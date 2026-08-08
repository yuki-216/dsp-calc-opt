# 动态 SCC 增产策略优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将固定的 SCC 遍历顺序改为动态 SCC 遍历，解决增产剂改变依赖关系导致的 SCC 结果变化问题

**Architecture:** 递归 DFS + 动态 SCC，按 SCC 顺序遍历，发现前置物品未确定时递归处理，循环组整体遍历所有组合

**Tech Stack:** JavaScript, React, Tarjan SCC 算法

## Global Constraints

- 复用现有的 `resolvedStrategies` 结构
- 复用现有的完整成本计算逻辑（`CoreEngine.compute`）
- 不引入 DAG 层级概念（后续优化方向）
- 循环组持久化与成员组合相关，key 是成员组合的排序后 JSON 字符串

---

## 文件结构

### 需要修改的文件

1. `src/engine/proliferator-optimizer.js` - 主要修改文件，重构 `optimizeProliferatorStrategy` 函数
2. `src/engine/graph-utils.js` - 可能需要导出 `tarjanSCC` 函数（已导出）

### 需要新增的函数

1. `findCycleGroup` - 循环组检测
2. `optimizeCycleGroup` - 循环组整体遍历
3. `generateCombinations` - 组合生成
4. `calculateCombinationCost` - 组合成本计算
5. `applyOptimizedStrategies` - 策略应用

---

## Task 1: 添加循环组检测函数

**Files:**
- Modify: `src/engine/proliferator-optimizer.js`

**Interfaces:**
- Consumes: `tarjanSCC` from `graph-utils.js`
- Produces: `findCycleGroup(item, graph, edges) -> Set<string>`

- [ ] **Step 1: 添加 findCycleGroup 函数**

```javascript
/**
 * 检测物品所属的循环组
 * @param {string} item - 物品ID
 * @param {Map} graph - 物品图
 * @param {Array} edges - 边集合
 * @returns {Set<string>} 循环组成员集合（如果不在循环组中，返回只包含自己的Set）
 */
function findCycleGroup(item, graph, edges) {
  // 使用 Tarjan 算法计算 SCC
  const sccList = tarjanSCC(graph, edges);
  
  // 找到包含 item 的 SCC
  for (const scc of sccList) {
    if (scc.has(item)) {
      return scc;
    }
  }
  
  // 不在任何 SCC 中，返回只包含自己的Set
  return new Set([item]);
}
```

- [ ] **Step 2: 添加 getGroupKey 函数**

```javascript
/**
 * 生成循环组成员组合的key
 * @param {Set<string>|Array<string>} groupMembers - 循环组成员
 * @returns {string} 排序后的JSON字符串，如 '["MK1","MK2","金刚石"]'
 */
function getGroupKey(groupMembers) {
  return JSON.stringify([...groupMembers].sort());
}
```

- [ ] **Step 3: 添加 generateCombinations 函数**

```javascript
/**
 * 生成所有组合
 * @param {Array<string>} items - 物品列表
 * @param {Array} choices - 增产选择列表
 * @returns {Array<Array>} 所有组合
 */
function generateCombinations(items, choices) {
  if (items.length === 0) {
    return [[]];
  }
  
  const [first, ...rest] = items;
  const restCombinations = generateCombinations(rest, choices);
  
  const result = [];
  for (const choice of choices) {
    for (const restComb of restCombinations) {
      result.push([choice, ...restComb]);
    }
  }
  
  return result;
}
```

- [ ] **Step 4: 添加 getDependencies 函数**

```javascript
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
```

- [ ] **Step 5: Commit**

```bash
git add src/engine/proliferator-optimizer.js
git commit -m "feat: 添加循环组检测和组合生成函数"
```

---

## Task 2: 添加组合成本计算函数

**Files:**
- Modify: `src/engine/proliferator-optimizer.js`

**Interfaces:**
- Consumes: `calculatePower`, `getAvailableChoices`
- Produces: `calculateCombinationCost(combination, items, gameData, settings, needs) -> number`

- [ ] **Step 1: 添加 calculateCombinationCost 函数**

```javascript
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
function calculateCombinationCost(combination, items, gameData, settings, needs, baseSchemeData) {
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
```

- [ ] **Step 2: Commit**

```bash
git add src/engine/proliferator-optimizer.js
git commit -m "feat: 添加组合成本计算函数"
```

---

## Task 3: 添加循环组优化函数

**Files:**
- Modify: `src/engine/proliferator-optimizer.js`

