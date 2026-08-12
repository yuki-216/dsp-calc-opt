# code-analysis.md — 代码分析文档

> 本文档记录项目代码结构分析，随修改同步更新。

---

## 更新日志

| 日期 | 内容 |
|------|------|
| 2026-07-04 | 初始版本，完成UI层、交互逻辑、核心计算、数据层分析 |
| 2026-07-04 | 完成依赖图分析，发现默认配方无循环依赖 |
| 2026-07-04 | 简化增产剂成本计算，修复批量预设按钮 |
| 2026-07-19 | 移除MOD支持，仅保留原版游戏 |
| 2026-07-19 | 重构增产剂系统：简化为3级（Mk.I/II/III），增产模式改为无/加速/增产/透镜 |
| 2026-07-19 | 修复增产剂名称中的非断行空格（U+00A0）导致的图标丢失问题 |
| 2026-07-26 | 新增新计算引擎（DAG+SCC+矩阵求逆），替代旧引擎（拓扑排序+LP） |
| 2026-07-31 | 代码清理：删除未使用文件，优化性能，统一建筑倍率计算 |
| 2026-07-31 | 引擎优化：多来源物品识别、延迟展开、循环组矩阵求逆优化 |
| 2026-08-04 | 代码整合：合并文件减少数量，删除 scale.js，清理注释代码 |
| 2026-08-12 | 新增燃料计算、占地计算系统、多目标优化策略 |

---

## 1. 项目文件结构

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
│   ├── dag.js                  # DAG层级计算（BFS构建图）
│   ├── graph-utils.js          # 图算法工具（Tarjan SCC、拓扑排序）
│   ├── unit-cost.js            # 系数表成本计算+矩阵求解
│   ├── proliferator-optimizer.js # 增产策略优化器
│   ├── matrix.js               # 稀疏矩阵求逆
│   └── debug.js                # 调试工具
```

---

## 2. UI层分析

### 2.1 入口结构（main.jsx）

应用有**4个独立的React根节点**：

| 根节点ID | 组件 | 说明 |
|----------|------|------|
| `icon-styles` | IconStyles | 图标精灵图样式 |
| `header` | Header | 顶部导航栏 |
| `root` | App | 主应用 |
| `pwa-prompt` | ReloadPrompt | PWA更新提示（可选） |

### 2.2 组件层次（App.jsx）

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

### 2.3 响应式设计

四种模式，通过窗口宽度自动切换：

| 模式 | 宽度 | 特点 |
|------|------|------|
| `full` | ≥1400px | 完整显示，右侧总结面板 |
| `compact` | 1024-1399px | 压缩间距，隐藏文字标签 |
| `narrow` | 768-1023px | 隐藏总结面板，改为弹出按钮 |
| `mobile` | <768px | 纵向堆叠，极简显示 |

---

## 3. 交互逻辑分析

### 3.1 状态管理架构（contexts.jsx）

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
├── ValidationContext         # 双引擎验证状态
├── EngineCalculateContext    # 主引擎计算函数
└── EngineGraphDataContext    # 引擎图数据
```

### 3.2 数据持久化

| 数据 | localStorage键 | 说明 |
|------|----------------|------|
| 生产策略 | `scheme_data` | 按游戏名称分组 |
| 需求列表 | `needs_list` | 按游戏名称分组 |
| 设置 | `auto_settings` | 全局设置，加载时自动清理废弃字段 |

---

## 4. 核心计算逻辑

### 4.1 计算引擎架构

**引擎结构**：
- `engine/` — 计算引擎（DAG+SCC+矩阵求逆）

**两段式计算架构**：

```
用户需求 → DAG层级计算 → 单位成本计算 → 结果汇总
  ↓           ↓              ↓            ↓
BFS构建图   SCC检测      系数表+矩阵求逆  资源/设备/电力/占地
  ↓           ↓              ↓            ↓
依赖图      循环组         成本展开      最终结果
```

