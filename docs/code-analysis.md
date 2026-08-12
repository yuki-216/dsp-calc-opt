# 代码分析文档

> 本文档记录项目代码结构与核心算法分析，随修改同步更新。

---

## 1. 项目概述

基于 [DSPCalculator/dsp-calc](https://github.com/DSPCalculator/dsp-calc) 进行功能修剪和新增。

### 技术选型

| 项目 | 选择 | 说明 |
|------|------|------|
| 基础项目 | dsp-calc | 已实现核心计算功能 |
| 框架 | React 19 | UI组件库 |
| 构建 | Vite 8 | 快速开发服务器 |
| 样式 | Bootstrap 5 + SCSS | UI框架 |
| 状态 | React Context | 全局状态管理 |

### 开发环境

```bash
npm install          # 安装依赖
npm run dev          # 启动开发服务器 (localhost:5173)
npm run build        # 编译静态文件
```

---

## 2. 文件结构

```
src/
├── main.jsx                    # 应用入口
├── App.jsx                     # 主应用组件
├── contexts.jsx                # React Context定义，全局状态管理
├── game_data.jsx               # 游戏数据加载与转换
├── scheme_data.jsx             # 配方方案管理与存储
├── needs_list.jsx              # 需求列表管理
├── result.jsx                  # 结果显示与计算调用
├── settings.jsx                # 设置面板 + 批量预设
├── recipe.jsx                  # 配方显示组件
├── ui_components.jsx           # UI组件（图标、主题、头部、PWA提示）
├── item_select.jsx             # 物品选择弹窗
├── DependencyGraphPage.jsx     # 依赖图页面
├── DependencyGraph.css         # 依赖图样式
├── ui_components/
│   └── auto_sized_input.jsx    # 自适应输入框组件
├── engine/                     # 计算引擎
│   ├── index.js                # 主入口（CoreEngine类）
│   ├── dag.js                  # BFS构建物品图 + SCC检测
│   ├── graph-utils.js          # 图算法工具（Tarjan SCC、拓扑排序）
│   ├── unit-cost.js            # 系数表成本计算+矩阵求解
│   ├── proliferator-optimizer.js # 增产策略优化器
│   ├── matrix.js               # 稀疏矩阵求逆
│   └── debug.js                # 调试工具
```

---

## 3. UI层分析

### 3.1 入口结构（main.jsx）

应用有**4个独立的React根节点**：

| 根节点ID | 组件 | 说明 |
|----------|------|------|
| `icon-styles` | IconStyles | 图标精灵图样式 |
| `header` | Header | 顶部导航栏 |
| `root` | App | 主应用 |
| `pwa-prompt` | ReloadPrompt | PWA更新提示（可选） |

### 3.2 组件层次（App.jsx）

```
App
└── ContextProvider              # 全局Context提供者
    └── AppWithContexts
        ├── 顶部面板 (.app-top-panel)
        │   ├── 游戏版本显示
        │   ├── SchemeStorage    # 生产策略存储
        │   ├── NeedsListStorage # 需求列表存储
        │   ├── 清空数据按钮
        │   ├── 设置显示按钮
        │   ├── UserSettings     # 采矿参数设置
        │   ├── NeedsList        # 需求列表管理
        │   └── BatchSetting     # 批量预设
        └── 结果区域 (.app-result-area)
            └── Result           # 结果显示
```

### 3.3 响应式设计

四种模式，通过窗口宽度自动切换：

| 模式 | 宽度 | 特点 |
|------|------|------|
| `full` | ≥1400px | 完整显示，右侧总结面板 |
| `compact` | 1024-1399px | 压缩间距，隐藏文字标签 |
| `narrow` | 768-1023px | 隐藏总结面板，改为弹出按钮 |
| `mobile` | <768px | 纵向堆叠，极简显示 |

---

## 4. 状态管理（contexts.jsx）

### 4.1 Context 结构

```
ContextProvider
├── GameInfoContext           # 游戏数据（只读）
├── GlobalStateContext        # 计算引擎实例（只读）
├── GameInfoSetterContext     # 游戏数据更新函数
├── SchemeDataSetterContext   # 配方方案更新函数
├── SettingsContext           # 设置数据（只读）
├── SettingsSetterContext     # 设置更新函数
├── CompactModeContext        # 响应式模式
├── DefaultSettingsContext    # 默认设置
├── EngineCalculateContext    # 主引擎计算函数
└── EngineGraphDataContext    # 引擎图数据
```

### 4.2 数据持久化

| 数据 | localStorage键 | 说明 |
|------|----------------|------|
| 生产策略 | `scheme_data` | 按游戏名称分组 |
| 需求列表 | `needs_list` | 按游戏名称分组 |
| 设置 | `auto_settings` | 全局设置，加载时自动清理废弃字段 |

---

## 5. 核心计算引擎

### 5.1 问题定义

**目标**：给定需求列表（如"每秒 2 个电路板"），计算所有物品的生产吞吐量。

**三大难点**：
1. **循环配方**：增产剂需要自身喷涂（自消耗），石墨烯/可燃冰/重整精炼存在环路
2. **多产物配方**：原油精炼同时产氢和精炼油，同物品可能有多种来源配方
3. **副产物配平**：多出的副产物需要合理消耗或标记为溢出

### 5.2 计算流程

```
用户需求 → BFS构建图+SCC检测 → 成本展开 → 结果汇总
  ↓              ↓                ↓            ↓
需求列表      物品图+循环组    系数表+矩阵求逆  资源/设备/电力/占地
  ↓              ↓                ↓            ↓
虚拟"解"      DAG层级(依赖图用) 代入展开到解   最终结果
```

> DAG层级（`dagTopologicalSort`）仅用于依赖图的可视化布局，计算引擎按SCC顺序展开，不依赖DAG层级。

**计算步骤**：

1. **BFS构建图**（dag.js）：从需求出发构建物品依赖图，计算每个物品的直接成本系数表和设备信息
2. **SCC检测**（dag.js → graph-utils.js）：Tarjan算法识别强连通分量（循环组）
3. **成本展开**（unit-cost.js）：创建虚拟"解"物品，按SCC逆拓扑序将各物品的直接成本代入展开
   - 单节点SCC：直接代入依赖方
   - 多节点SCC（循环组）：构建矩阵，求逆求解
4. **结果汇总**（index.js）：从虚拟"解"的展开结果中提取资源消耗、设备数量、电力、占地等

### 5.3 CoreEngine 类

```javascript
class CoreEngine {
  static VERSION = 'current';

  constructor(gameData, schemeData, settings, sprayCosts)
  initialize(needs, recipes)  // 构建图+SCC检测
  calculate(needs, recipes)   // 主计算函数，返回完整结果
}
```

### 5.4 输出数据

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

### 5.5 系数表设计

成本表示：`{ "$item": 1, "input1": ratio, "byproduct": -ratio, ... }`

- `$` 前缀：配方执行次数
- 无前缀：物品总成本符号
- 负数：副产物（产出而非消耗）

---

## 6. BFS构建图（dag.js）

### 6.1 物品节点结构

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

### 6.2 BFS构建过程

1. 初始化需求物品节点
2. BFS遍历，对每个物品：
   - 查找用户选择的主配方
   - 处理增产剂（添加到原料，计算产出倍率）
   - 计算设备数和耗电
   - 计算直接成本公式
   - 建立依赖边

### 6.3 直接成本公式

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

## 7. SCC检测（graph-utils.js）

### 7.1 Tarjan算法

使用Tarjan算法识别强连通分量：

```javascript
function tarjanSCC(items, edges) {
  // 构建邻接表
  // Tarjan深度优先搜索
  // 返回: Array<Set<string>>，每个SCC是成员节点的Set
}
```

### 7.2 SCC输出顺序

Tarjan输出顺序：逆拓扑序（`sccGroups[0]`=最终产物/顶层，`sccGroups[last]`=原矿/底层）。

### 7.3 为什么选择SCC而非关键物品法

| 方面 | 旧方案（拓扑排序+LP） | 当前方案（SCC+矩阵求逆） |
|------|--------|--------|
| 循环识别 | 贪心选 key_item 断点 | Tarjan SCC 找强连通分量 |
| 循环信息 | 丢失（断点后变成 DAG） | 保留（SCC 分组 + 内部结构） |
| 循环间关系 | 无法表达 | DAG 压缩后自然表达 |
| 增产优化 | 难以加入 | SCC 内部可独立优化 |

---

## 8. 成本展开（unit-cost.js）

### 8.1 展开顺序

按SCC逆拓扑序展开（从顶层/最终产物开始，正向遍历）。

### 8.2 矩阵求解（solveSCCByMatrix）

对循环组构建矩阵，求逆求解。支持配方变量法处理联产物线性相关问题。

---

## 9. 增产剂处理

### 9.1 增产剂等级

| 等级 | ID | 喷涂次数 | 增产效果 | 加速效果 | 耗电倍率 |
|------|-----|----------|----------|----------|----------|
| 0 | - | 1 | 1.0 | 1.0 | 1.0 |
| 1 | 1141 | 12 | 1.125 | 1.25 | 1.3 |
| 2 | 1142 | 24 | 1.2 | 1.5 | 1.7 |
| 3 | 1143 | 60 | 1.25 | 2.0 | 2.5 |

### 9.2 增产模式

| 模式 | 代码 | 效果 |
|------|------|------|
| 无 | 0 | 不使用增产剂 |
| 加速 | 1 | 产出倍率 × 加速效果 |
| 增产 | 2 | 产出倍率 × 增产效果 |
| 透镜 | 3 | 产出倍率 × 加速效果（仅特定配方） |

### 9.3 建筑倍率（ApplyBuildingMultiplier）

根据建筑类型应用不同的产出倍率：

| 建筑类型 | 倍率计算 |
|----------|----------|
| 采矿机 | 采矿速度 × 覆盖矿脉数 |
| 大型采矿机 | 采矿速度 × 覆盖矿脉数 × 开采效率 |
| 原油萃取站 | 采矿速度 × 原油面板 |
| 轨道采集器 | 采矿速度 × 特定资源倍率 |
| 大气采集站 | 采矿速度 × 特定气体倍率 |
| 分馏塔 | 分馏带速 |

---

## 10. 燃料计算系统

### 10.1 燃料数据

```javascript
export const FUEL_DATA_BASE = [
  { name: "无", heatValue: 0, device: "", restrict: "" },
  { name: "煤矿", heatValue: 2.16, device: "火力发电厂", restrict: "只能增产" },
  { name: "高能石墨", heatValue: 5.4, device: "火力发电厂", restrict: "只能增产" },
  // ... 更多燃料
];
```

### 10.2 燃料配方生成

在 `get_game_data()` 函数中，自动添加燃料配方：

```javascript
FUEL_DATA.forEach(fuel => {
  if (fuel.name === "无") return;
  const recipe = {
    Type: 3,
    原料: { [fuel.name]: 1 },
    产物: { "电力": fuel.heatValue / devicePower },
    设施: factoryIndex,
    时间: 1,
    增产: getFuelProliferatorCode(fuel.restrict),
    isFuelRecipe: true,
    fuelName: fuel.name
  };
  data.recipe_data.push(recipe);
});
```

### 10.3 计算逻辑

燃料配方初始化后，完全复用现有计算逻辑：
- 电力作为"物品"参与BFS建边和SCC分析
- 燃料原料被正确追溯
- 增产剂影响：加速模式减少设备数量，增产模式减少燃料需求

---

## 11. 占地计算系统

- `n` = ceil(设备数量)，进一法取整
- `l` = 原料种类数 + 产物种类数
- `m` = 研究站堆叠数（默认15）
- 宇宙矩阵使用配方索引号73识别

| 建筑类型 | 公式 | 说明 |
|----------|------|------|
| 制造台 | (4n-1) × (3+l/2) | n=设备数量, l=原料+产物种类数 |
| 熔炉 | 3n × (3+l/2) | |
| 原油精炼厂 | 3n × (6+l/2) | |
| 分馏塔 | 5.5 × (4n-1) | |
| 化工厂 | 7n × (4+l/2) | |
| 微型粒子对撞机 | 5n × (9+l/2) | |
| 研究站 | 5×ceil(n/m) × (5+l/2) | m=堆叠数 |
| 宇宙矩阵 | 12 × (5.5×ceil(n/m)) | 特殊公式 |
| 射线接收站 | (8√n-1)² | |
| 人造恒星 | 49 | 固定值 |
| 火力/微型聚变发电 | 28 | 固定值 |


---

## 12. 增产策略优化器

### 12.1 优化器接口

```javascript
export async function optimizeProliferatorStrategy(
  gameData, schemeData, settings, needs,
  onProgress = null, onLog = null,
  strategy = 'min_power'  // 'min_power' | 'min_raw_ore' | 'min_footprint'
)
```

### 12.2 核心矛盾

增产剂本身是物品，有自己的生产链。选择增产剂 = 添加新的原料依赖，会改变DAG层级。但优化按SCC顺序进行，上游先确定，局部最优 = 全局最优。

### 12.3 优化流程

在最高等级配置下按 SCC 顺序完成所有物品的优化：

1. **初始化** - 强制所有物品使用最高等级增产剂
2. **SCC 分析** - 在最高等级配置下分析 SCC 结构
3. **按 SCC 顺序优化** - 单节点逐个优化，循环组坐标下降

### 12.4 多目标策略

| 策略 | 标识 | 目标函数 | 说明 |
|------|------|---------|------|
| 最小电力 | `min_power` | totalEnergyCost | 最小化总耗电（默认） |
| 最小原矿 | `min_raw_ore` | totalRawOre | 最小化原矿消耗总量 |
| 最小占地 | `min_footprint` | totalFootprint | 最小化总占地面积 |

### 12.5 返回值

```javascript
{
  optimalScheme,        // 最优方案
  initialPower,         // 初始耗电
  optimalPower,         // 最终耗电
  strategy,             // 使用的策略标识
  initialObjective,     // 初始目标值
  optimalObjective,     // 最终目标值
  changes,              // 策略变更列表
  processedCount,       // 已处理物品数
  totalCount            // 总物品数
}
```

---

## 13. 数据层（game_data.jsx）

### 13.1 数据来源

从 `data/Vanilla.json` 文件加载原版游戏数据。

### 13.2 数据转换

```javascript
game_data = {
    recipe_data: [],       // 配方表
    factory_data: [],      // 设施表
    proliferator_data: [], // 增产剂数据（等级0-3）
    proliferator_effect: [], // 增产效果（等级0-3）
    item_grid: {},         // 物品网格位置
    item_icon_name: {},    // 物品名→图标名映射
    game_name: ""          // 游戏名称
}
```

### 13.3 配方数据结构

```javascript
recipe_data[i] = {
    "原料": {"铁矿": 1},      // 输入物品及数量
    "产物": {"铁板": 1},      // 输出物品及数量
    "设施": 0,                // 设施类型索引
    "时间": 1.0,              // 制造时间（秒）
    "增产": 3                 // 增产支持模式（位掩码）
}
```

### 13.4 增产支持模式（位掩码）

| 位 | 值 | 含义 |
|----|-----|------|
| bit0 | 1 | 可加速 |
| bit1 | 2 | 可增产 |
| bit2 | 4 | 透镜加速（不加倍原料） |

---

## 14. 图标系统（ui_components.jsx）

### 14.1 精灵图加载

通过 `import.meta.glob('../icon/*.json')` 加载精灵图元数据，构建 `image_indices` 映射。

### 14.2 图标查找流程

```
物品名称 → get_icon_by_item() → item_icon_name[名称] → 图标名（如 "accelerator-1"）
图标名 → Icon组件 → image_indices["Vanilla"][图标名] → CSS背景定位
```

---

## 15. 设计决策

| 问题 | 决定 |
|------|---------|
| 生产路线选择 | 用户手动 |
| 配方选择 | 用户手动 |
| 燃料选择 | 用户手动 |
| 优化变量 | 增产剂等级 + 模式 |
| 循环处理 | SCC + 矩阵求逆 |
| 非循环区域 | 系数表展开 |
| 循环区域 | 矩阵求逆求解 |
| 目标函数 | 最小电力 / 最小原矿 / 最小占地 |
| 电力处理 | 作为资源消耗 |

---

## 16. 特色功能

### 16.1 在新窗口计算

输出表每个物品旁有"在新窗口计算"按钮，点击后：
- **原页面**：将该物品标记为原矿（加入 mineralize_list），不参与生产链计算
- **新标签页**：打开独立计算器，将该物品添加为需求（不标记为原矿），继承输出表的数量
- **数据传递**：通过 localStorage 的 `dsp-calc-new-tab-data` 键传递数据
- **状态隔离**：新标签页清空原矿化列表，不继承原页面的原矿设置

### 16.2 负数需求（外部供给）

需求表支持输入负数，表示"外部供给"：
- 正数需求：需要生产的物品数量
- 负数需求：外部提供的物品数量，减少实际生产量
- 引擎处理：负需求作为"负成本"参与计算，自动减少相关物品的生产需求
- UI 区分：负数需求显示为绿色文字

---

