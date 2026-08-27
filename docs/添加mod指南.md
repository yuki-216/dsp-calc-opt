# 添加新 Mod 指南

本指南基于"创世之书"（GenesisBook）集成的实践经验整理，说明如何给本项目增加一个新的游戏数据源（mod）。核心结论：**引擎是数据无关的**，只要数据文件格式与原版一致，绝大多数工作集中在数据、图标与注册表。

## 0. 前置认知

- 游戏数据 = 物品表 + 配方表，格式与原版 `data/Vanilla.json` 完全一致：
  - `items`：`{ID, Type, Name, GridIndex, IconName}`（mod 数据可能多出 Enemy 字段，本项目只取这 5 个）
  - `recipes`：`{ID, Type, Factories, Name, Items, ItemCounts, Results, ResultCounts, TimeSpend, Proliferator, IconName}`
- 引擎不区分 mod：`CoreEngine` 只消费 `get_game_data(name)` 的产物，配方类型（含 mod 新 Type）走通用路径，**无需改引擎**。
- 依赖图：`build_dependency_graph` / `projectNeedsOnlyEdges` 用原始 `recipe.原料` 建边，天然不含电力/增产剂边，无需针对 mod 调整。

## 1. 获取与放置数据

1. 从 mod 来源获取数据文件（如 dsp-calc 的 `data/<Mod>.json`），放到 `data/<Mod名>.json`。
2. 确认数据自洽：每个配方引用的物品 ID 都存在于 `items`；`get_game_data` 转换时"缺失物品"应为 0。
   ```bash
   node -e "const d=require('./data/<Mod>.json'); console.log(d.items.length, d.recipes.length)"
   ```
3. （可选）写一个下载脚本放到 `scripts/`，参考 `scripts/download_genesisbook.cjs`（用 GitHub Trees API 一次列文件、raw 下载、去 BOM）。

## 2. 图标

1. 把 mod 新增物品的图标 PNG 放到 `icon/<Mod名>/`（文件名 = 物品 `IconName`）。
2. 共享物品（沿用原版拉丁 IconName，如 `iron-plate`）不需要重复放——`Icon` 组件有**回退链**：
   当前 mod 雪碧图未命中时回退原版 `Vanilla` 雪碧图。
3. 触发雪碧图生成：删除 `icon/<Mod名>.json`（若有）后 `npm run build`，或启动 dev 让
   `get_sprite_plugins` 自动生成；生成 `icon/<Mod名>.png|json` + `public/icon/<Mod名>.png|webp` 后**提交进 git**
   （vite 的 glob 在 dev 启动后不会重扫新增 JSON）。

## 3. 注册数据源

在 `src/game_data.jsx` 的 `GAME_DATA_SOURCES` 注册表添加条目：

```js
export const GAME_DATA_SOURCES = {
    Vanilla:     {name: "Vanilla",     data_file: "Vanilla",     version: "0.10.31.24710", display: "原版"},
    GenesisBook: {name: "GenesisBook", data_file: "GenesisBook", version: "3.0.14",          display: "创世之书"},
    // 新 mod:
    SomeMod:     {name: "SomeMod", data_file: "SomeMod", version: "<版本>", display: "<显示名>"},
};
```

- `name`：数据源标识（`game_name`，用于 scheme 持久化 key）。
- `data_file`：`data/*.json` 的文件名 basename。
- 添加后顶部导航栏的数据源切换下拉会自动出现该选项（Header 遍历 `GAME_DATA_SOURCES`）。

## 4. 生成 allowed_recipes

`data/allowed_recipes_<源名>.json` 记录每个物品的可选配方索引，决定结果表"配方选取"和默认配方。

```bash
npm run generate:recipes:genesisbook   # 或直接:
node scripts/generate_allowed_recipes.cjs <Mod>.json allowed_recipes_<Mod>.json
```

生成脚本会把**无中生有配方（空输入→直接获取）排到前面**——这是关键：若默认配方选到闭环合成配方
（如创世之书氧↔水互需），LP 会无可行解。有"直接获取"优先直接获取可避免。

