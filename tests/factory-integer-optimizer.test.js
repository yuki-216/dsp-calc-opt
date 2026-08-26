import {test} from 'node:test';
import assert from 'node:assert/strict';
import {optimizeFactoryMix, isOptimizableFactoryGroup} from '../src/factory-integer-optimizer.js';

// 设备等级组（对应 game_data.factory_data 的"设施"分组，按下标序）
const ASSEMBLER = [
    {名称: '制造台 Mk.I', 倍率: 0.75},
    {名称: '制造台 Mk.II', 倍率: 1},
    {名称: '制造台 Mk.III', 倍率: 1.5},
    {名称: '重组式制造台', 倍率: 3},
];
const SMELTER = [
    {名称: '电弧熔炉', 倍率: 1},
    {名称: '位面熔炉', 倍率: 2},
    {名称: '负熵熔炉', 倍率: 3},
];
const CHEMICAL = [
    {名称: '化工厂', 倍率: 1},
    {名称: '量子化工厂', 倍率: 2},
];

test('制造台 c=10.24 base=Mk.I(最低级) → 强制紧凑 9×1级+1×2级', () => {
    const r = optimizeFactoryMix({c: 10.24, levels: ASSEMBLER, baseIndex: 0, direction: 'compact'});
    assert.equal(r.type, 'compact');
    assert.equal(r.total, 10);
    assert.deepEqual(r.mix, [{levelIndex: 0, count: 9}, {levelIndex: 1, count: 1}]);
});

test('制造台 c=5.1 base=Mk.II direction=economy → 3×1级+3×2级', () => {
    const r = optimizeFactoryMix({c: 5.1, levels: ASSEMBLER, baseIndex: 1, direction: 'economy'});
    assert.equal(r.type, 'economy');
    assert.equal(r.total, 6);
    assert.deepEqual(r.mix, [{levelIndex: 0, count: 3}, {levelIndex: 1, count: 3}]);
});

test('制造台 c=5.1 base=Mk.II direction=compact → ceilC=6 偶数转入省料 3×1级+3×2级', () => {
    const r = optimizeFactoryMix({c: 5.1, levels: ASSEMBLER, baseIndex: 1, direction: 'compact'});
    assert.equal(r.type, 'economy');
    assert.equal(r.total, 6);
    assert.deepEqual(r.mix, [{levelIndex: 0, count: 3}, {levelIndex: 1, count: 3}]);
});

test('制造台 c=10.24 base=Mk.II direction=compact → ceilC=11 奇数 9×2级+1×3级', () => {
    const r = optimizeFactoryMix({c: 10.24, levels: ASSEMBLER, baseIndex: 1, direction: 'compact'});
    assert.equal(r.type, 'compact');
    assert.equal(r.total, 10);
    assert.deepEqual(r.mix, [{levelIndex: 1, count: 9}, {levelIndex: 2, count: 1}]);
});

test('制造台 c=10.24 base=Mk.II direction=off(残留值) → 中间等级按紧凑兜底', () => {
    const r = optimizeFactoryMix({c: 10.24, levels: ASSEMBLER, baseIndex: 1, direction: 'off'});
    assert.equal(r.type, 'compact');
    assert.deepEqual(r.mix, [{levelIndex: 1, count: 9}, {levelIndex: 2, count: 1}]);
});

test('制造台 c=10.24 base=重组(最高级) → 强制省料 低级优先混排', () => {
    const r = optimizeFactoryMix({c: 10.24, levels: ASSEMBLER, baseIndex: 3, direction: 'compact'});
    assert.equal(r.type, 'economy');
    assert.equal(r.total, 12);
    assert.deepEqual(r.mix, [{levelIndex: 0, count: 2}, {levelIndex: 3, count: 10}]);
});

test('制造台 c=2.9 base=Mk.I(最低级强制紧凑) → 向下取整不可行 → null(已最紧凑不提示)', () => {
    assert.equal(optimizeFactoryMix({c: 2.9, levels: ASSEMBLER, baseIndex: 0, direction: 'compact'}), null);
});

test('中间等级紧凑策略且向下取整不可行 → 回退省料方案', () => {
    // 造一个 base+1 只高一点的组,使 N=2 全换高一级也补不够 2.9
    const levels = [{名称: 'A', 倍率: 0.8}, {名称: 'B', 倍率: 1}, {名称: 'C', 倍率: 1.4}];
    const r = optimizeFactoryMix({c: 2.9, levels, baseIndex: 1, direction: 'compact'});
    assert.equal(r.type, 'economy');
    assert.equal(r.total, 4);
    assert.deepEqual(r.mix, [{levelIndex: 0, count: 4}]);
});

test('熔炉 c=7.3 base=位面(中间) direction=economy → 1×电弧+7×位面', () => {
    const r = optimizeFactoryMix({c: 7.3, levels: SMELTER, baseIndex: 1, direction: 'economy'});
    assert.equal(r.type, 'economy');
    assert.equal(r.total, 8);
    assert.deepEqual(r.mix, [{levelIndex: 0, count: 1}, {levelIndex: 1, count: 7}]);
});

test('c 为整数且为偶数 → null（无需调整）', () => {
    assert.equal(optimizeFactoryMix({c: 10, levels: ASSEMBLER, baseIndex: 1, direction: 'economy'}), null);
    assert.equal(optimizeFactoryMix({c: 10, levels: ASSEMBLER, baseIndex: 1, direction: 'compact'}), null);
});

test('单等级/无需求/越界 → null', () => {
    assert.equal(optimizeFactoryMix({c: 5, levels: [{名称: '化工厂', 倍率: 1}], baseIndex: 0, direction: 'economy'}), null);
    assert.equal(optimizeFactoryMix({c: 0, levels: ASSEMBLER, baseIndex: 0, direction: 'compact'}), null);
    assert.equal(optimizeFactoryMix({c: 5, levels: ASSEMBLER, baseIndex: 9, direction: 'compact'}), null);
});

test('isOptimizableFactoryGroup：三类为 true，研究站/采矿为 false', () => {
    assert.equal(isOptimizableFactoryGroup(ASSEMBLER), true);
    assert.equal(isOptimizableFactoryGroup(SMELTER), true);
    assert.equal(isOptimizableFactoryGroup(CHEMICAL), true);
    assert.equal(isOptimizableFactoryGroup([{名称: '矩阵研究站', 倍率: 1}, {名称: '自演化研究站', 倍率: 3}]), false);
    assert.equal(isOptimizableFactoryGroup([{名称: '采矿机', 倍率: 0.5}, {名称: '大型采矿机', 倍率: 1}]), false);
});
