/**
 * 二部图构建模块
 * 职责:BFS 可达性 + 配方节点的增产修正系数(原始比例,无归一化)+ 设备信息
 * 供 LP 构模(lp-model.js)与优化器 SCC 分组消费
 *
 * 图结构:配方节点(每配方一个变量 x_r,执行次数)+ 物品节点(守恒方程)。
 * 与旧 dag.js 的物品本位图不同,这里系数直译自配方原始比例:
 *   - outputs[r][k] = 原始产物[k] × 增产产出倍率(含联产物)
 *   - inputs[r][k]  = 原始原料[k](含按喷涂成本折算的增产剂投入)
 *   - 设备功耗作为 '电力' 原料边写入(inputs['电力'] += unitPowerCost)
 */

import { ApplyBuildingMultiplier, buildItemRecipeIndex } from '../game_data.jsx';

/**
 * 从需求出发构建二部图(BFS 可达性)
 * @param {Array} needs - 需求列表 [{id, name, count}]
 * @param {Array} recipes - recipe_data
 * @param {Object} gameData - 游戏数据
 * @param {Object} schemeData - 方案数据 {item_recipe_choices, scheme_for_recipe, selected_fuel}
 * @param {Object} settings - 设置(包含 mineralize_list、is_time_unit_minute 等)
 * @param {Array|null} sprayCosts - 增产剂喷涂成本 [null, cost1, cost2, cost3]
 * @param {Object} options - {excludeMinerPower: boolean} 不计挖矿电开关
 * @returns {{
 *   recipes: Map<string, {
 *     recipeId: string,
 *     outputs: Object,
 *     inputs: Object,
 *     buildingPower: {factoryName, singleExecBuildNumber, unitPowerCost, basePower, isMiner}|null,
 *     mainItem: string,
 *     proliferatorInfo: {level, mode},
 *   }>,
 *   items: Set<string>,
 *   demandByItem: Object,
 *   noRecipeItems: Set<string>,
 *   edges: Array<{from, to}>,
 *   proliferatorEdgeKeys: Set<string>,
 *   recipeOfItem: Map<string, string>,
 * }}
 */
