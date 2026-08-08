# 动态 SCC 增产策略优化设计

> 本文档描述将固定的 SCC 遍历顺序改为动态 SCC 遍历的设计方案。

---

## 1. 背景与问题

### 1.1 当前实现

当前 `autoOptimize` 函数在开始时计算一次 SCC 顺序，然后按这个固定顺序遍历所有物品。

```javascript
// 当前实现（简化）
function autoOptimize() {
    // 1. 计算一次 SCC 顺序
    const sccOrder = computeSCCOrder(graph, edges)
    
    // 2. 按固定顺序遍历
    for (const item of sccOrder) {
        optimizeSingleItem(item, ...)
    }
}
```

### 1.2 核心问题

**增产剂本身是物品，有自己的生产链。选择增产剂 = 添加新的原料依赖。**

- 当物品选择高级增产剂时，会添加新的依赖边（增产剂成为原料）
- 这会改变图结构，进而改变 SCC 结果
- 固定的 SCC 顺序无法保证"原料先优化，产物后优化"的条件

### 1.3 核心矛盾

物品使用增产剂这一行为，会改变 SCC 结果。那么就无法保证满足最佳剪枝条件。

**解决方案**：不能在优化过程中使用固定的原本计算的 SCC 顺序，而应该是动态的。

---

## 2. 设计目标

### 2.1 核心目标

1. **动态 SCC**：每次尝试增产选择时重新计算 SCC
2. **递归处理**：发现前置物品未确定时，递归去计算
3. **循环组整体遍历**：把循环组当作一个单元，遍历所有组合
4. **完整遍历**：保证全局最优
5. **循环组稳定后才持久化**：只有当循环组成员不再变化时才持久化
6. **循环组持久化与成员组合相关**：key 是成员组合，只有完全相同才能复用

### 2.2 约束条件

- 复用现有的 `resolvedStrategies` 结构
- 复用现有的完整成本计算逻辑
- 不引入 DAG 层级概念（后续优化方向）

---

## 3. 整体架构

### 3.1 核心数据结构

```javascript
// 1. 持久化策略存储（复用现有结构）
// key: 单物品为物品ID，循环组为成员组合的排序后JSON字符串
// value: {strategy: {level, mode}, cost: number}
resolvedStrategies = new Map()

// 2. 循环组成员组合的key生成
function getGroupKey(groupMembers) {
    // groupMembers: Set<string> 或 Array<string>
    // 返回排序后的JSON字符串，如 '["MK1","MK2","金刚石"]'
    return JSON.stringify([...groupMembers].sort())
}
```

### 3.2 主要函数结构

```javascript
// 主入口
function autoOptimize(recipeNodes, graph, edges, settings, gameData) {
    resolved = new Map()
    sccOrder = computeSCC(graph, edges)
    
    for (item of sccOrder) {
        optimizeItem(item, graph, edges, settings, gameData, resolved)
    }
    
    return resolved
}

// 单物品优化入口
function optimizeItem(item, graph, edges, gameData, settings, needs, resolved, depth = 0) {
    // 1. 检查是否已确定
    if (item in resolved) return
    
    // 2. 计算当前 SCC 顺序
    sccOrder = computeSCC(graph, edges)
    
    // 3. 找到当前物品在 SCC 中的位置
    itemIndex = findIndex(sccOrder, item)
    
    // 4. 检查前置物品是否都已确定
    for (i = 0 to itemIndex - 1) {
        if (sccOrder[i] not in resolved) {
            optimizeItem(sccOrder[i], graph, edges, gameData, settings, needs, resolved, depth + 1)
        }
    }
    
    // 5. 检测是否属于循环组
    cycleGroup = findCycleGroup(item, sccOrder, graph, edges)
    
    if (cycleGroup.size > 1) {
        optimizeCycleGroup(cycleGroup, graph, edges, gameData, settings, needs, resolved)
    } else {
        optimizeSingleItem(item, graph, edges, gameData, settings, needs, resolved)
    }
}
```

---

## 4. 循环组检测与遍历

### 4.1 循环组检测函数

