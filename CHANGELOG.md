# 更新日志

## 0.9.7 - 2026-08-20

- 自动优化默认仅启用增产剂 Mk.III。
- 无增产剂加权默认值设为 0.5%。
- 同步优化器默认配置和相关文档。

## 0.9.6 - 2026-08-20

- 新增浏览器 WASM 种子查询，公开 GitHub Pages 版本默认无需 Python 后端。
- 保留本地 FastAPI 查询和统计后端，可通过控制台切换 `browser`、`backend` 或 `auto` 模式。
- 统计结果支持从公开 `public/stats.json` 读取；后端统计控制 UI 默认隐藏，可通过 `showStatsControls()` 显示。
- 内置 `dsp_search_seed` C++/Python 查询依赖，消除对项目外部绝对路径的依赖。
- 新增 WASM 构建脚本 `npm run build:wasm`，通过 `GLM_ROOT` 配置 GLM 路径。
- 统计计算使用 Welford online algorithm，维护方差、置信区间和相对误差，并以星区汇总指标判断收敛。
- 种子查看器支持 32–64 恒星数量、矿量/矿点应用，以及选择星区或指定恒星应用资源数据。
- 删除过时的 `docs/deploy.md`，并按当前实现重写 `docs/code-analysis.md`。
