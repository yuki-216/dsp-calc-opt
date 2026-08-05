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

/**
 * 计算给定方案下的总耗电
 * @param {Object} gameData - 游戏数据
 * @param {Object} schemeData - 方案数据
 * @param {Object} settings - 设置参数
 * @param {Array} needs - 需求列表
 * @returns {Object} { totalEnergyCost, energyCost, minerEnergyCost }
 */
function calculatePower(gameData, schemeData, settings, needs) {
  const gameInfo = { game_data: gameData, item_data: {} };
  const globalState = new GlobalState(gameInfo, schemeData, settings);
  const engine = new CoreEngine(gameData, schemeData, settings, globalState.sprayCosts);
  const result = engine.calculate(needs, gameData.recipe_data);

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
 * @returns {Array} 可用的增产选择列表
 */
function getAvailableChoices(recipe) {
  const proliferator = recipe['增产'] || 0;
  if (proliferator === 0) return [{ level: 0, mode: 0, name: '无' }];

  const choices = [{ level: 0, mode: 0, name: '无' }];

  // 位掩码：bit0=可加速, bit1=可增产, bit2=特殊(透镜)
  const canAccelerate = proliferator & 1;
  const canExtraProduct = proliferator & 2;

  for (let level = 1; level <= 3; level++) {
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
 *
 * @param {Set<string>} group - 循环组成员
 * @param {Object} gameData - 游戏数据
 * @param {Object} settings - 设置
 * @param {Array} needs - 需求列表
 * @param {Object} baseSchemeData - 基础方案数据
 * @param {Map} resolved - 持久化策略存储
 * @param {Function} onLog - 日志回调
 */
function optimizeCycleGroup(group, gameData, settings, needs, baseSchemeData, resolved, onLog = null) {
  // 1. 生成循环组key
  const groupKey = getGroupKey(group);

  // 2. 检查是否已有持久化策略
  if (resolved.has(groupKey)) {
    if (onLog) onLog(`循环组 [${[...group].join(', ')}] 已有持久化策略，跳过`);
    return;
  }

  if (onLog) onLog(`处理循环组: [${[...group].join(', ')}]`);

  // 3. 检查循环组外部依赖是否都已确定
  const graph = gameData.graph;
  for (const item of group) {
    const deps = getDependencies(item, graph);
    for (const dep of deps) {
      if (!group.has(dep) && !resolved.has(dep)) {
        // 外部依赖未确定，SCC 正序遍历下不应出现此情况，记录警告
        if (onLog) onLog(`警告: 循环组外部依赖 ${dep} 未确定`);
      }
    }
  }

  // 4. 遍历所有组合
  const groupArray = [...group];

  // 获取每个物品的可用增产选择
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

  // 获取每个物品的可用选择
  const itemChoices = groupArray.map(item => {
    const recipeIndex = itemToRecipe.get(item);
    if (recipeIndex === undefined) return [{ level: 0, mode: 0, name: '无' }];
    const recipe = recipeData[recipeIndex];
    return getAvailableChoices(recipe);
  });

  // 生成所有组合（使用每个物品的实际可用选择）
  const combinations = generateCombinations(groupArray, itemChoices);

  if (onLog) onLog(`循环组组合数: ${combinations.length}`);

  let bestCombination = null;
  let bestCost = Infinity;

  for (const combination of combinations) {
    // 计算当前组合的总成本
    const cost = calculateCombinationCost(combination, groupArray, gameData, settings, needs, baseSchemeData);

    if (cost < bestCost) {
      bestCost = cost;
      bestCombination = combination;
    }
  }

  // 5. 持久化循环组策略
  for (let i = 0; i < groupArray.length; i++) {
    const item = groupArray[i];
    const strategy = bestCombination[i];
    resolved.set(item, { strategy, cost: bestCost });
  }

  // 6. 同时持久化循环组整体策略（用于后续复用）
  resolved.set(groupKey, { strategies: bestCombination, cost: bestCost, members: groupArray });

  if (onLog) onLog(`循环组最优策略: ${JSON.stringify(bestCombination.map(c => c.name))}, 耗电: ${formatPowerValue(bestCost)}`);
}

/**
 * 单物品优化
 * 遍历物品所有可用增产选择，选择使总耗电最小的策略并持久化。
 * 适用于非循环组的独立物品优化。
 *
 * @param {string} item - 物品ID
 * @param {Object} gameData - 游戏数据
 * @param {Object} settings - 设置
 * @param {Array} needs - 需求列表
 * @param {Object} baseSchemeData - 基础方案数据
 * @param {Map} resolved - 持久化策略存储
 * @param {Function} onLog - 日志回调
 */
export function optimizeSingleItem(item, gameData, settings, needs, baseSchemeData, resolved, onLog = null) {
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
  const choices = getAvailableChoices(recipe);

  // 3. 遍历所有增产选择
  let bestChoice = { level: 0, mode: 0, name: '无' };
  let bestCost = Infinity;

  for (const choice of choices) {
    // 创建临时的 schemeData
    const tempSchemeData = structuredClone(baseSchemeData);
    tempSchemeData.scheme_for_recipe[recipeIndex]['增产模式'] = choice.mode;
    tempSchemeData.scheme_for_recipe[recipeIndex]['增产剂等级'] = choice.level;

    // 计算成本
    const result = calculatePower(gameData, tempSchemeData, settings, needs);
    const cost = result.totalEnergyCost;

    if (cost < bestCost) {
      bestCost = cost;
      bestChoice = choice;
    }
  }

  // 4. 持久化
  resolved.set(item, { strategy: bestChoice, cost: bestCost });

  if (onLog) onLog(`${item} 最优策略: ${bestChoice.name}, 耗电: ${formatPowerValue(bestCost)}`);
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
 */
export function optimizeItem(item, gameData, settings, needs, baseSchemeData, resolved, depth = 0, onLog = null) {
  // 1. 检查是否已确定
  if (resolved.has(item)) {
    return;
  }

  // 2. 设置最大递归深度限制（防止无限递归）
  const MAX_DEPTH = 100;
  if (depth > MAX_DEPTH) {
    console.error(`[自动优化] 递归深度超限: ${item}，可能存在无限循环`);
    // 使用默认策略（无增产）
    resolved.set(item, { strategy: { level: 0, mode: 0, name: '无' }, cost: Infinity });
    return;
  }

  if (onLog) onLog(`${'  '.repeat(depth)}处理物品: ${item} (深度: ${depth})`);

  // 3. 计算当前 SCC 顺序
  const graph = gameData.graph;
  const edges = gameData.edges;
  const sccs = tarjanSCC(graph.keys(), edges);

  // 4. 找到当前物品在 SCC 中的位置
  const sccOrder = [];
  for (const scc of sccs) {
    for (const itemId of scc) {
      sccOrder.push(itemId);
    }
  }

  const itemIndex = sccOrder.indexOf(item);

  // 5. 检查前置物品是否都已确定
  for (let i = 0; i < itemIndex; i++) {
    const prevItem = sccOrder[i];
    if (!resolved.has(prevItem)) {
      // 递归处理前置物品
      if (onLog) onLog(`${'  '.repeat(depth)}前置物品 ${prevItem} 未确定，递归处理`);
      optimizeItem(prevItem, gameData, settings, needs, baseSchemeData, resolved, depth + 1, onLog);
    }
  }

  // 6. 检测是否属于循环组
  const cycleGroup = findCycleGroup(item, graph, edges);

  if (cycleGroup.size > 1) {
    // 7. 循环组整体遍历
    optimizeCycleGroup(cycleGroup, gameData, settings, needs, baseSchemeData, resolved, onLog);
  } else {
    // 8. 单物品遍历
    optimizeSingleItem(item, gameData, settings, needs, baseSchemeData, resolved, onLog);
  }
}

/**
 * 增产策略优化器主函数
 *
 * 按 SCC 正序（原矿→产物）遍历每个物品，尝试所有增产选择，
 * 选择使总耗电最小的配置。确定后锁定，不再改变。
 *
 * @param {Object} gameData - 游戏数据
 * @param {Object} schemeData - 当前方案数据
 * @param {Object} settings - 设置参数
 * @param {Array} needs - 需求列表
 * @param {Function} onProgress - 进度回调 (current, total, message)
 * @param {Function} onLog - 日志回调 (message)
 * @returns {Object} { optimalScheme, initialPower, optimalPower, changes }
 */
export function optimizeProliferatorStrategy(gameData, schemeData, settings, needs, onProgress = null, onLog = null) {
  // 1. 先执行一次初始计算，获取 SCC 结构
  if (onLog) {
    onLog(`需求物品: ${needs.map(n => `${n.id}x${n.count}`).join(', ')}`);
    onLog(`需求数量: ${needs.length}`);
    onLog(`设置: proliferate_itself=${settings.proliferate_itself}`);
  }

  const initialResult = calculatePower(gameData, schemeData, settings, needs);
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
      const choices = getAvailableChoices(recipe);

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

  // 4. 按 SCC 正序遍历，逐个物品优化
  let currentScheme = structuredClone(schemeData);
  let currentPower = initialPower;
  const changes = [];
  const totalCount = itemsToOptimize.length;

  for (let i = 0; i < itemsToOptimize.length; i++) {
    const item = itemsToOptimize[i];
    const { itemId, recipeIndex, recipe, choices } = item;

    // 报告进度
    if (onProgress) {
      onProgress(i + 1, totalCount, `优化 ${itemId}`);
    }
    if (onLog) onLog(`\n[${i + 1}/${totalCount}] 尝试优化: ${itemId}`);

    // 获取当前配置
    const currentLevel = currentScheme.scheme_for_recipe[recipeIndex]['增产剂等级'] || 0;
    const currentMode = currentScheme.scheme_for_recipe[recipeIndex]['增产模式'] || 0;

    if (onLog) {
      onLog(`  当前配置: 等级=${currentLevel}, 模式=${currentMode}`);
      onLog(`  配方可选增产: ${recipe['增产']}`);
    }

    // 遍历所有选择，找耗电最小的
    let bestChoice = null;
    let bestPower = Infinity;

    for (const choice of choices) {
      // 临时修改方案
      const tempScheme = structuredClone(currentScheme);
      tempScheme.scheme_for_recipe[recipeIndex]['增产剂等级'] = choice.level;
      tempScheme.scheme_for_recipe[recipeIndex]['增产模式'] = choice.mode;

      // 重新计算（对所有选择都重新计算，确保比较使用精确值）
      const result = calculatePower(gameData, tempScheme, settings, needs);
      const power = result.totalEnergyCost;

      if (choice.level === currentLevel && choice.mode === currentMode) {
        if (onLog) onLog(`  ${choice.name}: ${formatPowerValue(power)} (当前)`);
      } else {
        if (onLog) onLog(`  ${choice.name}: ${formatPowerValue(power)}`);
      }

      // 有更小的就更新
      if (power < bestPower) {
        bestPower = power;
        bestChoice = choice;
      }
    }

    // 应用最佳选择
    if (bestChoice.level !== currentLevel || bestChoice.mode !== currentMode) {
      currentScheme.scheme_for_recipe[recipeIndex]['增产剂等级'] = bestChoice.level;
      currentScheme.scheme_for_recipe[recipeIndex]['增产模式'] = bestChoice.mode;
      currentPower = bestPower;

      changes.push({
        itemId,
        recipeIndex,
        oldLevel: currentLevel,
        oldMode: currentMode,
        newLevel: bestChoice.level,
        newMode: bestChoice.mode,
        powerAfter: bestPower
      });

      if (onLog) onLog(`  ✓ 选择: ${bestChoice.name} (耗电 ${formatPowerValue(bestPower)})`);
    } else {
      if (onLog) onLog(`  ✓ 保持: ${bestChoice.name} (耗电 ${formatPowerValue(bestPower)})`);
    }
  }

  // 5. 输出最终结果
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
 * 格式化电力值
 * @param {number} value - 电力值 (kW)
 * @returns {string} 格式化后的字符串
 */
function formatPowerValue(value) {
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