```javascript
/**
 * 检测物品所属的循环组
 * @param {string} item - 物品ID
 * @param {Array<string>} sccOrder - SCC顺序
 * @param {Map} graph - 物品图
 * @param {Array} edges - 边集合
 * @returns {Set<string>} 循环组成员集合（如果不在循环组中，返回只包含自己的Set）
 */
function findCycleGroup(item, sccOrder, graph, edges) {
    // 使用 Tarjan 算法计算 SCC
    const sccList = tarjanSCC(graph, edges)
    
    // 找到包含 item 的 SCC
    for (const scc of sccList) {
        if (scc.has(item)) {
            return scc
        }
    }
    
    // 不在任何 SCC 中，返回只包含自己的Set
    return new Set([item])
}
```

### 4.2 循环组整体遍历函数

```javascript
/**
 * 循环组整体遍历
 * @param {Set<string>} group - 循环组成员
 * @param {Map} graph - 物品图
 * @param {Array} edges - 边集合
 * @param {Object} settings - 设置
 * @param {Object} gameData - 游戏数据
 * @param {Map} resolved - 持久化策略存储
 */
function optimizeCycleGroup(group, graph, edges, gameData, settings, needs, resolved) {
    // 1. 生成循环组key
    const groupKey = getGroupKey(group)
    
    // 2. 检查是否已有持久化策略
    if (groupKey in resolved) {
        return resolved[groupKey]
    }
    
    // 3. 检查循环组外部依赖是否都已确定
    for (const item of group) {
        for (const dep of getDependencies(item, graph)) {
            if (dep not in group && dep not in resolved) {
                // 递归处理外部依赖
                optimizeItem(dep, graph, edges, gameData, settings, needs, resolved)
            }
        }
    }
    
    // 4. 遍历所有组合
    const groupArray = [...group]
    const combinations = generateCombinations(groupArray, PROLIFERATOR_CHOICES)
    
    let bestCombination = null
    let bestCost = Infinity
    
    for (const combination of combinations) {
        // 计算当前组合的总成本
        const cost = calculateCombinationCost(combination, groupArray, gameData, settings, needs)
        
        if (cost < bestCost) {
            bestCost = cost
            bestCombination = combination
        }
    }
    
    // 5. 持久化循环组策略
    for (let i = 0; i < groupArray.length; i++) {
        const item = groupArray[i]
        const strategy = bestCombination[i]
        resolved[item] = {strategy, cost: bestCost}
    }
    
    // 6. 同时持久化循环组整体策略（用于后续复用）
    resolved[groupKey] = {strategies: bestCombination, cost: bestCost, members: groupArray}
}
```

### 4.3 组合生成函数

```javascript
/**
 * 生成所有组合
 * @param {Array<string>} items - 物品列表
 * @param {Array} choices - 增产选择列表
 * @returns {Array<Array>} 所有组合
 */
function generateCombinations(items, choices) {
    if (items.length === 0) {
        return [[]]
    }
    
    const [first, ...rest] = items
    const restCombinations = generateCombinations(rest, choices)
    
    const result = []
    for (const choice of choices) {
        for (const restComb of restCombinations) {
            result.push([choice, ...restComb])
        }
    }
    
    return result
}
```

---

## 5. 成本计算与单物品优化

### 5.1 复用现有成本计算

```javascript
/**
 * 计算组合成本（复用现有完整计算）
 * @param {Array} combination - 组合，每个元素是 {level, mode, name}
 * @param {Array<string>} items - 循环组成员列表
 * @param {Object} gameData - 游戏数据
 * @param {Object} settings - 设置
 * @param {Array} needs - 需求列表
 * @returns {number} 总耗电（所有物品的总成本）
 */
function calculateCombinationCost(combination, items, gameData, settings, needs) {
    // 1. 创建临时的 schemeData，设置循环组内每个物品的增产策略
    const tempSchemeData = deepCopy(gameData.schemeData)
    
    for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const choice = combination[i]
        const node = gameData.graph.get(item)
        
        if (node && node.recipeId != null) {
            tempSchemeData.scheme_for_recipe[node.recipeId] = {
                '增产模式': choice.mode,
                '增产剂等级': choice.level
            }
        }
    }
    
    // 2. 调用现有的完整计算
    const result = CoreEngine.compute(needs, gameData, settings, tempSchemeData)
    
    // 3. 返回总耗电
    return result.factoryPower + result.minerPower
}
```

