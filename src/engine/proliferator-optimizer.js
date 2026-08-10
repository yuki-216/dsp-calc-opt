/**
 * 增产策略优化器
 * 职责：两阶段优化增产策略
 * 目标函数：最小化总耗电
 *
 * 算法核心：
 * 1. 第一阶段：循环组优化（坐标下降法）
 * 2. 第二阶段：单物品优化（按 SCC 正序逐个优化）
 */

import { CoreEngine } from './index.js';
import { GlobalState } from '../game_data.jsx';

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
 * 构建物品到配方索引的映射
 * @param {Array} recipeData - 配方数据
 * @param {string} selectedFuel - 用户选择的燃料
 * @returns {Map} 物品->配方索引映射
 */
function buildItemToRecipeMap(recipeData, selectedFuel) {
  const itemToRecipe = new Map();
  for (let i = 0; i < recipeData.length; i++) {
    const outputs = Object.keys(recipeData[i]['产物'] || {});
    for (const item of outputs) {
      if (!itemToRecipe.has(item)) {
        itemToRecipe.set(item, i);
      }
    }
  }

  // 特殊处理电力：映射到用户选择的燃料配方
  if (selectedFuel && selectedFuel !== '无') {
    for (let i = 0; i < recipeData.length; i++) {
      if (recipeData[i]?.isFuelRecipe && recipeData[i]?.fuelName === selectedFuel) {
        itemToRecipe.set('电力', i);
        break;
      }
    }
  }

  return itemToRecipe;
}

/**
 * 获取配方的第一个可选增产模式
 * @param {Object} recipe - 配方数据
 * @param {Object} settings - 设置参数
 * @returns {number} 第一个可选模式
 */
function getFirstAvailableMode(recipe, settings) {
  const proliferator = recipe['增产'] || 0;
  if (proliferator === 0) return 0;

  const noAccelerate = settings.proliferate_no_accelerate || false;
  const canAccelerate = (proliferator & 1) && !noAccelerate;
  const canExtraProduct = proliferator & 2;

  // 优先返回增产模式，其次加速模式
  if (canExtraProduct) return 2;
  if (canAccelerate) return 1;
  return 0;
}

/**
 * 获取允许的最高等级增产剂
 * @param {Object} settings - 设置参数
 * @returns {number} 最高等级
 */
function getMaxAllowedLevel(settings) {
  const allowedLevels = settings.proliferate_allowed_levels || [1, 2, 3];
  return allowedLevels.length > 0 ? Math.max(...allowedLevels) : 0;
}

/**
 * 第一阶段：循环组优化
 * 使用坐标下降算法优化循环组内所有物品的增产策略
 *
 * @param {Array<string>} cycleItems - 循环组物品列表
 * @param {Object} gameData - 游戏数据
 * @param {Object} settings - 设置参数
 * @param {Array} needs - 需求列表
 * @param {Object} baseScheme - 基础方案数据
 * @param {Map} itemToRecipe - 物品到配方映射
 * @param {Function} onLog - 日志回调
 * @returns {Object} { choices, cost, calculations }
 */
