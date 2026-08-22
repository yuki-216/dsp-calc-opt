import { DEBUG } from './debug.js';
/**
 * 核心计算引擎主入口
 * 职责：整合DAG、SCC、单位成本（系数表+矩阵求逆）
 */

import { buildItemGraph, tarjanSCC } from './dag.js';
import { expandInSCCOrder } from './unit-cost.js';
import { getPowerDeviceCount } from '../power-device-count.js';

/**
 * 核心计算引擎
 */
export class CoreEngine {
  static VERSION = 'current';

  constructor(gameData, schemeData, settings = {}, sprayCosts = null) {
    this.gameData = gameData;
    this.schemeData = schemeData;
    this.settings = settings;
    this.sprayCosts = sprayCosts;
    this.recipeMap = new Map();
    this.graph = null;
    this.edges = [];
    this.sccs = [];
    this.proliferatorEdgeKeys = new Set();
  }

  /**
   * 获取配方数据
   * @param {string|number} recipeId - 配方ID
   * @returns {Object} 配方数据
   */
  getRecipeById(recipeId) {
    return this.recipeMap.get(String(recipeId));
  }

  /**
   * 初始化引擎
   * @param {Array} needs - 需求列表
   * @param {Object} recipes - 配方数据
   * @param {Set} filterList - 过滤列表（上次迭代中的负需求物品）
   */
  initialize(needs, recipes, filterList = new Set()) {
    // 构建配方映射（确保键是字符串类型）
    for (const [id, recipe] of Object.entries(recipes)) {
      this.recipeMap.set(String(id), recipe);
    }

    // 1. 构建物品图（BFS从需求出发，使用用户选择的主配方）
    const result = buildItemGraph(needs, recipes, this.gameData, this.schemeData, this.settings, this.sprayCosts, filterList);
    this.graph = result.graph;
    this.edges = result.edges;
    this.proliferatorEdgeKeys = result.proliferatorEdgeKeys || new Set();

    // 2. SCC算法识别所有SCC（包括单节点和循环组）
    // Tarjan输出顺序：拓扑逆序（第一个SCC是最顶层需求，最后一个SCC是最底层资源）
    this.sccs = tarjanSCC(this.graph, this.edges);
  }

  /**
   * 检测循环组中的共生产品组（同一配方的多个产物在同一 SCC 内，如 原油精炼 产出 氢+精炼油），
   * 并通过"一步递归测量"选择胜者代表：
   *   对每个候选代表，把联产品视为外部来源（加入过滤列表）整线重算一次，
   *   读取联产品多余量（负余额），按 coOutput 折算成配方运行次数，取最小者。
   * 原理：正确的代表是生产递归"多余量被消耗完才生产、没消耗完就抵消"的稳定不动点——
   * 联产品多余量最小（可被内生需求自我消耗），而非失控放大造成的持续浪费。
   * @param {Array} needs - 需求列表
   * @param {Object} recipes - 配方数据
   * @returns {Map|null} recipeId -> 胜者代表；无共生产品组时返回 null
   */
  detectAndSelectCoproductRepresentatives(needs, recipes, onLog = null) {
    if (onLog) onLog(`[共生产品][DBG] detect entered; onLog=${typeof onLog}; sccs=${this.sccs ? this.sccs.length : 'null'}`);
    const emitCoproductLog = (msg) => { if (onLog) onLog(msg); };
    // 1. 按配方分组检测共生产品组（多节点 SCC 内、同配方产物 ≥2）
    const recipeGroups = new Map(); // recipeId(string) -> [itemIds]
    for (const scc of this.sccs || []) {
      if (scc.size <= 1) continue;
      for (const itemId of scc) {
        const node = this.graph.get(itemId);
        const recipeId = node?.recipeId;
        if (recipeId == null) continue;
        const key = String(recipeId);
        if (!recipeGroups.has(key)) recipeGroups.set(key, []);
        recipeGroups.get(key).push(itemId);
      }
    }
    const groups = [...recipeGroups.entries()].filter(([, items]) => items.length > 1);
    if (onLog) onLog(`[共生产品][DBG] groupsLen=${groups.length}`);
    if (groups.length === 0) {
      emitCoproductLog('[共生产品] 未检测到共生产品组（无同配方多产物循环组），沿用默认代表');
      return null;
    }
    emitCoproductLog(`[共生产品] 检测到 ${groups.length} 个共生产品组: ` + groups.map(([k, items]) => `${k}[${items.join(',')}]`).join('; '));

    // 2. 对每个组做测量选择（先支持多组分别处理；组内组合爆炸留作后续）
    const coproductRepMap = new Map();
    for (const [recipeKey, items] of groups) {
      const recipe = this.recipeMap.get(recipeKey);
      const outputs = recipe?.产物 || {};
      let bestRep = items[0];
      let bestRuns = Infinity;

      for (const candidate of items) {
        // 联产品 = 组内其他物品；测量时全部视为外部来源
        const coProducts = items.filter(id => id !== candidate);
        const measureResult = this.calculate(needs, recipes, new Set(coProducts), true);
        let coRuns = 0;
        let valid = true; // 候选是否适合做代表：其联产品必须过剩，否则该候选本身才是紧缺品
        for (const co of coProducts) {
          const balance = measureResult.resourceUsage?.[co] ?? 0;
          if (onLog) onLog(`[共生产品][DBG] 测量 candidate=${candidate} co=${co} balance=${balance} hasRU=${!!measureResult.resourceUsage}`);
          if (balance < 0) {
            const coOutput = outputs[co] || 1;
            coRuns += -balance / coOutput;
          } else {
            // 联产品仍紧缺（balance>=0）：说明该候选做代表会导致联产品短缺，候选本身应是被需要的紧缺品，不应当选代表
            valid = false;
          }
        }
        emitCoproductLog(`[共生产品] 配方 ${recipeKey} 候选代表=${candidate}: 联产品多余折算运行次数=${coRuns.toFixed(6)} (有效=${valid})`);
        if (valid && coRuns < bestRuns) {
          bestRuns = coRuns;
          bestRep = candidate;
        }
      }

      coproductRepMap.set(recipeKey, bestRep);
      emitCoproductLog(`[共生产品] 配方 ${recipeKey} 采用代表=${bestRep}（最小多余 ${bestRuns.toFixed(6)} 次运行）`);
    }
    return coproductRepMap;
  }