### 5.2 单物品优化函数

```javascript
/**
 * 单物品优化
 * @param {string} item - 物品ID
 * @param {Map} graph - 物品图
 * @param {Array} edges - 边集合
 * @param {Object} settings - 设置
 * @param {Object} gameData - 游戏数据
 * @param {Map} resolved - 持久化策略存储
 */
function optimizeSingleItem(item, graph, edges, gameData, settings, needs, resolved) {
    // 1. 检查是否已确定
    if (item in resolved) {
        return resolved[item]
    }
    
    // 2. 获取物品节点
    const node = graph.get(item)
    if (!node || !node.recipeId) {
        resolved[item] = {strategy: PROLIFERATOR_CHOICES[0], cost: 0}
        return
    }
    
    // 3. 遍历所有增产选择
    let bestChoice = PROLIFERATOR_CHOICES[0]
    let bestCost = Infinity
    
    for (const choice of PROLIFERATOR_CHOICES) {
        // 3.1 创建临时的 schemeData
        const tempSchemeData = deepCopy(schemeData)
        tempSchemeData.scheme_for_recipe[node.recipeId] = {
            '增产模式': choice.mode,
            '增产剂等级': choice.level
        }
        
        // 3.2 计算成本
        const cost = calculateItemCost(item, tempSchemeData, graph, edges, gameData, settings, needs, resolved)
        
        // 3.3 更新最优选择
        if (cost < bestCost) {
            bestCost = cost
            bestChoice = choice
        }
    }
    
    // 4. 持久化
    resolved[item] = {strategy: bestChoice, cost: bestCost}
}
```

---

## 6. 与现有代码的集成

### 6.1 主入口函数改造

```javascript
/**
 * 增产策略自动优化主入口（改造后）
 * @param {Array} needs - 需求列表
 * @param {Object} gameData - 游戏数据
 * @param {Object} settings - 设置
 * @returns {Map} 持久化策略存储
 */
export function autoOptimize(needs, gameData, settings = {}) {
    const start = performance.now()
    
    // 1. 获取完整的游戏数据和方案数据
    const schemeData = gameData.schemeData
    const recipes = gameData.recipe_data
    const proliferatorData = gameData.proliferator_data
    const proliferatorEffect = gameData.proliferator_effect
    
    // 2. 计算增产剂喷涂成本
    const maxLevel = proliferatorData.length - 1
    const sprayCosts = [null]
    for (let i = 1; i <= maxLevel; i++) {
        const proItem = proliferatorData[i]?.增产剂
        if (proItem) {
            const cost = CoreEngine.computeUnitCost(proItem, recipes, schemeData, gameData, settings, new Map())
            sprayCosts.push(cost)
        } else {
            sprayCosts.push([null, 1/12, 1/24, 1/60][i])
        }
    }
    
    // 3. 构建物品图
    const {graph, edges} = buildItemGraph(needs, recipes, gameData, schemeData, settings, sprayCosts)
    
    // 4. 计算初始 SCC 顺序
    const sccOrder = computeSCCOrder(graph, edges)
    
    // 5. 持久化策略存储
    const resolved = new Map()
    
    // 6. 按 SCC 顺序优化
    for (const item of sccOrder) {
        optimizeItem(item, graph, edges, gameData, settings, needs, resolved, 0)
    }
    
    const elapsed = performance.now() - start
    console.log(`[自动优化] 完成，耗时 ${elapsed.toFixed(1)}ms，共同步了 ${resolved.size} 条配方`)
    
    return resolved
}
```

---

## 7. 优化策略选择应用逻辑

