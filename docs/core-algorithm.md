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

### 3.4 为什么放弃传统递归

传统量化计算：递归展开生产链（目标物品 → 原料 → 继续递归 → 直到矿物）。

普通生产链没有问题，但循环（如 金刚石→石墨→MK2→金刚石）无法自然结束。

传统解决方案：特判循环、等比数列、多轮迭代逼近。缺点：
1. 逻辑复杂
2. 容易遗漏特殊情况
3. 难以加入增产优化
4. 多层循环处理困难

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

  // 5. 提取结果
  // ...
}
```

### 4.3 输出数据

核心计算通过 `EngineGraphDataContext` 传递给依赖图模块：
- `edges` - BFS 构建的边 `[{from: 产物, to: 原料}]`
- `sccs` - SCC 分组（逆拓扑序）
- `graph` - 物品图 `Map<itemId, ItemNode>`
- `proliferatorEdgeKeys` - 增产剂边标记 `Set<string>`

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

注意：`graph-utils.js` 中的 `tarjanSCC` 已改为输出逆拓扑序，核心计算展开时正向遍历即可。

---

## 7. 单位成本计算（unit-cost.js）

### 7.1 系数表

成本表示：`{ "$item": 1, "input1": ratio, "byproduct": -ratio, ... }`

- `$` 前缀：配方执行次数
- 无前缀：物品总成本符号
- 负数：副产物（产出而非消耗）

### 7.2 展开顺序

按SCC逆拓扑序展开（从顶层/最终产物开始，正向遍历）：

```javascript
function expandInSCCOrder(solutionId, costs, graph, sccs, byproductMap, recipeMap) {
  for (let i = 0; i < sccs.length; i++) {
    const scc = sccs[i];

    if (scc.size === 1) {
      // 单节点 SCC：直接代入
      const itemId = scc.values().next().value;
      substituteDeferred(solutionCost, solutionId, itemId, itemCost, ...);
    } else {
      // 多节点 SCC（循环组）：矩阵求逆（支持配方变量法）
      solveSCCByMatrix(scc, costs, graph, recipeMap);
      for (const itemId of scc) {
        substituteDeferred(solutionCost, solutionId, itemId, itemCost, ...);
      }
    }
  }
}
```

### 7.3 代入函数（substituteDeferred）

```javascript
function substituteDeferred(target, targetItemId, key, source, costs, byproductMap, deferredItems) {
  const coeff = target[key];
  delete target[key];
  
  // 阶段1：代入加和
  for (const [k, v] of Object.entries(source)) {
    target[k] = (target[k] || 0) + coeff * v;
  }
  
  // 阶段2：逆生产检测
  // 检查副产物是否可以抵消
  
  // 阶段3：执行逆生产
  // 使用代入加和抵消成本
}
```

### 7.4 矩阵求解（solveSCCByMatrix）

对循环组构建矩阵，求逆求解：

```javascript
function solveSCCByMatrix(scc, costs, graph, recipeMap) {
  const sccArray = [...scc];
  
  // ====== 配方变量法：检测并合并同配方产物 ======
  // 当同一配方的多个产物（如精炼油和氢气）同时出现在 SCC 中时，
  // 它们的成本方程线性相关（a₂·b₂=1），导致矩阵奇异。
  // 解决方案：将同一配方的多个产物合并为一个"配方执行次数"变量。
  const mergeMap = new Map(); // coProductId → { representative, ratio }
  
  // 1. 按配方分组 SCC 中的物品
  // 2. 同配方多产物 → 合并为一个矩阵变量（配方执行次数）
  // 3. 联产物的系数按产出比合并到代表物品的列
  // 4. 联产物的行被删除（与代表行线性相关）
  
  // 构建 reducedArray（排除被合并的联产物）
  const reducedArray = sccArray.filter(id => !mergeMap.has(id));
  const n = reducedArray.length;
  
  // 构建矩阵A
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  
  for (let j = 0; j < n; j++) {
    const cost = costs.get(reducedArray[j]);
    
    // 对角线放$x（执行次数）
    A[j][j] = cost[`$${reducedArray[j]}`] || 1;
    
    // 循环组内引用 → 矩阵变量（联产物合并到代表物品列）
    for (const [key, coeff] of Object.entries(cost)) {
      if (scc.has(key) && reducedIndex.has(key)) {
        A[reducedIndex.get(key)][j] = -coeff;
      }
    }
  }
  
  // 求逆矩阵
  const A_inv = invertMatrix(A);
  
  // 更新 costs：每个物品的真实成本
  // 正向依赖：展开常数项 + 添加 $物品 执行次数
  // 负向依赖：保留 $物品 让逆生产机制判断取消量
  // 联产物成本 = 代表物品成本 × ratio
}
```

#### 配方变量法详解

**问题**：当同一配方的多个产物（如精炼油和氢气都选择 X 裂解配方）同时出现在 SCC 中时，它们的成本方程线性相关，矩阵不可逆。

**数学原理**：
- 设配方 X 产出 `r·A + h·B`，A 和 B 都选择配方 X
- A 的成本方程：`a₁·cₐ + a₂·cᵦ = bₐ`（a₂ = -h/r 是 B 的副产品系数）
- B 的成本方程：`b₁·cₐ + b₂·cᵦ = bᵦ`（b₁ = -r/h 是 A 的副产品系数）
- 由于 `a₂·b₂ = 1`，两行线性相关，矩阵奇异

**解决方案**：将 A 和 B 合并为一个"配方执行次数"变量 t：
- A 的成本 = t·bₐ，B 的成本 = t·bᵦ × (h/r)
- 矩阵维度降低 1，消除线性相关
- 求解后，联产物成本从代表物品成本按产出比推导

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

### 8.3 喷涂成本计算

```javascript
let sprayCost;
if (safeLevel === 1) {
  sprayCost = 1 / 12;
} else if (safeLevel === 2) {
  sprayCost = proliferateItself ? 1 / 27 : 1 / 24;
} else if (safeLevel === 3) {
  sprayCost = proliferateItself ? 1 / 74 : 1 / 60;
}

