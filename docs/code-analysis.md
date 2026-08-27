# 代码分析

本文档以当前代码为准，说明项目的主要模块、数据流和多数据源（mod）机制。版本对应 `0.12.0`。

## 1. 项目定位

项目基于 `DSPCalculator/dsp-calc`，提供两类功能：

1. 生产线计算：根据需求、配方和设置，计算原料、建筑、电力、占地和副产物。
2. 种子查看与统计：查询戴森球计划的星区资源，并用统计均值辅助填写矿物可用量。
3. 多游戏数据源：除原版外支持切换 mod 数据（如创世之书 GenesisBook），数据源由顶部导航栏下拉切换。

公开版是静态网站，默认不依赖 Python 后端。单个种子查询由浏览器 WASM Worker 完成，统计结果由
`public/stats.json` 提供。本地 FastAPI 后端仍保留，用于个人调试种子查询和运行全量统计。

## 2. 总体结构

```text
src/main.jsx
└── RootApp
    └── ThemeProvider
        └── ContextProvider（全局状态：游戏数据/设置/方案/引擎）
            ├── Header（导航栏：导航链接 / 数据源切换下拉 / 主题切换）
            ├── 主计算器页面 App.jsx
            │   ├── 需求/方案/设置状态
            │   ├── CoreEngine（LP 配平，HiGHS WASM）
            │   ├── 结果表 result.jsx（含整数建议/原矿化/原矿总需求）
            │   └── 依赖图 DependencyGraphPage.jsx
            └── SeedViewerPage.jsx
                ├── 单种子查询
                ├── SeedStatsPanel
                └── SeedStatsResult

公开查询：SeedViewerPage → seed_viewer_binding → seed_query_service
       → seed_query_browser → seed_query_worker → search_seed.wasm

本地调试：SeedViewerPage → seed_viewer_binding → FastAPI /api/seed
统计计算：FastAPI → run_stats_calc.py 子进程 → CApi.GetDataManager
公开统计：seed_stats_api → public/stats.json
```

## 3. 游戏数据源与 mod 机制

### 3.1 数据文件

数据以 `data/<数据源名>.json` 存放，格式与原版一致：

- `data/Vanilla.json`：原版（物品 + 配方，结构见 `src/game_data.jsx` 头部注释）
- `data/GenesisBook.json`：创世之书 mod（由 `npm run download:genesisbook` 从 dsp-calc 拉取）

`src/game_data.jsx` 用 `import.meta.glob('../data/*.json')` 预加载所有数据文件，`data_indices` 的
键为文件名 basename。图标同理：`src/ui_components.jsx` 用 `import.meta.glob('../icon/*.json')` 加载
各数据源的雪碧图坐标，`icon/<源名>.png` 由 vite 插件 `get_sprite_plugins`（`vite.config.js`）从
`icon/<源名>/*.png` 生成并输出到 `public/icon/`。

### 3.2 数据源注册与切换

- 注册表：`src/game_data.jsx` 的 `GAME_DATA_SOURCES`（`{name, data_file, version, display}`）。
- 转换：`get_game_data(dataSourceName)` 把 JSON 转换成内部结构（`item_grid`/`item_icon_name`/
  `recipe_data`/`factory_data`/`proliferator_data`），并合成燃料配方与发电建筑。`src/contexts.jsx`
  用 `getInitialSourceName()` 从 localStorage `game_source` 恢复上次选择。
- 切换：Header 下拉 → `switchSource(name)` → `set_game_data(get_game_data(name))`。`set_game_data`
  （`contexts.jsx`）一次性完成：重建 `GameInfo`、恢复/初始化该源的方案（`init_scheme_data`）、
  持久化 `game_source`、过滤无效增殖等级、清空源相关设置（矿物可用量/原矿化）。
- 方案独立：`scheme_data` 按 `game_name` 在 localStorage `auto_scheme` 分 key 存取；需求列表在
  `game_name` 变化时清空（`App.jsx` 的 effect）。
- 配方偏好：`data/allowed_recipes_<源名>.json` 记录每个物品的可选配方索引（`getAllowedRecipes`，
  `src/scheme_data.jsx`）。生成脚本 `scripts/generate_allowed_recipes.cjs` 参数化运行；注意
  **Vanilla 版本含手工调整（如硅石默认"直接获取"），勿重新生成覆盖**。

### 3.3 引擎的数据无关性

`CoreEngine` 只接收 `game_data` 参数，是数据无关的——mod 数据格式与原版一致即可直接计算。
引擎仅特判 `recipe.Type === -2`（无中生有，设备数为 0）；其余配方类型走通用路径。mod 新增的
配方类别（Type 9/10/11/16 等）无需引擎改动。

## 4. 主生产线计算器

### 4.1 状态和页面

- `src/main.jsx`：`RootApp`，页面切换、needs_list 状态。
- `src/contexts.jsx`：游戏数据、设置、方案和计算引擎的 React Context（`GameInfoContext`/
  `SettingsContext`/`SchemeDataSetterContext`/`EngineCalculateContext`/`CalculationErrorContext`/
  `CalculationFailureContext`/`EngineGraphDataContext`/`FuelContext` 等）。
- `src/App.jsx`：主页面，设置面板、原矿化、矿物可用量、批量预设。
- `src/settings.jsx`：采矿参数、矿量/矿点模式、增产剂/自动优化设置、批量预设。
- `src/needs_list.jsx`、`src/item_select.jsx`：需求列表（物品选择器）。
- `src/scheme_data.jsx`：生产方案初始化、按数据源的 `allowed_recipes`、方案持久化。
- `src/result.jsx`：生产结果展示（结果表、原矿输入总需求、副产物、历史差值）。

