import { DEBUG } from './debug.js';
/**
 * DAG层级计算模块
 * 职责：将物品关系转换为DAG并计算拓扑层级
 */

import { ApplyBuildingMultiplier, buildItemRecipeIndex } from '../game_data.jsx';
import { tarjanSCC as sharedTarjanSCC } from './graph-utils.js';

/**
 * Tarjan SCC算法实现（适配器：接受Map格式的graph）
 * @param {Map} graph - 物品图 {itemId: ItemNode}
 * @param {Array} edges - 边集合 [{from, to}]
 * @returns {Array<Set<string>>} SCC列表，每个SCC是成员节点的Set
 */
export function tarjanSCC(graph, edges = []) {
  return sharedTarjanSCC(new Set(graph.keys()), edges);
}

/**
 * 物品节点
 */
class ItemNode {
  constructor(id, name, depth = 0) {
    this.id = id;
    this.name = name;
    this.depth = depth;
    this.recipeId = null; // 主配方ID
    this.directCost = null; // 直接成本系数表（BFS时计算）
    this.dependents = []; // 依赖此物品的物品ID列表（用于代入展开）
  }
}

/**
 * 构建物品图（仅需求模式，BFS驱动）
 * @param {Array} needs - 需求列表 [{id, name, count}]
 * @param {Object} recipes - 配方数据
 * @param {Object} gameData - 游戏数据
 * @param {Object} schemeData - 方案数据（包含用户选择的主配方）
 * @param {Object} settings - 设置（包含mineralize_list）
 * @param {Array} sprayCosts - 增产剂喷涂成本 [null, cost1, cost2, cost3]
 * @param {Set} filterList - 过滤列表（上次迭代中的负需求物品，不寻找主配方，直接当原矿处理）
 * @returns {Object} {graph, edges} - 物品图和边集合
 */