### 4.2 核心类（CoreEngine）

```javascript
class CoreEngine {
  static VERSION = 'current';

  constructor(gameData, schemeData, settings, sprayCosts)
  initialize(needs, recipes)  // 构建图+SCC检测
  calculate(needs, recipes)   // 主计算函数，返回完整结果
}
```

### 4.3 计算流程

1. **DAG层级计算**（dag.js）：BFS从需求出发构建依赖图
2. **SCC检测**（graph-utils.js）：Tarjan算法识别强连通分量（循环组）
3. **单位成本计算**（unit-cost.js）：系数表追踪成本，按SCC顺序展开
   - 单节点SCC：直接代入依赖方
   - 多节点SCC（循环组）：构建矩阵，求逆求解
4. **结果汇总**（index.js）：从虚拟"解"物品提取资源消耗、设备数量、电力、占地等

### 4.4 系数表设计

成本表示：`{ "$item": 1, "input1": ratio, "byproduct": -ratio, ... }`

- `$` 前缀：配方执行次数
- 无前缀：物品总成本符号
- 负数：副产物（产出而非消耗）

### 4.5 增产剂处理

**增产剂等级**：

| 等级 | ID | 喷涂次数 | 增产效果 | 加速效果 | 耗电倍率 |
|------|-----|----------|----------|----------|----------|
| 0 | - | 1 | 1.0 | 1.0 | 1.0 |
| 1 | 1141 | 12 | 1.125 | 1.25 | 1.3 |
| 2 | 1142 | 24 | 1.2 | 1.5 | 1.7 |
| 3 | 1143 | 60 | 1.25 | 2.0 | 2.5 |

**增产模式**：

| 模式 | 代码 | 效果 |
|------|------|------|
| 无 | 0 | 不使用增产剂 |
| 加速 | 1 | 产出倍率 × 加速效果 |
| 增产 | 2 | 产出倍率 × 增产效果 |
| 透镜 | 3 | 产出倍率 × 加速效果（仅特定配方） |

### 4.6 建筑倍率（ApplyBuildingMultiplier）

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

## 5. 燃料计算系统

### 5.1 燃料数据

```javascript
export const FUEL_DATA_BASE = [
  { name: "无", heatValue: 0, device: "", restrict: "" },
  { name: "煤矿", heatValue: 2.16, device: "火力发电厂", restrict: "只能增产" },
  { name: "高能石墨", heatValue: 5.4, device: "火力发电厂", restrict: "只能增产" },
  // ... 更多燃料
];

export const DEVICE_POWER_CONSUMPTION = {
  "火力发电厂": 2.16,
  "微型聚变发电站": 15,
  "人造恒星": 72
};
```

### 5.2 燃料配方生成

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

### 5.3 计算逻辑

燃料配方初始化后，完全复用现有计算逻辑：
- 电力作为"物品"参与BFS建边和SCC分析
- 燃料原料被正确追溯
- 增产剂影响：加速模式减少设备数量，增产模式减少燃料需求

---

## 6. 占地计算系统

### 6.1 占地公式

```javascript
// 在 CoreEngine.calculate() 中
const footprintDetails = {};
let totalFootprint = 0;

for (const [itemId, detail] of Object.entries(buildingDetails)) {
  const n = Math.ceil(detail.设备数量);  // 进一法取整
  const l = Object.keys(rawInputs).length + Object.keys(rawOutputs).length;  // 种类数之和
  
  let area = 0;
  if (factoryName.includes('制造台')) {
    area = (4 * n - 1) * (3 + l / 2);
  } else if (factoryName.includes('研究站')) {
    const researchStations = Math.ceil(n / stackM);
    if (node.recipeId === 73) {  // 宇宙矩阵
      area = 12 * (5.5 * researchStations);
    } else {
      area = 5 * researchStations * (5 + l / 2);
    }
  }
  // ... 其他建筑类型
  
  footprintDetails[itemId] = { area, n, l, factoryName };
  totalFootprint += area;
}
```

