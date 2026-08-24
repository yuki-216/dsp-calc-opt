# 核心计算引擎 LP 重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用整网 LP(HiGHS WASM)替换矩阵求逆+逆生产范式,根治循环组联产物归因错误。

**Architecture:** dag.js 改为产出二部图(配方节点+物品节点,含增产修正系数);新 lp-model.js 构模(变量=配方执行次数、约束=物品守恒不等式、目标=min Σx)、lp-solver.js 封装 highs 单例;index.js 重写为 构模→求解→映射,删除 unit-cost.js/matrix.js/虚拟解/过滤迭代;calculate 变 async;优化器自算 tarjanSCC;电力合一;去 vite legacy;依赖图浅层化。

**Tech Stack:** React 19 + Vite 8(纯前端 PWA)、`highs` npm 包(WASM LP 求解器)、node:test 测试。

## Global Constraints

- 规格文档:`docs/superpowers/specs/2026-08-24-lp-core-engine-redesign.md`,本计划所有细节以它为准
- `calculate()` 出参形状冻结:`{resourceUsage, surplusByproducts, recipeExecutions, buildingDetails, buildingList, selfConsumption, byproductSources, energyCost, minerEnergyCost, totalEnergyCost, footprintDetails, totalFootprint}`(energyCost/minerEnergyCost 合并后两者相等,totalEnergyCost 同值)
- 引号必须用 `'` 和 `"`,禁止 `'` `'`;字符串内容用英文引号包裹
- 提交信息格式沿用仓库惯例:`feat:`/`fix:`/`refactor:`/`docs:` 前缀;仅本地提交不推远程
- 测试命令:`npm test`(node --test "tests/**/*.test.js");lint:`npx eslint . --max-warnings 0`
- 数值容差统一 1e-6;LP 求解容差用 HiGHS 默认
- 每个任务完成即提交,保持可回滚

---

### Task 1: 安装 highs 并封装 lp-solver.js

**Files:**
- Modify: `package.json`(npm install 自动改)
- Create: `src/engine/lp-solver.js`
- Test: `tests/engine/lp-solver.test.js`

**Interfaces:**
- Produces:
  - `getHighs(): Promise<HighsInstance>` — 单例 Promise,重复调用返回同一实例
  - `async solveLP(model): {x: Object<string, number>, status: string, objective: number}` — model 形如 `{variables: [{name}], objective: {coeffs: {varName: number}}, constraints: [{name, coeffs: {varName: number}, sense: '>='|'<=', rhs: number}]}`,status 为 `'Optimal'|'Infeasible'|'Unbounded'|'Error'`

- [ ] **Step 1: 安装依赖**

Run: `npm install highs`
Expected: package.json dependencies 出现 `"highs": "^1.x"`,`node_modules/highs/build/highs.wasm` 存在

- [ ] **Step 2: 写失败测试**

```js
// tests/engine/lp-solver.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import {solveLP} from '../../src/engine/lp-solver.js';

test('求解简单 LP: min x+y s.t. x+y>=10 → x+y=10', async () => {
    const model = {
        variables: [{name: 'x'}, {name: 'y'}],
        objective: {coeffs: {x: 1, y: 1}},
        constraints: [
            {name: 'demand', coeffs: {x: 1, y: 1}, sense: '>=', rhs: 10},
        ],
    };
    const result = await solveLP(model);
    assert.equal(result.status, 'Optimal');
    assert.ok(Math.abs(result.objective - 10) < 1e-6);
});

test('联产欠定场景: min Σx 时选副产品抵消', async () => {
    // 配方A: 跑一次产 2 个 a 和 4 个 b;配方B: 跑一次耗 3 个 b 产 1 个 c
    // 需求: a=2, c=1 → 最优 xA=1(副产 b=4 抵消 B 的消耗), xB=1, 目标=2
    const model = {
        variables: [{name: 'xA'}, {name: 'xB'}],
        objective: {coeffs: {xA: 1, xB: 1}},
        constraints: [
            {name: 'a', coeffs: {xA: 2}, sense: '>=', rhs: 2},
            {name: 'b', coeffs: {xA: 4, xB: -3}, sense: '>=', rhs: 0},
            {name: 'c', coeffs: {xB: 1}, sense: '>=', rhs: 1},
        ],
    };
    const result = await solveLP(model);
    assert.equal(result.status, 'Optimal');
    assert.ok(Math.abs(result.x.xA - 1) < 1e-6);
    assert.ok(Math.abs(result.x.xB - 1) < 1e-6);
    assert.ok(Math.abs(result.objective - 2) < 1e-6);
});

test('不可行模型返回 Infeasible 且无解', async () => {
    const model = {
        variables: [{name: 'x'}],
        objective: {coeffs: {x: 1}},
        constraints: [
            {name: 'c1', coeffs: {x: 1}, sense: '>=', rhs: 5},
            {name: 'c2', coeffs: {x: 1}, sense: '<=', rhs: 1},
        ],
    };
    const result = await solveLP(model);
    assert.equal(result.status, 'Infeasible');
});
```

注意:测试通过 `node --test` 运行,highs 在 Node 下自动定位 wasm,无需 locateFile。

- [ ] **Step 3: 运行确认失败**

Run: `npm test 2>&1 | Select-String "lp-solver"`(PowerShell)或 `npm test | grep lp-solver`
Expected: FAIL,模块不存在或导入错误

- [ ] **Step 4: 实现 lp-solver.js**

```js
// src/engine/lp-solver.js
/**
 * LP 求解器封装(hiGHS WASM)
 * 职责:单例加载 HiGHS;结构化模型 ↔ CPLEX LP 文本转换;解析求解结果
 */

import loadHighs from 'highs';

let highsPromise = null;

/**
 * 获取 HiGHS 实例(应用生命周期内只初始化一次)
 * @returns {Promise<Object>} HiGHS 实例
 */
export function getHighs() {
    if (!highsPromise) {
        highsPromise = loadHighs();
    }
    return highsPromise;
}

const SENSE_MAP = {'>=': '>=', '<=': '<='};

function serializeToLpText(model) {
    const lines = [];
    lines.push('Minimize');
    const objTerms = model.variables
        .map(v => ({name: v.name, c: model.objective.coeffs[v.name] || 0}))
        .filter(t => t.c !== 0);
    if (objTerms.length === 0) {
        lines.push(' obj: 0 ' + model.variables.map(v => `+ 0 ${v.name}`).join(' '));
    } else {
        lines.push(' obj: ' + objTerms.map((t, i) => `${i === 0 ? '' : '+ '}${t.c} ${t.name}`).join(' '));
    }

    lines.push('Subject To');
    for (const con of model.constraints) {
        const terms = [];
        let first = true;
        for (const v of model.variables) {
            const c = con.coeffs[v.name];
            if (!c) continue;
            terms.push(`${first ? (c < 0 ? '-' : '') : (c < 0 ? '- ' : '+ ')}${Math.abs(c)} ${v.name}`);
            first = false;
        }
        if (terms.length === 0) terms.push(`0 ${model.variables[0]?.name ?? '_zero'}`);
        lines.push(` ${con.name}: ${terms.join(' ')} ${SENSE_MAP[con.sense] ?? '>='} ${con.rhs}`);
    }

    lines.push('Bounds');
    for (const v of model.variables) {
        lines.push(` ${v.name} >= 0`);
    }
    lines.push('End');
    return lines.join('\n');
}

/**
 * 求解 LP 模型
 * @param {Object} model - {variables:[{name}], objective:{coeffs}, constraints:[{name, coeffs, sense, rhs}]}
 * @returns {Promise<{x: Object, status: string, objective: number}>}
 */
export async function solveLP(model) {
    const highs = await getHighs();
    const lpText = serializeToLpText(model);
    const result = highs.solve(lpText, {output_flag: false});

    const statusMap = {
        'Optimal': 'Optimal',
        'Infeasible': 'Infeasible',
        'Unbounded': 'Unbounded',
    };
    const status = statusMap[result.Status] ?? 'Error';

    const x = {};
    if (status === 'Optimal') {
        for (const v of model.variables) {
            x[v.name] = result.Columns?.[v.name]?.Primal ?? 0;
            if (!Number.isFinite(x[v.name])) {
                throw new Error(`LP 解含非有限值: ${v.name}=${x[v.name]}`);
            }
        }
    }
    return {x, status, objective: Number(result.ObjectiveValue) || 0};
}
```