async function optimizeCycleGroupPhase(cycleItems, gameData, settings, needs, baseScheme, itemToRecipe, onLog) {
  const recipeData = gameData.recipe_data || [];

  // 获取每个物品的可用增产选择
  const itemChoices = cycleItems.map(item => {
    const recipeIndex = itemToRecipe.get(item);
    if (recipeIndex === undefined) return [{ level: 0, mode: 0, name: '无' }];
    const recipe = recipeData[recipeIndex];
    return getAvailableChoices(recipe, settings);
  });

  // 初始状态：所有物品选择"无"
  const currentChoices = cycleItems.map((item, idx) => {
    return itemChoices[idx][0];
  });

  // 计算当前方案的成本
  function calculateCost(choices) {
    const tempScheme = structuredClone(baseScheme);
    for (let i = 0; i < cycleItems.length; i++) {
      const item = cycleItems[i];
      const choice = choices[i];
      const recipeIndex = itemToRecipe.get(item);
      if (recipeIndex !== undefined && tempScheme.scheme_for_recipe[recipeIndex]) {
        tempScheme.scheme_for_recipe[recipeIndex]['增产模式'] = choice.mode;
        tempScheme.scheme_for_recipe[recipeIndex]['增产剂等级'] = choice.level;
      }
    }
    return calculatePower(gameData, tempScheme, settings, needs).totalEnergyCost;
  }

  // 计算初始成本
  let currentCost = calculateCost(currentChoices);
  if (onLog) onLog(`初始状态: ${formatPowerValue(currentCost)}`);

  // 坐标下降迭代
  let round = 0;
  let totalCalculations = 0;
  let improved = true;

  while (improved) {
    improved = false;
    round++;
    let improvedCount = 0;

    for (let i = 0; i < cycleItems.length; i++) {
      const item = cycleItems[i];
      const choices = itemChoices[i];
      let bestChoice = currentChoices[i];
      let bestCost = currentCost;

      // 尝试每种选择
      for (const choice of choices) {
        if (choice === currentChoices[i]) continue;

        const oldChoice = currentChoices[i];
        currentChoices[i] = choice;

        const cost = calculateCost(currentChoices);
        totalCalculations++;

        if (cost < bestCost) {
          bestCost = cost;
          bestChoice = choice;
        }

        currentChoices[i] = oldChoice;
      }

      // 应用最佳选择
      if (bestChoice !== currentChoices[i]) {
        currentChoices[i] = bestChoice;
        currentCost = bestCost;
        improved = true;
        improvedCount++;

        if (onLog) {
          onLog(`  ${item}: → ${bestChoice.name} (${formatPowerValue(bestCost)})`);
        }
      }

      // 让出主线程
      if (totalCalculations % 100 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    if (onLog) {
      if (improvedCount > 0) {
        onLog(`第${round}轮: 改善${improvedCount}个物品，当前: ${formatPowerValue(currentCost)}`);
      } else {
        onLog(`第${round}轮: 无改善，收敛`);
      }
    }
  }

  return {
    choices: currentChoices,
    cost: currentCost,
    calculations: totalCalculations
  };
}

/**
 * 增产策略优化器主函数（重构后）
 *
 * 两阶段优化：
 * 1. 循环组优化：在最高等级配置下分析 SCC，找出循环组并用坐标下降优化
 * 2. 单物品优化：按 SCC 正序逐个优化非循环组物品
 *
 * @param {Object} gameData - 游戏数据
 * @param {Object} schemeData - 当前方案数据
 * @param {Object} settings - 设置参数
 * @param {Array} needs - 需求列表
 * @param {Function} onProgress - 进度回调 (current, total, message)
 * @param {Function} onLog - 日志回调 (message)
 * @returns {Object} { optimalScheme, initialPower, optimalPower, changes }
 */
export async function optimizeProliferatorStrategy(gameData, schemeData, settings, needs, onProgress = null, onLog = null) {
  // 1. 输出初始信息
  if (onLog) {
    onLog(`需求物品: ${needs.map(n => `${n.id}x${n.count}`).join(', ')}`);
    onLog('正在计算初始耗电...');
  }

  // 2. 执行初始计算
  const initialResult = calculatePower(gameData, schemeData, settings, needs);
  const initialPower = initialResult.totalEnergyCost;

  if (onLog) {
    onLog(`初始耗电: ${formatPowerValue(initialPower)}`);
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

  // 3. 构建物品到配方映射
  const recipeData = gameData.recipe_data || [];
  const itemToRecipe = buildItemToRecipeMap(recipeData, schemeData?.selected_fuel);

  // 4. 第一阶段：循环组优化
  if (onLog) onLog('\n========== 第一阶段：循环组优化 ==========');

  // 4.1 强制所有物品使用最高等级 + 第一个可选模式
  const maxLevel = getMaxAllowedLevel(settings);
  const maxScheme = structuredClone(schemeData);

  for (const [itemId, recipeIndex] of itemToRecipe) {
    if (recipeIndex !== undefined && maxScheme.scheme_for_recipe[recipeIndex]) {
      const recipe = recipeData[recipeIndex];
      const firstMode = getFirstAvailableMode(recipe, settings);
      maxScheme.scheme_for_recipe[recipeIndex]['增产剂等级'] = maxLevel;
      maxScheme.scheme_for_recipe[recipeIndex]['增产模式'] = firstMode;
    }
  }

  // 4.2 在最高等级配置下进行SCC分析
  const maxResult = calculatePower(gameData, maxScheme, settings, needs);
  const sccsForward = [...maxResult.sccs].reverse();

  if (onLog) {
    onLog(`最高等级配置下 SCC: ${sccsForward.map(scc => `[${[...scc].join(',')}]`).join(' → ')}`);
  }

  // 4.3 找出循环组（SCC大小>1）
  const cycleGroup = sccsForward.find(scc => scc.size > 1 && !scc.has('__solution__'));

  // 4.4 持久化存储
  const resolved = new Map();
  let currentScheme = structuredClone(schemeData);
  let currentPower = initialPower;

  if (cycleGroup) {
    // 有循环组，用坐标下降优化
    const cycleItems = [...cycleGroup];
    if (onLog) onLog(`发现循环组: [${cycleItems.join(', ')}]`);

    // 坐标下降优化
    const cycleResult = await optimizeCycleGroupPhase(
      cycleItems, gameData, settings, needs, maxScheme, itemToRecipe, onLog
    );

    // 持久化循环组策略
    for (let i = 0; i < cycleItems.length; i++) {
      resolved.set(cycleItems[i], {
        strategy: cycleResult.choices[i],
        cost: cycleResult.cost
      });
    }

    // 应用循环组策略到当前方案
    for (let i = 0; i < cycleItems.length; i++) {
      const item = cycleItems[i];
      const choice = cycleResult.choices[i];
      const recipeIndex = itemToRecipe.get(item);
      if (recipeIndex !== undefined && currentScheme.scheme_for_recipe[recipeIndex]) {
        currentScheme.scheme_for_recipe[recipeIndex]['增产剂等级'] = choice.level;
        currentScheme.scheme_for_recipe[recipeIndex]['增产模式'] = choice.mode;
      }
    }
    currentPower = cycleResult.cost;

    if (onLog) {
      onLog(`循环组优化完成, 耗电: ${formatPowerValue(currentPower)}`);
    }
  } else {
    if (onLog) onLog('无循环组，跳过第一阶段');
  }

  // 5. 第二阶段：单物品优化
  if (onLog) onLog('\n========== 第二阶段：单物品优化 ==========');

  // 5.1 重新SCC分析
  const secondResult = calculatePower(gameData, currentScheme, settings, needs);
  const secondSccsForward = [...secondResult.sccs].reverse();

  // 5.2 按SCC正序收集需要优化的物品
  const itemsToOptimize = [];
  for (const scc of secondSccsForward) {
    for (const itemId of scc) {
      if (itemId === '__solution__') continue;
      if (resolved.has(itemId)) continue; // 跳过已持久化的物品

      const recipeIndex = itemToRecipe.get(itemId);
      if (recipeIndex === undefined) continue;

      const recipe = recipeData[recipeIndex];
      const choices = getAvailableChoices(recipe, settings);

      if (choices.length > 1) {
        itemsToOptimize.push({ itemId, recipeIndex, choices });
      }
    }
  }

  if (onLog) onLog(`需要优化的物品: ${itemsToOptimize.length} 个`);

  // 5.3 按SCC正序逐个优化
  const changes = [];
  for (let i = 0; i < itemsToOptimize.length; i++) {
    const { itemId, recipeIndex, choices } = itemsToOptimize[i];

    if (onProgress) {
      onProgress(i + 1, itemsToOptimize.length, `优化 ${itemId}`);
    }
    if (onLog) onLog(`[${i + 1}/${itemsToOptimize.length}] ${itemId}`);

    // 遍历所有增产选择
    let bestChoice = { level: 0, mode: 0, name: '无' };
    let bestCost = currentPower;

    for (const choice of choices) {
      // 临时修改选择
      const tempScheme = structuredClone(currentScheme);
      tempScheme.scheme_for_recipe[recipeIndex]['增产剂等级'] = choice.level;
      tempScheme.scheme_for_recipe[recipeIndex]['增产模式'] = choice.mode;

      // 计算成本
      const result = calculatePower(gameData, tempScheme, settings, needs);
      const cost = result.totalEnergyCost;

      if (cost < bestCost) {
        bestCost = cost;
        bestChoice = choice;
      }
    }

    // 应用最佳选择
    if (bestChoice.level !== 0 || bestChoice.mode !== 0) {
      currentScheme.scheme_for_recipe[recipeIndex]['增产剂等级'] = bestChoice.level;
      currentScheme.scheme_for_recipe[recipeIndex]['增产模式'] = bestChoice.mode;
      currentPower = bestCost;

      resolved.set(itemId, { strategy: bestChoice, cost: bestCost });
      changes.push({
        itemId,
        recipeIndex,
        newLevel: bestChoice.level,
        newMode: bestChoice.mode,
        powerAfter: bestCost
      });

      if (onLog) onLog(`  ✓ ${bestChoice.name} (${formatPowerValue(bestCost)})`);
    } else {
      resolved.set(itemId, { strategy: bestChoice, cost: bestCost });
      if (onLog) onLog(`  - 保持无增产`);
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
    } else {
      onLog('当前配置已是最优');
    }
  }

  return {
    optimalScheme: currentScheme,
    initialPower,
    optimalPower: currentPower,
    changes,
    processedCount: itemsToOptimize.length,
    totalCount: itemsToOptimize.length
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
