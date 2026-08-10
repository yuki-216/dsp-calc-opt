/**
 * 增产策略优化器
 * 职责：按 SCC 正序（原矿→产物）遍历，为每个物品选择最优增产策略
 * 目标函数：最小化总耗电
 *
 * 算法核心：
 * 1. 使用已有 BFS+SCC 分析的结果
 * 2. 按 SCC 正序遍历（从原矿到产物）
 * 3. 每个物品尝试所有增产选择，选耗电最小的
 * 4. 确定后锁定，不再改变（天然满足子问题分解，完美剪枝）
 */

import { CoreEngine } from './index.js';
import { GlobalState } from '../game_data.jsx';
import { tarjanSCC } from './graph-utils.js';

// 全局计数器和限制，防止死循环
let _callCount = 0;
const MAX_CALLS = 300;

function checkCallLimit() {
  _callCount++;
  if (_callCount > MAX_CALLS) {
    throw new Error(`[自动优化] 调用次数超限 (${MAX_CALLS})，可能存在死循环`);
  }
}

export function resetCallCount() {
  _callCount = 0;
}

/**
 * 计算给定方案下的总耗电
 * @param {Object} gameData - 游戏数据
 * @param {Object} schemeData - 方案数据
 * @param {Object} settings - 设置参数
 * @param {Array} needs - 需求列表
 * @returns {Object} { totalEnergyCost, energyCost, minerEnergyCost }
 */
function calculatePower(gameData, schemeData, settings, needs, silent = false) {
  const gameInfo = { game_data: gameData, item_data: {} };
  const globalState = new GlobalState(gameInfo, schemeData, settings);
  const engine = new CoreEngine(gameData, schemeData, settings, globalState.sprayCosts, silent);
  const result = engine.calculate(needs, gameData.recipe_data);

  // 确保 graph 和 edges 存在
  if (!engine.graph || !engine.edges) {
    console.error('[calculatePower] engine.graph 或 engine.edges 未定义');
    return {
      totalEnergyCost: result.totalEnergyCost || 0,
      energyCost: result.energyCost || 0,
      minerEnergyCost: result.minerEnergyCost || 0,
      graph: new Map(),
      edges: [],
      sccs: []
    };
  }

  return {
    totalEnergyCost: result.totalEnergyCost || 0,
    energyCost: result.energyCost || 0,
    minerEnergyCost: result.minerEnergyCost || 0,
    graph: engine.graph,
    edges: engine.edges,
    sccs: engine.sccs
  };
}

/**
 * 获取配方的可用增产选择
 * @param {Object} recipe - 配方数据
 * @param {Object} settings - 设置参数（可选）
 * @returns {Array} 可用的增产选择列表
 */
function getAvailableChoices(recipe, settings = {}) {
  const proliferator = recipe['增产'] || 0;
  if (proliferator === 0) return [{ level: 0, mode: 0, name: '无' }];

  const choices = [{ level: 0, mode: 0, name: '无' }];
  const noAccelerate = settings.proliferate_no_accelerate || false;
  const allowedLevels = settings.proliferate_allowed_levels || [1, 2, 3];

  // 位掩码：bit0=可加速, bit1=可增产, bit2=特殊(透镜)
  const canAccelerate = (proliferator & 1) && !noAccelerate;
  const canExtraProduct = proliferator & 2;

  for (let level = 1; level <= 3; level++) {
    // 跳过不允许的等级
    if (!allowedLevels.includes(level)) continue;

    if (canAccelerate) {
      choices.push({ level, mode: 1, name: `MK${level}加速` });
    }
    if (canExtraProduct) {
      choices.push({ level, mode: 2, name: `MK${level}增产` });
    }
  }

  return choices;
}

/**
 * 检测物品所属的循环组
 * @param {string} item - 物品ID
 * @param {Map} graph - 物品图
 * @param {Array} edges - 边集合
 * @returns {Set<string>} 循环组成员集合（如果不在循环组中，返回只包含自己的Set）
 */
function findCycleGroup(item, graph, edges) {
  // 使用 Tarjan 算法计算 SCC
  const sccList = tarjanSCC(graph.keys(), edges);

  // 找到包含 item 的 SCC
  for (const scc of sccList) {
    if (scc.has(item)) {
      return scc;
    }
  }

  // 不在任何 SCC 中，返回只包含自己的Set
  return new Set([item]);
}

