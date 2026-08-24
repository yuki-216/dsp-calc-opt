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
