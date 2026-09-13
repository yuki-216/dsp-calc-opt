import test from 'node:test';
import assert from 'node:assert/strict';
import {trimFloatTail, adjustNeedsList} from '../src/numeric.js';

test('按显示精度吸附浮点尾巴', () => {
    assert.equal(trimFloatTail(59.99999999999999, 2), 60);
    assert.equal(trimFloatTail(45.00000000000001, 2), 45);
    assert.equal(trimFloatTail(33.00000000000004, 2), 33);
    assert.equal(trimFloatTail(100.00000000000001, 2), 100);
    assert.equal(trimFloatTail(-45.00000000000001, 2), -45);
});

test('真值不被有损舍入（57.3333... 不能变 57.33）', () => {
    const raw = 57.333333333333336;
    const v = trimFloatTail(raw, 2);
    assert.notEqual(v, 57.33);
    assert.ok(Math.abs(v - raw) / raw < 1e-9, `相对误差过大: ${v}`);
});

test('精度位数为 0 时不把普通小数吸附成整数', () => {
    assert.equal(trimFloatTail(1234.5678, 0), 1234.5678);
    // 但纯尾巴仍然吸附
    assert.equal(trimFloatTail(1234.0000000000002, 0), 1234);
});

test('零与非有限值原样返回', () => {
    assert.equal(trimFloatTail(0, 2), 0);
    assert.ok(Number.isNaN(trimFloatTail(NaN, 2)));
    assert.equal(trimFloatTail(Infinity, 2), Infinity);
});

test('等比例调整：被改物品精确等于输入值，其余去尾巴', () => {
    const prev = {
        '铁块': 59.99999999999999,
        '铜块': 45.00000000000001,
        '硫酸': 57.333333333333336,
    };
    const next = adjustNeedsList(prev, {ratio: 100 / 60, user_value: 100, fixed_num: 2, item: '铁块'});
    assert.equal(next['铁块'], 100);
    assert.equal(next['铜块'], 75);
    assert.ok(next['硫酸'] > 95 && next['硫酸'] < 96);
    assert.notEqual(next['硫酸'], 95.55);
});

test('键序不变 + 自耗物品按净需求换算', () => {
    const next = adjustNeedsList({'铁块': 60, '氢': 30}, {
        ratio: 2, user_value: 100, fixed_num: 2, item: '氢', self_consumption: 0.25,
    });
    assert.deepEqual(Object.keys(next), ['铁块', '氢']);
    assert.equal(next['铁块'], 120);
    assert.equal(next['氢'], 80);   // 100 / 1.25
});

test('被改物品不在需求表时只做等比缩放，不新增键', () => {
    const next = adjustNeedsList({'铁块': 60}, {
        ratio: 2, user_value: 999, fixed_num: 2, item: '精炼油',
    });
    assert.deepEqual(Object.keys(next), ['铁块']);
    assert.equal(next['铁块'], 120);
});

test('需求表为空时不崩', () => {
    assert.deepEqual(adjustNeedsList({}, {ratio: 2, user_value: 100, fixed_num: 2, item: '铁块'}), {});
});
