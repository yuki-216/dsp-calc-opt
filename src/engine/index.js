/**
 * 核心计算引擎主入口(LP 方案)
 * 职责:二部图构建 → LP 构模 → HiGHS 求解 → 结果映射
 */

import {buildRecipeGraph} from './bipartite-graph.js';
import {buildLPModel, parseSlackItem} from './lp-model.js';
import {solveLP} from './lp-solver.js';
import {getPowerDeviceCount} from '../power-device-count.js';

// 变量级零过滤:LP 解中理论为 0 的变量可能带 ~1e-9 数值噪声,统一过滤。
// (守恒平衡残差容差见守恒重算段的相对 EPS,二者语义不同)
const ZERO_EPS = 1e-9;

export class CoreEngine {
  static VERSION = 'lp-v1';

  constructor(gameData, schemeData, settings = {}, sprayCosts = null) {
    this.gameData = gameData;
    this.schemeData = schemeData;
    this.settings = settings;
    this.sprayCosts = sprayCosts;
    this.graph = null;
    this.edges = [];
    this.proliferatorEdgeKeys = new Set();
  }

  /**
   * 获取配方数据
   * @param {string|number} recipeId - 配方ID
   * @returns {Object} 配方数据
   */
  getRecipeById(recipeId) {
    return this.gameData?.recipe_data?.[Number(recipeId)];
  }

