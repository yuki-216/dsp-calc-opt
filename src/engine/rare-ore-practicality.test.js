import test from 'node:test';
import assert from 'node:assert/strict';

import {
    RARE_ORE_EQUIVALENCE,
    RARE_ORE_PRACTICALITY_RATIO,
    getRareOreCorrection,
    correctedRareWeightUnit,
    correctedRareBottleneckUnit,
    convertedRareOreAmount,
} from './rare-ore-practicality.js';

test('三条等价规则换算系数正确', () => {
    assert.ok(Math.abs(RARE_ORE_EQUIVALENCE['刺笋结晶'].factor - 1 / 3) < 1e-12);
    assert.ok(Math.abs(RARE_ORE_EQUIVALENCE['金伯利矿石'].factor - 4) < 1e-12);
    assert.ok(Math.abs(RARE_ORE_EQUIVALENCE['分形硅石'].factor - 4) < 1e-12);
});

test('默认替代比例为 0.95', () => {
    assert.equal(RARE_ORE_PRACTICALITY_RATIO, 0.95);
});

test('getRareOreCorrection: 无等价规则的物品返回 null', () => {
    assert.equal(getRareOreCorrection('铁矿', {铁矿: 100}), null);
});

test('getRareOreCorrection: 普通矿可用量缺失返回 null', () => {
    assert.equal(getRareOreCorrection('刺笋结晶', {刺笋结晶: 500}), null);
});

test('getRareOreCorrection: 珍稀矿可用量缺失返回 null', () => {
    assert.equal(getRareOreCorrection('刺笋结晶', {钛石: 10000}), null);
});

test('getRareOreCorrection: 正常返回规则与可用量', () => {
    const corr = getRareOreCorrection('刺笋结晶', {刺笋结晶: 500, 钛石: 10000});
    assert.equal(corr.rule.commonOre, '钛石');
    assert.equal(corr.rareAvail, 500);
    assert.equal(corr.commonAvail, 10000);
});

test('correctedRareWeightUnit: 95% 折算 + 5% 保留', () => {
    const corr = getRareOreCorrection('刺笋结晶', {刺笋结晶: 500, 钛石: 10000});
    const w = correctedRareWeightUnit(corr, 100000);
    const expected = 0.95 * (1 / 3) * (100000 / 10000) + 0.05 * (100000 / 500);
    assert.ok(Math.abs(w - expected) < 1e-9);
});

test('correctedRareBottleneckUnit: 单位瓶颈', () => {
    const corr = getRareOreCorrection('刺笋结晶', {刺笋结晶: 500, 钛石: 10000});
    const b = correctedRareBottleneckUnit(corr);
    const expected = 0.95 * (1 / 3) / 10000 + 0.05 / 500;
    assert.ok(Math.abs(b - expected) < 1e-15);
});

test('ratio=1 时等于纯折算, ratio=0 时等于原权重', () => {
    const corr = getRareOreCorrection('金伯利矿石', {金伯利矿石: 800, 煤矿: 20000});
    const baseAvail = 100000;
    const pureConverted = correctedRareWeightUnit(corr, baseAvail, 1);
    assert.ok(Math.abs(pureConverted - (4 * baseAvail / 20000)) < 1e-9);
    const noCorrection = correctedRareWeightUnit(corr, baseAvail, 0);
    assert.ok(Math.abs(noCorrection - (baseAvail / 800)) < 1e-9);
});

test('convertedRareOreAmount: 折算明细(刺笋 180 → 57 钛石 + 保留 9)', () => {
    const corr = getRareOreCorrection('刺笋结晶', {刺笋结晶: 500, 钛石: 10000});
    const {converted, retained} = convertedRareOreAmount(corr, 180);
    assert.ok(Math.abs(converted - 57) < 1e-9);
    assert.ok(Math.abs(retained - 9) < 1e-9);
});