// 增产剂需求 = 原料总数 × 喷涂成本
const proAmount = totalMaterialCount * sprayCost;
```

---

## 9. 建筑倍率（ApplyBuildingMultiplier）

根据建筑类型应用不同的产出倍率：

```javascript
function ApplyBuildingMultiplier(output_num, building_name, item, settings) {
  if (building_name === "采矿机") {
    output_num *= settings.mining_speed_multiple * settings.covered_veins_small;
  } else if (building_name === "大型采矿机") {
    output_num *= settings.mining_speed_multiple * settings.covered_veins_large * settings.mining_efficiency_large;
  } else if (building_name === "原油萃取站") {
    output_num *= settings.mining_speed_multiple * settings.mining_speed_oil;
  } else if (building_name === "轨道采集器") {
    output_num *= settings.mining_speed_multiple;
    // 特定资源倍率...
  } else if (building_name === "大气采集站") {
    output_num *= settings.mining_speed_multiple;
    // 特定气体倍率...
  } else if (building_name.endsWith("分馏塔")) {
    output_num *= settings.fractionating_speed;
  }
  return output_num;
}
```

---

## 10. 增产策略优化：递归DFS + DAG引导 + 动态SCC

> 本节描述阶段四的核心算法——在DAG层级会因增产选择而动态变化的约束下，寻找全局最优增产策略。

### 10.1 核心矛盾

DAG层级有两层功能：
1. **遍历顺序**：按DAG顺序（低→高）遍历增产选择，可实现完美剪枝
2. **计算顺序**：给单次计算成本提供迭代顺序

但增产剂本身是物品，有自己的生产链。选择增产剂 = 添加新的原料依赖，会改变DAG层级：
- 产物的DAG层级 > 所有原料的DAG层级
- 低DAG物品选择高DAG增产剂 → 增产剂层级被拉低 → DAG结构变化

这形成了**循环依赖**：遍历顺序依赖DAG，DAG依赖增产选择。

### 10.2 关键洞察

> **不需要等所有低层级物品都确定，只需要等该物品的所有上游物品确定即可。**

上游物品必然在更低层，所以DAG顺序是"上游先确定"的充分条件。但更低层的物品不全是上游——这是包含关系。

### 10.3 三级递进假设

| 层级 | 假设条件 | DAG变化 | 算法 |
|------|---------|---------|------|
| 第一层 | 只能选比自己层级低的增产剂 | 不变 | 标准DAG遍历 |
| 第二层 | 增产剂产线不能用高于自己层级的增产剂 | 变化但无循环组 | 递归处理，必然终止 |
| 第三层 | 完全自由选择 | 变化且有循环组 | 递归DFS + 动态SCC |

### 10.4 第三层算法：递归DFS

#### 核心思想

递归DFS在DAG引导下搜索增产策略空间。**只有当选择高级增产剂创建新的循环依赖时才展开新的递归分支**，低级选择直接内联计算。

这是"最短路径"：物品使用低级增产剂不会分散出无效的新遍历分支，只讨论发起循环组变化的必要分支。

#### 选择分类

| 选择类型 | 是否产生新分支 | 处理方式 |
|---------|-------------|---------|
| 无增产 | 否 | 直接计算 O(1) |
| 低级增产剂（<物品层级） | 否 | 直接计算 O(1) |
| 同级加速↔增产 | 否 | 直接计算 O(1)，无需重新SCC分析 |
| 高级增产剂（>物品层级） | **是** | 形成/扩大SCC，递归处理 |

#### 伪代码

```python
# 全局状态
resolved = {}        # item → choice（已持久化的最优策略）
edges = []           # 当前图的边（含增产剂边）
dag_levels = {}      # item → dag_level

