import { DEBUG } from './debug.js';
/**
 * 核心计算引擎主入口
 * 职责：整合DAG、SCC、单位成本（系数表+矩阵求逆）
 */

import { buildItemGraph, tarjanSCC } from './dag.js';
import { expandInSCCOrder } from './unit-cost.js';

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
   * 主计算函数（系数表 + 矩阵求逆方案）
   * @param {Array} needs - 需求列表
   * @param {Object} recipes - 配方数据
   * @returns {Object} 计算结果 {resourceUsage, power, buildings, footprint}
   */
  calculate(needs, recipes) {
    if (DEBUG) console.log('[Engine] ====== 计算开始 ======');
    if (DEBUG) console.log('[Engine] 需求:', needs.map(n => n.name + '×' + n.count).join(', '));

    // 迭代过滤逻辑
    const filterList = new Set(); // 过滤列表（负需求物品）
    let iteration = 0;
    const maxIterations = 10; // 最大迭代次数
    let costs = new Map();
    let byproductMap = new Map();
    const SOLUTION_ID = '__solution__';

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
      byproductMap = new Map(); // 独立的副产物映射
      for (const [itemId, node] of this.graph) {
        // 直接使用节点已有的 directCost（BFS阶段已计算）
        costs.set(itemId, node.directCost || { [`$${itemId}`]: 1 });
        byproductMap.set(itemId, new Set(node.byproducts || []));
      }
      // 添加 solution 的成本
      costs.set(SOLUTION_ID, solutionNode.directCost);


      // 4. 按 SCC 逆序展开成本到 solution（从顶层开始）
      const { negativeDemandItems } = expandInSCCOrder(SOLUTION_ID, costs, this.graph, this.sccs, byproductMap, this.recipeMap);

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

      const { factoryName, singleExecBuildNumber } = node.buildingPower;

      // 根据执行次数计算实际设备数
      const buildNumber = execCount * singleExecBuildNumber;

      // 保存详情
      buildingDetails[itemId] = {
        factoryName,
        设备数量: buildNumber,
        执行次数: execCount,
        单次执行设备数: singleExecBuildNumber
      };

      // 汇总建筑数量
      const ceilBuildNumber = Math.ceil(buildNumber);
      if (ceilBuildNumber > 0) {
        buildingList[factoryName] = (buildingList[factoryName] || 0) + ceilBuildNumber;
      }
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
    if (DEBUG) console.log('[Engine] ====== 计算结束 ======');

    return aggregated;
  }
}

export default CoreEngine;