### 7.1 策略应用函数

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
    const newSchemeData = deepCopy(schemeData)
    
    // 2. 遍历所有已确定的策略
    for (const [item, strategyInfo] of resolved) {
        // 跳过循环组整体策略（key 是 JSON 字符串）
        if (item.startsWith('[')) continue
        
        // 3. 获取物品节点
        const node = graph.get(item)
        if (!node || !node.recipeId) continue
        
        // 4. 应用策略
        const {strategy} = strategyInfo
        newSchemeData.scheme_for_recipe[node.recipeId] = {
            '增产模式': strategy.mode,
            '增产剂等级': strategy.level
        }
    }
    
    return newSchemeData
}
```

### 7.2 UI 集成点

```javascript
// 在 React 组件中使用
function handleAutoOptimize() {
    // 1. 调用自动优化
    const resolved = autoOptimize(needs, gameData, settings)
    
    // 2. 应用优化策略
    const newSchemeData = applyOptimizedStrategies(resolved, gameData.schemeData, gameData.graph)
    
    // 3. 更新状态
    updateSchemeData(newSchemeData)
    
    // 4. 重新计算结果
    recalculate()
}
```

---

## 8. 错误处理和边界情况

### 8.1 错误处理策略

```javascript
// 1. 循环检测失败
function optimizeItem(item, graph, edges, gameData, settings, needs, resolved, depth = 0) {
    // 设置最大递归深度限制（防止无限递归）
    const MAX_DEPTH = 100
    if (depth > MAX_DEPTH) {
        console.error(`[自动优化] 递归深度超限: ${item}，可能存在无限循环`)
        // 使用默认策略（无增产）
        resolved[item] = {strategy: PROLIFERATOR_CHOICES[0], cost: Infinity}
        return
    }
    
    // ... 其他逻辑
}

// 2. 依赖缺失处理
function getDependencies(item, graph) {
    const node = graph.get(item)
    if (!node || !node.directCost) return []
    
    const deps = []
    for (const [key, coeff] of Object.entries(node.directCost)) {
        if (key.startsWith('$')) continue
        if (coeff <= 0) continue
        
        // 检查依赖是否存在
        if (!graph.has(key)) {
            console.warn(`[自动优化] 依赖缺失: ${item} -> ${key}，跳过该依赖`)
            continue
        }
        
        deps.push(key)
    }
    
    return deps
}

// 3. 计算超时处理
function autoOptimize(needs, gameData, settings = {}) {
    const TIMEOUT = 30000 // 30秒超时
    const start = performance.now()
    
    // ... 优化逻辑 ...
    
    const elapsed = performance.now() - start
    if (elapsed > TIMEOUT) {
        console.warn(`[自动优化] 计算超时 (${elapsed.toFixed(1)}ms)，返回当前结果`)
    }
    
    return resolved
}
```

### 8.2 边界情况处理

```javascript
// 1. 空需求
function autoOptimize(needs, gameData, settings = {}) {
    if (!needs || needs.length === 0) {
        console.log('[自动优化] 需求为空，跳过优化')
        return new Map()
    }
    
    // ... 其他逻辑
}

// 2. 无增产剂数据
function autoOptimize(needs, gameData, settings = {}) {
    const proliferatorData = gameData.proliferator_data
    if (!proliferatorData || proliferatorData.length === 0) {
        console.log('[自动优化] 无增产剂数据，跳过优化')
        return new Map()
    }
    
    // ... 其他逻辑
}

// 3. 循环组只有一个成员
function findCycleGroup(item, sccOrder, graph, edges) {
    const sccList = tarjanSCC(graph, edges)
    
    for (const scc of sccList) {
        if (scc.has(item)) {
            // 如果 SCC 只有一个成员，说明不在循环组中
            if (scc.size === 1) {
                return new Set([item])
            }
            return scc
        }
    }
    
    return new Set([item])
}
```

### 8.3 日志和调试

```javascript
// 添加详细日志
const DEBUG = true

function optimizeItem(item, graph, edges, gameData, settings, needs, resolved, depth = 0) {
    if (DEBUG) {
        console.log(`[自动优化] 处理物品: ${item} (深度: ${depth})`)
    }
    
    // ... 其他逻辑
    
    if (DEBUG) {
        console.log(`[自动优化] ${item} 最优策略: ${resolved[item]?.strategy?.name}`)
    }
}

