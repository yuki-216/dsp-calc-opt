import test from 'node:test';
import assert from 'node:assert/strict';

// game_data.jsx 使用 Vite 专属语法(.jsx 扩展名 + import.meta.glob),
// 通过共享的 vite SSR 实例加载引擎模块,与前端构建工具链保持一致。
import {getViteServer, closeViteServer} from '../helpers/vite-game-data.mjs';

const server = await getViteServer();
const {buildRecipeGraph} = await server.ssrLoadModule('/src/engine/bipartite-graph.js');

// 释放 vite 实例句柄,保证 node --test 正常退出
test.after(async () => {
    await closeViteServer();
});

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
