import test from 'node:test';
import assert from 'node:assert/strict';

// game_data.jsx 使用 Vite 专属语法(.jsx 扩展名 + import.meta.glob),
// 通过共享的 vite SSR 实例加载引擎模块,与前端构建工具链保持一致。
import {getViteServer, closeViteServer} from '../helpers/vite-game-data.mjs';

const server = await getViteServer();
const {buildLPModel} = await server.ssrLoadModule('/src/engine/lp-model.js');
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

test('构模:每个入选配方一个变量,配方/slack变量目标系数为1,z变量不进目标', () => {
    const graph = buildRecipeGraph(
        [{id: '齿轮', name: '齿轮', count: 10}],
        makeGameData().recipe_data, makeGameData(), makeScheme(), {is_time_unit_minute: true}, null
    );
    const {model, varToRecipe} = buildLPModel(graph);
    // 配方变量 + noRecipeItems 的 slack 变量
    const recipeVars = model.variables.filter(v => varToRecipe.has(v.name)).map(v => v.name);
    assert.deepEqual(recipeVars.sort(), ['0', '1'].sort());
    for (const v of model.variables) {
        const coeff = model.objective.coeffs[v.name] ?? 0;
        if (varToRecipe.has(v.name) || v.name.startsWith('slack_')) {
            assert.equal(coeff, 1, `${v.name} 目标系数应为 1`);
        } else {
            // z 变量(主物品吸收上限记账):不进目标函数(spec §十一)
            assert.equal(coeff, 0, `${v.name} 是 z 变量,目标系数应为 0`);
        }
    }
    assert.equal(varToRecipe.get('0'), '0');
});

test("守恒约束:齿轮/铁块/铁矿三行系数与RHS正确", () => {
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
    assert.equal(oreCon.coeffs['0'], -1);              // 只有消耗
    assert.equal(oreCon.rhs, 0);
});

test("noRecipeItems 加松弛列:行内 +1 系数、目标系数 1、不登记 varToRecipe", () => {
    // 铁矿无配方 → noRecipeItems,构模后其守恒行含 +1 slack 铁矿
    const graph = buildRecipeGraph(
        [{id: '齿轮', name: '齿轮', count: 10}],
        makeGameData().recipe_data, makeGameData(), makeScheme(), {is_time_unit_minute: true}, null
    );
    assert.ok(graph.noRecipeItems.has('铁矿'));
    const {model, varToRecipe} = buildLPModel(graph);
    const oreCon = model.constraints.find(c => c.name === 'con_铁矿');
    assert.equal(oreCon.coeffs['slack_铁矿'], 1);
    assert.equal(model.objective.coeffs['slack_铁矿'], 1);
    // slack 不映射到配方
    assert.equal(varToRecipe.get('slack_铁矿'), undefined);
});
