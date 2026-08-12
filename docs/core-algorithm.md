# 核心算法思路

> 本文档描述量化计算器的核心计算原理。
>
> **当前状态**：新引擎已实现并作为主引擎使用，位于 `src/engine/` 目录。
> 基准版本（带调试日志）位于 `src/engine-v1/`，用于验证优化正确性。

---

## 1. 问题定义

**目标**：给定需求列表（如"每秒 2 个电路板"），计算所有物品的生产吞吐量。

**三大难点**：
1. **循环配方**：增产剂需要自身喷涂（自消耗），石墨烯/可燃冰/重整精炼存在环路
2. **多产物配方**：原油精炼同时产氢和精炼油，同物品可能有多种来源配方
3. **副产物配平**：多出的副产物需要合理消耗或标记为溢出

---

## 2. 整体架构：DAG + SCC + 矩阵求逆

| 阶段 | 方法 | 解决的问题 |
|------|------|-----------|
| 第一步 | BFS构建DAG | 从需求出发，构建物品依赖图 |
| 第二步 | Tarjan SCC | 识别强连通分量（循环组） |
| 第三步 | 系数表+矩阵求逆 | 按SCC顺序展开成本，循环组用矩阵求解 |

**核心思想**：用系数表符号化追踪成本，按拓扑顺序展开。单节点SCC直接代入，多节点SCC（循环组）构建矩阵求逆求解。

---

## 3. 新方案：SCC + DAG DP 架构

### 3.1 为什么需要新方案

旧方案（拓扑排序+LP）的局限：
- **关键物品法**只能断开循环，无法揭示循环内部结构、循环间依赖关系
- 多层循环处理困难，需要特判
- 难以加入增产优化（增产策略改变了物品的产出倍率，影响整个循环）

### 3.2 新方案架构

```
用户选择配方 + 燃料
        ↓
建立固定生产关系图
        ↓
Tarjan SCC 强连通分解
        ↓
DAG 区域 + SCC 循环区域
        ↓
DAG 动态规划（增产策略搜索）
        ↓
SCC 内部搜索优化
        ↓
最大瓶颈目标函数评价
        ↓
最优增产策略
```

### 3.3 SCC 替代拓扑排序

| 方面 | 旧方案 | 新方案 |
|------|--------|--------|
| 循环识别 | 贪心选 key_item 断点 | Tarjan SCC 找强连通分量 |
| 循环信息 | 丢失（断点后变成 DAG） | 保留（SCC 分组 + 内部结构） |
| 循环间关系 | 无法表达 | DAG 压缩后自然表达 |
| 增产优化 | 难以加入 | SCC 内部可独立优化 |

---

## 4. 核心类设计

### 4.1 CoreEngine 类

```javascript
class CoreEngine {
  static VERSION = 'current';
  
  constructor(gameData, schemeData, settings)
  initialize(needs, recipes)  // 构建图+SCC检测
  calculate(needs, recipes)   // 主计算函数
}
```

### 4.2 计算流程

```javascript
calculate(needs, recipes) {
  // 1. 初始化（图构建+SCC检测）
  this.initialize(needs, recipes);
  //    输出: this.graph, this.edges, this.sccs, this.proliferatorEdgeKeys

  // 2. 创建虚拟"解"物品
  const solutionNode = { directCost: {}, dependents: [] };
  for (const need of needs) {
    solutionNode.directCost[need.id] = need.count;
  }

  // 3. 计算所有物品的直接成本（系数表）
  for (const [itemId, node] of this.graph) {
    costs.set(itemId, node.directCost || { [`$${itemId}`]: 1 });
  }

  // 4. 按 SCC 逆拓扑序展开成本到 solution
  expandInSCCOrder(SOLUTION_ID, costs, this.graph, this.sccs, byproductMap, this.recipeMap);

  // 5. 提取结果（资源消耗、设备数量、电力、占地等）
  // ...
}
```

### 4.3 输出数据

```javascript
{
  resourceUsage,        // 资源消耗
  recipeExecutions,     // 配方执行次数
  surplusByproducts,    // 剩余副产物
  buildingDetails,      // 建筑详情 {设备数量, 执行次数, 单次执行设备数}
  buildingList,         // 建筑数量汇总
  selfConsumption,      // 自消耗系数
  byproductSources,     // 副产物来源
  energyCost,           // 生产设备耗电
  minerEnergyCost,      // 采集设备耗电
  totalEnergyCost,      // 总耗电
  footprintDetails,     // 占地详情（每物品）
  totalFootprint        // 总占地面积
}
```

---

## 5. DAG层级计算（dag.js）

### 5.1 物品节点结构

```javascript
class ItemNode {
  constructor(id, name, depth = 0) {
    this.id = id;
    this.name = name;
    this.depth = depth;
    this.recipeId = null;     // 主配方ID
    this.directCost = null;   // 直接成本系数表（BFS时计算）
    this.dependents = [];     // 依赖此物品的物品ID列表（用于代入展开）
    this.byproducts = [];     // 副产物列表
    this.buildingPower = null; // 设备数和耗电信息
  }
}
```

### 5.2 BFS构建过程

1. 初始化需求物品节点
2. BFS遍历，对每个物品：
   - 查找用户选择的主配方
   - 处理增产剂（添加到原料，计算产出倍率）
   - 计算设备数和耗电
   - 计算直接成本公式
   - 建立依赖边

### 5.3 直接成本公式