/**
 * 生成循环组成员组合的key
 * @param {Set<string>|Array<string>} groupMembers - 循环组成员
 * @returns {string} 排序后的JSON字符串，如 '["MK1","MK2","金刚石"]'
 */
function getGroupKey(groupMembers) {
  return JSON.stringify([...groupMembers].sort());
}

/**
 * 生成所有组合（每个物品有独立的选择列表）
 * @param {Array<string>} items - 物品列表
 * @param {Array<Array>} choicesPerItem - 每个物品对应的增产选择列表
 * @returns {Array<Array>} 所有组合
 */
function generateCombinations(items, choicesPerItem) {
  if (items.length === 0) {
    return [[]];
  }

  const [first, ...rest] = items;
  const [firstChoices, ...restChoices] = choicesPerItem;
  const restCombinations = generateCombinations(rest, restChoices);

  const result = [];
  for (const choice of firstChoices) {
    for (const restComb of restCombinations) {
      result.push([choice, ...restComb]);
    }
  }

  return result;
}

/**
 * 计算循环组某个组合的总成本（复用现有完整计算）
 * @param {Array} combination - 组合，每个元素是 {level, mode, name}
 * @param {Array<string>} items - 循环组成员列表
 * @param {Object} gameData - 游戏数据
 * @param {Object} settings - 设置
 * @param {Array} needs - 需求列表
 * @param {Object} baseSchemeData - 基础方案数据
 * @returns {number} 总耗电（所有物品的总成本）
 */
export function calculateCombinationCost(combination, items, gameData, settings, needs, baseSchemeData) {
  // 1. 创建临时的 schemeData，设置循环组内每个物品的增产策略
  const tempSchemeData = structuredClone(baseSchemeData);

  // 构建物品 -> 配方索引的映射
  const recipeData = gameData.recipe_data || [];
  const itemToRecipe = new Map();
  for (let i = 0; i < recipeData.length; i++) {
    const outputs = Object.keys(recipeData[i]['产物'] || {});
    for (const item of outputs) {
      if (!itemToRecipe.has(item)) {
        itemToRecipe.set(item, i);
      }
    }
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const choice = combination[i];
    const recipeIndex = itemToRecipe.get(item);

    if (recipeIndex !== undefined && tempSchemeData.scheme_for_recipe[recipeIndex]) {
      tempSchemeData.scheme_for_recipe[recipeIndex]['增产模式'] = choice.mode;
      tempSchemeData.scheme_for_recipe[recipeIndex]['增产剂等级'] = choice.level;
    }
  }

  // 2. 调用现有的完整计算
  const result = calculatePower(gameData, tempSchemeData, settings, needs);

  // 3. 返回总耗电
  return result.totalEnergyCost;
}

/**
 * 获取物品的依赖列表
 * @param {string} item - 物品ID
 * @param {Map} graph - 物品图
 * @returns {Array<string>} 依赖物品列表
 */
function getDependencies(item, graph) {
  const node = graph.get(item);
  if (!node || !node.directCost) return [];

  const deps = [];
  for (const [key, coeff] of Object.entries(node.directCost)) {
    if (key.startsWith('$')) continue;
    if (coeff <= 0) continue;

    // 检查依赖是否存在
    if (!graph.has(key)) {
      console.warn(`[自动优化] 依赖缺失: ${item} -> ${key}，跳过该依赖`);
      continue;
    }

    deps.push(key);
  }

  return deps;
}

/**
 * 循环组整体遍历
 * 对循环组内的所有成员进行组合遍历，选择总耗电最小的增产策略组合。
 * 循环组是指 SCC 中包含多个成员的强连通分量，组内成员相互依赖，
 * 必须同时确定增产策略才能得到最优解。
 * 实现动态SCC：当组合中使用增产剂时，先递归优化增产剂。
 *
 * @param {Set<string>} group - 循环组成员
 * @param {Object} gameData - 游戏数据
 * @param {Object} settings - 设置
 * @param {Array} needs - 需求列表
 * @param {Object} baseSchemeData - 基础方案数据
 * @param {Map} resolved - 持久化策略存储
 * @param {number} depth - 递归深度
 * @param {Function} onLog - 日志回调
 */
