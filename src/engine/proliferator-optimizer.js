/**
 * 增产策略优化器
 * 职责：优化增产策略
 * 支持多种目标函数：最小电力、最小原矿输出
 *
 * 算法核心：
 * 最高等级配置下，按 SCC 顺序优化（单节点逐个优化，循环组坐标下降）
 */

import { CoreEngine } from './index.js';
import { GlobalState, FUEL_DATA_BASE, buildItemRecipeIndex } from '../game_data.jsx';

/**
 * 计算给定方案下的总耗电
 * @param {Object} gameData - 游戏数据
 * @param {Object} schemeData - 方案数据
 * @param {Object} settings - 设置参数
 * @param {Array} needs - 需求列表
 * @returns {Object} { totalEnergyCost, energyCost, minerEnergyCost, resourceUsage, graph, edges, sccs }
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
      resourceUsage: result.resourceUsage || {},
      surplusByproducts: result.surplusByproducts || {},
      totalFootprint: result.totalFootprint || 0,
      footprintDetails: result.footprintDetails || {},
      graph: new Map(),
      edges: [],
      sccs: []
    };
  }

  return {
    totalEnergyCost: result.totalEnergyCost || 0,
    energyCost: result.energyCost || 0,
    minerEnergyCost: result.minerEnergyCost || 0,
    resourceUsage: result.resourceUsage || {},
    surplusByproducts: result.surplusByproducts || {},
    totalFootprint: result.totalFootprint || 0,
    footprintDetails: result.footprintDetails || {},
    graph: engine.graph,
    edges: engine.edges,
    sccs: engine.sccs
  };
}

/**
 * 判断物品是否为原矿
 * 原矿判定标准：
 * 1. 在 mineralize_list 中（用户标记为原矿化）
 * 2. 存在无原料输入单一产物配方，且该配方可由非行星基地设施生产
 *    （如轨道采集器可开采的氢、重氢也算原矿）
 * @param {string} itemId - 物品ID
 * @param {Array} recipeData - 配方数据
 * @param {Object} mineralizeList - 原矿化列表
 * @returns {boolean}
 */
function isRawOreItem(itemId, recipeData, mineralizeList) {
  // 1. 在原矿化列表中
  if (itemId in mineralizeList) return true;

  // 2. 查找该物品的配方，判断是否存在可由非行星基地设施生产的无原料配方
  for (const recipe of recipeData) {
    const outputs = recipe['产物'] || {};
    if (!(itemId in outputs)) continue;

    const inputs = recipe['原料'] || {};
    const outputKeys = Object.keys(outputs);
    // 无原料输入 + 单一产物 + 可由非行星基地设施生产（如采矿机、采集器）
    if (Object.keys(inputs).length === 0 && outputKeys.length === 1 && recipe['可采集']) {
      return true;
    }
  }

  return false;
}

/**
 * 计算给定方案下的原矿瓶颈度（最大瓶颈法）
 * 瓶颈度 = max(消耗量_i / 可用量_i)
 * 未设置可用量的矿物不参与瓶颈计算；未设置任何可用量时退化为无权重累加
 * @param {Object} gameData - 游戏数据
 * @param {Object} schemeData - 方案数据
 * @param {Object} settings - 设置参数
 * @param {Array} needs - 需求列表
 * @returns {Object} { totalRawOre, bottleneckOre, ... }
 */
// 油井产量衰减系数（用户输入面板产量，实际可用量 = 面板产量 / 0.00004）
const OIL_DECAY_FACTOR = 0.00004;