注意:HiGHS 的 LP 文本变量名不能与关键字冲突,构模层(Task 2)保证传入的名称安全(中文物品名 HiGHS 支持,若实测报错则在序列化时做 `v{i}` 别名映射——此为唯一允许的偏差点,需在 Task 2 的集成测试中验证)。

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test`
Expected: 全部 PASS(含既有测试)

- [ ] **Step 6: 提交**

```bash
git add src/engine/lp-solver.js tests/engine/lp-solver.test.js package.json package-lock.json
git commit -m "feat: 新增 highs LP 求解器封装(lp-solver.js)"
```

---

### Task 2: dag.js 改造——二部图构建(buildRecipeGraph)

**Files:**
- Create: `src/engine/bipartite-graph.js`
- Modify: `src/engine/dag.js`(保留 buildItemGraph 导出供过渡,新增逻辑放新文件;旧函数在 Task 4 结束时删除)
- Test: `tests/engine/bipartite-graph.test.js`

**Interfaces:**
- Consumes: `buildItemRecipeIndex(recipe_data)`(game_data.jsx 现有导出)、`ApplyBuildingMultiplier(output_num, building_name, item, settings)`(game_data.jsx)
- Produces:
  ```js
  /**
   * buildRecipeGraph(needs, recipes, gameData, schemeData, settings, sprayCosts, options?)
   * options: {excludeMinerPower: boolean} — 不计挖矿电开关
   * 返回:
   * {
   *   recipes: Map<recipeKey, {
   *     recipeId: string,          // 配方索引字符串
   *     outputs: Object,           // 增产修正后产物表 {item: qtyPerRun}
   *     inputs: Object,            // 增产修正后原料表(含增产剂投入){item: qtyPerRun}
   *     buildingPower: {factoryName, singleExecBuildNumber, unitPowerCost, basePower, isMiner}|null,
   *     mainItem: string,          // 主产物(产物表第一个键,recipeExecutions 键口径)
   *     proliferatorInfo: {level, mode},
   *   }>,
   *   items: Set<string>,          // 图中出现的全部物品
   *   demandByItem: Object,        // {item: D_j}(需求表)
   *   noRecipeItems: Set<string>,  // 无配方物品(原矿类,约束 RHS 来源)
   *   edges: Array<{from, to}>,    // 物品投影边 {产物→原料}(兼容依赖图页现有消费)
   *   proliferatorEdgeKeys: Set<string>, // 因增产剂加入的边 key '产物->原料'
   *   recipeOfItem: Map<item, recipeKey>, // 物品主配方(仅用于优化器 SCC 分组与 UI)
   * }
   */
  ```

- [ ] **Step 1: 写失败测试**

```js
// tests/engine/bipartite-graph.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import {buildRecipeGraph} from '../../src/engine/bipartite-graph.js';

// 极简游戏数据:配方1 铁矿→铁块×1;配方2 铁块+电力→齿轮×1(耗电0.5/台,制造台倍率1);
// 配方100 燃料→电力×10(isFuelRecipe)
function makeGameData() {
    return {
        recipe_data: [
            {_id: 0, 原料: {铁矿: 1}, 产物: {铁块: 1}, 设施: 0, 时间: 2, Type: 0, 增产: 0},
            {_id: 1, 原料: {铁块: 1}, 产物: {齿轮: 1}, 设施: 0, 时间: 1, Type: 0, 增产: 0},
            {_id: 2, Type: 3, 原料: {燃料: 1}, 产物: {电力: 10}, 设施: 5, 时间: 1, isFuelRecipe: true, fuelName: '燃料', 增产: 0},
        ],
        factory_data: {
            '0': [{'名称': '制造台', '倍率': 1, '耗能': 6}],
            '5': [{'名称': '火力发电厂', '倍率': 1, '耗能': 0, '发电功率': 100}],
        },
        proliferator_data: [],
        proliferator_effect: [],
    };
}

function makeScheme() {
    return {
        item_recipe_choices: {},
        scheme_for_recipe: [
            {'建筑': 0, '增产剂等级': 0, '增产模式': 0},
            {'建筑': 0, '增产剂等级': 0, '增产模式': 0},
            {'建筑': 0, '增产剂等级': 0, '增产模式': 0},
        ],
        selected_fuel: null,
    };
}

const SETTINGS = {is_time_unit_minute: true};

test('BFS 可达性:需求齿轮展开出 齿轮配方+铁块配方,不含无关配方', () => {
    const graph = buildRecipeGraph(
        [{id: '齿轮', name: '齿轮', count: 10}],
        makeGameData().recipe_data, makeGameData(), makeScheme(), SETTINGS, null
    );
    assert.equal(graph.recipes.size, 2);
    assert.ok(graph.recipes.has('0'));
    assert.ok(graph.recipes.has('1'));
    assert.ok(graph.noRecipeItems.has('铁矿'));
    assert.equal(graph.demandByItem['齿轮'], 10);
});

test('配方系数直译:outputs/inputs 为原始比例,无归一化', () => {
    const gd = makeGameData();
    gd.recipe_data[1] = {...gd.recipe_data[1], 原料: {铁块: 2}, 产物: {齿轮: 3}};
    const graph = buildRecipeGraph(
        [{id: '齿轮', name: '齿轮', count: 1}],
        gd.recipe_data, gd, makeScheme(), SETTINGS, null
    );
    const r = graph.recipes.get('1');
    assert.equal(r.inputs['铁块'], 2);
    assert.equal(r.outputs['齿轮'], 3);
    assert.equal(r.mainItem, '齿轮');
});

test('设备功耗进入原料边:齿轮配方的 inputs 含电力(耗能/60/产出率)', () => {
    const graph = buildRecipeGraph(
        [{id: '齿轮', name: '齿轮', count: 1}],
        makeGameData().recipe_data, makeGameData(), makeScheme(), SETTINGS, null
    );
    const r = graph.recipes.get('1');
    // 制造台耗能6MW,singleExecBuildNumber = 1/60/(1/1)/1 = 1/60,unitPowerCost=6/60=0.1 MW·min
    // 电力作为原料边写入 inputs['电力']
    assert.ok(r.inputs['电力'] > 0);
    assert.equal(r.buildingPower.unitPowerCost, r.inputs['电力']);
});

test('不计挖矿电:isMiner 配方电力输入置0,普通配方不受影响', () => {
    const gd = makeGameData();
    // 加一个采矿机配方(设施名含"采矿机")
    gd.factory_data['9'] = [{'名称': '采矿机', '倍率': 1, '耗能': 4}];
    gd.recipe_data.push({_id: 3, 原料: {}, 产物: {铁矿: 1}, 设施: 9, 时间: 1, Type: 0, 增产: 0, 可采集: true});
    const scheme = makeScheme();
    const graph = buildRecipeGraph(
        [{id: '铁块', name: '铁块', count: 1}],
        gd.recipe_data, gd, scheme, SETTINGS, null, {excludeMinerPower: true}
    );
    const minerR = graph.recipes.get('3');
    assert.equal(minerR.buildingPower.isMiner, true);
    assert.ok(!minerR.inputs['电力']);
    const ironR = graph.recipes.get('0');
    assert.ok(ironR.inputs['电力'] > 0);
});

test('增产模式:产出乘增产效果,增产剂按喷涂成本进原料', () => {
    const gd = makeGameData();
    gd.proliferator_data = [{'增产剂': '增产剂 Mk.I'}, {'增产剂': '增产剂 Mk.II'}, {'增产剂': '增产剂 Mk.III'}, {'增产剂': '增产剂 Mk.III'}];
    gd.proliferator_effect = [null,
        {'增产效果': 1.125, '加速效果': 1.25, '耗电倍率': 1.3},
        {'增产效果': 1.25, '加速效果': 1.5, '耗电倍率': 1.6},
        {'增产效果': 1.375, '加速效果': 1.75, '耗电倍率': 1.9}];
    const scheme = makeScheme();
    scheme.scheme_for_recipe[1] = {'建筑': 0, '增产剂等级': 3, '增产模式': 2};
    const sprayCosts = [null, 1 / 12, 1 / 24, 1 / 60];
    const graph = buildRecipeGraph(
        [{id: '齿轮', name: '齿轮', count: 1}],
        gd.recipe_data, gd, scheme, SETTINGS, sprayCosts
    );
    const r = graph.recipes.get('1');
    // 产出 1×1.375=1.375;原料 铁块1 + 增产剂 1×(1/60)=0.016667
    assert.ok(Math.abs(r.outputs['齿轮'] - 1.375) < 1e-9);
    assert.ok(Math.abs(r.inputs['增产剂 Mk.III'] - 1 / 60) < 1e-9);
});