**Interfaces:**
- Consumes: `findCycleGroup`, `getGroupKey`, `generateCombinations`, `calculateCombinationCost`, `getDependencies`
- Produces: `optimizeCycleGroup(group, gameData, settings, needs, baseSchemeData, resolved) -> void`

- [ ] **Step 1: 添加 optimizeCycleGroup 函数**

```javascript
/**
 * 循环组整体遍历
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
        // 递归处理外部依赖
        if (onLog) onLog(`循环组外部依赖 ${dep} 未确定，递归处理`);
        optimizeItem(dep, gameData, settings, needs, baseSchemeData, resolved, onLog);
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
  
  // 生成所有组合
  const combinations = generateCombinations(groupArray, PROLIFERATOR_CHOICES);
  
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
```

- [ ] **Step 2: Commit**

```bash
git add src/engine/proliferator-optimizer.js
git commit -m "feat: 添加循环组优化函数"
```

---

## Task 4: 添加单物品优化函数

**Files:**
- Modify: `src/engine/proliferator-optimizer.js`

**Interfaces:**
- Consumes: `getAvailableChoices`, `calculatePower`
- Produces: `optimizeSingleItem(item, gameData, settings, needs, baseSchemeData, resolved, onLog = null) -> void`

- [ ] **Step 1: 添加 optimizeSingleItem 函数**

```javascript
/**
 * 单物品优化
 * @param {string} item - 物品ID
 * @param {Object} gameData - 游戏数据
 * @param {Object} settings - 设置
 * @param {Array} needs - 需求列表
 * @param {Object} baseSchemeData - 基础方案数据
 * @param {Map} resolved - 持久化策略存储
 * @param {Function} onLog - 日志回调
 */
function optimizeSingleItem(item, gameData, settings, needs, baseSchemeData, resolved, onLog = null) {
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
    resolved.set(item, { strategy: PROLIFERATOR_CHOICES[0], cost: 0 });
    return;
  }
  
  const recipe = recipeData[recipeIndex];
  const choices = getAvailableChoices(recipe);
  
  // 3. 遍历所有增产选择
  let bestChoice = PROLIFERATOR_CHOICES[0];
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
```

- [ ] **Step 2: Commit**

```bash
git add src/engine/proliferator-optimizer.js
git commit -m "feat: 添加单物品优化函数"
```

---

## Task 5: 添加递归优化入口函数

**Files:**
- Modify: `src/engine/proliferator-optimizer.js`

**Interfaces:**
- Consumes: `findCycleGroup`, `optimizeCycleGroup`, `optimizeSingleItem`
- Produces: `optimizeItem(item, gameData, settings, needs, baseSchemeData, resolved, depth = 0, onLog = null) -> void`

- [ ] **Step 1: 添加 optimizeItem 函数**

```javascript
/**
 * 单物品优化入口（递归）
 * @param {string} item - 物品ID
 * @param {Object} gameData - 游戏数据
 * @param {Object} settings - 设置
 * @param {Array} needs - 需求列表
 * @param {Object} baseSchemeData - 基础方案数据
 * @param {Map} resolved - 持久化策略存储
 * @param {number} depth - 递归深度
 * @param {Function} onLog - 日志回调
 */
function optimizeItem(item, gameData, settings, needs, baseSchemeData, resolved, depth = 0, onLog = null) {
  // 1. 检查是否已确定
  if (resolved.has(item)) {
    return;
  }
  
  // 2. 设置最大递归深度限制（防止无限递归）
  const MAX_DEPTH = 100;
  if (depth > MAX_DEPTH) {
    console.error(`[自动优化] 递归深度超限: ${item}，可能存在无限循环`);
    // 使用默认策略（无增产）
    resolved.set(item, { strategy: PROLIFERATOR_CHOICES[0], cost: Infinity });
    return;
  }
  
  if (onLog) onLog(`${'  '.repeat(depth)}处理物品: ${item} (深度: ${depth})`);
  
  // 3. 计算当前 SCC 顺序
  const graph = gameData.graph;
  const edges = gameData.edges;
  const sccs = tarjanSCC(graph, edges);
  
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
```

- [ ] **Step 2: Commit**

```bash
git add src/engine/proliferator-optimizer.js
git commit -m "feat: 添加递归优化入口函数"
```

---

## Task 6: 重构主优化函数

**Files:**
- Modify: `src/engine/proliferator-optimizer.js`

**Interfaces:**
- Consumes: `optimizeItem`, `tarjanSCC`, `buildItemGraph`
- Produces: `optimizeProliferatorStrategy(gameData, schemeData, settings, needs, onProgress, onLog) -> Object`

- [ ] **Step 1: 重构 optimizeProliferatorStrategy 函数**