  /**
   * 主计算函数（系数表 + 矩阵求逆方案）
   * @param {Array} needs - 需求列表
   * @param {Object} recipes - 配方数据
   * @param {Set} initialFilterList - 初始过滤列表（把物品视为原矿；共生产品测量时传入联产品）
   * @param {boolean} measurementMode - 测量模式：true 时跳过共生产品组检测（防递归嵌套）
   * @returns {Object} 计算结果 {resourceUsage, power, buildings, footprint}
   */
  calculate(needs, recipes, initialFilterList = new Set(), measurementMode = false, onLog = null) {
    if (DEBUG) console.log('[Engine] ====== 计算开始 ======');
    if (DEBUG) console.log('[Engine] 需求:', needs.map(n => n.name + '×' + n.count).join(', '));

    // 迭代过滤逻辑（初始过滤列表：测量时把联产品视为原矿）
    const filterList = new Set(initialFilterList);
    let iteration = 0;
    const maxIterations = 10; // 最大迭代次数
    let costs = new Map();
    const SOLUTION_ID = '__solution__';

    // 共生产品组检测与胜者代表选择（主计算专用，测量计算跳过以避免递归嵌套）
    let coproductRepMap = null;
    if (!measurementMode) {
      this.initialize(needs, recipes, filterList);
      coproductRepMap = this.detectAndSelectCoproductRepresentatives(needs, recipes, onLog);
    }

    while (iteration < maxIterations) {
      iteration++;
      if (DEBUG) console.log(`[Engine] ====== 迭代 ${iteration} ======`);
      if (filterList.size > 0) {
        if (DEBUG) console.log(`[Engine] 过滤列表:`, [...filterList].join(', '));
      }

      // 1. 初始化（设备数和耗电已在 dag.js 中计算，存储在 node.buildingPower）
      this.initialize(needs, recipes, filterList);

      if (DEBUG) console.log('[Engine] 图节点数:', this.graph.size);

      // 2. 创建虚拟"解"物品和虚拟配方
      const solutionNode = {
        id: SOLUTION_ID,
        name: '解',
        recipeId: null,
        directCost: {},
        dependents: [],
        inputs: [],
        outputs: []
      };

      // 虚拟配方：需求表中的物品作为输入，产出1个"解"
      // 注意：这里用物品数量（没有$前缀），不是执行次数
      for (const need of needs) {
        solutionNode.directCost[need.id] = need.count;

        // 补上依赖边：需求物品的dependents包含解
        const needNode = this.graph.get(need.id);
        if (needNode && !needNode.dependents.includes(SOLUTION_ID)) {
          needNode.dependents.push(SOLUTION_ID);
        }
      }

      // 将"解"添加到图中
      this.graph.set(SOLUTION_ID, solutionNode);

      // 3. 计算所有物品的直接成本（系数表）
      costs = new Map();
      for (const [itemId, node] of this.graph) {
        // 直接使用节点已有的 directCost（BFS阶段已计算）
        costs.set(itemId, node.directCost || { [`$${itemId}`]: 1 });
      }
      // 添加 solution 的成本
      costs.set(SOLUTION_ID, solutionNode.directCost);


      // 4. 按 SCC 逆序展开成本到 solution（从顶层开始）
      const { negativeDemandItems } = expandInSCCOrder(SOLUTION_ID, costs, this.graph, this.sccs, this.recipeMap, coproductRepMap, onLog);

      // 5. 检查是否需要迭代
      // 检查是否有新的负需求物品（不在过滤列表中的）
      const newNegativeItems = [...negativeDemandItems].filter(id => !filterList.has(id));
      if (newNegativeItems.length === 0) {
        if (DEBUG) console.log(`[Engine] 迭代 ${iteration} 完成，没有新的负需求物品，停止迭代`);
        break;
      }

      // 更新过滤列表
      for (const itemId of newNegativeItems) {
        filterList.add(itemId);
      }
      if (DEBUG) console.log(`[Engine] 迭代 ${iteration} 完成，发现新的负需求物品:`, newNegativeItems.join(', '));
      if (DEBUG) console.log(`[Engine] 更新过滤列表:`, [...filterList].join(', '));
    }

    // 6. 获取"解"的成本并缩放
    let solutionCost = costs.get(SOLUTION_ID);

    if (DEBUG) console.log('[Engine] 展开后 solutionCost:', JSON.stringify(solutionCost));

    const recipeExecutions = {};
    const surplusByproducts = {};
    const resourceUsage = {};
    let energyCost = 0; // 生产设备耗电
    let minerEnergyCost = 0; // 采集设备耗电

    if (solutionCost) {
      // "解"的成本是生产1个"解"需要的资源
      // 由于"解"的虚拟配方是 需求物品*数量 -> 解*1
      // 所以解的成本已经是按需求量缩放后的结果
      for (const [key, coeff] of Object.entries(solutionCost)) {
        if (key.startsWith('$')) {
          const execItem = key.slice(1);
          // 特殊处理耗电键
          if (execItem === '__factory_power__') {
            energyCost = coeff;
          } else if (execItem === '__miner_power__') {
            minerEnergyCost = coeff;
          } else {
            resourceUsage[execItem] = (resourceUsage[execItem] || 0) + coeff;
            recipeExecutions[execItem] = (recipeExecutions[execItem] || 0) + coeff;
          }
        } else if (coeff < 0) {
          resourceUsage[key] = (resourceUsage[key] || 0) + coeff;
          surplusByproducts[key] = (surplusByproducts[key] || 0) + coeff;
        } else {
          resourceUsage[key] = (resourceUsage[key] || 0) + coeff;
        }
      }
    }

    if (DEBUG) console.log('[Engine] energyCost:', energyCost, 'minerEnergyCost:', minerEnergyCost);
    if (DEBUG) console.log('[Engine] surplusByproducts:', JSON.stringify(surplusByproducts));

    const totalEnergyCost = energyCost + minerEnergyCost;

    // 7. 计算设备数量
    const buildingDetails = {};
    const buildingList = {};

    for (const [itemId, execCount] of Object.entries(recipeExecutions)) {
      if (execCount <= 0) continue;

      // 从图中获取节点
      const node = this.graph.get(itemId);
      if (!node || !node.buildingPower) {
        continue;
      }

      const { factoryName, singleExecBuildNumber, basePower = 0 } = node.buildingPower;

      // 根据执行次数计算实际设备数
      const buildNumber = execCount * singleExecBuildNumber;

      // 保存详情
      buildingDetails[itemId] = {
        factoryName,
        设备数量: buildNumber,
        执行次数: execCount,
        单次执行设备数: singleExecBuildNumber,
        额定功率: basePower,
      };

      // 汇总建筑数量
      const ceilBuildNumber = Math.ceil(buildNumber);
      if (ceilBuildNumber > 0) {
        buildingList[factoryName] = (buildingList[factoryName] || 0) + ceilBuildNumber;
      }
    }

    // 发电设备数量按额定发电效率计算：基础功率乘以燃料配方的增产/加速倍率。
    // 这与输出表的电力行使用同一公式，避免把燃料配方执行次数误当成发电设备效率。
    // 直接依据"选定燃料 + 总耗电"计算，独立于"电力"节点是否存活（避免其在循环组迭代中被当作原矿过滤时丢失）。
    const selectedFuel = this.schemeData?.selected_fuel;
    if (selectedFuel && selectedFuel !== '无' && totalEnergyCost > 0) {
      const fuelRecipe = this.gameData.recipe_data.find(r => r.isFuelRecipe && r.fuelName === selectedFuel);
      if (fuelRecipe) {
        const factoryKey = String(fuelRecipe.设施);
        const genBuilding = this.gameData.factory_data?.[factoryKey]?.[0];
        const devicePower = genBuilding?.["发电功率"] ?? genBuilding?.["耗能"] ?? 0;
        const deviceName = genBuilding?.["名称"];
        const recipeId = (fuelRecipe._id !== undefined) ? fuelRecipe._id : this.gameData.recipe_data.indexOf(fuelRecipe);
        const schemeRecipe = this.schemeData?.scheme_for_recipe?.[recipeId];
        const proMode = Number(schemeRecipe?.['增产模式']) || 0;
        const proLevel = Number(schemeRecipe?.['增产剂等级'] || schemeRecipe?.['增产点数']) || 0;
        const correctedCount = getPowerDeviceCount({
          totalEnergy: totalEnergyCost,
          devicePower,
          proliferatorEffects: this.gameData.proliferator_effect,
          proliferatorLevel: proLevel,
          proliferatorMode: proMode,
        });
        // 确保 buildingDetails 记录电力节点（供占地计算使用），覆盖 step7 可能写入的错值
        if (!buildingDetails['电力']) {
          buildingDetails['电力'] = { factoryName: deviceName, 设备数量: 0, 执行次数: 0, 单次执行设备数: 0, 额定功率: devicePower };
        }
        buildingDetails['电力'].factoryName = deviceName;
        buildingDetails['电力'].额定功率 = devicePower;
        buildingDetails['电力'].设备数量 = correctedCount;
        // 发电建筑只用于发电，buildingList 中同名项即发电设备数，直接覆盖（step7 写入的错值一并清除）
        const ceilCount = Math.ceil(correctedCount);
        if (ceilCount > 0) {
          buildingList[deviceName] = ceilCount;
        } else {
          delete buildingList[deviceName];
        }
      }
    }

    // 8. 计算占地
    const footprintDetails = {};
    let totalFootprint = 0;
    const recipeData = this.gameData?.recipe_data || [];
    const stackM = this.settings?.stack_research_lab || 15;

    for (const [itemId, detail] of Object.entries(buildingDetails)) {
      if (detail.设备数量 <= 0) continue;
      const node = this.graph.get(itemId);
      if (!node || node.recipeId === undefined || node.recipeId === null) continue;
      const recipe = recipeData[node.recipeId];
      if (!recipe) continue;

      const n = Math.ceil(detail.设备数量);
      const factoryName = detail.factoryName;

      // 计算 l: 原料种类数 + 产物种类数
      const rawInputs = recipe.原料 || {};
      const rawOutputs = recipe.产物 || {};
      const l = Object.keys(rawInputs).length + Object.keys(rawOutputs).length;

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
        if (node.recipeId === 73) { // 宇宙矩阵配方索引
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

      footprintDetails[itemId] = { area, n, l, factoryName };
      totalFootprint += area;
    }

    // 提取自消耗系数和副产物来源
    const selfConsumption = {};
    const byproductSources = {};  // {物品: {来源物品: 每单位净产出的副产物量}}
    for (const [itemId, node] of this.graph) {
      if (node.selfConsumption && node.selfConsumption > 0) {
        selfConsumption[itemId] = node.selfConsumption;
      }
      // 从 directCost 提取副产物（负系数项）
      if (node.directCost) {
        for (const [key, coeff] of Object.entries(node.directCost)) {
          if (key.startsWith('$') || coeff >= 0) continue;
          if (!byproductSources[key]) byproductSources[key] = {};
          byproductSources[key][itemId] = (byproductSources[key][itemId] || 0) + Math.abs(coeff);
        }
      }
    }

    const aggregated = { resourceUsage };
    aggregated.recipeExecutions = recipeExecutions;
    aggregated.surplusByproducts = surplusByproducts;
    aggregated.buildingDetails = buildingDetails;
    aggregated.buildingList = buildingList;
    aggregated.selfConsumption = selfConsumption;
    aggregated.byproductSources = byproductSources;
    aggregated.energyCost = energyCost;
    aggregated.minerEnergyCost = minerEnergyCost;
    aggregated.totalEnergyCost = totalEnergyCost;
    aggregated.footprintDetails = footprintDetails;
    aggregated.totalFootprint = totalFootprint;
    if (DEBUG) console.log('[Engine] ====== 计算结束 ======');

    return aggregated;
  }
}

export default CoreEngine;