test('燃料配方:电力物品由选定燃料配方生产', () => {
    const gd = makeGameData();
    const scheme = makeScheme();
    scheme.selected_fuel = '燃料';
    const graph = buildRecipeGraph(
        [{id: '齿轮', name: '齿轮', count: 1}],
        gd.recipe_data, gd, scheme, SETTINGS, null
    );
    const fuelR = [...graph.recipes.values()].find(r => r.recipeId === '2');
    assert.ok(fuelR);
    assert.equal(fuelR.outputs['电力'], 10);
    // 电力不是 noRecipeItem(有发电配方)
    assert.ok(!graph.noRecipeItems.has('电力'));
});

test('edges 投影:产物→原料物品边生成,增产剂边有标记', () => {
    const gd = makeGameData();
    gd.proliferator_data = [{'增产剂': '增产剂 Mk.I'}, {'增产剂': '增产剂 Mk.II'}, {'增产剂': '增产剂 Mk.III'}, {'增产剂': '增产剂 Mk.III'}];
    gd.proliferator_effect = [null,
        {'增产效果': 1.125, '加速效果': 1.25, '耗电倍率': 1.3},
        {'增产效果': 1.25, '加速效果': 1.5, '耗电倍率': 1.6},
        {'增产效果': 1.375, '加速效果': 1.75, '耗电倍率': 1.9}];
    const scheme = makeScheme();
    scheme.scheme_for_recipe[1] = {'建筑': 0, '增产剂等级': 3, '增产模式': 2};
    const graph = buildRecipeGraph(
        [{id: '齿轮', name: '齿轮', count: 1}],
        gd.recipe_data, gd, scheme, SETTINGS, [null, 1 / 12, 1 / 24, 1 / 60]
    );
    const edgeKeys = graph.edges.map(e => `${e.from}->${e.to}`);
    assert.ok(edgeKeys.includes('齿轮->铁块'));
    assert.ok(edgeKeys.includes('铁块->铁矿'));
    assert.ok(graph.proliferatorEdgeKeys.has('齿轮->增产剂 Mk.III'));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: bipartite-graph 相关 FAIL(模块不存在)

- [ ] **Step 3: 实现 bipartite-graph.js**

核心逻辑从现 `dag.js` 的 buildItemGraph 移植改造(增产剂修正、buildingPower 计算、大型采矿机/分馏塔特殊处理、电力特殊处理全部保留),关键差异:

```js
// src/engine/bipartite-graph.js
/**
 * 二部图构建模块
 * 职责:BFS 可达性 + 配方节点的增产修正系数(原始比例,无归一化)+ 设备信息
 * 供 LP 构模(lp-model.js)与优化器 SCC 分组消费
 */

import {ApplyBuildingMultiplier} from '../game_data.jsx';

/**
 * @param {Array} needs - [{id, name, count}]
 * @param {Array} recipes - recipe_data
 * @param {Object} gameData
 * @param {Object} schemeData - {item_recipe_choices, scheme_for_recipe, selected_fuel}
 * @param {Object} settings
 * @param {Array|null} sprayCosts - 增产剂喷涂成本 [null, cost1, cost2, cost3]
 * @param {Object} options - {excludeMinerPower: boolean}
 */
export function buildRecipeGraph(needs, recipes, gameData, schemeData, settings = {}, sprayCosts = null, options = {}) {
    const excludeMinerPower = !!options.excludeMinerPower;
    const recipesOut = new Map();
    const items = new Set();
    const noRecipeItems = new Set();
    const demandByItem = {};
    const edges = [];
    const edgeSet = new Set();
    const proliferatorEdgeKeys = new Set();
    const recipeOfItem = new Map();

    const addEdge = (from, to, isProliferator) => {
        const key = `${from}->${to}`;
        if (edgeSet.has(key)) return;
        edgeSet.add(key);
        edges.push({from, to});
        if (isProliferator) proliferatorEdgeKeys.add(key);
    };

    // BFS 从需求出发:队列元素为物品名
    const queue = [];
    const enqueued = new Set();
    for (const need of needs) {
        demandByItem[need.id] = need.count;
        items.add(need.id);
        if (!enqueued.has(need.id)) { enqueued.add(need.id); queue.push(need.id); }
    }

    // 电力特殊处理:选定燃料时找到燃料配方索引
    const findFuelRecipeIndex = () => {
        const fuel = schemeData?.selected_fuel;
        if (!fuel || fuel === '无') return -1;
        for (let i = 0; i < recipes.length; i++) {
            if (recipes[i]?.isFuelRecipe && recipes[i]?.fuelName === fuel) return i;
        }
        return -1;
    };

    // 单配方入图(移植 dag.js:127-305 的修正逻辑,见下方"完整实现要点"第2条)
    const addRecipe = (recipeIndex, forItemId) => { /* 完整实现见下方要点 */ };

    while (queue.length > 0) {
        const itemId = queue.shift();

        const mineralizeList = settings.mineralize_list || {};
        if (itemId in mineralizeList) { noRecipeItems.add(itemId); continue; }

        if (itemId === '电力') {
            const fuelIdx = findFuelRecipeIndex();
            if (fuelIdx === -1) { noRecipeItems.add(itemId); continue; }
            addRecipe(fuelIdx, itemId);
            continue;
        }

        const choiceIndex = schemeData?.item_recipe_choices?.[itemId] ?? 1;
        const recipeIndex = itemData[itemId]?.[choiceIndex];
        if (recipeIndex === undefined || recipeIndex === null || !recipes[recipeIndex]) {
            noRecipeItems.add(itemId);
            continue;
        }
        addRecipe(recipeIndex, itemId);
    }
```

完整实现要点(实现者据此写出全部代码,不得省略):

0. 函数开头 `const itemData = buildItemRecipeIndex(recipes);`(从 `../game_data.jsx` 导入);
1. `noRecipeItems` 最终口径:BFS 中显式加入的项 ∪ 收尾时 `items` 中不在 `recipeOfItem` 的项:
   ```js
   for (const it of items) if (!recipeOfItem.has(it)) noRecipeItems.add(it);
   ```
2. `addRecipe(recipeIndex, forItemId)` 内部:
   - `recipeKey = String(recipeIndex)`;若 `recipesOut.has(recipeKey)` 已存在则跳过(同一配方只入图一次——联产物共享);
   - 读 `scheme_for_recipe[recipeIndex]` 得增产模式/等级;`modifiedInputs` 从 `recipe.原料` 展开;增产模式下 push 增产剂 `{id: proItemName, count: proAmount}`(sprayCost 回退默认 `[null, 1/12, 1/24, 1/60]`);`proMode===2` 时 `outputMultiplier = proEffect['增产效果']`;
   - `outputs[r][k] = 原始产物[k] × outputMultiplier`(全部产物,含联产物);
   - `inputs[r][k] = modifiedInputs[k].count`(原始数量,无归一化);
   - buildingPower 计算:移植 dag.js:181-276(Type=-2 特判、factory_data 查找、singleExecBuildNumber 公式 `1/timeTick/outputRate/factorySpeed` 其中 `outputRate = netOutputAdjusted/时间`、大型采矿机/分馏塔特殊处理、增产剂耗电倍率)。**注意**:这里 netOutput 计算保留现状(总产出×增产倍率−自身消耗,再乘 ApplyBuildingMultiplier),因为设备数公式语义不变;
   - **电力作为原料边**:`if (buildingPower?.unitPowerCost > 0 && !(excludeMinerPower && buildingPower.isMiner)) { inputs[r]['电力'] += buildingPower.unitPowerCost; }`——这是电力合一的核心:不再写 `$__factory_power__`,直接进守恒方程;
   - `mainItem`:优先 `forItemId`(BFS 进入原因),否则产物表第一个键;`recipeOfItem.set(mainItem, recipeKey)`;
   - 边生成:对 inputs 中每个正系数物品 k:`addEdge(mainItem→k, k 是增产剂)`;同时 `items.add(k)`,k 未入队且无配方记录时入队继续追溯;
   - 对 outputs 中其他产物(联产物):`items.add(coItem)`,不建边不入队(联产物天然被守恒方程覆盖);
   - **重要修正**(相对 dag.js 现状):联产物如果也是别的配方的产物(如氢既是精炼配方联产物又有独立配方),BFS 只在"氢作为需求/原料被追溯到"时才把它的独立配方加进来;联产物身份不阻止这一点。
3. BFS 结束后按要点第 1 条收尾 `noRecipeItems`;
4. 返回结构见 Interfaces。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 5: lint + 提交**

Run: `npx eslint src/engine/bipartite-graph.js tests/engine/bipartite-graph.test.js --max-warnings 0`
Expected: 无错误

```bash
git add src/engine/bipartite-graph.js tests/engine/bipartite-graph.test.js
git commit -m "feat: 二部图构建模块(配方节点+物品节点,替代 directCost)"
```

---

### Task 3: lp-model.js——LP 构模

**Files:**
- Create: `src/engine/lp-model.js`
- Test: `tests/engine/lp-model.test.js`

**Interfaces:**
- Consumes: Task 2 的 `buildRecipeGraph` 返回结构
- Produces:
  ```js
  /**
   * buildLPModel(graph) → {
   *   model,              // 直传 solveLP 的结构化模型
   *   varToRecipe: Map<varName, recipeKey>,
   * }
   * 变量名 = recipeKey(字符串配方索引);约束名 = 'con_' + itemId
   */
  ```

- [ ] **Step 1: 写失败测试**

```js
// tests/engine/lp-model.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import {buildLPModel} from '../../src/engine/lp-model.js';
import {buildRecipeGraph} from '../../src/engine/bipartite-graph.js';

// 复用 Task 2 的极简数据(复制 makeGameData/makeScheme,略——实现时直接从
// tests/engine/bipartite-graph.test.js 复制这两个工厂函数到本文件)

test('构模:每个入选配方一个变量,目标系数全为1', () => {
    const graph = buildRecipeGraph(
        [{id: '齿轮', name: '齿轮', count: 10}],
        makeGameData().recipe_data, makeGameData(), makeScheme(), {is_time_unit_minute: true}, null
    );
    const {model, varToRecipe} = buildLPModel(graph);
    assert.deepEqual(model.variables.map(v => v.name).sort(), ['0', '1'].sort());
    for (const v of model.variables) assert.equal(model.objective.coeffs[v.name], 1);
    assert.equal(varToRecipe.get('0'), '0');
});

test('守恒约束:齿轮行 = 产出1×x1 − 消耗1×x1? 不对——齿轮行是 x1≥10, 铁块行是 x0 − x1 ≥ 0', () => {
    const graph = buildRecipeGraph(
        [{id: '齿轮', name: '齿轮', count: 10}],
        makeGameData().recipe_data, makeGameData(), makeScheme(), {is_time_unit_minute: true}, null
    );
    const {model} = buildLPModel(graph);
    const gearCon = model.constraints.find(c => c.name === 'con_齿轮');
    assert.deepEqual(gearCon.coeffs, {'1': 1});       // 齿轮配方产齿轮
    assert.equal(gearCon.sense, '>=');
    assert.equal(gearCon.rhs, 10);
    const ironCon = model.constraints.find(c => c.name === 'con_铁块');
    assert.deepEqual(ironCon.coeffs, {'0': 1, '1': -1}); // 铁块配方产,齿轮配方耗
    assert.equal(ironCon.rhs, 0);
    const oreCon = model.constraints.find(c => c.name === 'con_铁矿');
    assert.deepEqual(oreCon.coeffs, {'0': -1});        // 只有消耗
    assert.equal(oreCon.rhs, 0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: 实现 lp-model.js**

```js
// src/engine/lp-model.js
/**
 * LP 构模层
 * 职责:二部图 → 结构化 LP 模型(变量=配方执行次数;约束=物品守恒 ≥;目标=min Σx)
 */

export function buildLPModel(graph) {
    const variables = [];
    const objectiveCoeffs = {};
    const varToRecipe = new Map();

    for (const [recipeKey, r] of graph.recipes) {
        variables.push({name: recipeKey});
        objectiveCoeffs[recipeKey] = 1;
        varToRecipe.set(recipeKey, recipeKey);
    }

    // 每物品一条守恒行
    const conRows = new Map(); // itemId -> {coeffs: Map<varName, coeff>}
    const ensureRow = (itemId) => {
        if (!conRows.has(itemId)) conRows.set(itemId, {coeffs: new Map()});
        return conRows.get(itemId);
    };

    for (const [recipeKey, r] of graph.recipes) {
        for (const [item, qty] of Object.entries(r.outputs)) {
            if (!qty) continue;
            const row = ensureRow(item);
            row.coeffs.set(recipeKey, (row.coeffs.get(recipeKey) || 0) + qty);
        }
        for (const [item, qty] of Object.entries(r.inputs)) {
            if (!qty) continue;
            const row = ensureRow(item);
            row.coeffs.set(recipeKey, (row.coeffs.get(recipeKey) || 0) - qty);
        }
    }

    const constraints = [];
    const allItems = new Set([...graph.items]);
    for (const item of allItems) {
        const row = ensureRow(item); // 无流量物品也建空行(RHS=需求,触发不可行诊断)
        const coeffs = {};
        for (const [v, c] of row.coeffs) {
            if (c) coeffs[v] = c;
        }
        constraints.push({
            name: `con_${item}`,
            coeffs,
            sense: '>=',
            rhs: graph.demandByItem[item] || 0,
        });
    }

    return {
        model: {variables, objective: {coeffs: objectiveCoeffs}, constraints},
        varToRecipe,
    };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/engine/lp-model.js tests/engine/lp-model.test.js
git commit -m "feat: LP 构模层(配方变量+物品守恒约束+min Σx)"
```

---

### Task 4: index.js 重写——calculate 变 async,删旧范式

**Files:**
- Modify: `src/engine/index.js`(整体重写 calculate,保留 getRecipeById)
- Delete: `src/engine/unit-cost.js`、`src/engine/matrix.js`
- Modify: `src/engine/dag.js`(删除 buildItemGraph/tarjanSCC 导出及 ItemNode——本任务后 dag.js 若无剩余内容则整文件删除)
- Test: `tests/engine/calculate-lp.test.js`(新建);运行 repro 脚本验收

**Interfaces:**
- Consumes: Task 1 `solveLP`、Task 2 `buildRecipeGraph`、Task 3 `buildLPModel`、`getPowerDeviceCount`(power-device-count.js 现有)
- Produces:
  ```js
  class CoreEngine {
    // 签名变化:async!initialFilterList/measurementMode 保留为 no-op 兼容位
    async calculate(needs, recipes, initialFilterList = new Set(), measurementMode = false, onLog = null)
    // 返回对象字段(规格 §Global Constraints 冻结清单):
    // resourceUsage/surplusByproducts/recipeExecutions/buildingDetails/buildingList/
    // selfConsumption/byproductSources/energyCost/minerEnergyCost/totalEnergyCost/
    // footprintDetails/totalFootprint
    // 新增:graph(二部图), edges, proliferatorEdgeKeys(供 contexts.jsx 传给依赖图页)
    // 移除:sccs
  }
  ```

- [ ] **Step 1: 写失败测试(小型端到端)**

```js
// tests/engine/calculate-lp.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import {CoreEngine} from '../../src/engine/index.js';
// makeGameData/makeScheme 复制自 bipartite-graph.test.js(含燃料配方)

test('端到端:需求齿轮×10 → 铁矿缺口/执行次数/电力聚合', async () => {
    const gd = makeGameData();
    const scheme = makeScheme();
    scheme.selected_fuel = '燃料';
    const engine = new CoreEngine(gd, scheme, {is_time_unit_minute: true}, null);
    const result = await engine.calculate([{id: '齿轮', name: '齿轮', count: 10}], gd.recipe_data);

    assert.equal(result.recipeExecutions['齿轮'], 10);
    assert.equal(result.resourceUsage['铁矿'], 10);
    // 电力:齿轮10次×0.1MW·min + 发电配方执行(电力消耗/每次10)= 总电力;发电次数=总电力/10
    const totalPower = result.totalEnergyCost;
    assert.ok(totalPower > 0);
    assert.ok(Math.abs(result.recipeExecutions['电力'] - totalPower / 10) < 1e-6);
    assert.ok(!result.surplusByproducts['齿轮']);
});

test('端到端:联产物抵消——多余副产品进 surplusByproducts(正值)', async () => {
    const gd = makeGameData();
    // 加联产配方:原油→氢×1+精炼油×2;配方:氢×2→水×1(虚构但线性)
    gd.recipe_data.push({_id: 3, 原料: {原油: 1}, 产物: {氢: 1, 精炼油: 2}, 设施: 0, 时间: 1, Type: 0, 增产: 0});
    gd.recipe_data.push({_id: 4, 原料: {氢: 2}, 产物: {水: 1}, 设施: 0, 时间: 1, Type: 0, 增产: 0});
    const scheme = makeScheme();
    // 需求 水×10 → 氢20 → 跑联产20次 → 精炼油40全多余
    const engine = new CoreEngine(gd, scheme, {is_time_unit_minute: true}, null);
    const result = await engine.calculate([
        {id: '水', name: '水', count: 10},
    ], gd.recipe_data);
    assert.ok(Math.abs(result.surplusByproducts['精炼油'] - 40) < 1e-6);
    assert.ok(Math.abs(result.resourceUsage['原油'] - 20) < 1e-6);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL(calculate 非 async 或模块缺失)

- [ ] **Step 3: 重写 index.js**

```js
// src/engine/index.js
/**
 * 核心计算引擎主入口(LP 方案)
 * 职责:二部图构建 → LP 构模 → HiGHS 求解 → 结果映射
 */

import {buildRecipeGraph} from './bipartite-graph.js';
import {buildLPModel} from './lp-model.js';
import {solveLP} from './lp-solver.js';
import {getPowerDeviceCount} from '../power-device-count.js';

export class CoreEngine {
  static VERSION = 'lp-v1';

  constructor(gameData, schemeData, settings = {}, sprayCosts = null) {
    this.gameData = gameData;
    this.schemeData = schemeData;
    this.settings = settings;
    this.sprayCosts = sprayCosts;
  }

  getRecipeById(recipeId) {
    return this.gameData?.recipe_data?.[Number(recipeId)];
  }

  /**
   * 主计算(LP 方案)
   * @param {Array} needs - [{id, name, count}]
   * @param {Array} recipes - recipe_data
   * @param {Set} initialFilterList - 向后兼容位(忽略)
   * @param {boolean} measurementMode - 向后兼容位(忽略)
   * @param {Function|null} onLog - 日志回调
   * @returns {Object} 聚合结果(字段清单见规格)
   */
  async calculate(needs, recipes, initialFilterList = new Set(), measurementMode = false, onLog = null) {
    const excludeMinerPower = !!this.settings.exclude_miner_power;

    // 1. 二部图
    this.graph = buildRecipeGraph(needs, recipes, this.gameData, this.schemeData, this.settings, this.sprayCosts, {excludeMinerPower});
    this.edges = this.graph.edges;
    this.proliferatorEdgeKeys = this.graph.proliferatorEdgeKeys;

    // 2. 构模 + 求解
    const {model, varToRecipe} = buildLPModel(this.graph);
    const lpResult = await solveLP(model);

    if (lpResult.status === 'Infeasible') {
      // 诊断:找没有任何产出配方的需求物品
      const orphanNeeds = [];
      for (const need of needs) {
        const hasSource = [...this.graph.recipes.values()].some(r => r.outputs[need.id]);
        if (!hasSource) {
          orphanNeeds.push(this.graph.noRecipeItems.has(need.id)
            ? `${need.id}(视为原矿,无外部来源)`
            : `${need.id}(无生产链可达)`);
        }
      }
      throw new Error(`无可行解:以下物品无法获得:${orphanNeeds.join(', ') || '(未知)'}`);
    }
    if (lpResult.status !== 'Optimal') {
      throw new Error(`LP 求解失败:${lpResult.status}`);
    }

    // 3. 结果映射
    const recipeExecutions = {};
    const surplusByproducts = {};
    const resourceUsage = {};
    const execByRecipe = new Map(); // recipeKey -> x

    for (const [varName, xVal] of Object.entries(lpResult.x)) {
      const recipeKey = varToRecipe.get(varName);
      const r = this.graph.recipes.get(recipeKey);
      if (!r) continue;
      execByRecipe.set(recipeKey, xVal);
      const eps = 1e-9;
      if (xVal <= eps) continue;
      const key = r.mainItem;
      recipeExecutions[key] = (recipeExecutions[key] || 0) + xVal;
    }

    // 松弛量:用解代入守恒行重算(lhs − rhs),避免依赖求解器对偶值
    // surplus > 0 且物品有产出配方 → surplusByproducts(正值=多余量)
    // surplus < 0 且物品无配方 → resourceUsage 正值(外部获取缺口)
    const EPS = 1e-6;
    for (const item of this.graph.items) {
      let lhs = 0;
      for (const [recipeKey, xVal] of execByRecipe) {
        const r = this.graph.recipes.get(recipeKey);
        lhs += (r.outputs[item] || 0) * xVal - (r.inputs[item] || 0) * xVal;
      }
      const rhs = this.graph.demandByItem[item] || 0;
      const surplus = lhs - rhs;

      if (surplus > EPS) {
        surplusByproducts[item] = surplus;
      } else if (surplus < -EPS && !this.graph.recipeOfItem.has(item)) {
        resourceUsage[item] = -surplus;
      }
    }

    // 电力聚合(规格 §7.2):总耗电 = 所有配方的电力输入 × 执行次数 之和。
    // energyCost/minerEnergyCost 双轨合并:两者同值 = totalEnergyCost;
    // minerEnergyCost 字段名保留仅为兼容 result.jsx 现有解构,UI 只显示总数。
    let totalEnergyCost = 0;
    for (const [recipeKey, xVal] of execByRecipe) {
      const r = this.graph.recipes.get(recipeKey);
      totalEnergyCost += (r.inputs['电力'] || 0) * xVal;
    }
    const energyCost = totalEnergyCost;
    const minerEnergyCost = 0; // 双轨取消;字段保留兼容,UI 只读 totalEnergyCost

    // 4. 设备数量(沿用 buildingPower 公式)
    const buildingDetails = {};
    const buildingList = {};
    for (const [recipeKey, xVal] of execByRecipe) {
      if (xVal <= 1e-9) continue;
      const r = this.graph.recipes.get(recipeKey);
      const bp = r.buildingPower;
      if (!bp || !bp.factoryName) continue;
      const buildNumber = xVal * bp.singleExecBuildNumber;
      const itemKey = r.mainItem;
      buildingDetails[itemKey] = {
        factoryName: bp.factoryName,
        设备数量: buildNumber,
        执行次数: xVal,
        单次执行设备数: bp.singleExecBuildNumber,
        额定功率: bp.basePower,
      };
      const ceilBuildNumber = Math.ceil(buildNumber);
      if (ceilBuildNumber > 0) buildingList[bp.factoryName] = (buildingList[bp.factoryName] || 0) + ceilBuildNumber;
    }

    // 发电设备数(getPowerDeviceCount 衔接,数值与置顶电力行一致)
    const selectedFuel = this.schemeData?.selected_fuel;
    if (selectedFuel && selectedFuel !== '无' && totalEnergyCost > 0) {
      const fuelRecipe = recipes.find(r => r.isFuelRecipe && r.fuelName === selectedFuel);
      if (fuelRecipe) {
        const factoryKey = String(fuelRecipe.设施);
        const genBuilding = this.gameData.factory_data?.[factoryKey]?.[0];
        const devicePower = genBuilding?.['发电功率'] ?? genBuilding?.['耗能'] ?? 0;
        const deviceName = genBuilding?.['名称'];
        const recipeId = fuelRecipe._id !== undefined ? fuelRecipe._id : recipes.indexOf(fuelRecipe);
        const schemeRecipe = this.schemeData?.scheme_for_recipe?.[recipeId];
        const proMode = Number(schemeRecipe?.['增产模式']) || 0;
        const proLevel = Number(schemeRecipe?.['增产剂等级'] || schemeRecipe?.['增产点数']) || 0;
        const correctedCount = getPowerDeviceCount({
          totalEnergy: totalEnergyCost, devicePower,
          proliferatorEffects: this.gameData.proliferator_effect,
          proliferatorLevel: proLevel, proliferatorMode: proMode,
        });
        if (!buildingDetails['电力']) {
          buildingDetails['电力'] = {factoryName: deviceName, 设备数量: 0, 执行次数: 0, 单次执行设备数: 0, 额定功率: devicePower};
        }
        buildingDetails['电力'].factoryName = deviceName;
        buildingDetails['电力'].额定功率 = devicePower;
        buildingDetails['电力'].设备数量 = correctedCount;
        const ceilCount = Math.ceil(correctedCount);
        if (ceilCount > 0) buildingList[deviceName] = ceilCount;
        else delete buildingList[deviceName];
      }
    }

    // 5. 占地(公式原样移植 index.js 现 341-392 行,l/n/factoryName 判定不变,
    //    数据源从 node.buildingPower 改为 r.buildingPower + recipe 原始表)
    const footprintDetails = {};
    let totalFootprint = 0;
    const stackM = this.settings?.stack_research_lab || 15;
    for (const [itemKey, detail] of Object.entries(buildingDetails)) {
      if (detail.设备数量 <= 0) continue;
      const r = [...this.graph.recipes.values()].find(rr => rr.mainItem === itemKey);
      if (!r) continue;
      const recipe = recipes[Number(r.recipeId)];
      if (!recipe) continue;

      const n = Math.ceil(detail.设备数量);
      const factoryName = detail.factoryName;
      const l = Object.keys(recipe.原料 || {}).length + Object.keys(recipe.产物 || {}).length;

      let area = 0;
      if (factoryName.includes('制造台')) {
        area = (4 * n - 1) * (3 + l / 2);
      } else if (factoryName.includes('熔炉')) {
        area = 3 * n * (3 + l / 2);
      } else if (factoryName === '原油精炼厂') {
        area = 3 * n * (6 + l / 2);
      } else if (factoryName.includes('分馏塔')) {
        area = (11 / 2) * (4 * n - 1);
      } else if (factoryName.includes('化工厂')) {
        area = 7 * n * (4 + l / 2);
      } else if (factoryName === '微型粒子对撞机') {
        area = 5 * n * (9 + l / 2);
      } else if (factoryName.includes('研究站')) {
        const researchStations = Math.ceil(n / stackM);
        if (Number(r.recipeId) === 73) { // 宇宙矩阵配方索引
          area = 12 * (5.5 * researchStations);
        } else {
          area = 5 * researchStations * (5 + l / 2);
        }
      } else if (factoryName === '射线接收站') {
        area = Math.pow(8 * Math.sqrt(n) - 1, 2);
      } else if (factoryName === '人造恒星') {
        area = 49;
      } else if (factoryName === '火力发电厂' || factoryName === '微型聚变发电站') {
        area = 28;
      }

      footprintDetails[itemKey] = {area, n, l, factoryName};
      totalFootprint += area;
    }

    // 6. selfConsumption 与 byproductSources 重导出
    const selfConsumption = {};
    const byproductSources = {};
    for (const [recipeKey, r] of this.graph.recipes) {
      const sc = (r.inputs[r.mainItem] || 0);
      const gross = r.outputs[r.mainItem] || 0;
      if (gross > 0 && sc > 0) {
        // 毛产量 = 净产量 × (1 + selfConsumption);净产量 = max(outputs-mainInputs, ε)
        const net = Math.max(gross - sc, 1e-12);
        selfConsumption[r.mainItem] = sc / net;
      }
      for (const [coItem, qty] of Object.entries(r.outputs)) {
        if (coItem === r.mainItem) continue;
        byproductSources[coItem] = byproductSources[coItem] || {};
        byproductSources[coItem][r.mainItem] = qty / Math.max(gross - (r.inputs[r.mainItem] || 0), 1e-12);
      }
    }

    return {
      resourceUsage, surplusByproducts, recipeExecutions,
      buildingDetails, buildingList, selfConsumption, byproductSources,
      energyCost, minerEnergyCost, totalEnergyCost,
      footprintDetails, totalFootprint,
      graph: this.graph, edges: this.edges, proliferatorEdgeKeys: this.proliferatorEdgeKeys,
    };
  }
}

export default CoreEngine;
```

实现要求:
- `surplusByproducts` 语义变化:现在存**正值**(多余量),result.jsx 显示处取 `-amount` 的地方要同步改为直接显示正值(Task 6 处理,本任务的端到端测试断言用正值);
- `resourceUsage` 只含外部获取正值(原矿缺口);有配方物品不再出现负值;
- 删除文件:`git rm src/engine/unit-cost.js src/engine/matrix.js`;检查 dag.js——若 buildItemGraph 已无消费者(contexts.jsx 的 EngineGraphDataContext 改读新返回值),整个文件删除(tarjanSCC 适配器一并删,graph-utils.js 保留给优化器/依赖图页)。

- [ ] **Step 4: 运行测试确认通过 + repro 验收**

Run: `npm test`
Expected: PASS

改造 `repro_engine.mjs`(calculate 调用前加 await):

```js
// repro_engine.mjs 关键改动
const result = await engine.calculate(needs, gameData.recipe_data, new Set(), false, (m) => cpLogs.push(m));
```

并在结果断言处输出核心验收指标:

```js
console.log('氢 surplus:', result.surplusByproducts['氢']);       // 预期 ≈ 5.63(多余,正值)
console.log('精炼油 surplus:', result.surplusByproducts['精炼油']); // 预期 undefined(恰好满足)
console.log('原油 usage:', result.resourceUsage['原油']);
```

Run: `node repro_engine.mjs`
Expected:**氢为多余副产品(正值)、精炼油不在 surplusByproducts 中**(旧算法错误解为精炼油多余+氢短缺)——这是本次重构的核心验收标准。数值与手算锚点(-5.63/+200.94 的绝对值)允许小偏差(增产方案细节),方向性必须一致。

再跑 `node repro_hydrogen_direct.mjs`(同样加 await):氢改为轨道采集器后应为氢外部采集正值、无精炼油多余。

- [ ] **Step 5: 提交**

```bash
git add -A src/engine repro_engine.mjs repro_hydrogen_direct.mjs tests/engine/calculate-lp.test.js
git rm src/engine/unit-cost.js src/engine/matrix.js
# 若 dag.js 已无消费者: git rm src/engine/dag.js
git commit -m "feat!: 核心计算切换 LP 方案——calculate 变 async,删除矩阵求逆/逆生产/过滤迭代"
```

---

### Task 5: contexts.jsx + 优化器适配 async

**Files:**
- Modify: `src/contexts.jsx:153-194`(engineCalculate 变 async)
- Modify: `src/result.jsx:355-360`(engineResult useMemo → useState/useEffect 异步获取)
- Modify: `src/engine/proliferator-optimizer.js`(三个包装函数 async;SCC 自算;sccs 消费点改造)

**Interfaces:**
- Consumes: Task 4 的 `async calculate`
- Produces:
  - `engineCalculate(needs_dict): Promise<Result|null>`(contexts.jsx,签名不变但返回 Promise)
  - 优化器内部:`calculatePower/calculateOreHeat/calculateRareWeight` 均 `async`,`sccsForward` 来自自算 tarjanSCC

- [ ] **Step 1: contexts.jsx 改造**

```jsx
// contexts.jsx —— engineCalculate 段(替换 153-194 行)
const [engineGraphData, setEngineGraphData] = useState(null);
const [calculationError, setCalculationError] = useState(null);
const [engineLogs, setEngineLogs] = useState([]);

const engineCalculate = useMemo(() => {
    return async function(needs_dict) {
        if (!needs_dict || Object.keys(needs_dict).length === 0) {
            setTimeout(() => setCalculationError(null), 0);
            return null;
        }
        const needsArray = Object.entries(needs_dict).map(([id, count]) => ({id, name: id, count}));
        try {
            const runLogs = [];
            const onLog = DEBUG ? (msg) => { runLogs.push(msg); } : null;
            const result = await engine.calculate(needsArray, game_info.game_data.recipe_data, new Set(), false, onLog);
            if (DEBUG) setTimeout(() => setEngineLogs(runLogs), 0);
            setTimeout(() => setCalculationError(null), 0);
            if (engine.graph && engine.edges) {
                const graphData = {
                    edges: engine.edges,
                    graph: engine.graph,
                    proliferatorEdgeKeys: engine.proliferatorEdgeKeys || new Set()
                    // 注意:sccs 字段移除——依赖图页浅层化后不再消费(Task 7)
                };
                setTimeout(() => setEngineGraphData(graphData), 0);
            }
            return result;
        } catch (e) {
            setTimeout(() => setCalculationError(e.message), 0);
            return null;
        }
    };
}, [engine, game_info]);
```

- [ ] **Step 2: result.jsx 消费点改造**

```jsx
// result.jsx —— 替换 355-360 行
const [engineResult, setEngineResult] = useState(null);
useEffect(() => {
    let cancelled = false;
    if (!engineCalculate || !needs_list || Object.keys(needs_list).length === 0) {
        setEngineResult(null);
        return;
    }
    engineCalculate(needs_list).then(res => {
        if (!cancelled) setEngineResult(res);
    });
    return () => { cancelled = true; };
}, [engineCalculate, needs_list]);
```

同时在文件顶部 import 确认有 `useState`(已有)。

- [ ] **Step 3: 优化器适配(proliferator-optimizer.js)**

3a. 三个包装函数变 async:

```js
// calculatePower(28-63行)签名与内部:
async function calculatePower(gameData, schemeData, settings, needs) {
  const gameInfo = {game_data: gameData, item_data: {}};
  const globalState = new GlobalState(gameInfo, schemeData, settings);
  const engine = new CoreEngine(gameData, schemeData, settings, globalState.sprayCosts);
  const result = await engine.calculate(needs, gameData.recipe_data);

  // graph/edges 从 result 取(engine 属性在新方案下同样可用,取 result 更稳)
  return {
    totalEnergyCost: result.totalEnergyCost || 0,
    energyCost: result.energyCost || 0,
    minerEnergyCost: result.minerEnergyCost || 0,
    resourceUsage: result.resourceUsage || {},
    surplusByproducts: result.surplusByproducts || {},
    totalFootprint: result.totalFootprint || 0,
    footprintDetails: result.footprintDetails || {},
    graph: engine.graph || new Map(),
    edges: engine.edges || [],
  };
}
```

`calculateRareWeight`/`calculateOreHeat`(132/190 行)首行改 `const result = await calculatePower(...)` 并加 `async`。

3b. optimizeCycleGroupPhase(402-492行)内 `calculateFullResult` 变 async,坐标下降循环内所有 `calculateFullResult(...)` 调用加 await:

```js
async function calculateFullResult(choices) { /* 同原逻辑 */ return await calculateResult(gameData, tempScheme, settings, needs); }
// 循环内: const result = await calculateFullResult(currentChoices);
// initResult 同理: const initResult = await calculateFullResult(currentChoices);
```

3c. SCC 自算(optimizeProliferatorStrategy 内 769-783 行区域):

```js
import {tarjanSCC} from './graph-utils.js';   // 文件头新增

// 原:maxResult = calculatePower(...) 后取 maxResult.sccs
const maxResult = await calculatePower(gameData, maxScheme, settings, needs);
// Tarjan 需要 items 集合:从 edges 收集
const graphItems = new Set();
maxResult.edges.forEach(e => { graphItems.add(e.from); graphItems.add(e.to); });
const sccsBackward = tarjanSCC(graphItems, maxResult.edges); // graph-utils 返回已是逆拓扑序(顶层在前)
const sccsForward = [...sccsBackward].reverse();             // 正序:底层在前
```

后续消费点(`scc.has('__solution__')`)删除该判断(新方案无 solution 节点):
- optimizePhaseBySCC 526 行 `if (scc.has('__solution__')) continue;` 删除;
- validateFinalProliferatorChoices 调用处(800-811行)传 `sccs: sccsForward`(proliferator-final-validation.js 内部 50 行 `if (scc.has('__solution__')) continue;` 一并删除);
- 734 行 `if (!initialResult.sccs ...)` 判断改为 `if (!maxResult.edges || maxResult.edges.length === 0)`;
- 注意:initialResult(701行)来自 `await calculateResult(...)`(加 await)。

3d. optimizePhaseBySCC(509行)签名加 async,内部 515-517 行初始计算、559 行、573 行等所有 calculateResult/calculatePower 调用加 await;631 行同理。

- [ ] **Step 4: 运行全部测试 + lint**

Run: `npm test && npx eslint . --max-warnings 0`
Expected: 全部 PASS(proliferator-final-validation.test.js 的 mock calculateResult 是同步箭头函数——validateFinalProliferatorChoices 内部调用处需 await,mock 同步返回值 await 后仍正常,无需改测试;若有断言失败按实际调整 mock 为 async)

- [ ] **Step 5: 手动冒烟(dev server)**

Run: `npm run dev`
浏览器验证:①输入需求(四矩阵×60)主视图出数值;②多余产物面板显示"氢"(正值展示正确);③点击自动优化四种策略各跑一遍无报错。

- [ ] **Step 6: 提交**

```bash
git add src/contexts.jsx src/result.jsx src/engine/proliferator-optimizer.js src/engine/proliferator-final-validation.js
git commit -m "refactor: contexts/优化器适配 async calculate;优化器自算 SCC"
```

---

### Task 6: UI——电力合一、不计挖矿电按钮、副产品正值显示

**Files:**
- Modify: `src/result.jsx`(电力行、总结面板电力显示、surplusByproducts 符号)
- Modify: `src/settings.jsx`(不计挖矿电开关)
- Modify: `src/contexts.jsx`(settings 增加 exclude_miner_power 默认值)

**Interfaces:**
- Consumes: Task 4/5 的引擎输出(surplusByproducts 已是正值;minerEnergyCost 恒 0)
- Produces: settings.exclude_miner_power(boolean,默认 false)

- [ ] **Step 1: settings 默认值与开关**

contexts.jsx DEFAULT_SETTINGS(settings useMemo 初始化处)增加 `exclude_miner_power: false`。

settings.jsx 在合适分组(挖矿设置区)添加开关(参照现有开关写法,如 rare_ore_practicality 的 Checkbox):

```jsx
<label className="d-flex align-items-center gap-1 text-nowrap">
    <input type="checkbox" checked={!!settings.exclude_miner_power}
           onChange={e => set_settings(prev => ({...prev, exclude_miner_power: e.target.checked}))}/>
    不计挖矿电力
</label>
```

- [ ] **Step 2: result.jsx 电力显示合一**

全文搜索 `energy_cost + miner_energy_cost` 与 `energy_cost`、`miner_energy_cost` 的所有显示点(478-541 置顶电力行、740-752 historyValues、827-852 mobile 电力面板、926-953 desktop 电力面板、1110-1137 Modal 底部),统一改为单一总值:

```jsx
let total_energy_cost = engineResult?.totalEnergyCost || 0;
// 所有 currentValue={...} 统一用 total_energy_cost;"生产/总计"两行合并为一行"总计"
// historyValues.currentValues 里 totalEnergyCost: total_energy_cost(energyCost 字段同步同值,保历史兼容)
```

具体:mobile/desktop 两处的"生产:"行删除,"总计:"保留;Modal footer 的"生产电力:"行删除,"总电力:"保留;置顶电力行的 `totalEnergy` 变量改读 `total_energy_cost`。

- [ ] **Step 3: surplusByproducts 正值显示**

Task 4 后 surplusByproducts 存正值。修改:
- 745-747 行 `surplusByproducts: Object.fromEntries(...map(([i,a])=>[i,-a]))` 改为直接透传 `[i, a]`(historyValues 口径同步为正值);
- 884 行 `formatValue(-amount,...)` → `formatValue(amount,...)`;885-888 行比较符号同步去掉负号;
- 1027-1046 行(Modal 内多余产物)同样处理;
- 727-733 行净热值计算 `amount >= 0 continue` → `amount <= 0 continue`,`Math.abs(amount)` → `amount`(正值直接累加);
- proliferator-optimizer.js 209-215 行 byproductHeat 同步改(`amount >= 0` → `amount <= 0`,`Math.abs` 去掉);
- repro 脚本断言已按正值(Task 4),无需改。

- [ ] **Step 4: 验证**

Run: `npm test && npx eslint . --max-warnings 0 && npm run build`
Expected: 全部通过(build 确认 legacy 移除前打包正常)

手动冒烟:①勾选"不计挖矿电力",原矿行电力贡献消失、总电力下降;②电力行显示单一总值;③多余产物面板数值符号正确。

- [ ] **Step 5: 提交**

```bash
git add src/result.jsx src/settings.jsx src/contexts.jsx src/engine/proliferator-optimizer.js
git commit -m "feat: 电力合一显示+不计挖矿电开关;副产品正值口径统一"
```

---

### Task 7: 去 vite legacy + PWA 缓存 wasm + 依赖图浅层化

**Files:**
- Modify: `vite.config.js`(删 legacy 插件;workbox globPatterns 加 wasm;manualChunks 加 highs)
- Modify: `package.json`(删 devDependency @vitejs/plugin-legacy)
- Modify: `src/DependencyGraphPage.jsx`(删电力/增产剂边、删 SCC 布局)

**Interfaces:**
- Consumes: Task 5 的 engineGraphData(无 sccs 字段)
- Produces: 依赖图页只渲染物品投影边(无电力边、无循环包围盒)

- [ ] **Step 1: vite.config.js 改造**

```js
// 1) 删除 import legacy from '@vitejs/plugin-legacy'(第8行)与 plugins 数组中 legacy({...})(213-216行)
// 2) manualChunks 增加分支:
if (id.includes('/node_modules/highs/') || id.includes('/node_modules/pako/')) {
    return 'vendor-highs';
}
// 3) workbox.globPatterns 改为:
globPatterns: ['**/*.{js,css,html,ico,svg,woff2,wasm}'],
maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,  // highs.wasm 约1-2MB,留余量
// runtimeCaching 增加 wasm 兜底(预缓存为主,此处防 glob 遗漏):
{
    urlPattern: /\.wasm$/i,
    handler: 'CacheFirst',
    options: {cacheName: 'wasm-cache', expiration: {maxEntries: 10, maxAgeSeconds: 60*60*24*365}},
},
```

- [ ] **Step 2: 卸载 legacy 依赖**

Run: `npm uninstall @vitejs/plugin-legacy regenerator-runtime`
说明:regenerator-runtime 是 legacy 的 additionalLegacyPolyfills,一并卸载;若 src 中有直接 import 会报错,届时保留该包并在计划备注中说明(先全局搜索确认:`Grep pattern "regenerator-runtime" path src`)。

- [ ] **Step 3: 依赖图浅层化(DependencyGraphPage.jsx)**

3a. build_dependency_graph(21-133行):删除电力特殊段(31-66 燃料配方边)与"为有设备的配方添加对电力的依赖"段(111-128),删除 `if (item === '电力') continue;`(70 行,不再需要——电力根本不进图);增产剂材料段保留吗?**否——按浅层化原则删除**:86-94 行 materials 不再加 proItem(增产剂不进依赖图),proliferator_edges 相关逻辑随之删除(25、59-62、105-107 行),返回值删掉 proliferator_edges。

3b. filtered_graph useMemo(1115-1184行):
- 仅需求模式分支:删除 power_edges 计算(1123-1125)、filtered_sccs(1132-1135)、filtered_proliferator_edges(1137-1146);返回值 `{edges, items, power_edges: new Set(), sccs: [], proliferator_edges: new Set()}`(字段保留为空集合以兼容下游解构,Task 7 结束时清理);
- 全部配方模式分支:full_edges 即渲染边(1155-1159 合并为一步,不再区分电力边),删除 sccs 计算(1170-1181)。

3c. layout_graph(147-245行)简化:
- 删除 precomputed_sccs 参数与 scc_groups/compressToDag/node_to_scc/sccVisualLayer(152-158 行);
- 层级计算改纯 Kahn:直接用 children/in_degree(162-180 行已有)做分层——`layer(item) = 1 + max(layer(parents))`,拓扑序遍历(图已保证无环);
- cycle_items/cycle_set(182-192)删除;下移优化段(194-215)保留但去掉 `cycle_set.has` 分支;scc_info(234-245)删除;返回值删 scc_groups/scc_info/node_to_scc;
- assign_positions 首层的循环组排布段(330-394)删除循环分支,cycle_items_in_layer 恒空;第二遍延迟节点的 layer_scc_bboxes(697-737)删除 SCC 障碍物参数(layout_items_in_groups 第三参传 `[]`);
- 渲染层:is_cycle 恒 false(674、746 行),1560-1593 行 same_cycle_group 分支自然死代码,删除 CYCLE_DOT_OFFSET 段;material_in_cycle/product_in_cycle 判定删除。

3d. 解构清理(1190-1229 行):layout 返回值与消费点删除 scc_info/scc_groups/node_to_scc 相关变量;EngineGraphDataContext 消费处不再引用 sccs(Task 5 已移除字段)。

- [ ] **Step 4: 构建与冒烟**

Run: `npm run build && npm test && npx eslint . --max-warnings 0`
Expected: build 成功(dist 中无双入口 legacy 包);dist/vendor-highs chunk 含 wasm 资产引用

Run: `npm run preview`
冒烟:①依赖图页两种模式(仅需求/全部配方)正常布局,无电力节点、无循环包围盒;②PWA 构建 dist/sw.js 预缓存清单含 .wasm。

- [ ] **Step 5: 提交**

```bash
git add vite.config.js package.json package-lock.json src/DependencyGraphPage.jsx
git commit -m "refactor: 去 vite legacy;PWA 预缓存 wasm;依赖图浅层化(去电力/增产剂边与 SCC 布局)"
```

---

### Task 8: 清理收尾与全面回归

**Files:**
- Delete: `repro_ratio_check.mjs`、`verify_merge_hypothesis.mjs`(针对旧算法的验证脚本)
- Modify: `repro_engine.mjs`、`repro_hydrogen_direct.mjs`(已在 Task 4 改造,此处复核)
- Modify: `README.md`(如有引擎架构描述段落则更新一句:核心计算采用 LP 配平)
- Modify: `CHANGELOG.md`(新增条目)

**Interfaces:** 无新接口,纯清理与回归。

- [ ] **Step 1: 清理旧脚本与文档**

```bash
git rm repro_ratio_check.mjs verify_merge_hypothesis.mjs
```

CHANGELOG.md 顶部(Unreleased 区)新增:

```markdown
### Changed
- 核心计算重构为整网 LP 配平(HiGHS WASM):根治循环组联产物归因错误(氢/精炼油问题),
  删除矩阵求逆、阶段2逆生产、共生产品代表选择与过滤迭代
- calculate() 变为异步;优化器与界面适配
- 电力记账合并:生产/挖矿双轨合并为单一电力流,新增"不计挖矿电力"开关
- 依赖图浅层化:不再显示电力/增产剂依赖与循环组包围盒
- 移除 vite legacy 构建(structuredClone 已要求 Chrome 98+)
```

- [ ] **Step 2: 全面回归**

Run: `npm test && npx eslint . --max-warnings 0 && npm run build`
Expected: 全绿

Run: `node repro_engine.mjs && node repro_hydrogen_direct.mjs`
Expected: 核心验收——氢多余(正值)、精炼油恰好满足;氢轨道采集器场景氢为外部采集。

- [ ] **Step 3: 性能记录(规格 §八)**

在 repro_engine.mjs 输出处记录耗时(console.time/end 或 performance.now),把"LP 方案单次耗时"记入 CHANGELOG 条目末尾注释或 PR 描述(供用户对比旧值 ~数百 ms 病态场景)。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore: 清理旧算法复现脚本,更新更新日志,全面回归通过"
```

---

## 任务依赖关系

```
Task 1 ─→ Task 3 ─→ Task 4 ─→ Task 5 ─→ Task 6
   └─────→ Task 2 ────┘                    └─→ Task 7 ─→ Task 8
```

(Task 1、2 可并行;3 依赖两者;4 是核心切换点;5/6/7 围绕切换点收尾;8 终验)
