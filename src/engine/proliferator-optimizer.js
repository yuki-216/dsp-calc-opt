/**
 * 增产策略优化器
 * 职责：优化增产策略
 * 支持多种目标函数：最小电力、最小净热值、最小占地、珍稀权重
 *
 * 算法核心：
 * 最高等级配置下，按 SCC 顺序优化（单节点逐个优化，循环组坐标下降）
 */

import { CoreEngine } from './index.js';
import { GlobalState, FUEL_DATA_BASE, buildItemRecipeIndex } from '../game_data.jsx';
import { validateFinalProliferatorChoices } from './proliferator-final-validation.js';
import {
    RARE_ORE_EQUIVALENCE,
    RARE_ORE_PRACTICALITY_RATIO,
    getRareOreCorrection,
    correctedRareWeightUnit,
} from './rare-ore-practicality.js';

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

// 油井产量衰减系数（用户输入面板产量，实际可用量 = 面板产量 / 0.00004）
const OIL_DECAY_FACTOR = 0.00004;

/**
 * 构建 物品 -> 有效可用量 映射（原油在矿量模式下输入的是面板产量，需还原为原始量；矿点模式不换算）
 * @param {Object} oreQuantities - 可用量设置
 * @param {Object} settings - 设置参数
 * @returns {Object} 物品 -> 有效可用量
 */
function buildEffectiveAvailMap(oreQuantities, settings) {
    const map = {};
    for (const [item, raw] of Object.entries(oreQuantities || {})) {
        if (item === '原油' && raw > 0 && settings.ore_quantity_mode !== 'point') {
            map[item] = raw / OIL_DECAY_FACTOR;
        } else {
            map[item] = raw;
        }
    }
    return map;
}

/**
 * 计算珍稀权重法目标值（用于珍稀权重法优化策略）
 * 等价权重 = 基准可用量 / 本矿可用量（相对稀缺倍数：最丰富矿=1，越稀缺权重越大），
 * 目标值 = Σ 需求 × 权重 = 基准可用量 × Σ(需求 / 可用量)。
 * 基准可用量取所有已设可用量中的最大值（全局常量），因此目标值仅比原始的 1/可用量
 * 加权求和整体放大一个常数倍，单调变换不改变最优解——优化结果与线性 1/可用量 完全一致，
 * 只是把权重缩放到可读的“稀缺倍数”量级。
 * 加权求和不会只盯住单一最大瓶颈，对中等稀缺矿也更敏感，更适合前期多种矿物都很稀缺的场景。
 * 未设置任何可用量时退化为无权重累加（与原矿数一致）。
 * @param {Object} gameData - 游戏数据
 * @param {Object} schemeData - 方案数据
 * @param {Object} settings - 设置参数
 * @param {Array} needs - 需求列表
 * @returns {Object} { rareWeightObjective, totalRawOre, ... }
 */