### 6.2 建筑类型公式

| 建筑类型 | 公式 |
|----------|------|
| 制造台 | (4n-1) × (3+l/2) |
| 熔炉 | 3n × (3+l/2) |
| 原油精炼厂 | 3n × (6+l/2) |
| 分馏塔 | 5.5 × (4n-1) |
| 化工厂 | 7n × (4+l/2) |
| 微型粒子对撞机 | 5n × (9+l/2) |
| 研究站 | 5×ceil(n/m) × (5+l/2) |
| 宇宙矩阵 | 12 × (5.5×ceil(n/m)) |
| 射线接收站 | (8√n-1)² |
| 人造恒星 | 49 |
| 火力/微型聚变发电 | 28 |

### 6.3 参数说明

- `n` = ceil(设备数量)，进一法取整
- `l` = 原料种类数 + 产物种类数（不需要GCD简化）
- `m` = 研究站堆叠数（默认15）
- 宇宙矩阵使用配方索引号73识别

---

## 7. 增产策略优化器

### 7.1 优化器架构

```javascript
// src/engine/proliferator-optimizer.js
export async function optimizeProliferatorStrategy(
  gameData, schemeData, settings, needs,
  onProgress = null, onLog = null,
  strategy = 'min_power'  // 'min_power' | 'min_raw_ore' | 'min_footprint'
)
```

### 7.2 一阶段优化算法

优化算法采用一阶段策略，在最高等级配置下按 SCC 顺序一次性完成所有物品的优化：

1. **初始化** - 强制所有物品使用最高等级增产剂
2. **SCC 分析** - 在最高等级配置下分析 SCC 结构
3. **按 SCC 顺序优化** - 单节点逐个优化，循环组坐标下降

### 7.3 多目标策略

| 策略 | 标识 | 目标函数 | 说明 |
|------|------|---------|------|
| 最小电力 | `min_power` | totalEnergyCost | 最小化总耗电（默认） |
| 最小原矿 | `min_raw_ore` | totalRawOre | 最小化原矿消耗总量 |
| 最小占地 | `min_footprint` | totalFootprint | 最小化总占地面积 |

### 7.4 返回值结构

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

## 8. 数据层分析（game_data.jsx）

### 8.1 数据来源

从 `data/Vanilla.json` 文件加载原版游戏数据。

### 8.2 数据转换

原始JSON → 游戏数据结构：

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

### 8.3 配方数据结构

```javascript
recipe_data[i] = {
    "原料": {"铁矿": 1},      // 输入物品及数量
    "产物": {"铁板": 1},      // 输出物品及数量
    "设施": 0,                // 设施类型索引
    "时间": 1.0,              // 制造时间（秒）
    "增产": 3                 // 增产支持模式（位掩码）
}
```

### 8.4 增产支持模式（位掩码）

| 位 | 值 | 含义 |
|----|-----|------|
| bit0 | 1 | 可加速 |
| bit1 | 2 | 可增产 |
| bit2 | 4 | 透镜加速（不加倍原料） |

---

## 9. 图标系统（ui_components.jsx）

### 9.1 精灵图加载

通过 `import.meta.glob('../icon/*.json')` 加载精灵图元数据，构建 `image_indices` 映射。

### 9.2 图标查找流程

```
物品名称 → get_icon_by_item() → item_icon_name[名称] → 图标名（如 "accelerator-1"）
图标名 → Icon组件 → image_indices["Vanilla"][图标名] → CSS背景定位
```

---

## 10. 双引擎验证（engine-compare/）

### 10.1 目的

通过同时运行基准版本和优化版本，对比结果验证优化的正确性。

### 10.2 对比维度

- 配方执行次数
- 多余产物
- 设备数量
- 耗电
