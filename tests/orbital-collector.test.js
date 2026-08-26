import test from 'node:test';
import assert from 'node:assert/strict';
import {getViteServer, closeViteServer} from './helpers/vite-game-data.mjs';

const server = await getViteServer();
const {computeOrbitalCollectorOutput} = await server.ssrLoadModule('/src/game_data.jsx');

test.after(async () => {
    await closeViteServer();
});

test('computeOrbitalCollectorOutput:冰巨默认 氢0.3281/可燃冰0.6902 → 单采集器/单球', () => {
    const r = computeOrbitalCollectorOutput({氢: 0.3281, 可燃冰: 0.6902}, 1);
    // 毛采氢=8×0.3281=2.6248; 毛采可燃冰=8×0.6902=5.5216; 采集能量≈50.13; eff≈0.4015
    // 净氢/min≈63.2; 单球=单采集器×40
    assert.ok(Math.abs(r.eff - 0.4015) < 0.005, `eff=${r.eff}`);
    assert.ok(Math.abs(r.perMinute['氢'] - 63.2) < 1, `氢/min=${r.perMinute['氢']}`);
    assert.ok(Math.abs(r.perMinute['可燃冰'] - 133) < 2, `可燃冰/min=${r.perMinute['可燃冰']}`);
    assert.ok(Math.abs(r.perPlanet['氢'] - r.perMinute['氢'] * 40) < 0.01, '单球=单采集器×40');
});

test('computeOrbitalCollectorOutput:速率为0的项不产出(冰巨双项+重氢0)', () => {
    const r = computeOrbitalCollectorOutput({氢: 0.3281, 重氢: 0, 可燃冰: 0.6902}, 1);
    assert.equal(r.perMinute['重氢'], undefined);
    assert.ok(r.perMinute['氢'] > 0);
});

test('computeOrbitalCollectorOutput:采集速度 110% 使单采集器产量更高', () => {
    const r1 = computeOrbitalCollectorOutput({氢: 0.3281, 可燃冰: 0.6902}, 1);
    const r2 = computeOrbitalCollectorOutput({氢: 0.3281, 可燃冰: 0.6902}, 1.1);
    assert.ok(r2.perMinute['氢'] > r1.perMinute['氢']);
});

test('computeOrbitalCollectorOutput:全部速率为0 → eff=0,无产出', () => {
    const r = computeOrbitalCollectorOutput({氢: 0, 可燃冰: 0}, 1);
    assert.equal(r.eff, 0);
    assert.equal(r.perMinute['氢'], undefined);
});
