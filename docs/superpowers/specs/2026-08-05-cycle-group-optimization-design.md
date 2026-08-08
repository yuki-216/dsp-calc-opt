# 循环组增产优化算法设计

## 背景

当前循环组优化使用暴力枚举所有组合，复杂度为 O(choices^items)。当循环组包含10个物品、每个物品4种增产选择时，需要计算 4^10 = 1,048,576 次，每次都要创建 CoreEngine 运行完整计算，导致性能问题。

## 目标

在合理时间内（30秒内）找到循环组的近似最优增产策略。

## 相关设置

### 可选增产剂等级

新增设置 `proliferate_allowed_levels`，用于控制自动优化时可尝试的增产剂等级：

- **类型**：数组，如 `[1, 2, 3]`
- **默认值**：`[1, 2, 3]`（允许所有等级）
- **作用**：`getAvailableChoices` 函数会根据此设置过滤增产选择
- **UI**：三个增产剂图标按钮，绿色表示已选中，灰色表示未选中，可单独切换

### 限制加速模式

设置 `proliferate_no_accelerate`，用于限制只能选择增产模式（不能选择加速）：

- **类型**：布尔值
- **默认值**：`false`
- **作用**：当为 `true` 时，`getAvailableChoices` 会过滤掉加速模式选项

## 方案 A：坐标下降（当前实现）

### 原理

每次固定其他物品的选择，只优化一个物品，反复迭代直到收敛。

### 算法

```
function optimizeCycleGroup(group, gameData, settings, needs, baseSchemeData, resolved, depth, onLog):
  // 1. 初始化：所有物品选择"无"
  currentChoices = group.map(item => { level: 0, mode: 0, name: '无' })
  currentCost = calculatePower(currentChoices)
  
  // 2. 迭代优化
  improved = true
  round = 0
  while improved:
    improved = false
    round++
    improvedCount = 0
    
    for each item in group:
      bestChoice = currentChoices[item]
      bestCost = currentCost
      
      for each choice in getAvailableChoices(item):
        if choice == currentChoices[item]: continue
        tempChoices = currentChoices.copy()
        tempChoices[item] = choice
        cost = calculatePower(tempChoices)
        if cost < bestCost:
          bestCost = cost
          bestChoice = choice
      
      if bestChoice != currentChoices[item]:
        currentChoices[item] = bestChoice
        currentCost = bestCost
        improved = true
        improvedCount++
    
    onLog(`坐标下降: 第${round}轮，改善${improvedCount}个物品`)
  
  // 3. 持久化结果
  persist(currentChoices, currentCost)
```

### 复杂度

- O(items × choices × passes)
- 典型情况：10物品 × 4选择 × 3轮 = 120次计算
- 相比暴力枚举：120 vs 1,048,576（减少 99.99%）

### 收敛性

- 每次改善严格降低耗电
- 选择数有限，必然在有限步内收敛
- 典型 2-3 轮收敛

### 日志格式

```
循环组: [增产剂Mk.I, 高能石墨, ...] (10个物品)
坐标下降: 第1轮，改善3个物品
  增产剂Mk.I: 无 → MK2增产 (13.55 kW → 12.34 kW)
  高能石墨: 无 → MK1增产 (12.34 kW → 11.89 kW)
  ...
坐标下降: 第2轮，改善1个物品
  ...
坐标下降: 第3轮，无改善，收敛
最优: [增产剂Mk.I:MK2增产, 高能石墨:MK1增产, ...]，耗电: 11.89 kW
```

---

## 升级方案 C：多起点贪心 + 坐标下降（备用）

### 触发条件

如果方案 A 的结果不满足以下条件之一，考虑升级：
1. 结果明显不合理（如所有物品都是"无"）
2. 用户反馈结果不够优化
3. 需要更高质量的解

### 原理

多次运行坐标下降，每次从不同随机起点开始，取最优结果。

### 算法

```
function optimizeCycleGroupRandom(group, ..., restarts=10):
  bestSolution = null
  bestCost = Infinity
  
  for i in 1..restarts:
    // 随机初始化
    currentChoices = group.map(item => randomChoice(getAvailableChoices(item)))
    currentCost = calculatePower(currentChoices)
    
    // 坐标下降
    solution = coordinateDescent(currentChoices, currentCost)
    
    if solution.cost < bestCost:
      bestSolution = solution
      bestCost = solution.cost
  
  return bestSolution
```

### 复杂度

- O(N × items × choices × passes)
- 典型情况：10次重启 × 120次/轮 = 1,200次计算
- 仍然远小于暴力枚举

### 优势

- 多次随机起点能跳出局部最优
- 时间可控（调整 N）
- 实现简单（复用方案 A 的坐标下降）

---

## 实施计划

### 第一阶段：实现方案 A ✅ 已完成

1. ✅ 修改 `optimizeCycleGroup` 函数
2. ✅ 实现坐标下降逻辑
3. ✅ 添加详细日志输出
4. ✅ 测试验证

### 第二阶段：评估效果

1. 对比暴力枚举的结果（小规模测试）
2. 检查收敛速度和结果质量
3. 收集用户反馈

### 第三阶段：升级到方案 C（如需要）

1. 实现随机重启逻辑
2. 调整重启次数参数
3. 添加进度显示

---

## UI 改进

### 增产剂等级选择

- 三个图标按钮（MK1、MK2、MK3）
- 绿色背景表示已选中，灰色表示未选中
- 可单独切换，至少保留一个等级
- 设置保存到 `proliferate_allowed_levels`

### 批量预设样式

- 使用圆角图标样式
- "无"选项显示为文本，居中对齐
- 间距统一为 2px

### 输出表样式

- 增产剂等级选择：圆角图标样式
- 建筑选择：圆角图标样式，移除文字展开行为

---

## 参考

- 当前实现：`src/engine/proliferator-optimizer.js` - `optimizeCycleGroup` 函数
- 核心计算：`calculatePower` 函数（创建 CoreEngine 运行完整计算）
- 增产选择：`getAvailableChoices` 函数（返回物品的可用增产选项）
- UI 组件：`src/recipe.jsx` - `HorizontalMultiButtonSelect` 组件（支持 `rounded` 属性）
- 设置管理：`src/contexts.jsx` - `DEFAULT_SETTINGS`（包含 `proliferate_allowed_levels`）