async function optimizeCycleGroup(group, gameData, settings, needs, baseSchemeData, resolved, depth = 0, onLog = null) {
  // 0. 检查调用次数限制
  checkCallLimit();

  // 1. 生成循环组key
  const groupKey = getGroupKey(group);

  // 2. 检查是否已有持久化策略
  if (resolved.has(groupKey)) {
    if (onLog) onLog(`${'  '.repeat(depth)}循环组 [${[...group].join(', ')}] 已有持久化策略，跳过`);
    return;
  }

  const groupArray = [...group];
  if (onLog) onLog(`${'  '.repeat(depth)}循环组优化: [${groupArray.join(', ')}] (${groupArray.length}个物品)`);

  // 3. 获取每个物品的可用增产选择
  const recipeData = gameData.recipe_data || [];
  const itemToRecipe = new Map();
  for (let i = 0; i < recipeData.length; i++) {
    const outputs = Object.keys(recipeData[i]['产物'] || {});
    for (const item of outputs) {
      if (!itemToRecipe.has(item)) {
        itemToRecipe.set(item, i);
      }
    }
  }

  const itemChoices = groupArray.map(item => {
    const recipeIndex = itemToRecipe.get(item);
    if (recipeIndex === undefined) return [{ level: 0, mode: 0, name: '无' }];
    const recipe = recipeData[recipeIndex];
    return getAvailableChoices(recipe, settings);
  });

  // 4. 坐标下降算法
  // 初始状态：所有物品选择"无"
  const currentChoices = groupArray.map((item, idx) => {
    return itemChoices[idx][0]; // 选择列表的第一个（"无"）
  });

  // 计算当前方案的成本
  function calculateCost(choices) {
    const tempSchemeData = structuredClone(baseSchemeData);
    for (let i = 0; i < groupArray.length; i++) {
      const item = groupArray[i];
      const choice = choices[i];
      const recipeIndex = itemToRecipe.get(item);
      if (recipeIndex !== undefined) {
        tempSchemeData.scheme_for_recipe[recipeIndex]['增产模式'] = choice.mode;
        tempSchemeData.scheme_for_recipe[recipeIndex]['增产剂等级'] = choice.level;
      }
    }
    return calculatePower(gameData, tempSchemeData, settings, needs).totalEnergyCost;
  }

  // 计算初始成本
  let currentCost = calculateCost(currentChoices);
  if (onLog) onLog(`${'  '.repeat(depth)}初始状态: ${formatPowerValue(currentCost)}`);

  // 迭代优化
  let round = 0;
  let totalCalculations = 0;
  let improved = true;

  while (improved) {
    improved = false;
    round++;
    let improvedCount = 0;

    for (let i = 0; i < groupArray.length; i++) {
      const item = groupArray[i];
      const choices = itemChoices[i];
      let bestChoice = currentChoices[i];
      let bestCost = currentCost;

      // 尝试每种选择
      for (const choice of choices) {
        if (choice === currentChoices[i]) continue; // 跳过当前选择

        // 临时修改选择
        const oldChoice = currentChoices[i];
        currentChoices[i] = choice;

        // 计算成本
        const cost = calculateCost(currentChoices);
        totalCalculations++;

        if (cost < bestCost) {
          bestCost = cost;
          bestChoice = choice;
        }

        // 恢复选择（准备下一次尝试）
        currentChoices[i] = oldChoice;
      }

      // 应用最佳选择
      if (bestChoice !== currentChoices[i]) {
        currentChoices[i] = bestChoice;
        currentCost = bestCost;
        improved = true;
        improvedCount++;

        if (onLog) {
          const oldName = currentChoices[i] === bestChoice ? '无' : currentChoices[i].name;
          onLog(`${'  '.repeat(depth)}  ${item}: ${oldName} → ${bestChoice.name} (${formatPowerValue(bestCost)})`);
        }
      }

      // 让出主线程
      if (totalCalculations % 100 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    if (onLog) {
      if (improvedCount > 0) {
        onLog(`${'  '.repeat(depth)}第${round}轮: 改善${improvedCount}个物品，当前: ${formatPowerValue(currentCost)}`);
      } else {
        onLog(`${'  '.repeat(depth)}第${round}轮: 无改善，收敛`);
      }
    }
  }

  // 5. 持久化结果
  for (let i = 0; i < groupArray.length; i++) {
    const item = groupArray[i];
    resolved.set(item, { strategy: currentChoices[i], cost: currentCost });
  }

  // 同时持久化循环组整体策略（用于后续复用）
  resolved.set(groupKey, { strategies: [...currentChoices], cost: currentCost, members: groupArray });

  if (onLog) {
    const bestDesc = groupArray.map((item, i) => `${item}:${currentChoices[i].name}`).join(', ');
    onLog(`${'  '.repeat(depth)}最优: [${bestDesc}], 耗电: ${formatPowerValue(currentCost)}, 计算${totalCalculations}次`);
  }
}

/**
 * 单物品优化
 * 遍历物品所有可用增产选择，选择使总耗电最小的策略并持久化。
 * 适用于非循环组的独立物品优化。
 * 实现动态SCC：当选择使用增产剂时，先递归优化增产剂。
 *
 * @param {string} item - 物品ID
 * @param {Object} gameData - 游戏数据
 * @param {Object} settings - 设置
 * @param {Array} needs - 需求列表
 * @param {Object} baseSchemeData - 基础方案数据
 * @param {Map} resolved - 持久化策略存储
 * @param {number} depth - 递归深度
 * @param {Function} onLog - 日志回调
 */
export async function optimizeSingleItem(item, gameData, settings, needs, baseSchemeData, resolved, depth = 0, onLog = null) {
  // 0. 检查调用次数限制
  checkCallLimit();

  // 1. 检查是否已确定
  if (resolved.has(item)) {
    return;
  }

  // 2. 获取物品节点
  const recipeData = gameData.recipe_data || [];
  const itemToRecipe = new Map();
  for (let i = 0; i < recipeData.length; i++) {
    const outputs = Object.keys(recipeData[i]['产物'] || {});
    for (const output of outputs) {
      if (!itemToRecipe.has(output)) {
        itemToRecipe.set(output, i);
      }
    }
  }

  const recipeIndex = itemToRecipe.get(item);
  if (recipeIndex === undefined) {
    resolved.set(item, { strategy: { level: 0, mode: 0, name: '无' }, cost: 0 });
    return;
  }

  const recipe = recipeData[recipeIndex];
  const choices = getAvailableChoices(recipe, settings);
  const proliferatorData = gameData.proliferator_data || [];

  // 只有一种选择时直接标记，无需遍历
  if (choices.length === 1) {
    const choice = choices[0];
    const tempSchemeData = structuredClone(baseSchemeData);
    tempSchemeData.scheme_for_recipe[recipeIndex]['增产模式'] = choice.mode;
    tempSchemeData.scheme_for_recipe[recipeIndex]['增产剂等级'] = choice.level;
    const result = calculatePower(gameData, tempSchemeData, settings, needs);
    const cost = result.totalEnergyCost;
    resolved.set(item, { strategy: choice, cost });
    if (onLog) onLog(`${'  '.repeat(depth)}  ${item} 仅1种选择: ${choice.name}, 耗电: ${formatPowerValue(cost)}`);
    return;
  }

  if (onLog) onLog(`${'  '.repeat(depth)}  ${item} 尝试 ${choices.length} 种增产选择...`);

  // 3. 遍历所有增产选择
  let bestChoice = { level: 0, mode: 0, name: '无' };
  let bestCost = Infinity;

  for (const choice of choices) {
    // 1. 先设置增产选择
    const tempSchemeData = structuredClone(baseSchemeData);
    tempSchemeData.scheme_for_recipe[recipeIndex]['增产模式'] = choice.mode;
    tempSchemeData.scheme_for_recipe[recipeIndex]['增产剂等级'] = choice.level;

    // 2. 重新计算 SCC 分析（增产选择可能改变依赖图）
    const tempResult = calculatePower(gameData, tempSchemeData, settings, needs);
    const tempGraph = tempResult.graph;
    const tempEdges = tempResult.edges;

    // 如果 graph 或 edges 无效，跳过 SCC 分析
    if (!tempGraph || !tempEdges || tempGraph.size === 0) {
      const cost = tempResult.totalEnergyCost;
      const isBetter = cost < bestCost;
      if (isBetter) {
        bestCost = cost;
        bestChoice = choice;
      }
      if (onLog) {
        const marker = isBetter ? ' ✓ 新最优' : '';
        onLog(`${'  '.repeat(depth)}    ${choice.name} → ${formatPowerValue(cost)}${marker}`);
      }
      continue;
    }

    // 将 Map.keys() 转换为 Set，因为 tarjanSCC 期望 Set 类型
    const tempItems = new Set(tempGraph.keys());
    const sccs = tarjanSCC(tempItems, tempEdges);

    // 3. 找到当前物品在新 SCC 顺序中的位置（使用正序：原矿→产物）
    const sccsForward = [...sccs].reverse();

    // 4. 检测当前物品是否属于循环组（SCC 大小 > 1）
    const currentScc = sccs.find(scc => scc.has(item));
    if (currentScc && currentScc.size > 1) {
      // 当前选择导致物品进入循环组，转由 optimizeCycleGroup 处理整个循环组
      if (onLog) {
        const sccSummary = sccsForward
          .map(scc => [...scc].filter(item => item !== '__solution__'))
          .filter(members => members.length > 0)
          .map(scc => `[${scc.join(',')}]`)
          .join(' → ');
        onLog(`${'  '.repeat(depth)}    ${choice.name} SCC: ${sccSummary}`);
        onLog(`${'  '.repeat(depth)}    ${choice.name} 导致进入循环组 [${[...currentScc].join(', ')}]，转为循环组优化...`);
      }
      // 调用循环组优化，会持久化循环组所有成员的策略
      await optimizeCycleGroup(currentScc, gameData, settings, needs, tempSchemeData, resolved, depth, onLog);
      // 循环组优化完成后直接返回（策略已持久化）
      return;
    }

    // 5. 非循环组情况，继续正常处理
    const sccOrder = [];
    for (const scc of sccsForward) {
      for (const itemId of scc) {
        if (itemId !== '__solution__') {
          sccOrder.push(itemId);
        }
      }
    }
    const itemIndex = sccOrder.indexOf(item);

    // 6. 日志：显示新的 SCC 分析结果
    if (onLog) {
      const sccSummary = sccsForward
        .map(scc => [...scc].filter(item => item !== '__solution__'))
        .filter(members => members.length > 0)
        .map(scc => `[${scc.join(',')}]`)
        .join(' → ');
      onLog(`${'  '.repeat(depth)}    ${choice.name} SCC: ${sccSummary}`);
    }

    // 7. 递归优化在新 SCC 队列中当前物品之前的未确定物品
    for (let i = 0; i < itemIndex; i++) {
      const prevItem = sccOrder[i];
      if (!resolved.has(prevItem)) {
        if (onLog) onLog(`${'  '.repeat(depth)}    ${choice.name} 需要前置 ${prevItem}，递归优化...`);
        await optimizeItem(prevItem, gameData, settings, needs, tempSchemeData, resolved, depth + 1, onLog, tempGraph, tempEdges);
      }
    }

    // 8. 重新计算成本（使用已优化的前置物品）
    const result = calculatePower(gameData, tempSchemeData, settings, needs);
    const cost = result.totalEnergyCost;

    const isBetter = cost < bestCost;
    if (isBetter) {
      bestCost = cost;
      bestChoice = choice;
    }

    // 9. 日志：显示当前选择的结果
    if (onLog) {
      const marker = isBetter ? ' ✓ 新最优' : '';
      onLog(`${'  '.repeat(depth)}    ${choice.name} → ${formatPowerValue(cost)}${marker}`);
    }
  }

  // 10. 持久化
  resolved.set(item, { strategy: bestChoice, cost: bestCost });

  if (onLog) onLog(`${'  '.repeat(depth)}  ${item} 最优策略: ${bestChoice.name}, 耗电: ${formatPowerValue(bestCost)}`);
}

/**
 * 单物品优化入口（递归）
 * 按 SCC 正序递归处理前置依赖，然后对目标物品进行增产策略优化。
 * 若物品属于循环组则整体遍历，否则单独遍历。
 *
 * @param {string} item - 物品ID
 * @param {Object} gameData - 游戏数据
 * @param {Object} settings - 设置
 * @param {Array} needs - 需求列表
 * @param {Object} baseSchemeData - 基础方案数据
 * @param {Map} resolved - 持久化策略存储
 * @param {number} depth - 递归深度
 * @param {Function} onLog - 日志回调
 * @param {Map|null} graph - 动态依赖图（可选，默认使用 gameData.graph）
 * @param {Array|null} edges - 动态边集合（可选，默认使用 gameData.edges）
 */
export async function optimizeItem(item, gameData, settings, needs, baseSchemeData, resolved, depth = 0, onLog = null, graph = null, edges = null) {
  // 1. 检查调用次数限制
  checkCallLimit();

  // 2. 检查是否已确定
  if (resolved.has(item)) {
    return;
  }

  // 3. 设置最大递归深度限制（防止无限递归）
  const MAX_DEPTH = 50;
  if (depth > MAX_DEPTH) {
    console.error(`[自动优化] 递归深度超限: ${item}，可能存在无限循环`);
    // 使用默认策略（无增产）
    resolved.set(item, { strategy: { level: 0, mode: 0, name: '无' }, cost: Infinity });
    return;
  }

  if (onLog) onLog(`${'  '.repeat(depth)}处理物品: ${item} (深度: ${depth})`);

  // 3. 计算当前 SCC 顺序
  // 使用传入的 graph/edges，或者使用 gameData 的默认值
  const currentGraph = graph || gameData.graph;
  const currentEdges = edges || gameData.edges;
  // 将 Map.keys() 转换为 Set，因为 tarjanSCC 期望 Set 类型
  const currentItems = new Set(currentGraph.keys());
  const sccs = tarjanSCC(currentItems, currentEdges);

  // 4. 找到当前物品在 SCC 中的位置（使用正序：原矿→产物）
  // tarjanSCC 返回逆拓扑序（产物在前），需要反转为正序
  const sccsForward = [...sccs].reverse();
  const sccOrder = [];
  for (const scc of sccsForward) {
    for (const itemId of scc) {
      if (itemId !== '__solution__') { // 过滤虚拟物品
        sccOrder.push(itemId);
      }
    }
  }

  const itemIndex = sccOrder.indexOf(item);

  // 5. 检查前置物品是否都已确定
  for (let i = 0; i < itemIndex; i++) {
    const prevItem = sccOrder[i];
    if (!resolved.has(prevItem)) {
      // 递归处理前置物品
      if (onLog) onLog(`${'  '.repeat(depth)}前置物品 ${prevItem} 未确定，递归处理...`);
      await optimizeItem(prevItem, gameData, settings, needs, baseSchemeData, resolved, depth + 1, onLog, currentGraph, currentEdges);
      const prevResolved = resolved.get(prevItem);
      if (onLog && prevResolved) {
        onLog(`${'  '.repeat(depth)}前置物品 ${prevItem} 已确定: ${prevResolved.strategy.name}, 耗电: ${formatPowerValue(prevResolved.cost)}`);
      }
    }
  }

  // 6. 检测是否属于循环组
  const cycleGroup = findCycleGroup(item, currentGraph, currentEdges);

  if (cycleGroup.size > 1) {
    // 7. 循环组整体遍历
    await optimizeCycleGroup(cycleGroup, gameData, settings, needs, baseSchemeData, resolved, depth, onLog);
  } else {
    // 8. 单物品遍历
    await optimizeSingleItem(item, gameData, settings, needs, baseSchemeData, resolved, depth, onLog);
  }
}

/**
 * 增产策略优化器主函数（重构后）
 *
 * 使用动态 SCC 遍历，按 SCC 正序（原矿→产物）遍历每个物品，
 * 尝试所有增产选择，选择使总耗电最小的配置。
 * 对于循环组，整体遍历所有组合。
 *
 * @param {Object} gameData - 游戏数据
 * @param {Object} schemeData - 当前方案数据
 * @param {Object} settings - 设置参数
 * @param {Array} needs - 需求列表
 * @param {Function} onProgress - 进度回调 (current, total, message)
 * @param {Function} onLog - 日志回调 (message)
 * @param {boolean} silent - 是否静默模式（不输出调试日志）
 * @returns {Object} { optimalScheme, initialPower, optimalPower, changes }
 */
export async function optimizeProliferatorStrategy(gameData, schemeData, settings, needs, onProgress = null, onLog = null, silent = false) {
  // 0. 重置调用计数器
  resetCallCount();

  // 1. 输出初始信息
  if (onLog) {
    onLog(`需求物品: ${needs.map(n => `${n.id}x${n.count}`).join(', ')}`);
    onLog(`需求数量: ${needs.length}`);
    onLog(`设置: proliferate_itself=${settings.proliferate_itself}, proliferate_no_accelerate=${settings.proliferate_no_accelerate}`);
    onLog('正在计算初始耗电...');
  }

  // 2. 执行初始计算，获取 SCC 结构
  const initialResult = calculatePower(gameData, schemeData, settings, needs, silent);
  const initialPower = initialResult.totalEnergyCost;

  if (onLog) {
    onLog(`初始总耗电: ${formatPowerValue(initialPower)}`);
    onLog(`初始生产设备耗电: ${formatPowerValue(initialResult.energyCost)}`);
    onLog(`初始采集设备耗电: ${formatPowerValue(initialResult.minerEnergyCost)}`);
  }

  if (!initialResult.sccs || initialResult.sccs.length === 0) {
    if (onLog) onLog('无 SCC 结构，跳过优化');
    return {
      optimalScheme: structuredClone(schemeData),
      initialPower,
      optimalPower: initialPower,
      changes: [],
      processedCount: 0,
      totalCount: 0
    };
  }

  // 2. 获取 SCC 顺序（逆拓扑序：sccGroups[0]=产物，sccGroups[last]=原矿）
  // 反转为正序：从原矿到产物
  const sccsForward = [...initialResult.sccs].reverse();
  if (onLog) onLog(`SCC 正序: ${sccsForward.map(scc => `[${[...scc].join(',')}]`).join(' → ')}`);

  // 3. 收集所有需要优化的物品（按 SCC 正序）
  const itemsToOptimize = [];
  const recipeData = gameData.recipe_data || [];

  // 构建物品 -> 配方索引的映射
  const itemToRecipe = new Map();
  for (let i = 0; i < recipeData.length; i++) {
    const outputs = Object.keys(recipeData[i]['产物'] || {});
    for (const item of outputs) {
      if (!itemToRecipe.has(item)) {
        itemToRecipe.set(item, i);
      }
    }
  }

  // 按 SCC 正序收集可优化的物品
  for (const scc of sccsForward) {
    for (const itemId of scc) {
      const recipeIndex = itemToRecipe.get(itemId);
      if (recipeIndex === undefined) continue;

      const recipe = recipeData[recipeIndex];
      const choices = getAvailableChoices(recipe, settings);

      // 只有超过 1 种选择的配方才需要优化
      if (choices.length > 1) {
        itemsToOptimize.push({
          itemId,
          recipeIndex,
          recipe,
          choices
        });
      }
    }
  }

  // 4. 创建持久化策略存储
  const resolved = new Map();

  // 5. 按 SCC 正序遍历，逐个物品优化（使用动态 SCC）
  let currentScheme = structuredClone(schemeData);
  let currentPower = initialPower;
  const changes = [];
  const totalCount = itemsToOptimize.length;

  // 将 graph 和 edges 存储到 gameData 中，供后续使用
  gameData.graph = initialResult.graph;
  gameData.edges = initialResult.edges;

  for (let i = 0; i < itemsToOptimize.length; i++) {
    const item = itemsToOptimize[i];
    const { itemId, recipeIndex } = item;

    // 报告进度
    if (onProgress) {
      onProgress(i + 1, totalCount, `优化 ${itemId}`);
    }
    if (onLog) onLog(`\n[${i + 1}/${totalCount}] 尝试优化: ${itemId}`);

    // 使用动态 SCC 优化
    await optimizeItem(itemId, gameData, settings, needs, currentScheme, resolved, 0, onLog);

    // 应用优化结果
    const strategyInfo = resolved.get(itemId);
    if (strategyInfo) {
      const { strategy, cost } = strategyInfo;
      const currentLevel = currentScheme.scheme_for_recipe[recipeIndex]['增产剂等级'] || 0;
      const currentMode = currentScheme.scheme_for_recipe[recipeIndex]['增产模式'] || 0;

      if (strategy.level !== currentLevel || strategy.mode !== currentMode) {
        currentScheme.scheme_for_recipe[recipeIndex]['增产剂等级'] = strategy.level;
        currentScheme.scheme_for_recipe[recipeIndex]['增产模式'] = strategy.mode;
        currentPower = cost;

        changes.push({
          itemId,
          recipeIndex,
          oldLevel: currentLevel,
          oldMode: currentMode,
          newLevel: strategy.level,
          newMode: strategy.mode,
          powerAfter: cost
        });

        if (onLog) onLog(`  ✓ 选择: ${strategy.name} (耗电 ${formatPowerValue(cost)})`);
      } else {
        if (onLog) onLog(`  ✓ 保持: ${strategy.name} (耗电 ${formatPowerValue(cost)})`);
      }
    }
  }

  // 6. 输出最终结果
  if (onLog) {
    onLog('\n========== 优化结果 ==========');
    onLog(`初始耗电: ${formatPowerValue(initialPower)}`);
    onLog(`最终耗电: ${formatPowerValue(currentPower)}`);
    if (changes.length > 0) {
      const reduction = initialPower - currentPower;
      const percent = (reduction / initialPower * 100).toFixed(1);
      onLog(`耗电减少: ${formatPowerValue(reduction)} (${percent}%)`);
      onLog(`调整配方: ${changes.length} 个`);
    } else {
      onLog('当前配置已是最优');
    }
  }

  return {
    optimalScheme: currentScheme,
    initialPower,
    optimalPower: currentPower,
    changes,
    processedCount: totalCount,
    totalCount
  };
}

/**
 * 应用优化策略到方案数据
 * 将优化器计算出的最优策略应用到方案数据中，生成新的方案数据。
 * 遍历持久化策略存储，跳过循环组整体策略（key 以 '[' 开头），
 * 将每个物品的增产模式和等级写入对应的配方配置中。
 *
 * @param {Map} resolved - 持久化策略存储（由 optimizeProliferatorStrategy 生成）
 * @param {Object} schemeData - 原始方案数据
 * @param {Map} graph - 物品图（包含 recipeId 等节点信息）
 * @returns {Object} 更新后的方案数据（深拷贝，不修改原数据）
 */
export function applyOptimizedStrategies(resolved, schemeData, graph) {
  // 1. 深拷贝方案数据，避免修改原数据
  const newSchemeData = structuredClone(schemeData);

  // 2. 遍历所有已确定的策略
  for (const [item, strategyInfo] of resolved) {
    // 跳过循环组整体策略（key 是 JSON 字符串，以 '[' 开头）
    if (item.startsWith('[')) continue;

    // 3. 获取物品节点
    const node = graph.get(item);
    if (!node || !node.recipeId) continue;

    // 4. 应用策略到对应的配方配置
    const { strategy } = strategyInfo;
    if (newSchemeData.scheme_for_recipe[node.recipeId]) {
      newSchemeData.scheme_for_recipe[node.recipeId]['增产模式'] = strategy.mode;
      newSchemeData.scheme_for_recipe[node.recipeId]['增产剂等级'] = strategy.level;
    }
  }

  return newSchemeData;
}

/**
 * 格式化电力值
 * @param {number} value - 电力值 (kW)
 * @returns {string} 格式化后的字符串
 */
export function formatPowerValue(value) {
  if (value >= 1e6) return (value / 1e6).toFixed(2) + ' GW';
  if (value >= 1e3) return (value / 1e3).toFixed(2) + ' MW';
  return value.toFixed(2) + ' kW';
}

/**
 * 格式化增产模式名称
 * @param {number} mode - 增产模式
 * @returns {string} 模式名称
 */
export function formatProliferatorMode(mode) {
  switch (mode) {
    case 0: return '不使用';
    case 1: return '加速';
    case 2: return '增产';
    default: return '未知';
  }
}

/**
 * 格式化增产剂等级名称
 * @param {number} level - 增产剂等级
 * @returns {string} 等级名称
 */
export function formatProliferatorLevel(level) {
  switch (level) {
    case 0: return '无';
    case 1: return 'Mk.I';
    case 2: return 'Mk.II';
    case 3: return 'Mk.III';
    default: return '未知';
  }
}