export function buildRecipeGraph(needs, recipes, gameData, schemeData, settings = {}, sprayCosts = null, options = {}) {
    const excludeMinerPower = !!options.excludeMinerPower;
    const recipesOut = new Map();
    const items = new Set();
    const noRecipeItems = new Set();
    const demandByItem = {};
    const edges = [];
    const edgeSet = new Set();
    const proliferatorEdgeKeys = new Set();
    const recipeOfItem = new Map();

    const addEdge = (from, to, isProliferator) => {
        const key = `${from}->${to}`;
        if (edgeSet.has(key)) return;
        edgeSet.add(key);
        edges.push({from, to});
        if (isProliferator) proliferatorEdgeKeys.add(key);
    };

    // 物品可用配方列表(1-based 索引,与 item_recipe_choices 兼容)
    const itemData = buildItemRecipeIndex(recipes);

    // BFS 从需求出发:队列元素为物品名
    const queue = [];
    const enqueued = new Set();
    for (const need of needs) {
        demandByItem[need.id] = need.count;
        items.add(need.id);
        if (!enqueued.has(need.id)) {
            enqueued.add(need.id);
            queue.push(need.id);
        }
    }

    // 电力特殊处理:选定燃料时找到燃料配方索引
    const findFuelRecipeIndex = () => {
        const fuel = schemeData?.selected_fuel;
        if (!fuel || fuel === '无') return -1;
        for (let i = 0; i < recipes.length; i++) {
            if (recipes[i]?.isFuelRecipe && recipes[i]?.fuelName === fuel) return i;
        }
        return -1;
    };

    /**
     * 单配方入图:计算增产修正后的 outputs/inputs、设备数与耗电、投影边。
     * 修正逻辑移植自 dag.js 的 buildItemGraph(同一配方的行为保持一致)。
     * @param {number} recipeIndex - 配方在 recipe_data 中的下标
     * @param {string} forItemId - BFS 进入原因(触发此配方入图的物品)
     */
    const addRecipe = (recipeIndex, forItemId) => {
        const recipeKey = String(recipeIndex);
        // 同一配方只入图一次(联产物共享一个配方节点)
        if (recipesOut.has(recipeKey)) return;
        const recipe = recipes[recipeIndex];

        // ---- 增产剂修正:增产剂作为额外原料加入,增产模式下产出乘增产效果 ----
        const schemeRecipe = schemeData?.scheme_for_recipe?.[recipeIndex];
        // recipe.原料 格式: {物品: 数量}(对象格式),展开为数组 [{id, count}]
        const rawInputs = recipe.原料 || {};
        const modifiedInputs = Object.entries(rawInputs).map(([id, count]) => ({id, count}));
        let outputMultiplier = 1; // 产出倍率(增产模式下 > 1)
        const proliferatorItems = new Set(); // 本配方因喷涂加入的增产剂物品名

        const proMode = Number(schemeRecipe?.['增产模式']) || 0;
        const proLevel = Number(schemeRecipe?.['增产剂等级'] || schemeRecipe?.['增产点数']) || 0;

        if (proMode > 0 && proLevel > 0) {
            const proliferatorData = gameData.proliferator_data || [];
            const proliferatorEffect = gameData.proliferator_effect || [];
            const maxLevel = proliferatorData.length - 1;
            const safeLevel = Math.min(proLevel, maxLevel);

            const proItemName = proliferatorData[safeLevel]?.增产剂;
            const proEffect = proliferatorEffect[safeLevel];

            if (proItemName && proEffect) {
                // 使用预计算的喷涂成本,或回退到默认值
                const defaultCosts = [null, 1 / 12, 1 / 24, 1 / 60];
                const sprayCost = sprayCosts?.[safeLevel] ?? defaultCosts[safeLevel] ?? 0;

                if (sprayCost > 0) {
                    // 增产剂喷涂成本 = 配方原料总数 × 喷涂成本(倒数)
                    let totalMaterialCount = 0;
                    for (const input of modifiedInputs) {
                        totalMaterialCount += (input.count || 1);
                    }
                    const proAmount = totalMaterialCount * sprayCost;

                    modifiedInputs.push({id: proItemName, count: proAmount});
                    proliferatorItems.add(proItemName);

                    // 增产模式:产出倍率 × 增产效果
                    if (proMode === 2) {
                        outputMultiplier = proEffect['增产效果'] || 1;
                    }
                }
            }
        }

        // ---- 配方节点系数表:原始比例直译,无归一化 ----
        const outputsR = {};
        for (const [k, v] of Object.entries(recipe.产物 || {})) {
            outputsR[k] = (v || 0) * outputMultiplier; // 全部产物,含联产物
        }
        const inputsR = {};
        for (const input of modifiedInputs) {
            inputsR[input.id] = (inputsR[input.id] || 0) + (input.count || 0);
        }

        // ---- 设备数与耗电(移植自 dag.js)----
        let buildingPower = null;
        const factoryType = recipe.设施;
        if (recipe.Type === -2) {
            // 纯无中生有物品:设备数为0,不计算耗电
            buildingPower = {
                factoryName: null,
                singleExecBuildNumber: 0,
                unitPowerCost: 0,
                basePower: 0,
                isMiner: false,
            };
        } else if (factoryType !== undefined && factoryType !== null) {
            // factory_data 的键是字符串,需要转换
            const factoryData = gameData.factory_data?.[String(factoryType)];
            if (factoryData) {
                const buildingChoice = schemeRecipe?.['建筑'] || Object.keys(factoryData)[0];
                const factoryInfo = factoryData[buildingChoice];
                if (factoryInfo) {
                    const factoryName = factoryInfo['名称'];
                    const factorySpeed = factoryInfo['倍率'] || 1;
                    const factoryPower = factoryInfo['耗能'] || 0;
                    const timeTick = settings?.is_time_unit_minute ? 60 : 1;

                    // 净产出 = 总产出 - 自身消耗,再乘增产效果与建筑倍率
                    const totalOutput = recipe.产物?.[forItemId] || 0;
                    const selfConsumption = recipe.原料?.[forItemId] || 0;
                    let netOutput = totalOutput - selfConsumption;
                    if (netOutput > 0) {
                        if (proMode > 0 && proLevel > 0) {
                            const proEffect = gameData.proliferator_effect?.[proLevel];
                            if (proEffect) {
                                if (proMode === 1) {
                                    // 加速模式:净产出 × 加速效果
                                    netOutput *= proEffect['加速效果'] || 1;
                                } else if (proMode === 2) {
                                    // 增产模式:净产出 × 增产效果
                                    netOutput *= proEffect['增产效果'] || 1;
                                }
                            }
                        }

                        // 应用建筑倍率(采矿机/采集器等)
                        netOutput = ApplyBuildingMultiplier(netOutput, factoryName, forItemId, settings);

                        // 单次执行设备数 = 1 / timeTick / (净产出 / 时间) / 设备倍率
                        const outputRate = netOutput / (recipe.时间 || 1); // 每 tick 产出
                        const singleExecBuildNumber = 1 / timeTick / outputRate / factorySpeed;

                        // 单次执行耗电 = 单次执行设备数 × 额定功率
                        let unitPowerCost = singleExecBuildNumber * factoryPower;
                        // 大型采矿机特殊处理:耗电由开采效率决定
                        if (factoryName === '大型采矿机' && settings?.mining_efficiency_large) {
                            const eff = settings.mining_efficiency_large / 100.0;
                            unitPowerCost = (eff * eff * (2.94 - 0.168) + 0.168) / netOutput * timeTick;
                        }
                        // 分馏塔特殊处理:分馏速度超过面板值时耗电放大
                        if (factoryName.endsWith('分馏塔') && settings?.fractionating_speed > 30) {
                            const multiplier = (settings.fractionating_speed * 0.036 - 0.36) / 0.72;
                            unitPowerCost *= multiplier;
                        }
                        // 增产剂耗电倍率
                        if (proMode > 0 && proLevel > 0) {
                            const proEffect = gameData.proliferator_effect?.[proLevel];
                            if (proEffect) {
                                unitPowerCost *= proEffect['耗电倍率'] || 1;
                            }
                        }

                        buildingPower = {
                            factoryName,
                            singleExecBuildNumber,
                            unitPowerCost,
                            // 额定功率:发电建筑用"发电功率"字段(自身不耗电),其余用"耗能"
                            basePower: factoryInfo['发电功率'] ?? factoryPower,
                            isMiner: ['采矿机', '大型采矿机', '抽水站', '原油萃取站'].includes(factoryName),
                        };
                    }
                }
            }
        }

        // ---- 电力合一:设备功耗直接作为'电力'原料边写入守恒方程 ----
        // 不再写 $__factory_power__ / $__miner_power__,LP 中统一由'电力'物品平衡
        if (buildingPower?.unitPowerCost > 0 && !(excludeMinerPower && buildingPower.isMiner)) {
            inputsR['电力'] = (inputsR['电力'] || 0) + buildingPower.unitPowerCost;
        }

        // 主产物:优先 BFS 进入原因,否则产物表第一个键
        const mainItem = (forItemId !== undefined && outputsR[forItemId] !== undefined)
            ? forItemId
            : Object.keys(outputsR)[0];
        recipeOfItem.set(mainItem, recipeKey);

        recipesOut.set(recipeKey, {
            recipeId: recipeKey,
            outputs: outputsR,
            inputs: inputsR,
            buildingPower,
            mainItem,
            proliferatorInfo: {level: proLevel, mode: proMode},
        });

        // 物品投影边:主产物 → 各正系数输入;输入物品入队继续追溯
        for (const [k, coeff] of Object.entries(inputsR)) {
            if (coeff <= 0) continue;
            addEdge(mainItem, k, proliferatorItems.has(k));
            items.add(k);
            if (!enqueued.has(k)) {
                enqueued.add(k);
                queue.push(k);
            }
        }

        // 联产物:只登记进 items,不建边不入队(天然被守恒方程覆盖;
        // 其独立配方仅在它作为需求/原料被追溯时才入图)
        for (const coItem of Object.keys(outputsR)) {
            if (coItem === mainItem) continue;
            items.add(coItem);
        }
    };

    while (queue.length > 0) {
        const itemId = queue.shift();

        // 视为原矿的物品,跳过配方查找
        const mineralizeList = settings.mineralize_list || {};
        if (itemId in mineralizeList) {
            noRecipeItems.add(itemId);
            continue;
        }

        // 特殊处理"电力"物品:使用用户选择的燃料配方
        if (itemId === '电力') {
            const fuelIdx = findFuelRecipeIndex();
            if (fuelIdx === -1) {
                noRecipeItems.add(itemId);
                continue;
            }
            addRecipe(fuelIdx, itemId);
            continue;
        }

        // 从用户选择的主配方获取(choiceIndex 默认 1 与 item_recipe_choices 对齐)
        const choiceIndex = schemeData?.item_recipe_choices?.[itemId] ?? 1;
        const recipeIndex = itemData[itemId]?.[choiceIndex];
        if (recipeIndex === undefined || recipeIndex === null || !recipes[recipeIndex]) {
            noRecipeItems.add(itemId);
            continue;
        }
        addRecipe(recipeIndex, itemId);
    }

    // 收尾:noRecipeItems = items 中无任何已入图配方产出的项
    // (覆盖:未选定燃料的'电力'、真·无来源物品)。
    // 注意联产物(如精炼油之于原油精炼配方)不算无来源——其缺口由该配方的执行补足,
    // 若给联产物加 slack,min Σx+Σslack 会用 slack 直接填缺口而放弃多跑配方。
    const producerItems = new Set();
    for (const r of recipesOut.values()) {
        for (const k of Object.keys(r.outputs)) producerItems.add(k);
    }
    for (const it of items) {
        if (!producerItems.has(it)) noRecipeItems.add(it);
    }

    return {
        recipes: recipesOut,
        items,
        demandByItem,
        noRecipeItems,
        edges,
        proliferatorEdgeKeys,
        recipeOfItem,
    };
}
