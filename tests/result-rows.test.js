import test from 'node:test';
import assert from 'node:assert/strict';
import {buildResultRowOrder} from '../src/result-rows.js';

test('纯联产物统一追加到表尾', () => {
    const rows = buildResultRowOrder(['精炼油', '煤矿'], {'氢': {'精炼油': 60}});
    assert.deepEqual(rows, [
        {item: '精炼油', isCoProduct: false},
        {item: '煤矿', isCoProduct: false},
        {item: '氢', isCoProduct: true},
    ]);
});

test('已是主物品的联产物不重复成行', () => {
    const rows = buildResultRowOrder(['石墨烯', '氢'], {'氢': {'石墨烯': 15}});
    assert.deepEqual(rows.map(r => r.item), ['石墨烯', '氢']);
    assert.deepEqual(rows.map(r => r.isCoProduct), [false, false]);
});

test('多个联产物保持 side_products 键序', () => {
    const rows = buildResultRowOrder(
        ['塑料'],
        {'氢': {'精炼油': 60}, '硫': {'精炼油': 5}},
    );
    assert.deepEqual(rows.map(r => r.item), ['塑料', '氢', '硫']);
    assert.deepEqual(rows.map(r => r.isCoProduct), [false, true, true]);
});

test('空输入返回空数组', () => {
    assert.deepEqual(buildResultRowOrder([], {}), []);
});
