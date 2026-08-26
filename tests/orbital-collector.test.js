import test from 'node:test';
import assert from 'node:assert/strict';
import {getViteServer, closeViteServer} from './helpers/vite-game-data.mjs';

const server = await getViteServer();
const {getOrbitalCollectorEfficiency, computeOrbitalCollectorOutput} = await server.ssrLoadModule('/src/game_data.jsx');

test.after(async () => {
    await closeViteServer();
});

test('getOrbitalCollectorEfficiency:冰巨 氢0.25/可燃冰0.58(重氢0) → eff≈0.255', () => {
    // 采集能量 = 8×(0.25×9 + 0.58×4.8) = 8×5.034 = 40.272; eff = 1 − 30/40.272 = 0.2551
    const settings = {mining_speed_hydrogen: 0.25, mining_speed_deuterium: 0, mining_speed_gas_hydrate: 0.58, gas_collect_speed: 1};
    const eff = getOrbitalCollectorEfficiency(settings);
    assert.ok(Math.abs(eff - 0.2551) < 0.005, `eff=${eff}，期望≈0.255`);
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

test('getOrbitalCollectorEfficiency:采集能量为 0 → eff=0', () => {
    const settings = {mining_speed_hydrogen: 0, mining_speed_deuterium: 0, mining_speed_gas_hydrate: 0, gas_collect_speed: 1};
    assert.equal(getOrbitalCollectorEfficiency(settings), 0);
});

test('getOrbitalCollectorEfficiency:采集速度 110% 使采集能量更大 → eff 更高', () => {
    const base = {mining_speed_hydrogen: 0.25, mining_speed_deuterium: 0, mining_speed_gas_hydrate: 0.58, gas_collect_speed: 1};
    const faster = {...base, gas_collect_speed: 1.1};
    assert.ok(getOrbitalCollectorEfficiency(faster) > getOrbitalCollectorEfficiency(base));
});