export function buildItemGraph(needs, recipes, gameData, schemeData, settings = {}, sprayCosts = null, filterList = new Set()) {
  const graph = new Map();
  const edges = [];
  const edgeSet = new Set();
  const proliferatorEdgeKeys = new Set();
  const proliferatorItems = new Set(); // 记录所有增产剂物品名

  // 1. 构建item_data（物品可用配方列表）
  const recipeData = gameData.recipe_data || [];
  const itemData = buildItemRecipeIndex(recipeData);

  // 2. 初始化需求物品节点
  for (const need of needs) {
    if (!graph.has(need.id)) {
      graph.set(need.id, new ItemNode(need.id, need.name, 0));
    }
  }

  // 3. BFS驱动构建图，从需求物品出发，使用用户选择的主配方
  const reachable = new Set(needs.map(n => n.id));
  const queue = [...reachable];
  const processed = new Set();

  while (queue.length > 0) {
    const itemId = queue.shift();

    if (processed.has(itemId)) continue;
    processed.add(itemId);

    if (!graph.has(itemId)) {
      graph.set(itemId, new ItemNode(itemId, itemId, 0));
    }

    // 视为原矿的物品，跳过配方查找
    const mineralizeList = settings.mineralize_list || {};
    if (itemId in mineralizeList) {
      if (DEBUG) console.log(`[buildItemGraph] ${itemId} 在原矿化列表中，跳过配方查找`);
      continue;
    }

    // 过滤列表中的物品，不寻找主配方，直接当原矿处理
    if (filterList.has(itemId)) {
      if (DEBUG) console.log(`[buildItemGraph] ${itemId} 在过滤列表中，当原矿处理`);
      continue;
    }

    // 从用户选择的主配方获取
    let foundRecipe = null;

    // 特殊处理"电力"物品：使用用户选择的燃料配方
    if (itemId === '电力') {
      const selectedFuel = schemeData?.selected_fuel;
      if (selectedFuel && selectedFuel !== '无') {
        // 查找燃料配方
        for (let i = 0; i < recipes.length; i++) {
          if (recipes[i]?.isFuelRecipe && recipes[i]?.fuelName === selectedFuel) {
            foundRecipe = recipes[i];
            foundRecipe._id = i;
            break;
          }
        }
      }
      // 如果没有选择燃料或找不到配方，跳过（电力作为原始资源）
      if (!foundRecipe) {
        continue;
      }
    } else if (itemData[itemId] && itemData[itemId].length > 1) {
      const choiceIndex = schemeData?.item_recipe_choices?.[itemId] ?? 1;
      const recipeIndex = itemData[itemId][choiceIndex];

      if (DEBUG) console.log(`[buildItemGraph] ${itemId}: itemData=`, itemData[itemId], `choiceIndex=${choiceIndex}, recipeIndex=${recipeIndex}`);

      if (recipeIndex !== undefined && recipes[recipeIndex]) {
        foundRecipe = recipes[recipeIndex];
        foundRecipe._id = recipeIndex; // 临时存储索引
      }
    }

    if (!foundRecipe) {
      continue;
    }

    const recipeId = foundRecipe._id;
    const recipe = foundRecipe;
    const node = graph.get(itemId);
    node.recipeId = recipeId; // 设置配方ID

    // 修正配方：如果使用了增产剂，将增产剂作为原料加入配方
    const schemeRecipe = schemeData?.scheme_for_recipe?.[recipeId];
    // 原始数据格式：recipe.原料 是对象 {物品: 数量}，需要转换为数组 [{id, count}]
    const rawInputs = recipe.原料 || {};
    let modifiedInputs = Object.entries(rawInputs).map(([id, count]) => ({ id, count }));
    let outputMultiplier = 1; // 产出倍率（增产模式下 > 1）

    if (schemeRecipe) {
      const proMode = Number(schemeRecipe['增产模式']) || 0;
      const proLevel = Number(schemeRecipe['增产剂等级'] || schemeRecipe['增产点数']) || 0;

      if (proMode > 0 && proLevel > 0) {
        const proliferatorData = gameData.proliferator_data || [];
        const proliferatorEffect = gameData.proliferator_effect || [];
        const maxLevel = proliferatorData.length - 1;
        const safeLevel = Math.min(proLevel, maxLevel);

        // 获取增产剂物品名称和效果
        const proItemName = proliferatorData[safeLevel]?.增产剂;
        const proEffect = proliferatorEffect[safeLevel];

        if (proItemName && proEffect) {
          // 使用预计算的喷涂成本，或回退到默认值
          const defaultCosts = [null, 1/12, 1/24, 1/60];
          const sprayCost = sprayCosts?.[safeLevel] ?? defaultCosts[safeLevel] ?? 0;

          if (sprayCost > 0) {
            // 计算配方原料总数
            let totalMaterialCount = 0;
            for (const input of modifiedInputs) {
              totalMaterialCount += (input.count || 1);
            }

            // 增产剂喷涂成本 = 原料总数 * 喷涂成本（倒数）
            const proAmount = totalMaterialCount * sprayCost;

            // 将增产剂作为原料加入配方
            modifiedInputs.push({ id: proItemName, count: proAmount });
            proliferatorItems.add(proItemName);

            // 增产模式：产出倍率 * 增产效果
            if (proMode === 2) {
              outputMultiplier = proEffect['增产效果'] || 1;
            }
          }
        }
      }
    }

    // 计算设备数和耗电（增产剂处理完成后立即计算）
    // 纯无中生有物品（Type = -2）跳过设备数和耗电计算
    const factoryType = recipe.设施;
    if (recipe.Type === -2) {
      // 纯无中生有物品：设备数为0，不计算耗电
      node.buildingPower = {
        factoryName: null,
        singleExecBuildNumber: 0,
        unitPowerCost: 0,
        isMiner: false
      };
    } else if (factoryType !== undefined && factoryType !== null) {
      // factory_data 的键是字符串，需要转换
      const factoryKey = String(factoryType);
      const factoryData = gameData.factory_data?.[factoryKey];
      if (factoryData) {
        const buildingChoice = schemeRecipe?.["建筑"] || Object.keys(factoryData)[0];
        const factoryInfo = factoryData[buildingChoice];
        if (factoryInfo) {
          const factoryName = factoryInfo["名称"];
          const factorySpeed = factoryInfo["倍率"] || 1;
          const factoryPower = factoryInfo["耗能"] || 0;
          const timeTick = settings?.is_time_unit_minute ? 60 : 1;

          // 计算净产出（考虑增产剂效果和自身消耗）
          // recipe.产物 格式: {物品: 数量}（对象格式）
          // recipe.原料 格式: {物品: 数量}（对象格式）
          const totalOutput = recipe.产物?.[itemId] || 0;
          const selfConsumption = recipe.原料?.[itemId] || 0;
          // 净产出 = 总产出 - 自身消耗
          let netOutput = totalOutput - selfConsumption;
          if (netOutput > 0) {
            // 增产剂效果
            const proMode = Number(schemeRecipe?.['增产模式']) || 0;
            const proLevel = Number(schemeRecipe?.['增产剂等级'] || schemeRecipe?.['增产点数']) || 0;
            if (proMode > 0 && proLevel > 0) {
              const proEffect = gameData.proliferator_effect?.[proLevel];
              if (proEffect) {
                if (proMode === 1) {
                  // 加速模式：净产出 * 加速效果
                  const accEffect = proEffect["加速效果"] || 1;
                  netOutput *= accEffect;
                } else if (proMode === 2) {
                  // 增产模式：净产出 * 增产效果
                  const proEffectValue = proEffect["增产效果"] || 1;
                  netOutput *= proEffectValue;
                }
              }
            }

            // 应用建筑倍率（统一使用 ApplyBuildingMultiplier 函数）
            netOutput = ApplyBuildingMultiplier(netOutput, factoryName, itemId, settings || {});

            // 计算单次执行设备数（整合公式）
            // 公式: 单次执行设备数 = 1 / timeTick / (netOutput / recipe.时间) / factorySpeed
            const outputRate = netOutput / (recipe.时间 || 1); // 每秒产出
            const singleExecBuildNumber = 1 / timeTick / outputRate / factorySpeed;

            // 计算单次执行耗电 = 单次执行设备数 * 初始功率
            // 单位物品耗电 = 单次执行耗电 * $x（执行次数），在成本公式中累加
            let unitPowerCost = singleExecBuildNumber * factoryPower;
            // 特殊处理
            if (factoryName === "大型采矿机" && settings?.mining_efficiency_large) {
              const eff = settings.mining_efficiency_large / 100.0;
              const oldPower = unitPowerCost;
              unitPowerCost = (eff * eff * (2.94 - 0.168) + 0.168) / netOutput * timeTick;
              if (DEBUG) console.log(`[设备计算] ${itemId}: 大型采矿机特殊处理, 效率=${eff.toFixed(4)}, 单位物品耗电=${oldPower.toFixed(6)}->${unitPowerCost.toFixed(6)}`);
            }
            if (factoryName.endsWith("分馏塔") && settings?.fractionating_speed > 30) {
              const multiplier = (settings.fractionating_speed * 0.036 - 0.36) / 0.72;
              const oldPower = unitPowerCost;
              unitPowerCost *= multiplier;
              if (DEBUG) console.log(`[设备计算] ${itemId}: 分馏塔特殊处理, 分馏速度=${settings.fractionating_speed}, 倍率=${multiplier.toFixed(4)}, 单位物品耗电=${oldPower.toFixed(6)}*${multiplier.toFixed(4)}=${unitPowerCost.toFixed(6)}`);
            }
            if (proMode > 0 && proLevel > 0) {
              const proEffect = gameData.proliferator_effect?.[proLevel];
              if (proEffect) {
                const powerMultiplier = proEffect["耗电倍率"] || 1;
                const oldPower = unitPowerCost;
                unitPowerCost *= powerMultiplier;
              }
            }

            // 存储到节点
            node.buildingPower = {
              factoryName,
              singleExecBuildNumber,
              unitPowerCost,
              isMiner: ["采矿机", "大型采矿机", "抽水机", "原油萃取站"].includes(factoryName)
            };
          }
        }
      }
    }

    // 存储增产剂信息到节点（用于调试日志）
    const proMode = Number(schemeRecipe?.['增产模式']) || 0;
    const proLevel = Number(schemeRecipe?.['增产剂等级'] || schemeRecipe?.['增产点数']) || 0;
    node.proliferatorInfo = { level: proLevel, mode: proMode };

    // 计算直接成本公式（仅为主物品，不为副产物建公式）
    // 增产模式下，产出 = 原产出 * 产出倍率
    // recipe.产物 格式: {物品: 数量}（对象格式）
    const outputCount = (recipe.产物?.[itemId] || 1) * outputMultiplier;
    const selfInput = modifiedInputs.find(i => i.id === itemId)?.count || 0;
    const netProduction = outputCount - selfInput;

    const directCost = { [`$${itemId}`]: 1 };
    const byproducts = []; // 独立数组存储副产物
    for (const input of modifiedInputs) {
      if (input.id === itemId) continue;
      const ratio = (input.count || 1) / netProduction;
      directCost[input.id] = (directCost[input.id] || 0) + ratio;
    }
    // recipe.产物 是对象格式，需要遍历对象
    for (const [outputId, count] of Object.entries(recipe.产物 || {})) {
      if (outputId !== itemId) {
        const ratio = ((count || 1) * outputMultiplier) / netProduction;
        directCost[outputId] = (directCost[outputId] || 0) - ratio;
        byproducts.push(outputId); // 记录副产物
      }
    }
    node.byproducts = byproducts;

    // 自消耗系数 = 自身输入 / 净产出（已有值，无需重复计算）
    // 毛产出 = 执行次数 × (1 + 自消耗系数)
    node.selfConsumption = (selfInput > 0 && netProduction > 0) ? selfInput / netProduction : 0;

    // 将耗电加入到直接成本公式中（乘以执行次数 $x）
    // 单位物品耗电 = 单次执行耗电 * $x
    // 保持生产/挖矿电力区分，同时让它们都依赖"电力"物品
    if (node.buildingPower?.unitPowerCost) {
      const powerKey = node.buildingPower.isMiner ? '$__miner_power__' : '$__factory_power__';
      directCost[powerKey] = (directCost[powerKey] || 0) + node.buildingPower.unitPowerCost;
      // 同时添加对"电力"物品的依赖
      directCost['电力'] = (directCost['电力'] || 0) + node.buildingPower.unitPowerCost;
    }

    // 精确计算，不进行四舍五入

    node.directCost = directCost;

    // 设置 dependents 反向映射 + 建立依赖边 + 原料入队（合并为单次遍历）
    for (const [key, coeff] of Object.entries(directCost)) {
      if (key.startsWith('$')) continue;
      if (coeff <= 0) continue;

      // 设置 dependents
      if (!graph.has(key)) {
        graph.set(key, new ItemNode(key, key, 0));
      }
      const depNode = graph.get(key);
      if (!depNode.dependents.includes(itemId)) {
        depNode.dependents.push(itemId);
      }

      // 只为主产物（当前物品）→ 原料 建立边
      // 联产物（如氢）不应该建立边进入 SCC，它们只是副产物
      if (!graph.has(itemId)) {
        graph.set(itemId, new ItemNode(itemId, itemId, 0));
      }
      const edgeKey = `${itemId}->${key}`;
      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey);
        edges.push({ from: itemId, to: key });
        if (proliferatorItems.has(key)) {
          proliferatorEdgeKeys.add(edgeKey);
        }
      }

      // 原料入队继续追溯
      if (!reachable.has(key)) {
        reachable.add(key);
        queue.push(key);
      }
    }

    // 为跨配方的副产物建立SCC边（跳过同一配方的联产物）
    // 联产物（同一配方的多个产物）天然抵消，不需要进入SCC
    // 只有跨配方的副产物（如高能石墨）才需要建立SCC边
    for (const [key, coeff] of Object.entries(directCost)) {
      if (key.startsWith('$')) continue;
      if (coeff >= 0) continue;  // 只处理负系数（副产物/联产物）

      // 跳过联产物：如果负系数的物品也是当前配方的产物，则是联产物
      if (recipe.产物 && key in recipe.产物) {
        continue;  // 联产物，不建立SCC边
      }

      // 跨配方的副产物：建立SCC边，但不入队
      // 副产物是产出的物品，不需要追溯其原料
      if (!graph.has(key)) {
        graph.set(key, new ItemNode(key, key, 0));
      }

      // 只为主产物（当前物品）→ 副产物 建立边
      // 联产物不应该建立边进入 SCC
      if (!graph.has(itemId)) {
        graph.set(itemId, new ItemNode(itemId, itemId, 0));
      }
      const edgeKey = `${itemId}->${key}`;
      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey);
        edges.push({ from: itemId, to: key });
      }

      // 副产物不入队！只建立SCC边
      // 副产物是产出的物品，不需要追溯其原料
    }
  }

  return { graph, edges, proliferatorEdgeKeys };
}