### 4.2 CoreEngine（LP 配平）

核心代码位于 `src/engine/`：

- `bipartite-graph.js`：BFS 构建二部图（配方节点 + 物品守恒），附加电力/增产剂喷涂输入，计算设备数/耗电。
- `lp-model.js`：构建 LP 模型——配方执行次数为变量、物品守恒为约束，目标 `min Σx + Σslack`；
  `noRecipeItems`（含被原矿化物品）加 slack 变量表示"外部获取缺口"。
- `lp-solver.js`：HiGHS WASM 求解。
- `index.js`：`CoreEngine`，编排并映射结果（`productionByItem`/`resourceUsage`/`surplusByproducts`/
  `recipeExecutions`/`graph`/`totalFootprint` 等）。
- `proliferator-optimizer.js`：按目标（最小电力/珍稀权重/净热值/占地）优化各物品增产/加速方案。
- `rare-ore-practicality.js`：珍稀矿实用性修正。
- `graph-utils.js`：图工具（SCC 等，供优化器分组）。
- `debug.js`：`window.__DEBUG` 调试开关。

计算流程：

```text
需求
  → BFS 构建二部图（含电力/增产剂附加输入）
  → 构建 LP（配方次数变量、物品守恒约束、slack 松弛）
  → HiGHS WASM 求解（min Σx + Σslack）
  → 结果映射：生产量/外部输入/副产物/设备/电力/占地
```

失败处理：LP 求解失败（如无可行解）时，`engineCalculate` 捕获异常，触发全局弹窗
（`CalcFailureModal`，`App.jsx`）并自动回退到上次成功计算的配方方案（`lastGoodSchemeRef`）。

### 4.3 整数优化与设备利用率

`src/factory-integer-optimizer.js` 提供"整数优化建议"（混合工厂等级凑偶数台，纯前端提示）。
`src/result.jsx` 计算设备利用率（需求产能 ÷ 建议组合总产能）并显示在悬浮信息中。

### 4.4 原矿化

被原矿化的物品（`settings.mineralize_list`）不再通过生产链生产——引擎把其加入 `noRecipeItems`，
用 slack 变量满足需求，外部输入量进入 `resourceUsage`。结果表"原矿输入总需求"读取
`resourceUsage` 显示需要外部输入多少；被原矿化物品不参与矿物可用量/瓶颈（`OreQuantitiesPanel`）。

## 5. 依赖图

`src/DependencyGraphPage.jsx` + `src/dependency-graph-edges.js`：

- 全部配方模式：`build_dependency_graph` 遍历各物品所选配方，建"产物→真实原料"边（`recipe.原料`，
  不含电力/增产剂）。
- 仅需求模式：`projectNeedsOnlyEdges` 从引擎二部图投影无环生产边，同样排除电力/增产剂依赖边，
  不把电力/增产剂作为独立需求节点；用户显式需求物品保留。
- 使用增产剂（增产剂等级>0）的物品节点用玫红背景区分（图例"增产"项）。

## 6. 种子查询

### 6.1 查询模式

`src/seed_query_mode.js` 保存查询模式，合法值为 `browser`（默认，浏览器 WASM）/ `backend` /
`auto`。模式存于 localStorage `seed-query-mode`，控制台可调用 `setSeedQueryMode` 等。
`src/seed_query_service.js` 是统一适配层。

### 6.2 浏览器 WASM 路径

`src/seed_query_browser.js` 管理 Module Worker；`src/seed_query_worker.js` 动态加载
`public/search_seed.js`/`.wasm`；`src/seed_viewer_binding.js` 转换 camelCase→snake_case。
Worker 通过页面 `baseURI` 计算资源根路径，支持 GitHub Pages 子路径。

### 6.3 C++ 构建

源代码在 `dsp_search_seed/cpp_source_code/`，入口 `wasm_api.cpp`；浏览器构建用
`wasm_opencl_stub.cpp` 提供 CPU 兼容。构建脚本 `scripts/build_seed_wasm.cjs`：
`set GLM_ROOT=<path>; npm run build:wasm`。

## 7. 统计系统

- 前端：`src/seed_stats_api.js` 按模式读 `public/stats.json`（Welford M2 计算 CI95）或请求后端。
- 后端：`backend/main.py`（FastAPI）、`stats_api.py`、`run_stats_calc.py`、`batch_calculator.py`、
  `stats_calculator.py`（Welford）、`stats_storage.py`；`dsp_search_seed/CApi/` 内置 Python CApi。
- 统计状态文件 `backend/data/seed_stats/` 为运行时数据，不提交；公开发布用筛选后的
  `public/stats.json`。
- 收敛判据：星区汇总相对误差阈值 3%，所有参与停止判断的指标都达到才停止。

## 8. 构建和验证

```bash
npm install
npm run build:wasm   # 只有修改 C++ 查询引擎时需要
npm run build        # 生成 GitHub Pages 静态产物（同时重新生成雪碧图）
npm run lint
npm run test         # node --test "tests/**/*.test.js"
```

测试目录 `tests/`：引擎（`tests/engine/`）、依赖图投影（`tests/dependency-graph-edges.test.js`）、
结果行（`tests/result-rows.test.js`）、整数优化、种子查询等。

## 9. 版本与变更

版本号位于 `package.json`，构建时由 `vite.config.js` 注入 `VITE_APP_VERSION`。当前版本 0.12.0。
每次发布应同步更新 README 标题和 `CHANGELOG.md`，并通过 GitHub Actions 将 `dist/` 发布到
GitHub Pages。
