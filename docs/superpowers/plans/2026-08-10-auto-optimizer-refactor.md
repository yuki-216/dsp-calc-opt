# 自动优化器重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构增产策略自动优化器，将递归SCC分析改为两阶段优化：先处理循环组，再处理单物品

**Architecture:** 两阶段优化设计 - 第一阶段强制最高等级配置找出循环组并用坐标下降优化；第二阶段重新SCC分析按正序逐个优化单物品

**Tech Stack:** JavaScript, CoreEngine, tarjanSCC

## Global Constraints

- 保持相同的函数接口和回调签名
- 简化日志，只保留关键信息
- 使用坐标下降算法
- 为未来扩展预留接口

---

### Task 1: 重构主函数 optimizeProliferatorStrategy

**Files:**
- Modify: `src/engine/proliferator-optimizer.js:687-851`

**Interfaces:**
- Consumes: `calculatePower`, `getAvailableChoices`, `tarjanSCC`
- Produces: `optimizeProliferatorStrategy(gameData, schemeData, settings, needs, onProgress, onLog)`

- [ ] **Step 1: 创建辅助函数 buildItemToRecipeMap**

在 `optimizeProliferatorStrategy` 函数之前添加辅助函数：

```javascript
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
```

- [ ] **Step 2: 创建辅助函数 getFirstAvailableMode**

```javascript
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
```

- [ ] **Step 3: 创建辅助函数 getMaxAllowedLevel**

```javascript
/**
 * 获取允许的最高等级增产剂
 * @param {Object} settings - 设置参数
 * @returns {number} 最高等级
 */
function getMaxAllowedLevel(settings) {
  const allowedLevels = settings.proliferate_allowed_levels || [1, 2, 3];
  return allowedLevels.length > 0 ? Math.max(...allowedLevels) : 0;
}
```

- [ ] **Step 4: 重写 optimizeProliferatorStrategy 主函数**

```javascript
export async function optimizeProliferatorStrategy(gameData, schemeData, settings, needs, onProgress = null, onLog = null) {
  // 0. 重置调用计数器
  resetCallCount();

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
```

- [ ] **Step 5: 测试主函数**

运行自动优化功能，验证：
1. 第一阶段正确识别循环组
2. 第二阶段按SCC正序优化单物品
3. 日志输出符合预期

- [ ] **Step 6: 提交代码**

```bash
git add src/engine/proliferator-optimizer.js
git commit -m "refactor: 重构自动优化器主函数为两阶段优化"
```

---

### Task 2: 实现循环组优化阶段 optimizeCycleGroupPhase

**Files:**
- Modify: `src/engine/proliferator-optimizer.js`

**Interfaces:**
- Consumes: `calculatePower`, `getAvailableChoices`
- Produces: `optimizeCycleGroupPhase(cycleItems, gameData, settings, needs, baseScheme, itemToRecipe, onLog)`

- [ ] **Step 1: 实现 optimizeCycleGroupPhase 函数**

```javascript
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
 * @returns {Object} { choices, cost }
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
```

- [ ] **Step 2: 测试循环组优化**

运行自动优化功能，验证：
1. 循环组优化正确收敛
2. 日志显示每轮改善情况
3. 最终成本正确

- [ ] **Step 3: 提交代码**

```bash
git add src/engine/proliferator-optimizer.js
git commit -m "feat: 实现循环组优化阶段"
```

---

### Task 3: 清理旧代码并测试

**Files:**
- Modify: `src/engine/proliferator-optimizer.js`

**Interfaces:**
- 删除旧的递归函数：`optimizeCycleGroup`, `optimizeSingleItem`, `optimizeItem`, `findCycleGroup`, `getGroupKey`, `generateCombinations`, `calculateCombinationCost`, `getDependencies`
- 保留：`calculatePower`, `getAvailableChoices`, `buildItemToRecipeMap`, `getFirstAvailableMode`, `getMaxAllowedLevel`, `formatPowerValue`, `formatProliferatorMode`, `formatProliferatorLevel`, `resetCallCount`, `applyOptimizedStrategies`

- [ ] **Step 1: 删除旧的递归函数**

删除以下函数：
- `optimizeCycleGroup` (第256-405行)
- `optimizeSingleItem` (第422-586行)
- `optimizeItem` (第604-670行)
- `findCycleGroup` (第109-122行)
- `getGroupKey` (第129-131行)
- `generateCombinations` (第139-156行)
- `calculateCombinationCost` (第168-211行)
- `getDependencies` (第219-238行)

- [ ] **Step 2: 运行完整测试**

测试场景：
1. 无循环组的情况
2. 有循环组的情况
3. 不同增产剂等级限制
4. 禁用加速模式的情况

- [ ] **Step 3: 提交代码**

```bash
git add src/engine/proliferator-optimizer.js
git commit -m "refactor: 清理旧的递归优化逻辑"
```

---

### Task 4: 更新文档

**Files:**
- Modify: `docs/增产策略优化算法详解.md`

- [ ] **Step 1: 更新算法说明**

更新文档，说明新的两阶段优化算法：
1. 第一阶段：循环组优化
2. 第二阶段：单物品优化

- [ ] **Step 2: 提交文档**

```bash
git add docs/增产策略优化算法详解.md
git commit -m "docs: 更新增产策略优化算法说明"
```
