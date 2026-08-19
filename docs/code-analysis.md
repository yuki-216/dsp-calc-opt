# 代码分析

本文档以当前代码为准，说明项目的主要模块、数据流和公开部署/本地调试边界。

## 1. 项目定位

项目基于 `DSPCalculator/dsp-calc`，提供两类功能：

1. 生产线计算：根据需求、配方和设置，计算原料、建筑、电力、占地和副产物。
2. 种子查看与统计：查询戴森球计划的星区资源，并用统计均值辅助填写矿物可用量。

公开版是静态网站，默认不依赖 Python 后端。单个种子查询由浏览器 WASM Worker 完成，统计结果由
`public/stats.json` 提供。本地 FastAPI 后端仍保留，用于个人调试种子查询和运行全量统计。

## 2. 总体结构

```text
src/main.jsx
└── App.jsx
    └── ContextProvider
        ├── 主计算器页面
        │   ├── 需求/方案/设置状态
        │   ├── CoreEngine
        │   └── 计算结果与优化器
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

## 3. 主生产线计算器

### 3.1 状态和页面

- `src/App.jsx`：应用页面切换、主题和主布局。
- `src/contexts.jsx`：游戏数据、设置、方案和计算引擎的 React Context。
- `src/settings.jsx`：采矿参数、矿量/矿点模式、统计均值应用后的设置。
- `src/needs_list.jsx`、`src/scheme_data.jsx`：需求列表和生产方案持久化。
- `src/result.jsx`：生产结果展示。

### 3.2 CoreEngine

核心代码位于 `src/engine/`：

- `dag.js`：从需求出发 BFS 构建物品依赖图。
- `graph-utils.js`：Tarjan 算法识别强连通分量（SCC）。
- `unit-cost.js`：展开直接成本，循环组通过矩阵求逆求解。
- `matrix.js`：矩阵运算。
- `proliferator-optimizer.js`：按目标优化各物品的增产/加速方案。
- `index.js`：创建和调用 `CoreEngine`，汇总资源、建筑、电力和占地。

计算流程：

```text
需求
  → BFS 构建依赖图
  → Tarjan SCC 分组
  → 按 SCC 逆拓扑顺序展开成本
  → 循环组矩阵求逆
  → 汇总矿物、配方、建筑、电力和占地
```

依赖图的 DAG 排序主要服务于可视化布局；实际循环计算以 SCC 为边界，不把循环错误地当成普通树结构。

## 4. 种子查询

### 4.1 查询模式

`src/seed_query_mode.js` 保存查询模式，合法值为：

- `browser`：默认模式，使用浏览器 WASM。
- `backend`：使用本地 FastAPI。
- `auto`：优先尝试后端，失败后回退浏览器 WASM。

模式保存于 localStorage 的 `seed-query-mode`。控制台可调用：

```js
setSeedQueryMode('browser')
setSeedQueryMode('backend')
setSeedQueryMode('auto')
resetSeedQueryMode()
```

`src/seed_query_service.js` 是统一适配层，页面不需要知道当前查询来自 WASM 还是后端。

### 4.2 浏览器 WASM 路径

- `src/seed_query_browser.js`：创建并复用 Module Worker，管理请求 ID 和 Promise。
- `src/seed_query_worker.js`：动态加载 `public/search_seed.js` 和 `public/search_seed.wasm`，在 Worker 中调用 C++ 导出函数。
- `src/seed_viewer_binding.js`：把 WASM 的 camelCase 数据转换成页面使用的 snake_case 数据结构。
- `public/search_seed.js`、`public/search_seed.wasm`：公开版实际加载的查询引擎。

Worker 通过页面的 `baseURI` 计算资源根路径，因此支持 GitHub Pages 的项目子路径，而不是把资源固定到域名根目录。

### 4.3 C++ 构建

源代码位于 `dsp_search_seed/cpp_source_code/`，主要入口为 `wasm_api.cpp`。OpenCL 在浏览器构建中由
`wasm_opencl_stub.cpp` 提供 CPU 兼容实现。构建脚本是 `scripts/build_seed_wasm.cjs`：

```bash
set GLM_ROOT=<path-to-glm>
npm run build:wasm
```

脚本只使用 `GLM_ROOT` 和环境中的 `em++`，不依赖开发机上的固定绝对路径。

## 5. 统计系统

### 5.1 前端行为

`src/seed_stats_api.js` 根据查询模式选择数据源：

- `browser`/`auto`：读取 `public/stats.json`，并在前端根据 Welford 的 `M2` 计算 CI95 和相对误差。
- `backend`：请求 `/api/seed-stats/*`，由本地后端返回实时状态和统计结果。

统计控制区默认隐藏。进入种子查看器后可在控制台执行：

```js
setSeedQueryMode('backend')
showStatsControls()
```

`showStatsControls()` 显示开始、停止、恢复等后端统计控制；`hideStatsControls()` 隐藏控制区但不停止正在运行的后端任务。

### 5.2 后端结构

- `backend/main.py`：FastAPI 入口。
- `backend/stats_api.py`：统计 API、子进程生命周期和状态接口。
- `backend/run_stats_calc.py`：独立统计子进程入口。
- `backend/batch_calculator.py`：按种子批量调用 `GetDataManager`。
- `backend/stats_calculator.py`：Welford online algorithm，维护每项的 `count`、`mean`、`M2`。
- `backend/stats_storage.py`：保存和恢复统计状态。
- `dsp_search_seed/CApi/`：项目内置的 Python CApi 和 Windows 运行库。

统计计算按 `batch_size=1` 处理时，每完成一个种子就能提交一次；中途停止不会提交未完成的批次。
星区汇总矿点和矿量是停止计算的依据，单个恒星指标仍计算并展示相对误差，但不决定停止。

统计状态文件位于 `backend/data/seed_stats/`，属于运行时数据，不提交到仓库。公开发布使用的是经过筛选的
`public/stats.json`。

### 5.3 统计量定义

对每个指标维护：

```text
n    样本量
mean 均值
M2   到当前均值的平方离差和
```

样本方差为 `M2 / (n - 1)`，标准误为 `std / sqrt(n)`。当前实现使用 95% 置信度和正态近似：

```text
CI 半宽 = 1.96 × 标准误
相对误差 = CI 半宽 / |均值|
```

星区汇总的相对误差阈值当前为 3%，所有参与停止判断的汇总矿点/矿量指标都达到阈值后才认为收敛。

## 6. 矿物可用量集成

`src/ore_stats_binding.js` 将统计数据或具体种子数据转换成主计算器的 `ore_quantities`：

- 可选择矿量或矿点模式。
- 主页面按恒星数自动应用公开统计均值。
- 种子查看器可选择星区或指定恒星后应用。
- 原油在矿量模式按产速显示，在矿点模式不再进行产速换算。
- 气体、可燃冰和统计距离等已从统计指标中移除。

## 7. 构建和验证

```bash
npm install
npm run build:wasm   # 只有修改 C++ 查询引擎时需要
npm run build        # 生成 GitHub Pages 静态产物
npm run lint
```

Python 统计相关测试位于 `backend/test_*.py`；浏览器查询模式测试位于：

- `src/seed_query_mode.test.js`
- `src/seed_query_service.test.js`

## 8. 版本与变更

版本号位于 `package.json`，构建时由 `vite.config.js` 注入 `VITE_APP_VERSION`。每次发布应同步更新 README 标题和
`CHANGELOG.md`，并通过 GitHub Actions 将 `dist/` 发布到 GitHub Pages。