function calculateRawOre(gameData, schemeData, settings, needs) {
  const result = calculatePower(gameData, schemeData, settings, needs);
  const recipeData = gameData.recipe_data || [];
  const mineralizeList = settings.mineralize_list || {};
  const oreQuantities = settings.ore_quantities || {};

  // 检查是否有可用量设置
  const hasQuantities = Object.keys(oreQuantities).length > 0;

  let maxBottleneck = 0;
  let bottleneckOre = '';
  let totalRawOre = 0; // 退化模式（无可用量设置时使用）
  const bottleneckArray = []; // 收集所有矿物的瓶颈度

  for (const [item, amount] of Object.entries(result.resourceUsage)) {
    if (amount <= 0) continue; // 跳过副产物/盈余
    if (isRawOreItem(item, recipeData, mineralizeList)) {
      totalRawOre += amount; // 始终计算（用于退化模式）

      let available = oreQuantities[item];
      // 原油：用户输入的是面板产量，需要转换为实际可用量
      if (item === '原油' && available > 0) {
        available = available / OIL_DECAY_FACTOR;
      }
      if (available > 0) {
        const bottleneck = amount / available;
        bottleneckArray.push({ item, bottleneck });
        if (bottleneck > maxBottleneck) {
          maxBottleneck = bottleneck;
          bottleneckOre = item;
        }
      }
    }
  }

  // 按瓶颈度降序排列
  bottleneckArray.sort((a, b) => b.bottleneck - a.bottleneck);

  // 未设置任何可用量时，退化为无权重累加
  const finalRawOre = hasQuantities ? maxBottleneck : totalRawOre;

  return { totalRawOre: finalRawOre, bottleneckOre, bottleneckArray, ...result };
}

/**
 * 比较两个瓶颈数组（字典序，越小越好）
 * @param {Array} aArray - 瓶颈数组A [{item, bottleneck}]
 * @param {Array} bArray - 瓶颈数组B [{item, bottleneck}]
 * @returns {number} 负数=A更优，0=相等，正数=B更优
 */
function compareBottlenecks(aArray, bArray) {
  const len = Math.max(aArray.length, bArray.length);
  for (let i = 0; i < len; i++) {
    const aVal = aArray[i]?.bottleneck ?? 0;
    const bVal = bArray[i]?.bottleneck ?? 0;
    if (aVal !== bVal) return aVal - bVal;
  }
  return 0;
}

/**
 * 计算原矿净热值（用于最小净热值优化策略）
 * 原矿热值 - 副产品燃料热值
 * @param {Object} gameData - 游戏数据
 * @param {Object} schemeData - 方案数据
 * @param {Object} settings - 设置参数
 * @param {Array} needs - 需求列表
 * @returns {Object} { netOreHeat, oreHeat, byproductHeat, ...calculatePower的结果 }
 */
function calculateOreHeat(gameData, schemeData, settings, needs) {
  const result = calculatePower(gameData, schemeData, settings, needs);
  const recipeData = gameData.recipe_data || [];
  const mineralizeList = settings.mineralize_list || {};

  // 计算原矿热值
  let oreHeat = 0;
  for (const [item, amount] of Object.entries(result.resourceUsage)) {
    if (amount <= 0) continue;
    if (isRawOreItem(item, recipeData, mineralizeList)) {
      const fuel = FUEL_DATA_BASE.find(f => f.name === item);
      if (fuel && fuel.heatValue > 0) {
        oreHeat += amount * fuel.heatValue;
      }
    }
  }

  // 副产品燃料热值抵扣
  let byproductHeat = 0;
  for (const [item, amount] of Object.entries(result.surplusByproducts || {})) {
    if (amount >= 0) continue; // 只处理负系数（副产品）
    const fuel = FUEL_DATA_BASE.find(f => f.name === item);
    if (fuel && fuel.heatValue > 0) {
      byproductHeat += Math.abs(amount) * fuel.heatValue;
    }
  }

  const netOreHeat = oreHeat - byproductHeat;

  return { netOreHeat, oreHeat, byproductHeat, ...result };
}

/**
 * 获取优化目标值
 * @param {Object} result - calculatePower / calculateRawOre / calculateOreHeat 的返回结果
 * @param {string} strategy - 策略标识 ('min_power' | 'min_raw_ore' | 'min_net_heat' | 'min_footprint')
 * @returns {number} 目标值（越小越好）
 */
function getObjectiveValue(result, strategy) {
  if (strategy === 'min_raw_ore') {
    return result.totalRawOre ?? 0;
  }
  if (strategy === 'min_net_heat') {
    return result.netOreHeat ?? 0;
  }
  if (strategy === 'min_footprint') {
    return result.totalFootprint ?? 0;
  }
  return result.totalEnergyCost; // 默认 min_power
}