function optimizeCycleGroup(group, graph, edges, gameData, settings, needs, resolved) {
    if (DEBUG) {
        console.log(`[自动优化] 处理循环组: [${[...group].join(', ')}]`)
    }
    
    // ... 其他逻辑
    
    if (DEBUG) {
        console.log(`[自动优化] 循环组最优策略: ${JSON.stringify(bestCombination.map(c => c.name))}`)
    }
}
```

---

## 9. 性能优化和后续改进方向

### 9.1 当前方案的性能特点

**时间复杂度**：
- 单物品优化：O(7) = O(1)
- 循环组优化：O(7^n)，n 为循环组成员数
- 最坏情况：所有物品形成一个大循环组，复杂度为 O(7^N)

**空间复杂度**：
- 持久化存储：O(N + 2^N)，N 为物品数，2^N 为循环组组合数

### 9.2 后续优化方向

#### 1. 缓存优化

```javascript
// 缓存已计算的组合成本
const combinationCache = new Map()

function calculateCombinationCost(combination, items, gameData, settings, needs) {
    const cacheKey = JSON.stringify(combination)
    
    if (combinationCache.has(cacheKey)) {
        return combinationCache.get(cacheKey)
    }
    
    const cost = computeCombinationCost(combination, items, gameData, settings, needs)
    combinationCache.set(cacheKey, cost)
    
    return cost
}
```

#### 2. 并行计算

```javascript
// 使用 Web Worker 并行计算组合成本
async function calculateCombinationsParallel(combinations, items, gameData, settings, needs) {
    const workerPool = new WorkerPool(navigator.hardwareConcurrency)
    
    const results = await Promise.all(
        combinations.map(combination => 
            workerPool.run('calculateCombinationCost', {combination, items, gameData, settings, needs})
        )
    )
    
    return results
}
```

#### 3. 增量更新

```javascript
// 当只有少数物品的增产策略变化时，只重新计算受影响的循环组
function incrementalUpdate(changedItems, resolved, graph, edges, gameData, settings, needs) {
    // 1. 找到受影响的循环组
    const affectedGroups = findAffectedGroups(changedItems, resolved, graph, edges)
    
    // 2. 只重新计算受影响的循环组
    for (const group of affectedGroups) {
        // 清除旧策略
        for (const item of group) {
            resolved.delete(item)
        }
        resolved.delete(getGroupKey(group))
        
        // 重新优化
        optimizeCycleGroup(group, graph, edges, gameData, settings, needs, resolved)
    }
}
```

---

## 10. 与现有代码的关系

### 10.1 需要修改的文件

1. `src/engine/proliferator-optimizer.js` - 主要修改文件
2. `src/engine/dag.js` - 可能需要导出 `tarjanSCC` 函数
3. `src/engine/graph-utils.js` - 可能需要导出 SCC 相关函数

### 10.2 需要复用的现有逻辑

1. `buildItemGraph` - 构建物品图
2. `computeSCCOrder` - 计算 SCC 顺序
3. `CoreEngine.compute` - 完整成本计算
4. `CoreEngine.computeUnitCost` - 单物品成本计算

### 10.3 需要新增的函数

1. `findCycleGroup` - 循环组检测
2. `optimizeCycleGroup` - 循环组整体遍历
3. `generateCombinations` - 组合生成
4. `calculateCombinationCost` - 组合成本计算
5. `applyOptimizedStrategies` - 策略应用

---

## 11. 测试策略

### 11.1 单元测试

1. 测试 `findCycleGroup` 函数
2. 测试 `generateCombinations` 函数
3. 测试 `getGroupKey` 函数

### 11.2 集成测试

1. 测试单物品优化
2. 测试循环组优化
3. 测试递归处理
4. 测试持久化逻辑

### 11.3 性能测试

1. 测试小规模循环组（3-5 个物品）
2. 测试中规模循环组（10-20 个物品）
3. 测试大规模循环组（50+ 个物品）

---

## 12. 总结

本设计方案通过引入动态 SCC 遍历，解决了增产剂改变依赖关系导致的 SCC 结果变化问题。主要创新点：

1. **动态 SCC**：每次尝试增产选择时重新计算 SCC
2. **递归处理**：发现前置物品未确定时，递归去计算
3. **循环组整体遍历**：把循环组当作一个单元，遍历所有组合
4. **精细持久化**：循环组持久化与成员组合相关，支持复用

该方案保证了全局最优，同时通过缓存、并行计算、增量更新等后续优化方向，为性能提升提供了空间。
