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

/**
 * 增产选择常量
 * 每个可增产配方有 7 种选择：
 * {无, MK1加速, MK1增产, MK2加速, MK2增产, MK3加速, MK3增产}
 */
const PROLIFERATOR_CHOICES = [
  { level: 0, mode: 0, name: '无' },
  { level: 1, mode: 1, name: 'MK1加速' },
  { level: 1, mode: 2, name: 'MK1增产' },
  { level: 2, mode: 1, name: 'MK2加速' },
  { level: 2, mode: 2, name: 'MK2增产' },
  { level: 3, mode: 1, name: 'MK3加速' },
  { level: 3, mode: 2, name: 'MK3增产' },
];

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
    onLog(`设置: proliferate_itself=${settings.proliferate_itself}, acc_rate=${settings.acc_rate}, inc_rate=${settings.inc_rate}`);
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
      let power;

      if (choice.level === currentLevel && choice.mode === currentMode) {
        // 当前选择，直接使用已知的耗电值
        power = currentPower;
        if (onLog) onLog(`  ${choice.name}: ${formatPowerValue(power)} (当前)`);
      } else {
        // 临时修改方案
        const tempScheme = structuredClone(currentScheme);
        tempScheme.scheme_for_recipe[recipeIndex]['增产剂等级'] = choice.level;
        tempScheme.scheme_for_recipe[recipeIndex]['增产模式'] = choice.mode;

        // 重新计算
        const result = calculatePower(gameData, tempScheme, settings, needs);
        power = result.totalEnergyCost;
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