function calculateRareWeight(gameData, schemeData, settings, needs) {
  const result = calculatePower(gameData, schemeData, settings, needs);
  const recipeData = gameData.recipe_data || [];
  const mineralizeList = settings.mineralize_list || {};
  const oreQuantities = settings.ore_quantities || {};

  // 检查是否有可用量设置
  const hasQuantities = Object.keys(oreQuantities).length > 0;

  // 有效可用量：原油在矿量模式下输入的是面板产量，需还原为原始量；矿点模式不换算
  const effectiveAvailMap = buildEffectiveAvailMap(oreQuantities, settings);

  // 基准可用量 = 所有已设可用量中的最大值（全局常量，保证各方案间单调缩放一致）
  let baseAvail = 0;
  if (hasQuantities) {
    for (const eff of Object.values(effectiveAvailMap)) {
      if (eff > baseAvail) baseAvail = eff;
    }
  }
  const practicalityEnabled = settings.rare_ore_practicality;

  let totalRawOre = 0; // 真实原矿数累加（退化模式/语义值）
  let rareWeightObjective = 0; // 加权求和目标值 = baseAvail × Σ(需求/有效可用量)

  for (const [item, amount] of Object.entries(result.resourceUsage)) {
    if (amount <= 0) continue; // 跳过副产物/盈余
    if (isRawOreItem(item, recipeData, mineralizeList)) {
      totalRawOre += amount; // 始终计算（用于退化模式/语义值）

      const available = effectiveAvailMap[item] || 0;
      if (available > 0) {
        // 相对稀缺倍数：最丰富矿=1，越稀缺权重越大
        let weight = baseAvail / available;
        // 珍稀实用性修正：命中等价规则时改用修正后的单位权重
        const correction = practicalityEnabled ? getRareOreCorrection(item, effectiveAvailMap) : null;
        if (correction) {
          weight = correctedRareWeightUnit(correction, baseAvail);
        }
        rareWeightObjective += amount * weight; // = 基准可用量 × 需求 / 可用量
      }
    }
  }

  // 未设置任何可用量时，退化为无权重累加
  const finalObjective = hasQuantities ? rareWeightObjective : totalRawOre;

  return { rareWeightObjective: finalObjective, totalRawOre, ...result };
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
 * @param {Object} result - calculatePower / calculateRareWeight / calculateOreHeat 的返回结果
 * @param {string} strategy - 策略标识 ('min_power' | 'min_rare_weight' | 'min_net_heat' | 'min_footprint')
 * @returns {number} 目标值（越小越好）
 */
function getObjectiveValue(result, strategy) {
  if (strategy === 'min_rare_weight') {
    return result.rareWeightObjective ?? 0;
  }
  if (strategy === 'min_net_heat') {
    return result.netOreHeat ?? 0;
  }
  if (strategy === 'min_footprint') {
    return result.totalFootprint ?? 0;
  }
  return result.totalEnergyCost; // 默认 min_power
}

function getNoProliferatorThreshold(settings) {
  const value = Number(settings?.no_proliferator_weight);
  return Number.isFinite(value) ? Math.max(0, value) : 0.005;
}

/**
 * 格式化目标值
 * @param {number} value - 目标值
 * @param {string} strategy - 策略标识
 * @returns {string} 格式化后的字符串
 */
function formatObjectiveValue(value, strategy) {
  if (strategy === 'min_net_heat') {
    return formatHeatValue(value);
  }
  if (strategy === 'min_footprint') {
    return value.toFixed(0) + ' 格';
  }
  if (strategy === 'min_rare_weight') {
    // 目标值为小数（量级约 1e-3），固定 2 位小数会截成 0.00，需自适应精度
    if (!Number.isFinite(value) || value === 0) return '0 稀缺权重';
    const a = Math.abs(value);
    if (a >= 100) return value.toFixed(2) + ' 稀缺权重';
    if (a >= 1) return value.toFixed(3) + ' 稀缺权重';
    if (a >= 0.01) return value.toFixed(4) + ' 稀缺权重';
    return Number(value.toPrecision(4)).toString() + ' 稀缺权重';
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
 * @param {Object} gameData - 游戏数据（可选，用于识别生产增产剂的配方）
 * @returns {Array} 可用的增产选择列表
 */
function getAvailableChoices(recipe, settings = {}, gameData = null) {
  const proliferator = recipe['增产'] || 0;
  if (proliferator === 0) return [{ level: 0, mode: 0, name: '无' }];

  const choices = [{ level: 0, mode: 0, name: '无' }];
  const noAccelerate = settings.proliferate_no_accelerate || false;
  const allowedLevels = settings.proliferate_allowed_levels || [1, 2, 3];
  // 增产剂自由等级：仅对生产"增产剂 Mk.I/II/III"三个物品的配方生效（它们本就在产线上，无混用顾虑）
  const flexibleLevels = settings.proliferate_flexible_levels || false;
  const proliferatorItemNames = new Set(
    (gameData?.proliferator_data || []).map(d => d?.['增产剂']).filter(Boolean)
  );
  const producesProliferator = Object.keys(recipe['产物'] || {}).some(name => proliferatorItemNames.has(name));
  const maxLevel = allowedLevels.length > 0 ? Math.max(...allowedLevels) : 0;

  // 位掩码：bit0=可加速, bit1=可增产, bit2=特殊(透镜)
  const canAccelerate = (proliferator & 1) && !noAccelerate;
  const canExtraProduct = proliferator & 2;

  for (let level = 1; level <= maxLevel; level++) {
    // 默认仅允许可选增产剂选中的等级；仅生产增产剂的配方在开启自由等级后允许 1..最高等级
    if (!(flexibleLevels && producesProliferator) && !allowedLevels.includes(level)) continue;

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
 * @param {string} strategy - 优化策略 ('min_power' | 'min_rare_weight' | 'min_net_heat' | 'min_footprint')
 * @returns {Object} { choices, cost, calculations }
 */
async function optimizeCycleGroupPhase(cycleItems, gameData, settings, needs, baseScheme, itemToRecipe, onLog, strategy = 'min_power') {
  const recipeData = gameData.recipe_data || [];

  // 根据策略选择计算函数
  const calculateResult = strategy === 'min_net_heat' ? calculateOreHeat
    : strategy === 'min_rare_weight' ? calculateRareWeight
    : calculatePower;

  // 获取每个物品的可用增产选择
  const itemChoices = cycleItems.map(item => {
    const recipeIndex = itemToRecipe.get(item);
    if (recipeIndex === undefined) return [{ level: 0, mode: 0, name: '无' }];
    const recipe = recipeData[recipeIndex];
    return getAvailableChoices(recipe, settings, gameData);
  });

  // 初始状态：所有物品选择"无"
  const currentChoices = cycleItems.map((item, idx) => {
    return itemChoices[idx][0];
  });

  // 计算当前方案的结果
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

  // 计算初始成本
  const initResult = calculateFullResult(currentChoices);
  let currentCost = getObjectiveValue(initResult, strategy);

  // 坐标下降迭代
  let totalCalculations = 0;
  let improved = true;

  while (improved) {
    improved = false;

    for (let i = 0; i < cycleItems.length; i++) {
      const choices = itemChoices[i];
      let bestChoice = currentChoices[i];
      let bestCost = currentCost;

      // 尝试每种选择
      for (const choice of choices) {
        if (choice === currentChoices[i]) continue;

        const oldChoice = currentChoices[i];
        currentChoices[i] = choice;

        const result = calculateFullResult(currentChoices);
        const cost = getObjectiveValue(result, strategy);
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
 * @returns {Object} { currentScheme, currentObjective, currentPower, changes }
 */
async function optimizePhaseBySCC(sccs, gameData, settings, needs, currentScheme, itemToRecipe, resolved, onLog, strategy, onProgress = null) {
  const recipeData = gameData.recipe_data || [];
  const calculateResult = strategy === 'min_net_heat' ? calculateOreHeat
    : strategy === 'min_rare_weight' ? calculateRareWeight
    : calculatePower;

  const initialCalcResult = calculateResult(gameData, currentScheme, settings, needs);
  let currentObjective = getObjectiveValue(initialCalcResult, strategy);
  let currentPower = calculatePower(gameData, currentScheme, settings, needs).totalEnergyCost;
  const changes = [];
  const totalSteps = Math.max(1, sccs.length);

  for (let sccIdx = 0; sccIdx < sccs.length; sccIdx++) {
    const scc = sccs[sccIdx];
    onProgress?.(sccIdx, totalSteps, `正在优化第${sccIdx + 1}/${totalSteps}组`);

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
      const choices = getAvailableChoices(recipe, settings, gameData);

      // 只有一个选择时，直接应用（无需遍历）
      if (choices.length <= 1) {
        const onlyChoice = choices[0];
        currentScheme.scheme_for_recipe[recipeIndex]['增产剂等级'] = onlyChoice.level;
        currentScheme.scheme_for_recipe[recipeIndex]['增产模式'] = onlyChoice.mode;
        resolved.set(itemId, { strategy: onlyChoice, cost: currentObjective });
        continue;
      }

      // 遍历所有增产选择，找到优于当前状态的最优选择
      let bestChoice = null;
      let bestCost = currentObjective;

      for (const choice of choices) {
        const tempScheme = structuredClone(currentScheme);
        tempScheme.scheme_for_recipe[recipeIndex]['增产剂等级'] = choice.level;
        tempScheme.scheme_for_recipe[recipeIndex]['增产模式'] = choice.mode;

        const result = calculateResult(gameData, tempScheme, settings, needs);
        const cost = getObjectiveValue(result, strategy);
        if (cost < bestCost) {
          bestCost = cost;
          bestChoice = choice;
        }
      }

      // 仅当找到更优选择时才应用并更新状态
      if (bestChoice) {
        currentScheme.scheme_for_recipe[recipeIndex]['增产剂等级'] = bestChoice.level;
        currentScheme.scheme_for_recipe[recipeIndex]['增产模式'] = bestChoice.mode;
        currentObjective = bestCost;
        // 重新计算获取最新的耗电
        const afterApplyResult = calculateResult(gameData, currentScheme, settings, needs);
        currentPower = afterApplyResult.totalEnergyCost;
      }

      // 实际应用的增产选择：参照当前方案，而非默认首项 choices[0]（首项恒为“无”）
      const appliedLevel = currentScheme.scheme_for_recipe[recipeIndex]['增产剂等级'];
      const appliedMode = currentScheme.scheme_for_recipe[recipeIndex]['增产模式'];
      const appliedChoice = bestChoice
        || choices.find(c => c.level === appliedLevel && c.mode === appliedMode)
        || choices[0];

      resolved.set(itemId, { strategy: appliedChoice, cost: bestCost });
      // 仅当实际应用了更优选择时才记录 changes
      if (bestChoice) {
        changes.push({
          itemId,
          recipeIndex,
          newLevel: bestChoice.level,
          newMode: bestChoice.mode,
          powerAfter: currentPower,
          objectiveAfter: bestCost
        });
      }

      if (onLog) {
        const status = bestChoice ? '' : ' (已最优)';
        onLog(`[${sccIdx}] ${itemId} (单节点) → ${appliedChoice.name}${status} (${formatObjectiveValue(bestCost, strategy)})`);
      }

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
      // 重新计算当前状态，获取最新耗电
      currentPower = calculatePower(gameData, currentScheme, settings, needs).totalEnergyCost;

      changes.push({
        itemId: `[${cycleItems.join(',')}]`,
        recipeIndex: -1,
        newLevel: -1,
        newMode: -1,
        powerAfter: currentPower,
        objectiveAfter: currentObjective
      });

      if (onLog) {
        onLog(`  总计: ${formatObjectiveValue(currentObjective, strategy)}`);
      }
      // 输出循环组内每个物品的选择（单行合并显示）
      if (onLog) {
        const choiceParts = cycleItems.map((item, i) => `${item} → ${cycleResult.choices[i].name}`);
        onLog(`  ${choiceParts.join('  ')}`);
      }
    }

    onProgress?.(sccIdx + 1, totalSteps, `已完成第${sccIdx + 1}/${totalSteps}组`);
    await new Promise(resolve => setTimeout(resolve, 0));
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
 * @param {string} strategy - 优化策略 ('min_power' | 'min_rare_weight' | 'min_net_heat' | 'min_footprint')
 * @param {Object} optimizationOptions - 优化器专用选项
 * @returns {Object} { optimalScheme, initialPower, optimalPower, strategy, initialObjective, optimalObjective, changes }
 */
export async function optimizeProliferatorStrategy(gameData, schemeData, settings, needs, onProgress = null, onLog = null, strategy = 'min_power', optimizationOptions = {}) {
  // 优化全程关闭调试输出，避免控制台刷屏，结束后恢复
  const dbg = typeof window !== 'undefined' && window.__DEBUG;
  const wasDebugEnabled = dbg && dbg.enabled;
  if (wasDebugEnabled) dbg.off();
  try {

  settings = {...settings, ...optimizationOptions};

  // 根据策略选择计算函数
  const calculateResult = strategy === 'min_net_heat' ? calculateOreHeat
    : strategy === 'min_rare_weight' ? calculateRareWeight
    : calculatePower; // min_power 和 min_footprint 都用 calculatePower

  // 1. 输出初始信息
  const strategyName = strategy === 'min_net_heat' ? '最小净热值'
    : strategy === 'min_footprint' ? '最小占地'
    : strategy === 'min_rare_weight' ? '珍稀权重'
    : '最小电力';
  if (onLog) {
    onLog(`优化策略: ${strategyName}`);
    onLog(`需求物品: ${needs.map(n => `${n.id}x${n.count}`).join(', ')}`);
  }
  onProgress?.(0, 1, '正在初始化...');
  await new Promise(resolve => setTimeout(resolve, 0));

  // 2. 执行初始计算
  const initialResult = calculateResult(gameData, schemeData, settings, needs);
  const initialPower = initialResult.totalEnergyCost;
  const initialObjective = getObjectiveValue(initialResult, strategy);

  if (onLog) {
    onLog(`初始目标: ${formatObjectiveValue(initialObjective, strategy)}`);
  }

  // 2.1 珍稀实用性修正信息（珍稀权重策略且开启时）
  if (strategy === 'min_rare_weight'
      && settings.rare_ore_practicality && onLog) {
    const effectiveAvailMap = buildEffectiveAvailMap(settings.ore_quantities || {}, settings);
    const correctedLines = [];
    const skippedLines = [];
    for (const [rare, rule] of Object.entries(RARE_ORE_EQUIVALENCE)) {
      const amount = initialResult.resourceUsage?.[rare];
      if (!amount || amount <= 0) continue; // 方案中未消耗该珍稀矿
      const correction = getRareOreCorrection(rare, effectiveAvailMap);
      if (!correction) {
        skippedLines.push(`${rare} → ${rule.commonOre}: 普通矿 ${rule.commonOre} 未设置可用量，本次不修正`);
        continue;
      }
      correctedLines.push(`${rare} → ${rule.commonOre} (等价 ${rule.rareAmount}↔${rule.commonAmount})`);
    }
    onLog(`珍稀实用性修正: 已启用 (替代比例 ${RARE_ORE_PRACTICALITY_RATIO * 100}%)`);
    if (correctedLines.length === 0 && skippedLines.length === 0) {
      onLog('  方案中未涉及三种珍稀矿');
    } else {
      correctedLines.forEach((line) => onLog('  ' + line));
      skippedLines.forEach((line) => onLog('  ' + line));
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

  for (const recipeIndex of itemToRecipe.values()) {
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
  const activeRecipeIndices = new Set();
  for (const scc of sccsForward) {
    for (const itemId of scc) {
      const recipeIndex = itemToRecipe.get(itemId);
      if (recipeIndex !== undefined) activeRecipeIndices.add(recipeIndex);
    }
  }

  if (onLog) {
    onLog(`最高等级配置下 SCC: ${sccsForward.map(scc => `[${[...scc].join(',')}]`).join(' → ')}`);
  }

  // 4.3 按 SCC 顺序优化（单阶段完成）
  const resolved = new Map();
  let currentScheme = structuredClone(maxScheme);
  let currentPower = initialPower;
  let currentObjective = initialObjective;

  onProgress?.(0, Math.max(1, sccsForward.length), '正在开始优化...');
  const result = await optimizePhaseBySCC(
    sccsForward, gameData, settings, needs, currentScheme, itemToRecipe, resolved, onLog, strategy, onProgress
  );

  currentScheme = result.currentScheme;
  currentObjective = result.currentObjective;
  currentPower = result.currentPower;

  const finalValidation = await validateFinalProliferatorChoices({
    gameData,
    settings,
    needs,
    sccs: sccsForward,
    scheme: currentScheme,
    itemToRecipe,
    strategy,
    threshold: getNoProliferatorThreshold(settings),
    calculateResult,
    onLog,
  });
  currentScheme = finalValidation.scheme;
  currentObjective = getObjectiveValue(finalValidation.result, strategy);
  currentPower = finalValidation.result.totalEnergyCost;

  // 5. 输出最终结果
  const optimalObjective = currentObjective;

  if (onLog) {
    onLog('\n========== 优化结果 ==========');
    onLog(`策略: ${strategyName}`);
    onLog(`初始目标: ${formatObjectiveValue(initialObjective, strategy)}`);
    onLog(`最终目标: ${formatObjectiveValue(optimalObjective, strategy)}`);
    if (result.changes.length > 0) {
      const reduction = initialObjective - optimalObjective;
      const percent = initialObjective > 0 ? (reduction / initialObjective * 100).toFixed(2) : '0.00';
      onLog(`目标减少: ${formatObjectiveValue(reduction, strategy)} (${percent}%)`);
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
    activeRecipeIndices,
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