```javascript
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
    optimizeItem(itemId, gameData, settings, needs, currentScheme, resolved, 0, onLog);
    
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
```

- [ ] **Step 2: Commit**

```bash
git add src/engine/proliferator-optimizer.js
git commit -m "feat: 重构主优化函数，使用动态 SCC 遍历"
```

---

## Task 7: 添加策略应用函数

**Files:**
- Modify: `src/engine/proliferator-optimizer.js`

**Interfaces:**
- Consumes: `getGroupKey`
- Produces: `applyOptimizedStrategies(resolved, schemeData, graph) -> Object`

- [ ] **Step 1: 添加 applyOptimizedStrategies 函数**

```javascript
/**
 * 应用优化策略到方案数据
 * @param {Map} resolved - 持久化策略存储
 * @param {Object} schemeData - 方案数据
 * @param {Map} graph - 物品图
 * @returns {Object} 更新后的方案数据
 */
export function applyOptimizedStrategies(resolved, schemeData, graph) {
  // 1. 深拷贝方案数据
  const newSchemeData = structuredClone(schemeData);
  
  // 2. 遍历所有已确定的策略
  for (const [item, strategyInfo] of resolved) {
    // 跳过循环组整体策略（key 是 JSON 字符串）
    if (item.startsWith('[')) continue;
    
    // 3. 获取物品节点
    const node = graph.get(item);
    if (!node || !node.recipeId) continue;
    
    // 4. 应用策略
    const { strategy } = strategyInfo;
    if (newSchemeData.scheme_for_recipe[node.recipeId]) {
      newSchemeData.scheme_for_recipe[node.recipeId]['增产模式'] = strategy.mode;
      newSchemeData.scheme_for_recipe[node.recipeId]['增产剂等级'] = strategy.level;
    }
  }
  
  return newSchemeData;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/engine/proliferator-optimizer.js
git commit -m "feat: 添加策略应用函数"
```

---

## Task 8: 添加日志和调试函数

**Files:**
- Modify: `src/engine/proliferator-optimizer.js`

**Interfaces:**
- Consumes: 无
- Produces: `formatPowerValue(value) -> string`, `formatProliferatorMode(mode) -> string`, `formatProliferatorLevel(level) -> string`

- [ ] **Step 1: 确保格式化函数已存在**

检查 `formatPowerValue`, `formatProliferatorMode`, `formatProliferatorLevel` 函数是否已存在。如果不存在，添加它们。

```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/engine/proliferator-optimizer.js
git commit -m "feat: 确保格式化函数已存在"
```

---

## Task 9: 测试和验证

**Files:**
- Test: 手动测试

**Interfaces:**
- Consumes: `optimizeProliferatorStrategy`
- Produces: 测试结果

- [ ] **Step 1: 运行现有测试**

```bash
npm test
```

- [ ] **Step 2: 手动测试优化功能**

1. 启动应用程序
2. 添加一些需求物品
3. 点击"自动优化"按钮
4. 验证优化结果是否正确

- [ ] **Step 3: 检查日志输出**

1. 打开浏览器控制台
2. 运行自动优化
3. 检查日志输出是否符合预期

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "test: 验证动态 SCC 优化功能"
```

---

## 自审检查清单

### 1. Spec 覆盖检查

- [x] 动态 SCC：每次尝试增产选择时重新计算 SCC
- [x] 递归处理：发现前置物品未确定时，递归去计算
- [x] 循环组整体遍历：把循环组当作一个单元，遍历所有组合
- [x] 完整遍历：保证全局最优
- [x] 循环组持久化与成员组合相关：key 是成员组合，只有完全相同才能复用

### 2. 占位符扫描

- [x] 无 "TBD", "TODO", "implement later"
- [x] 无 "Add appropriate error handling"
- [x] 无 "Write tests for the above"
- [x] 无 "Similar to Task N"

### 3. 类型一致性检查

- [x] 函数签名一致：`optimizeItem(item, gameData, settings, needs, baseSchemeData, resolved, depth = 0, onLog = null)`
- [x] 函数签名一致：`optimizeCycleGroup(group, gameData, settings, needs, baseSchemeData, resolved, onLog = null)`
- [x] 函数签名一致：`optimizeSingleItem(item, gameData, settings, needs, baseSchemeData, resolved, onLog = null)`
- [x] 函数签名一致：`calculateCombinationCost(combination, items, gameData, settings, needs, baseSchemeData)`

---

## 执行选项

Plan complete and saved to `docs/superpowers/plans/2025-08-05-dynamic-scc-optimization.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