/**
 * 格式化目标值
 * @param {number} value - 目标值
 * @param {string} strategy - 策略标识
 * @param {string} bottleneckOre - 瓶颈矿物名（仅 min_raw_ore 策略，非空时表示瓶颈模式）
 * @returns {string} 格式化后的字符串
 */
function formatObjectiveValue(value, strategy, bottleneckOre = '', baseline = null) {
  if (strategy === 'min_raw_ore') {
    if (bottleneckOre) {
      // 瓶颈模式：相对于初始最大瓶颈显示百分比
      const base = baseline || value; // 无基准时退化为自身（100%）
      const pct = (value / base) * 100;
      if (pct === 0) return '0%';
      if (pct < 0.01) return pct.toFixed(3) + '%';
      if (pct >= 1000) return pct.toFixed(0) + '%';
      return pct.toFixed(1) + '%';
    }
    // 退化模式：显示为原矿数
    return value.toFixed(2) + ' 原矿';
  }
  if (strategy === 'min_net_heat') {
    return formatHeatValue(value);
  }
  if (strategy === 'min_footprint') {
    return value.toFixed(0) + ' 格';
  }
  return formatPowerValue(value);
}

/**
 * 格式化热值
 * @param {number} value - 热值（MJ）
 * @returns {string} 格式化后的字符串
 */