  /**
   * 主计算(LP 方案)
   * @param {Array} needs - 需求列表 [{id, name, count}]
   * @param {Array} recipes - recipe_data
   * @param {Set} initialFilterList - 向后兼容位(忽略)
   * @param {boolean} measurementMode - 向后兼容位(忽略)
   * @param {Function|null} onLog - 日志回调
   * @returns {Object} 聚合结果(字段清单见规格)
   */
  // initialFilterList/measurementMode/onLog 为向后兼容位:旧调用方仍按位置传参,
  // 参数必须保留但引擎不再读取(no-op)。
  async calculate(needs, recipes, initialFilterList = new Set(), measurementMode = false, onLog = null) { // eslint-disable-line no-unused-vars
    const excludeMinerPower = !!this.settings.exclude_miner_power;

    // 1. 二部图
    this.graph = buildRecipeGraph(needs, recipes, this.gameData, this.schemeData, this.settings, this.sprayCosts, {excludeMinerPower});
    this.edges = this.graph.edges;
    this.proliferatorEdgeKeys = this.graph.proliferatorEdgeKeys;

    // 2. 构模 + 求解
    const {model, varToRecipe} = buildLPModel(this.graph);
    const lpResult = await solveLP(model);

    if (lpResult.status === 'Infeasible') {
      // 诊断:找没有任何产出配方的需求物品
      const orphanNeeds = [];
      for (const need of needs) {
        const hasSource = [...this.graph.recipes.values()].some(r => r.outputs[need.id]);
        if (!hasSource) {
          orphanNeeds.push(this.graph.noRecipeItems.has(need.id)
            ? `${need.id}(视为原矿,无外部来源)`
            : `${need.id}(无生产链可达)`);
        }
      }
      throw new Error(`无可行解:以下物品无法获得:${orphanNeeds.join(', ') || '(未知)'}`);
    }
    if (lpResult.status !== 'Optimal') {
      throw new Error(`LP 求解失败:${lpResult.status}`);
    }

    // 3. 结果映射
    const recipeExecutions = {};
    const surplusByproducts = {};
    const resourceUsage = {};
    const execByRecipe = new Map(); // recipeKey -> x

    for (const [varName, xVal] of Object.entries(lpResult.x)) {
      const recipeKey = varToRecipe.get(varName);
      if (recipeKey === undefined) continue; // slack 变量等非配方变量跳过
      const r = this.graph.recipes.get(recipeKey);
      if (!r) continue;
      execByRecipe.set(recipeKey, xVal);
    }

    // 松弛量:用解代入守恒行重算(lhs − rhs),避免依赖求解器对偶值
    // surplus > 0 → surplusByproducts(正值=多余量;含仅以联产物身份出现的物品)
    // surplus < 0 且物品无配方 → resourceUsage 正值(外部获取缺口)
    for (const item of this.graph.items) {
      let lhs = 0;
      for (const [recipeKey, xVal] of execByRecipe) {
        const r = this.graph.recipes.get(recipeKey);
        lhs += (r.outputs[item] || 0) * xVal - (r.inputs[item] || 0) * xVal;
      }
      const rhs = this.graph.demandByItem[item] || 0;
      const surplus = lhs - rhs;

      // 相对容差:rhs(该物品需求)越大容差越宽、越小越严格——挡 ~1e-4~1e-6 量级的 LP 数值噪声
      const EPS = 1e-6 * Math.max(1, Math.abs(rhs));

      if (surplus > EPS) {
        surplusByproducts[item] = surplus;
      } else if (surplus < -EPS && !this.graph.recipeOfItem.has(item)) {
        resourceUsage[item] = -surplus;
      }
    }

    // 展示主物品:多产物配方把设备/产量/联产来源归到"未多余(实际消耗)"的产物,
    // 消除 BFS 入图顺序漂移(原 mainItem 仅由触发顺序决定)。recipeOfItem/resourceUsage
    // 仍用图构建时的 mainItem。规则:surplus 最小(最紧缺)优先;平局取净产出最大;
    // 候选已被其他配方作为主物品(key 冲突)时回退原 mainItem。
    const displayMainByRecipe = new Map();
    {
      const allMainItems = new Set();
      for (const r of this.graph.recipes.values()) allMainItems.add(r.mainItem);
      for (const [recipeKey, r] of this.graph.recipes) {
        const outputs = Object.keys(r.outputs);
        let dm = r.mainItem;
        if (outputs.length > 1) {
          let bestSurplus = Infinity, bestNet = -Infinity;
          for (const o of outputs) {
            if (o !== r.mainItem && allMainItems.has(o)) continue;
            const sur = surplusByproducts[o] || 0; // 未多余→0,多余→正
            const net = (r.outputs[o] || 0) - (r.inputs[o] || 0);
            if (sur < bestSurplus - 1e-9 || (Math.abs(sur - bestSurplus) <= 1e-9 && net > bestNet)) {
              dm = o;
              bestSurplus = sur;
              bestNet = net;
            }
          }
        }
        displayMainByRecipe.set(recipeKey, dm);
      }
    }

    // 执行次数(展示口径,归到展示主物品)
    for (const [recipeKey, xVal] of execByRecipe) {
      if (xVal <= ZERO_EPS) continue;
      const dm = displayMainByRecipe.get(recipeKey);
      recipeExecutions[dm] = (recipeExecutions[dm] || 0) + xVal;
    }

    // 主物品净产量(UI 展示口径)= 执行次数 × 单次净产出(修正后系数 outputs−inputs,
    // 已含增产修正)。recipeExecutions 是"执行次数"契约(spec §5);旧引擎配方归一化
    // 使执行次数恰好等于净产量,LP 原始比例直译后多产物配方两者相差一个单次产出倍数
    // (如可燃冰2→石墨烯2+氢1 跑30次:次数30、产量60),展示层必须用本字段。
    const productionByItem = {};
    for (const [recipeKey, xVal] of execByRecipe) {
      if (xVal <= ZERO_EPS) continue;
      const r = this.graph.recipes.get(recipeKey);
      const dm = displayMainByRecipe.get(recipeKey);
      const netOut = (r.outputs[dm] || 0) - (r.inputs[dm] || 0);
      if (netOut <= 0) continue; // 净产出非正的转换配方无"产量"可言
      productionByItem[dm] = (productionByItem[dm] || 0) + xVal * netOut;
    }

    // 真·无配方物品的缺口:slack 变量的取值即"外部获取量",计入 resourceUsage 正值
    for (const [varName, xVal] of Object.entries(lpResult.x)) {
      const slackItem = parseSlackItem(varName);
      if (slackItem === null) continue;
      if (xVal > ZERO_EPS) resourceUsage[slackItem] = xVal;
    }

    // 原矿采集配方(原料表为空+单产物):采集量 = 执行次数 × 单次产量,映射进 resourceUsage
    // (与旧引擎 $原矿 执行次数同源)。这类物品走正常配方路径,绝不加 slack,
    // 守恒行恰好平衡不会进入上面的 surplus 分支,需在此单独登记。
    for (const [recipeKey, xVal] of execByRecipe) {
      if (xVal <= ZERO_EPS) continue;
      const r = this.graph.recipes.get(recipeKey);
      const raw = recipes[Number(r.recipeId)];
      if (!raw) continue;
      const isEmptyInput = Object.keys(raw.原料 || {}).length === 0;
      const isSingleOutput = Object.keys(raw.产物 || {}).length === 1;
      if (isEmptyInput && isSingleOutput) {
        const gathered = (r.outputs[r.mainItem] || 0) * xVal;
        if (gathered > 0) resourceUsage[r.mainItem] = (resourceUsage[r.mainItem] || 0) + gathered;
      }
    }

    // 电力聚合(规格 §7.2):总耗电 = 所有配方的电力输入 × 执行次数 之和。
    // energyCost/minerEnergyCost 双轨合并:两者同值 = totalEnergyCost;
    // minerEnergyCost 字段名保留仅为兼容 result.jsx 现有解构,UI 只显示总数。
    let totalEnergyCost = 0;
    let grossPowerGeneration = 0; // 需求电力修复:总发电量 = Σ燃料配方电力输出×次数
    for (const [recipeKey, xVal] of execByRecipe) {
      const r = this.graph.recipes.get(recipeKey);
      totalEnergyCost += (r.inputs['电力'] || 0) * xVal;
      grossPowerGeneration += (r.outputs['电力'] || 0) * xVal;
    }
    const energyCost = totalEnergyCost;
    const minerEnergyCost = 0; // 双轨取消;字段保留兼容,UI 只读 totalEnergyCost
    // 需求电力修复:选了燃料时 = 总发电量(LP 守恒 gross ≥ 设备自耗 + 净需求,min Σx 下恰平衡);
    // 未选燃料时 = 设备自耗 + 净需求缺口(本次不展示,仅兜底字段)。
    const netPowerDemand = this.graph.demandByItem['电力'] || 0;
    const totalPowerDemand = grossPowerGeneration > 0
      ? grossPowerGeneration
      : (totalEnergyCost + netPowerDemand);

    // 4. 设备数量(沿用 buildingPower 公式)
    const buildingDetails = {};
    const buildingList = {};
    for (const [recipeKey, xVal] of execByRecipe) {
      if (xVal <= ZERO_EPS) continue;
      const r = this.graph.recipes.get(recipeKey);
      const bp = r.buildingPower;
      if (!bp || !bp.factoryName) continue;
      const buildNumber = xVal * bp.singleExecBuildNumber;
      const itemKey = displayMainByRecipe.get(recipeKey);
      buildingDetails[itemKey] = {
        factoryName: bp.factoryName,
        设备数量: buildNumber,
        执行次数: xVal,
        单次执行设备数: bp.singleExecBuildNumber,
        额定功率: bp.basePower,
      };
      const ceilBuildNumber = Math.ceil(buildNumber);
      if (ceilBuildNumber > 0) buildingList[bp.factoryName] = (buildingList[bp.factoryName] || 0) + ceilBuildNumber;
    }

    // 发电设备数(getPowerDeviceCount 衔接,数值与置顶电力行一致)
    const selectedFuel = this.schemeData?.selected_fuel;
    if (selectedFuel && selectedFuel !== '无' && totalPowerDemand > 0) {
      const fuelRecipe = recipes.find(r => r.isFuelRecipe && r.fuelName === selectedFuel);
      if (fuelRecipe) {
        const factoryKey = String(fuelRecipe.设施);
        const genBuilding = this.gameData.factory_data?.[factoryKey]?.[0];
        const devicePower = genBuilding?.['发电功率'] ?? genBuilding?.['耗能'] ?? 0;
        const deviceName = genBuilding?.['名称'];
        const recipeId = fuelRecipe._id !== undefined ? fuelRecipe._id : recipes.indexOf(fuelRecipe);
        const schemeRecipe = this.schemeData?.scheme_for_recipe?.[recipeId];
        const proMode = Number(schemeRecipe?.['增产模式']) || 0;
        const proLevel = Number(schemeRecipe?.['增产剂等级'] || schemeRecipe?.['增产点数']) || 0;
        const correctedCount = getPowerDeviceCount({
          totalEnergy: totalPowerDemand, devicePower,
          proliferatorEffects: this.gameData.proliferator_effect,
          proliferatorLevel: proLevel, proliferatorMode: proMode,
        });
        if (!buildingDetails['电力']) {
          buildingDetails['电力'] = {factoryName: deviceName, 设备数量: 0, 执行次数: 0, 单次执行设备数: 0, 额定功率: devicePower};
        }
        buildingDetails['电力'].factoryName = deviceName;
        buildingDetails['电力'].额定功率 = devicePower;
        buildingDetails['电力'].设备数量 = correctedCount;
        const ceilCount = Math.ceil(correctedCount);
        if (ceilCount > 0) buildingList[deviceName] = ceilCount;
        else delete buildingList[deviceName];
      }
    }

    // 5. 占地(公式移植自旧版 index.js,l/n/factoryName 判定不变,
    //    数据源从 node.buildingPower 改为 r.buildingPower + recipe 原始表)
    const footprintDetails = {};
    let totalFootprint = 0;
    const stackM = this.settings?.stack_research_lab || 15;
    // 主产物→配方索引,避免循环内 find 造成 O(配方数²)
    const recipeByMainItem = new Map();
    for (const r of this.graph.recipes.values()) recipeByMainItem.set(displayMainByRecipe.get(r.recipeId), r);
    for (const [itemKey, detail] of Object.entries(buildingDetails)) {
      if (detail.设备数量 <= 0) continue;
      const r = recipeByMainItem.get(itemKey);
      if (!r) continue;
      const recipe = recipes[Number(r.recipeId)];
      if (!recipe) continue;

      const n = Math.ceil(detail.设备数量);
      const factoryName = detail.factoryName;
      const l = Object.keys(recipe.原料 || {}).length + Object.keys(recipe.产物 || {}).length;

      let area = 0;
      if (factoryName.includes('制造台')) {
        area = (4 * n - 1) * (3 + l / 2);
      } else if (factoryName.includes('熔炉')) {
        area = 3 * n * (3 + l / 2);
      } else if (factoryName === '原油精炼厂') {
        area = 3 * n * (6 + l / 2);
      } else if (factoryName.includes('分馏塔')) {
        area = (11 / 2) * (4 * n - 1);
      } else if (factoryName.includes('化工厂')) {
        area = 7 * n * (4 + l / 2);
      } else if (factoryName === '微型粒子对撞机') {
        area = 5 * n * (9 + l / 2);
      } else if (factoryName.includes('研究站')) {
        const researchStations = Math.ceil(n / stackM);
        if (Number(r.recipeId) === 73) { // 宇宙矩阵配方索引
          area = 12 * (5.5 * researchStations);
        } else {
          area = 5 * researchStations * (5 + l / 2);
        }
      } else if (factoryName === '射线接收站') {
        area = Math.pow(8 * Math.sqrt(n) - 1, 2);
      } else if (factoryName === '人造恒星') {
        area = 49;
      } else if (factoryName === '火力发电厂' || factoryName === '微型聚变发电站') {
        area = 28;
      }

      footprintDetails[itemKey] = {area, n, l, factoryName};
      totalFootprint += area;
    }

    // 6. selfConsumption 与 byproductSources 重导出(来源指向展示主物品)
    const selfConsumption = {};
    const byproductSources = {};
    for (const [recipeKey, r] of this.graph.recipes) {
      const dm = displayMainByRecipe.get(recipeKey);
      const sc = (r.inputs[dm] || 0);
      const gross = r.outputs[dm] || 0;
      if (gross > 0 && sc > 0) {
        // 毛产量 = 净产量 × (1 + selfConsumption);净产量 = max(outputs-mainInputs, ε)
        const net = Math.max(gross - sc, 1e-12);
        selfConsumption[dm] = sc / net;
      }
      for (const [coItem, qty] of Object.entries(r.outputs)) {
        if (coItem === dm) continue;
        byproductSources[coItem] = byproductSources[coItem] || {};
        // 累加而非覆盖:两配方同展示主物品时保留双份贡献(防御性)
        byproductSources[coItem][dm] = (byproductSources[coItem][dm] || 0) + qty / Math.max(gross - (r.inputs[dm] || 0), 1e-12);
      }
    }

    return {
      resourceUsage, surplusByproducts, recipeExecutions, productionByItem,
      buildingDetails, buildingList, selfConsumption, byproductSources,
      energyCost, minerEnergyCost, totalEnergyCost, totalPowerDemand,
      footprintDetails, totalFootprint,
      graph: this.graph, edges: this.edges, proliferatorEdgeKeys: this.proliferatorEdgeKeys,
    };
  }
}

export default CoreEngine;