> ⚠️ **不要**重新生成原版 `allowed_recipes_Vanilla.json`——它含手工调整（硅石默认直接获取、精炼油排除部分配方）。

## 5. 数据源特有逻辑（如有）

在 `get_game_data` 里按 `src.name` 加分支，参考创世之书的两处：

- **增产剂改名/隐藏**：若 mod 只有部分增产剂等级，把不存在的等级 `proliferator_data[i].增产剂` 置 `null`
  （result/settings/依赖图的等级选项按 `增产剂 != null` 自动隐藏）；需要改名时先改克隆后的 items。
- **其他**（mod 特有计算、特殊建筑）在同函数内按 `src.name` 处理。

## 6. 验证

1. **数据转换**：`get_game_data('<Mod>')` 不抛错、`recipe_data` 数量正确、无缺失物品。
2. **引擎计算**：用 `CoreEngine` 计算几个代表性物品（含 mod 新增物品），确认不报"无可行解"。
   若 infeasible：检查默认配方是否选到闭环/断点合成链 → 确认 allowed_recipes 已"无中生有优先"。
3. **UI 切换**：顶部下拉切到 mod → 版本号/方案独立、物品图标正常（共享回退原版、新增用 mod 雪碧图）、
   需求/方案按 mod 的 `game_name` 独立存取。
4. **回归原版**：切回原版一切恢复。

## 7. 收尾

- 提交 `data/`、`icon/<Mod名>/`、`icon/<Mod名>.png|json`、`public/icon/<Mod名>.png|webp`、
  `src/game_data.jsx`、`scripts/`（如新增下载脚本）、package.json scripts。
- 更新 `README.md` 功能特性、`CHANGELOG.md`、版本号（`package.json`/`package-lock.json`）。
- 可更新 `docs/code-analysis.md` 的数据源章节。

## 常见坑位清单

| 坑 | 说明 | 对策 |
|---|---|---|
| **GridIndex 冲突** | 不同版本游戏数据网格不同，mod 物品 GridIndex 可能与原版冲突（如全息信标 2410 被电磁轨道弹射器占用） | 给 mod/新增物品选空闲 GridIndex（`x = GridIndex % 100` 列、`y = /100` 行），避免单独成列 |
| **配方 ID 冲突** | 配方 ID 需唯一 | 用空闲范围（正常配方 1~160，无中生有 11000+），避免与 `Type -1` 冲突 |
| **IconName 映射** | 新增物品 IconName 需与 `icon/<Mod名>/` 内文件名一致 | 检查 `get_game_data` 后 `item_icon_name` 能查到；缺图标会显示"?"占位 |
| **闭环 infeasible** | 默认配方选到闭环合成链 → LP 无可行解 | allowed_recipes 生成"无中生有优先" |
| **增产剂缺失** | mod 无 Mk.I/Mk.II 等 → 图标缺失/按钮残留 | `proliferator_data[i].增产剂 = null`，UI 自动隐藏 |
| **燃料** | mod 新燃料无热值数据，不参与发电计算 | 保持现状（仅作普通物品参与生产链） |
| **雪碧图** | dev 启动后 glob 不重扫新增图标 JSON | 删除旧 json 或 `npm run build` 生成后提交产物 |
| **allowed_recipes 手工调整** | 原版版本含手工调整 | 只生成 mod 版本，勿覆盖原版 |
| **数据源切换清空** | `set_game_data` 清空矿物可用量/原矿化、过滤增殖等级 | 这是预期行为，跨源偏好不保留 |

## 参考实现

- 下载脚本：`scripts/download_genesisbook.cjs`
- 数据源注册与转换：`src/game_data.jsx`（`GAME_DATA_SOURCES` / `get_game_data`）
- 数据源状态与切换：`src/contexts.jsx`（`getInitialSourceName` / `set_game_data`）
- 配方偏好：`scripts/generate_allowed_recipes.cjs` + `src/scheme_data.jsx`（`getAllowedRecipes`）
- 图标回退链：`src/ui_components.jsx`（`Icon` 的 `[mod, 'Vanilla']` 回退）
