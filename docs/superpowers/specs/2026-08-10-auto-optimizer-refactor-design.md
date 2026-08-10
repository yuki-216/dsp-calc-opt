# 自动优化器重构设计

## 概述

重构增产策略自动优化器，将现有的递归SCC分析改为两阶段优化：先处理循环组，再处理单物品。

## 问题分析

### 当前实现的问题

1. **递归SCC分析效率低**：每次尝试增产选择时都重新计算SCC，导致大量重复计算
2. **逻辑不清晰**：递归处理依赖关系，难以理解和维护
3. **精度与速度的矛盾**：既没有保证精确（因为SCC可能变化），又失去了速度

### 核心观察

- 循环组（SCC大小>1）的数量通常很少（预期只有一个）
- 循环组的坐标下降算法效率很高
- 循环组的策略会影响SCC结构

## 设计方案

### 核心思路

**两阶段优化**：
1. **第一阶段：循环组优化** - 在最复杂配置下找出循环组，用坐标下降遍历最优策略
2. **第二阶段：单物品优化** - 基于第一阶段结果，按SCC正序逐个优化

### 算法流程

```
optimizeProliferatorStrategy(gameData, schemeData, settings, needs):

  1. 初始化
     - 构建物品→配方映射（处理电力特殊逻辑）
     - 计算初始耗电

  2. 第一阶段：循环组优化
     - 配置：所有物品 = 最高等级 + 第一个可选模式
     - SCC分析 → 找出循环组
     - 如果循环组存在：
       - 坐标下降优化循环组
       - 持久化最优策略
     - 输出：循环组最优策略

  3. 第二阶段：单物品优化
     - 重新SCC分析
     - 按SCC正序遍历所有物品
     - 跳过已持久化的物品（循环组成员）
     - 对每个未持久化物品：
       - 尝试所有增产选择
       - 选耗电最小的策略
       - 持久化
     - 输出：所有物品的最优策略

  4. 返回结果
     - 最优方案
     - 耗电变化
     - 策略变更列表
```

### 关键函数设计

```javascript
// 主函数
export async function optimizeProliferatorStrategy(
  gameData, schemeData, settings, needs,
  onProgress = null, onLog = null
)

// 第一阶段：循环组优化
async function optimizeCycleGroupPhase(
  gameData, schemeData, settings, needs, onLog
)
// 返回 { strategies, updatedScheme }

// 第二阶段：单物品优化
async function optimizeSingleItemsPhase(
  gameData, schemeData, settings, needs,
  resolved, sccOrder, onProgress, onLog
)

// 坐标下降算法
async function coordinateDescent(
  items, gameData, settings, needs,
  baseSchemeData, onLog
)

// 计算耗电
function calculatePower(gameData, schemeData, settings, needs)
```

### 数据结构

```javascript
// 持久化策略存储
resolved = Map<itemId, {
  strategy: { level, mode, name },
  cost: number
}>

// SCC顺序
sccOrder = Array<itemId>  // 正序：原矿→产物
```

### 日志设计

简化日志，只保留关键信息：

```
初始耗电: 1.23 GW
第一阶段: 循环组 [石墨烯, 金刚石] 优化完成, 耗电降至 1.15 GW
第二阶段: [1/10] 铁板 → Mk.II增产 (1.12 GW)
         [2/10] 铜板 → Mk.III加速 (1.08 GW)
         ...
最终耗电: 0.98 GW, 减少 20.3%
```

### 边界情况处理

1. **无循环组**：跳过第一阶段，直接进入第二阶段
2. **循环组优化失败**：使用默认策略（不使用增产剂）
3. **物品无增产选择**：跳过优化，使用默认策略
4. **电力配方**：特殊处理，映射到用户选择的燃料配方

### 扩展性设计

为未来算法预留接口：

```javascript
// 策略枚举器接口（未来可替换为其他算法）
function* enumerateStrategies(items, settings) {
  // 当前：坐标下降
  // 未来：可替换为多起点、模拟退火等
}

// 优化器接口（未来可替换为目标函数）
function evaluateStrategy(strategy, gameData, settings, needs) {
  // 当前：计算总耗电
  // 未来：可添加其他目标
}
```

## 实现计划

### 第一步：重构主函数

- 重写 `optimizeProliferatorStrategy` 主函数
- 实现两阶段调用逻辑
- 保持相同的接口和回调

### 第二步：实现第一阶段

- 实现 `optimizeCycleGroupPhase` 函数
- 配置最高等级增产剂
- SCC分析找出循环组
- 坐标下降优化循环组

### 第三步：实现第二阶段

- 实现 `optimizeSingleItemsPhase` 函数
- 重新SCC分析
- 按SCC正序逐个优化
- 去掉递归逻辑

### 第四步：清理和测试

- 删除旧的递归逻辑
- 测试各种场景
- 验证结果正确性

## 预期效果

1. **逻辑清晰**：两阶段分离，易于理解和维护
2. **效率提升**：只进行两次SCC分析，而不是每次尝试都分析
3. **精确性**：循环组用坐标下降遍历，覆盖所有可能
4. **可扩展**：为未来算法预留接口