```javascript
// 格式: { "$itemId": 1, "input1": ratio, "byproduct": -ratio, ... }
const directCost = { [`$${itemId}`]: 1 };

for (const input of modifiedInputs) {
  if (input.id === itemId) continue;
  const ratio = (input.count || 1) / netProduction;
  directCost[input.id] = (directCost[input.id] || 0) + ratio;
}

for (const [outputId, count] of Object.entries(recipe.产物 || {})) {
  if (outputId !== itemId) {
    const ratio = ((count || 1) * outputMultiplier) / netProduction;
    directCost[outputId] = (directCost[outputId] || 0) - ratio;
  }
}
```

---

## 6. SCC检测（scc.js）

### 6.1 Tarjan算法

使用Tarjan算法识别强连通分量：

```javascript
function tarjanSCC(graph, edges) {
  // 构建邻接表
  const adj = new Map();
  for (const [node] of graph) adj.set(node, []);
  for (const { from, to } of edges) adj.get(from).push(to);
  
  // Tarjan算法
  let index = 0;
  const stack = [];
  const indices = new Map();
  const lowlinks = new Map();
  const onStack = new Set();
  const sccs = [];
  
  function strongconnect(v) { /* ... */ }
  
  for (const [v] of graph) {
    if (!indices.has(v)) strongconnect(v);
  }
  
  return sccs;
}
```

### 6.2 SCC输出顺序

Tarjan输出顺序：逆拓扑序（`sccGroups[0]`=最终产物/顶层，`sccGroups[last]`=原矿/底层）。

---

## 7. 单位成本计算（unit-cost.js）

### 7.1 系数表

成本表示：`{ "$item": 1, "input1": ratio, "byproduct": -ratio, ... }`

- `$` 前缀：配方执行次数
- 无前缀：物品总成本符号
- 负数：副产物（产出而非消耗）

### 7.2 展开顺序

按SCC逆拓扑序展开（从顶层/最终产物开始，正向遍历）。

### 7.3 矩阵求解（solveSCCByMatrix）

对循环组构建矩阵，求逆求解。支持配方变量法处理联产物线性相关问题。

---

## 8. 增产剂处理

### 8.1 增产剂等级

| 等级 | ID | 喷涂次数 | 增产效果 | 加速效果 | 耗电倍率 |
|------|-----|----------|----------|----------|----------|
| 0 | - | 1 | 1.0 | 1.0 | 1.0 |
| 1 | 1141 | 12 | 1.125 | 1.25 | 1.3 |
| 2 | 1142 | 24 | 1.2 | 1.5 | 1.7 |
| 3 | 1143 | 60 | 1.25 | 2.0 | 2.5 |

### 8.2 增产模式

| 模式 | 代码 | 效果 |
|------|------|------|
| 无 | 0 | 不使用增产剂 |
| 加速 | 1 | 产出倍率 × 加速效果 |
| 增产 | 2 | 产出倍率 × 增产效果 |
| 透镜 | 3 | 产出倍率 × 加速效果（仅特定配方） |

---

## 9. 占地计算

### 9.1 计算流程

在 `calculate()` 函数中，步骤8计算占地面积：

```javascript
// 8. 计算占地
for (const [itemId, detail] of Object.entries(buildingDetails)) {
  const n = Math.ceil(detail.设备数量);  // 进一法取整
  const l = Object.keys(recipe.原料).length + Object.keys(recipe.产物).length;  // 种类数之和
  
  // 根据建筑类型选择公式
  if (factoryName.includes('制造台')) {
    area = (4 * n - 1) * (3 + l / 2);
  } else if (factoryName.includes('研究站')) {
    const researchStations = Math.ceil(n / stackM);
    if (recipeId === 73) {  // 宇宙矩阵
      area = 12 * (5.5 * researchStations);
    } else {
      area = 5 * researchStations * (5 + l / 2);
    }
  }
  // ... 其他建筑类型
}
```

### 9.2 参数说明

- `n` = ceil(设备数量)，进一法取整
- `l` = 原料种类数 + 产物种类数（不需要GCD简化）
- `m` = 研究站堆叠数（默认15）
- 宇宙矩阵使用配方索引号73识别

---

## 10. 增产策略优化：一阶段优化算法

### 10.1 核心矛盾

DAG层级有两层功能：
1. **遍历顺序**：按DAG顺序（低→高）遍历增产选择，可实现完美剪枝
2. **计算顺序**：给单次计算成本提供迭代顺序

但增产剂本身是物品，有自己的生产链。选择增产剂 = 添加新的原料依赖，会改变DAG层级。

### 10.2 一阶段优化算法

优化算法采用一阶段策略，在最高等级配置下按 SCC 顺序一次性完成所有物品的优化：

1. **初始化** - 强制所有物品使用最高等级增产剂
2. **SCC 分析** - 在最高等级配置下分析 SCC 结构
3. **按 SCC 顺序优化** - 单节点逐个优化，循环组坐标下降

### 10.3 多目标策略支持

| 策略 | 标识 | 目标函数 | 说明 |
|------|------|---------|------|
| 最小电力 | `min_power` | totalEnergyCost | 最小化总耗电（默认） |
| 最小原矿 | `min_raw_ore` | totalRawOre | 最小化原矿消耗总量 |
| 最小占地 | `min_footprint` | totalFootprint | 最小化总占地面积 |

---

## 11. 最终关键决策表

| 问题 | 最终决定 |
|------|---------|
| 生产路线选择 | 用户手动 |
| 配方选择 | 用户手动 |
| 燃料选择 | 用户手动 |
| 优化变量 | 增产剂等级 + 模式 |
| 循环处理 | SCC |
| 非循环区域 | DAG动态规划 |
| 循环区域 | SCC内部搜索 |
| 目标函数 | 最小电力 / 最小原矿 / 最小占地 |
| 资源模型 | 多维资源统一向量 |
| 电力处理 | 作为资源消耗 |
| LP | 局部副产物平衡 |
| 关键物品法 | 不作为核心 |
