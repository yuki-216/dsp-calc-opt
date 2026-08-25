import test from 'node:test';
import assert from 'node:assert/strict';
import {projectNeedsOnlyEdges} from '../src/dependency-graph-edges.js';

// 纯 JS 模块,node 直连 import,无需 vite helper(参考 tests/result-rows.test.js)。

const PROLIFERATOR_NAMES = new Set(['增产剂 Mk.I', '增产剂 Mk.II', '增产剂 Mk.III']);

// 原始配方表:原料 不含电力、不含喷涂增产剂
const RECIPE_DATA = [
    {原料: {铁矿: 1}, 产物: {铁块: 1}},                                             // 0 铁块
    {原料: {铁块: 2}, 产物: {齿轮: 1}},                                              // 1 齿轮
    {原料: {煤矿: 1}, 产物: {电力: 10}},                                             // 2 燃料配方
    {原料: {'增产剂 Mk.II': 1, 金刚石: 2}, 产物: {'增产剂 Mk.III': 1}},             // 3 Mk.III 配方
    {原料: {'增产剂 Mk.I': 1, 煤矿: 1}, 产物: {'增产剂 Mk.II': 1}},                 // 4 Mk.II 配方
];

// 引擎二部图 recipes:inputs = 原始原料 + 引擎附加的 电力 + 喷涂增产剂
function makeRecipes() {
    const recipes = new Map();
    recipes.set('0', {recipeId: '0', mainItem: '铁块', outputs: {铁块: 1}, inputs: {铁矿: 1, 电力: 0.5, '增产剂 Mk.III': 0.01}});
    recipes.set('1', {recipeId: '1', mainItem: '齿轮', outputs: {齿轮: 1}, inputs: {铁块: 2, 电力: 0.1}});
    recipes.set('2', {recipeId: '2', mainItem: '电力', outputs: {电力: 10}, inputs: {煤矿: 1, '增产剂 Mk.III': 0.02}}); // 燃料配方被喷涂
    recipes.set('3', {recipeId: '3', mainItem: '增产剂 Mk.III', outputs: {'增产剂 Mk.III': 1}, inputs: {'增产剂 Mk.II': 1, 金刚石: 2, '增产剂 Mk.III': 0.01, 电力: 0.3}});
    recipes.set('4', {recipeId: '4', mainItem: '增产剂 Mk.II', outputs: {'增产剂 Mk.II': 1}, inputs: {'增产剂 Mk.I': 1, 煤矿: 1, 电力: 0.2}});
    return recipes;
}

function call(overrides = {}) {
    return projectNeedsOnlyEdges({
        recipes: makeRecipes(), recipeData: RECIPE_DATA,
        needsList: {齿轮: 10}, deletedItems: new Set(), proliferatorItemNames: PROLIFERATOR_NAMES,
        ...overrides,
    });
}

function edgeKeys(result) {
    return result.edges.map(e => `${e.from}->${e.to}`);
}

test('无消耗边:普通配方不产生 物品→电力、物品→喷涂增产剂 边', () => {
    const keys = edgeKeys(call());
    assert.ok(!keys.includes('铁块->电力'), '不应有铁块耗电边');
    assert.ok(!keys.includes('齿轮->电力'), '不应有齿轮耗电边');
    assert.ok(!keys.includes('铁块->增产剂 Mk.III'), '不应有铁块喷涂增产剂边');
    assert.ok(!keys.includes('电力->增产剂 Mk.III'), '燃料配方被喷涂不应产生 电力→增产剂 边');
});

test('增产剂内部真实链边保留:Mk.III→Mk.II、Mk.II→Mk.I、→金刚石;无自喷自环', () => {
    const keys = edgeKeys(call());
    assert.ok(keys.includes('增产剂 Mk.III->增产剂 Mk.II'), 'Mk.III 配方需 Mk.II 的链边必须保留');
    assert.ok(keys.includes('增产剂 Mk.II->增产剂 Mk.I'), 'Mk.II 配方需 Mk.I 的链边必须保留');
    assert.ok(keys.includes('增产剂 Mk.III->金刚石'), 'Mk.III 配方普通原料边保留');
    assert.ok(!keys.includes('增产剂 Mk.III->增产剂 Mk.III'), '自喷自环边必须去除');
});

test('电力生产链保留:电力→煤矿(燃料配方真实原料边)', () => {
    assert.ok(edgeKeys(call()).includes('电力->煤矿'));
});

test('独立需求节点:items 含 电力 与 增产剂', () => {
    const result = call();
    assert.ok(result.items.has('电力'));
    assert.ok(result.items.has('增产剂 Mk.III'));
    assert.ok(result.items.has('增产剂 Mk.II'));
});

test('needs 强制入节点:空 recipes 时孤立需求仍显示', () => {
    const result = projectNeedsOnlyEdges({
        recipes: new Map(), recipeData: RECIPE_DATA,
        needsList: {水: 5}, deletedItems: new Set(), proliferatorItemNames: PROLIFERATOR_NAMES,
    });
    assert.ok(result.items.has('水'));
    assert.deepEqual(result.edges, []);
});

test('deleted 过滤:删除煤矿后去掉相关边与节点', () => {
    const result = call({deletedItems: ['煤矿']});
    const keys = edgeKeys(result);
    assert.ok(!keys.includes('电力->煤矿'));
    assert.ok(!keys.includes('增产剂 Mk.II->煤矿'));
    assert.ok(!result.items.has('煤矿'));
    assert.ok(result.items.has('电力'), '电力节点本身不应被误删');
});

test('无燃料配方:电力作为孤立节点保留,无 from=电力 的边', () => {
    const recipes = makeRecipes();
    recipes.delete('2'); // 移除燃料配方
    const result = call({recipes});
    assert.ok(result.items.has('电力'), '无燃料时电力仍作为独立需求节点显示');
    assert.ok(!result.edges.some(e => e.from === '电力'), '无燃料链则无 电力→X 边');
});

test('无电力消耗:电力不出现', () => {
    const recipes = new Map();
    recipes.set('0', {recipeId: '0', mainItem: '铁块', outputs: {铁块: 1}, inputs: {铁矿: 1}});
    const result = call({recipes});
    assert.ok(!result.items.has('电力'));
});

test('null/空守卫:空 recipes、null needsList/deletedItems 不抛错', () => {
    const result = projectNeedsOnlyEdges({
        recipes: new Map(), recipeData: RECIPE_DATA,
        needsList: null, deletedItems: null, proliferatorItemNames: PROLIFERATOR_NAMES,
    });
    assert.deepEqual(result.edges, []);
    assert.equal(result.items.size, 0);
});

test('电力作为需求:items 含 电力 且出现 from=电力 的燃料链边', () => {
    const result = call({needsList: {电力: 100}});
    assert.ok(result.items.has('电力'));
    assert.ok(result.edges.some(e => e.from === '电力' && e.to === '煤矿'));
});