function formatHeatValue(value) {
  if (value >= 1e6) return (value / 1e6).toFixed(2) + ' TJ';
  if (value >= 1e3) return (value / 1e3).toFixed(2) + ' GJ';
  return value.toFixed(2) + ' MJ';
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
 * @param {Object} schemeData - 方案数据（包含用户的配方选择）
 * @returns {Map} 物品->配方索引映射
 */
function buildItemToRecipeMap(recipeData, schemeData) {
  // 使用共享函数构建 itemData
  const itemData = buildItemRecipeIndex(recipeData);

  const itemToRecipe = new Map();
  const selectedFuel = schemeData?.selected_fuel;

  // 根据用户的配方选择构建映射
  for (const item of Object.keys(itemData)) {
    const choiceIndex = schemeData?.item_recipe_choices?.[item] ?? 1;
    const recipeIndex = itemData[item][choiceIndex];
    if (recipeIndex !== undefined && recipeIndex !== null) {
      itemToRecipe.set(item, recipeIndex);
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
 * 循环组坐标下降优化
 * 使用坐标下降算法优化循环组内所有物品的增产策略
 *
 * @param {Array<string>} cycleItems - 循环组物品列表
 * @param {Object} gameData - 游戏数据
 * @param {Object} settings - 设置参数
 * @param {Array} needs - 需求列表
 * @param {Object} baseScheme - 基础方案数据
 * @param {Map} itemToRecipe - 物品到配方映射
 * @param {Function} onLog - 日志回调
 * @param {string} strategy - 优化策略 ('min_power' | 'min_raw_ore')
 * @returns {Object} { choices, cost, calculations }
 */
async function optimizeCycleGroupPhase(cycleItems, gameData, settings, needs, baseScheme, itemToRecipe, onLog, strategy = 'min_power') {
  const recipeData = gameData.recipe_data || [];
  const oreQuantities = settings.ore_quantities || {};
  const hasQuantities = Object.keys(oreQuantities).length > 0;

  // 根据策略选择计算函数
  const calculateResult = strategy === 'min_net_heat' ? calculateOreHeat
    : strategy === 'min_raw_ore' ? calculateRawOre
    : calculatePower;

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

  // 计算当前方案的结果（返回完整结果，用于瓶颈数组比较）
  function calculateFullResult(choices) {
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
    return calculateResult(gameData, tempScheme, settings, needs);
  }

  // 计算初始成本和瓶颈数组（一次计算，同时提取两个值）
  const initResult = calculateFullResult(currentChoices);
  let currentCost = getObjectiveValue(initResult, strategy);
  let currentBottleneckArray = initResult.bottleneckArray || [];

  // 坐标下降迭代
  let totalCalculations = 0;
  let improved = true;

  while (improved) {
    improved = false;

    for (let i = 0; i < cycleItems.length; i++) {
      const item = cycleItems[i];
      const choices = itemChoices[i];
      let bestChoice = currentChoices[i];
      let bestCost = currentCost;
      let bestBottleneckArray = currentBottleneckArray;

      // 尝试每种选择
      for (const choice of choices) {
        if (choice === currentChoices[i]) continue;

        const oldChoice = currentChoices[i];
        currentChoices[i] = choice;

        const result = calculateFullResult(currentChoices);
        const cost = getObjectiveValue(result, strategy);
        totalCalculations++;

        let dominated = false;
        if (strategy === 'min_raw_ore' && hasQuantities) {
          const cmp = compareBottlenecks(result.bottleneckArray || [], bestBottleneckArray);
          if (cmp < 0) {
            dominated = true;
          } else if (cmp === 0 && cost < bestCost) {
            dominated = true;
          }
        } else if (cost < bestCost) {
          dominated = true;
        }

        if (dominated) {
          bestCost = cost;
          bestChoice = choice;
          bestBottleneckArray = result.bottleneckArray || [];
        }

        currentChoices[i] = oldChoice;
      }

      // 应用最佳选择
      if (bestChoice !== currentChoices[i]) {
        currentChoices[i] = bestChoice;
        currentCost = bestCost;
        currentBottleneckArray = bestBottleneckArray;
        improved = true;
      }

      // 让出主线程
      if (totalCalculations % 100 === 0) {
        await new Promise(r => setTimeout(r, 0));
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
 * 按 SCC 顺序优化
 * 遍历 SCC，单节点逐个优化，循环组坐标下降
 *
 * @param {Array<Set<string>>} sccs - SCC 列表（正序：底层在前，顶层在后）
 * @param {Object} gameData - 游戏数据
 * @param {Object} settings - 设置参数
 * @param {Array} needs - 需求列表
 * @param {Object} currentScheme - 当前方案数据（会被修改）
 * @param {Map} itemToRecipe - 物品到配方映射
 * @param {Map} resolved - 已持久化的优化结果
 * @param {Function} onLog - 日志回调
 * @param {string} strategy - 优化策略
 * @param {number} initialMaxBottleneck - 初始最大瓶颈值（用于百分比基准）
 * @returns {Object} { currentScheme, currentObjective, currentPower, changes }
 */
async function optimizePhaseBySCC(sccs, gameData, settings, needs, currentScheme, itemToRecipe, resolved, onLog, strategy, initialMaxBottleneck = 1) {
  const recipeData = gameData.recipe_data || [];
  const calculateResult = strategy === 'min_net_heat' ? calculateOreHeat
    : strategy === 'min_raw_ore' ? calculateRawOre
    : calculatePower;
  const oreQuantities = settings.ore_quantities || {};
  const hasQuantities = Object.keys(oreQuantities).length > 0;

  const initialCalcResult = calculateResult(gameData, currentScheme, settings, needs);
  let currentObjective = getObjectiveValue(initialCalcResult, strategy);
  let currentPower = calculatePower(gameData, currentScheme, settings, needs).totalEnergyCost;
  // 瓶颈矿物名（用于格式化日志，会随优化过程更新）
  let bottleneckOre = initialCalcResult.bottleneckOre || '';
  // 当前瓶颈数组（用于字典序比较）
  let currentBottleneckArray = initialCalcResult.bottleneckArray || [];
  const changes = [];

  for (let sccIdx = 0; sccIdx < sccs.length; sccIdx++) {
    const scc = sccs[sccIdx];

    // 跳过 solution 节点
    if (scc.has('__solution__')) continue;

    if (scc.size === 1) {
      // ====== 单节点 SCC：逐个优化 ======
      const itemId = [...scc][0];

      // 跳过已持久化的物品
      if (resolved.has(itemId)) continue;

      const recipeIndex = itemToRecipe.get(itemId);
      if (recipeIndex === undefined) continue;

      const recipe = recipeData[recipeIndex];
      const choices = getAvailableChoices(recipe, settings);

      // 只有一个选择时，直接应用（无需遍历）
      if (choices.length <= 1) {
        const onlyChoice = choices[0];
        currentScheme.scheme_for_recipe[recipeIndex]['增产剂等级'] = onlyChoice.level;
        currentScheme.scheme_for_recipe[recipeIndex]['增产模式'] = onlyChoice.mode;
        resolved.set(itemId, { strategy: onlyChoice, cost: currentObjective });
        continue;
      }

      // 遍历所有增产选择，找到最优
      let bestChoice = null;
      let bestCost = Infinity;
      let bestBottleneckArray = currentBottleneckArray;

      for (const choice of choices) {
        const tempScheme = structuredClone(currentScheme);
        tempScheme.scheme_for_recipe[recipeIndex]['增产剂等级'] = choice.level;
        tempScheme.scheme_for_recipe[recipeIndex]['增产模式'] = choice.mode;

        const result = calculateResult(gameData, tempScheme, settings, needs);
        const cost = getObjectiveValue(result, strategy);

        if (strategy === 'min_raw_ore' && hasQuantities) {
          // 瓶颈数组字典序比较
          const cmp = compareBottlenecks(result.bottleneckArray || [], bestBottleneckArray);
          if (cmp < 0) {
            bestCost = cost;
            bestChoice = choice;
            bestBottleneckArray = result.bottleneckArray || [];
          }
        } else {
          // 其他策略：简单数值比较
          if (cost < bestCost) {
            bestCost = cost;
            bestChoice = choice;
          }
        }
      }

      // 应用最佳选择
      currentScheme.scheme_for_recipe[recipeIndex]['增产剂等级'] = bestChoice.level;
      currentScheme.scheme_for_recipe[recipeIndex]['增产模式'] = bestChoice.mode;
      currentObjective = bestCost;

      // 重新计算当前状态，获取最新的瓶颈矿物
      const afterApplyResult = calculateResult(gameData, currentScheme, settings, needs);
      currentPower = calculatePower(gameData, currentScheme, settings, needs).totalEnergyCost;
      if (strategy === 'min_raw_ore') {
        bottleneckOre = afterApplyResult.bottleneckOre || '';
        currentBottleneckArray = afterApplyResult.bottleneckArray || [];
      }

      resolved.set(itemId, { strategy: bestChoice, cost: bestCost });
      changes.push({
        itemId,
        recipeIndex,
        newLevel: bestChoice.level,
        newMode: bestChoice.mode,
        powerAfter: currentPower,
        objectiveAfter: bestCost
      });

      if (onLog) {
        const oreTag = strategy === 'min_raw_ore' && bottleneckOre ? ` 瓶颈:${bottleneckOre}` : '';
        onLog(`[${changes.length}] ${itemId} (单节点) → ${bestChoice.name} (${formatObjectiveValue(bestCost, strategy, bottleneckOre, initialMaxBottleneck)}${oreTag})`);
      };

    } else {
      // ====== 多节点 SCC（循环组）：坐标下降优化 ======
      const cycleItems = [...scc];

      // 检查是否所有物品都已持久化
      const unresolvedItems = cycleItems.filter(item => !resolved.has(item));
      if (unresolvedItems.length === 0) continue;

      if (onLog) onLog(`\n循环组 [${cycleItems.join(', ')}]`);

      // 坐标下降优化
      const cycleResult = await optimizeCycleGroupPhase(
        cycleItems, gameData, settings, needs, currentScheme, itemToRecipe, onLog, strategy
      );

      // 应用循环组策略
      for (let i = 0; i < cycleItems.length; i++) {
        const item = cycleItems[i];
        const choice = cycleResult.choices[i];
        const recipeIndex = itemToRecipe.get(item);
        if (recipeIndex !== undefined && currentScheme.scheme_for_recipe[recipeIndex]) {
          currentScheme.scheme_for_recipe[recipeIndex]['增产剂等级'] = choice.level;
          currentScheme.scheme_for_recipe[recipeIndex]['增产模式'] = choice.mode;
        }
        resolved.set(item, { strategy: choice, cost: cycleResult.cost });
      }

      currentObjective = cycleResult.cost;
      // 重新计算当前状态，获取最新的瓶颈矿物
      const afterCycleResult = calculateResult(gameData, currentScheme, settings, needs);
      currentPower = calculatePower(gameData, currentScheme, settings, needs).totalEnergyCost;
      if (strategy === 'min_raw_ore') {
        bottleneckOre = afterCycleResult.bottleneckOre || '';
        currentBottleneckArray = afterCycleResult.bottleneckArray || [];
      }

      changes.push({
        itemId: `[${cycleItems.join(',')}]`,
        recipeIndex: -1,
        newLevel: -1,
        newMode: -1,
        powerAfter: currentPower,
        objectiveAfter: currentObjective
      });

      if (onLog) {
        const oreTag = strategy === 'min_raw_ore' && bottleneckOre ? ` 瓶颈:${bottleneckOre}` : '';
        onLog(`  总计: ${formatObjectiveValue(currentObjective, strategy, bottleneckOre, initialMaxBottleneck)}${oreTag}`);
      }
      // 输出循环组内每个物品的选择
      for (let i = 0; i < cycleItems.length; i++) {
        const item = cycleItems[i];
        const choice = cycleResult.choices[i];
        if (onLog) onLog(`  ${item} → ${choice.name}`);
      }
    }
  }

  return { currentScheme, currentObjective, currentPower, changes };
}

/**
 * 增产策略优化器主函数
 *
 * 单阶段优化：最高等级配置下，按 SCC 顺序优化（单节点逐个优化，循环组坐标下降）
 *
 * @param {Object} gameData - 游戏数据
 * @param {Object} schemeData - 当前方案数据
 * @param {Object} settings - 设置参数
 * @param {Array} needs - 需求列表
 * @param {Function} onProgress - 进度回调 (current, total, message)
 * @param {Function} onLog - 日志回调 (message)
 * @param {string} strategy - 优化策略 ('min_power' | 'min_raw_ore' | 'min_net_heat')
 * @returns {Object} { optimalScheme, initialPower, optimalPower, strategy, initialObjective, optimalObjective, changes }
 */
export async function optimizeProliferatorStrategy(gameData, schemeData, settings, needs, onProgress = null, onLog = null, strategy = 'min_power') {
  // 优化全程关闭调试输出，避免控制台刷屏，结束后恢复
  const dbg = typeof window !== 'undefined' && window.__DEBUG;
  const wasDebugEnabled = dbg && dbg.enabled;
  if (wasDebugEnabled) dbg.off();
  try {

  // 根据策略选择计算函数
  const calculateResult = strategy === 'min_net_heat' ? calculateOreHeat
    : strategy === 'min_raw_ore' ? calculateRawOre
    : calculatePower; // min_power 和 min_footprint 都用 calculatePower

  // 1. 输出初始信息
  const strategyName = strategy === 'min_raw_ore' ? '最小原矿输出'
    : strategy === 'min_net_heat' ? '最小净热值'
    : strategy === 'min_footprint' ? '最小占地'
    : '最小电力';
  if (onLog) {
    onLog(`优化策略: ${strategyName}`);
    onLog(`需求物品: ${needs.map(n => `${n.id}x${n.count}`).join(', ')}`);
    onLog('正在计算初始值...');
  }

  // 2. 执行初始计算
  const initialResult = calculateResult(gameData, schemeData, settings, needs);
  const initialPower = initialResult.totalEnergyCost;
  const initialObjective = getObjectiveValue(initialResult, strategy);
  // 初始最大瓶颈值作为基准（固定不变，用于百分比显示）
  const initialMaxBottleneck = strategy === 'min_raw_ore' ? initialObjective : 1;

  if (onLog) {
    if (strategy === 'min_net_heat') {
      onLog(`初始净热值: ${formatObjectiveValue(initialObjective, strategy)}`);
      onLog(`初始耗电: ${formatPowerValue(initialPower)}`);
    } else if (strategy === 'min_raw_ore') {
      const initBottleneck = initialResult.bottleneckOre || '';
      onLog(`初始原矿: ${formatObjectiveValue(initialObjective, strategy, initBottleneck, initialMaxBottleneck)}`);
      if (initBottleneck) onLog(`瓶颈矿物: ${initBottleneck}`);
      onLog(`初始耗电: ${formatPowerValue(initialPower)}`);
    } else if (strategy === 'min_footprint') {
      onLog(`初始占地: ${formatObjectiveValue(initialObjective, strategy)}`);
      onLog(`初始耗电: ${formatPowerValue(initialPower)}`);
    } else {
      onLog(`初始耗电: ${formatObjectiveValue(initialObjective, strategy)}`);
    }
  }

  if (!initialResult.sccs || initialResult.sccs.length === 0) {
    if (onLog) onLog('无 SCC 结构，跳过优化');
    return {
      optimalScheme: structuredClone(schemeData),
      initialPower,
      optimalPower: initialPower,
      strategy,
      initialObjective,
      optimalObjective: initialObjective,
      changes: [],
      processedCount: 0,
      totalCount: 0
    };
  }

  // 3. 构建物品到配方映射
  const recipeData = gameData.recipe_data || [];
  const itemToRecipe = buildItemToRecipeMap(recipeData, schemeData);

  // 4. 最高等级配置下按 SCC 顺序优化
  if (onLog) onLog('\n========== 开始优化 ==========');

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

  // 4.2 在最高等级配置下进行 SCC 分析
  const maxResult = calculatePower(gameData, maxScheme, settings, needs);
  // SCC 顺序：Tarjan 输出是拓扑逆序（顶层在前），我们需要正序（底层在前）
  const sccsForward = [...maxResult.sccs].reverse();

  if (onLog) {
    onLog(`最高等级配置下 SCC: ${sccsForward.map(scc => `[${[...scc].join(',')}]`).join(' → ')}`);
  }

  // 4.3 按 SCC 顺序优化（单阶段完成）
  const resolved = new Map();
  let currentScheme = structuredClone(maxScheme);
  let currentPower = initialPower;
  let currentObjective = initialObjective;

  const result = await optimizePhaseBySCC(
    sccsForward, gameData, settings, needs, currentScheme, itemToRecipe, resolved, onLog, strategy, initialMaxBottleneck
  );

  currentScheme = result.currentScheme;
  currentObjective = result.currentObjective;
  currentPower = result.currentPower;

  // 5. 输出最终结果
  const optimalObjective = currentObjective;
  const metricName = strategy === 'min_raw_ore' ? '原矿'
    : strategy === 'min_net_heat' ? '净热值'
    : strategy === 'min_footprint' ? '占地'
    : '耗电';

  // 获取最终瓶颈矿物（用于格式化）
  const finalBottleneck = strategy === 'min_raw_ore'
    ? (calculateResult(gameData, currentScheme, settings, needs).bottleneckOre || '')
    : '';

  if (onLog) {
    onLog('\n========== 优化结果 ==========');
    onLog(`策略: ${strategyName}`);
    if (strategy === 'min_raw_ore') {
      const initBottleneck = initialResult.bottleneckOre || '';
      onLog(`初始${metricName}: ${formatObjectiveValue(initialObjective, strategy, initBottleneck, initialMaxBottleneck)} 瓶颈:${initBottleneck || '无'}`);
      onLog(`最终${metricName}: ${formatObjectiveValue(optimalObjective, strategy, finalBottleneck, initialMaxBottleneck)} 瓶颈:${finalBottleneck || '无'}`);
    } else {
      onLog(`初始${metricName}: ${formatObjectiveValue(initialObjective, strategy, '', initialMaxBottleneck)}`);
      onLog(`最终${metricName}: ${formatObjectiveValue(optimalObjective, strategy, '', initialMaxBottleneck)}`);
    }
    if (strategy !== 'min_power') {
      onLog(`初始耗电: ${formatPowerValue(initialPower)}`);
      onLog(`最终耗电: ${formatPowerValue(currentPower)}`);
    }
    if (result.changes.length > 0) {
      const reduction = initialObjective - optimalObjective;
      const percent = initialObjective > 0 ? (reduction / initialObjective * 100).toFixed(1) : '0.0';
      onLog(`${metricName}减少: ${formatObjectiveValue(reduction, strategy, finalBottleneck, initialMaxBottleneck)} (${percent}%)`);
    } else {
      onLog('当前配置已是最优');
    }
  }

  return {
    optimalScheme: currentScheme,
    initialPower,
    optimalPower: currentPower,
    strategy,
    initialObjective,
    optimalObjective,
    changes: result.changes,
    processedCount: result.changes.length,
    totalCount: result.changes.length
  };

  } finally {
    if (wasDebugEnabled) dbg.on();
  }
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

