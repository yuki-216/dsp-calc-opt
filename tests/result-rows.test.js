import test from 'node:test';
import assert from 'node:assert/strict';
import {buildResultRowOrder, collectDemandedItems} from '../src/result-rows.js';

test('被需求的联产物追加到表尾', () => {
    const rows = buildResultRowOrder(['精炼油', '煤矿'], {'氢': {'精炼油': 60}}, new Set(['氢']));
    assert.deepEqual(rows, [
        {item: '精炼油', isCoProduct: false},
        {item: '煤矿', isCoProduct: false},
        {item: '氢', isCoProduct: true},
    ]);
});

test('纯多余联产物(未被需求)不追加独立行', () => {
    const rows = buildResultRowOrder(['精炼油', '煤矿'], {'氢': {'精炼油': 60}}, new Set());
    assert.deepEqual(rows.map(r => r.item), ['精炼油', '煤矿']);
    assert.deepEqual(rows.map(r => r.isCoProduct), [false, false]);
});

test('已是主物品的联产物不重复成行', () => {
    const rows = buildResultRowOrder(['石墨烯', '氢'], {'氢': {'石墨烯': 15}}, new Set(['氢']));
    assert.deepEqual(rows.map(r => r.item), ['石墨烯', '氢']);
    assert.deepEqual(rows.map(r => r.isCoProduct), [false, false]);
});

test('多个联产物保持 side_products 键序', () => {
    const rows = buildResultRowOrder(
        ['塑料'],
        {'氢': {'精炼油': 60}, '硫': {'精炼油': 5}},
        new Set(['氢', '硫']),
    );
    assert.deepEqual(rows.map(r => r.item), ['塑料', '氢', '硫']);
    assert.deepEqual(rows.map(r => r.isCoProduct), [false, true, true]);
});

test('demanded 为 null 时保持旧行为(全部追加)', () => {
    const rows = buildResultRowOrder(['塑料'], {'氢': {'精炼油': 60}});
    assert.deepEqual(rows.map(r => r.item), ['塑料', '氢']);
    assert.deepEqual(rows.map(r => r.isCoProduct), [false, true]);
});

test('空输入返回空数组', () => {
    assert.deepEqual(buildResultRowOrder([], {}), []);
});

test('collectDemandedItems 提取需求表与配方原料', () => {
    const graph = {
        demandByItem: {'石墨烯': 60},
        recipes: new Map([
            ['0', {inputs: {可燃冰: 2, 电力: 0.5, '增产剂 Mk.III': 0.01}}],
            ['1', {inputs: {氢: 3, 电力: 0.2}}],
        ]),
    };
    const demanded = collectDemandedItems(graph);
    assert.ok(demanded.has('石墨烯'), '顶层需求入集');
    assert.ok(demanded.has('可燃冰'), '配方原料入集');
    assert.ok(demanded.has('氢'), '被消耗的联产物入集');
    assert.ok(demanded.has('电力'), '电力等附加输入也入集(联产物不可能是电力,无害)');
    assert.equal(demanded.size, 5);
});

test('collectDemandedItems 空/缺省守卫', () => {
    assert.equal(collectDemandedItems(null).size, 0);
    assert.equal(collectDemandedItems({}).size, 0);
    assert.equal(collectDemandedItems({demandByItem: {}, recipes: new Map()}).size, 0);
});