CHOICES = [无, MK1加速, MK1增产, MK2加速, MK2增产, MK3加速, MK3增产]

def main_optimize(items):
    """主入口：按DAG顺序遍历所有物品"""
    for item in sorted(items, key=lambda x: dag_levels[x]):
        if item in resolved:
            continue
        optimize_item(item)
    return resolved

def optimize_item(item):
    """优化单个物品的增产策略"""
    best_q = -∞
    best_choice = None

    for choice in CHOICES:
        # 保存状态（用于回溯）
        saved_edges = copy(edges)
        saved_dag = copy(dag_levels)

        if choice == 无:
            q = compute_q()
        else:
            new_dep = get_proliferator_item(choice)  # e.g., MK2

            if dag_levels[new_dep] <= dag_levels[item]:
                # 低级/同级选择：不产生新循环，直接计算
                add_proliferator_edge(item, new_dep)
                q = compute_q()
            else:
                # 高级选择：可能形成SCC
                add_proliferator_edge(item, new_dep)
                scc = run_scc_analysis()
                scc_of_item = find_scc_containing(scc, item)
                scc_items = list(scc_of_item)

                # 递归处理SCC的外部上游
                handle_unresolved_upstream(scc_items)

                # SCC内部全遍历（此时外部上游已全部确定）
                best_q_scc = -∞
                traverse_scc(scc_items, set(), 0,
                             lambda q: update_if_better(best_q_scc, q))
                q = best_q_scc

        if q > best_q:
            best_q, best_choice = q, choice

        # 回溯状态
        edges = saved_edges
        dag_levels = saved_dag

    # 持久化最优策略（不可推翻）
    resolved[item] = best_choice
    return best_q
```

### 10.5 持久化与剪枝

**持久化的正确性**：

当一个物品（或循环组）的所有上游都已确定策略后，遍历其所有增产选择得到的最优策略可以**永久持久化**——因为上游不会再变，局部最优 = 全局最优。

持久化后的物品/循环组**永远不会被重新考虑**，这是算法效率的关键来源。

**SCC持久化**：

当一个SCC的外部上游全部确定后，SCC内部全遍历得到的最优策略可以永久持久化。这提供了强大的剪枝——SCC内的物品一旦resolved，就不再参与后续搜索。

### 10.6 为什么这是最短路径

1. **低级选择不产生分支**：选低级增产剂直接内联计算，不展开递归
2. **只有必要分支**：只有选高级增产剂形成循环时才展开
3. **SCC内部全遍历**：一旦进入SCC，穷举所有组合，得到确定性最优
4. **不重复**：同级选择（加速↔增产）不触发SCC分析

搜索空间远小于 7^N（N为循环组最大成员数），而是只包含"必要分支"。

---

## 11. 优化设计：多来源物品延迟展开

### 11.1 优化目标

减少逆生产计算次数，提高计算性能。

### 11.2 核心思路

通过跳过多来源物品的展开，最后批量处理，减少逆生产计算次数。

### 11.3 多来源物品识别

在DAG构建阶段识别多来源物品（有多个配方产出的物品）：

```javascript
const multiSourceItems = new Set();
const outputRecipeIndices = new Map();

for (const outputId of Object.keys(recipe.产物 || {})) {
  if (!outputRecipeIndices.has(outputId)) {
    outputRecipeIndices.set(outputId, 0);
  }
  outputRecipeIndices.set(outputId, outputRecipeIndices.get(outputId) + 1);
}

for (const [itemId, count] of outputRecipeIndices) {
  if (count > 1) {
    multiSourceItems.add(itemId);
  }
}
```

### 11.4 展开顺序处理

1. SCC分析得到展开顺序
2. 按顺序展开物品
3. 在展开过程中检查物品是否是多来源物品，如果是就跳过展开
4. 最后统一展开多来源物品（deferredItems）

### 11.5 循环组处理

- 循环组不跳过，直接进行矩阵求逆
- 矩阵求逆后，只有非多来源物品才代入到依赖边

---

## 12. 最终关键决策表

| 问题 | 最终决定 |
|------|---------|
| 生产路线选择 | 用户手动 |
| 配方选择 | 用户手动 |
| 燃料选择 | 用户手动 |
| 优化变量 | 增产剂等级 + 模式 |
| 循环处理 | SCC |
| 非循环区域 | DAG动态规划 |
| 循环区域 | SCC内部搜索 |
| 目标函数 | 最大瓶颈法 |
| 资源模型 | 多维资源统一向量 |
| 电力处理 | 作为资源消耗 |
| LP | 局部副产物平衡 |
| 关键物品法 | 不作为核心 |
| 权重法 | 放弃 |
| Pareto | 暂不采用 |
