import test from 'node:test';
import assert from 'node:assert/strict';

import {getPowerDeviceCount} from '../src/power-device-count.js';

test('uses the base generator efficiency without proliferator', () => {
    assert.equal(getPowerDeviceCount({
        totalEnergy: 2.16,
        devicePower: 2.16,
        proliferatorEffects: [],
        proliferatorLevel: 0,
        proliferatorMode: 0,
    }), 1);
});

test('applies Mk.III extra-product efficiency to thermal generators', () => {
    assert.equal(getPowerDeviceCount({
        totalEnergy: 2.7,
        devicePower: 2.16,
        proliferatorEffects: [null, null, null, {'增产效果': 1.25, '加速效果': 2}],
        proliferatorLevel: 3,
        proliferatorMode: 2,
    }), 1);
});

test('applies Mk.III acceleration efficiency to artificial stars', () => {
    assert.equal(getPowerDeviceCount({
        totalEnergy: 144,
        devicePower: 72,
        proliferatorEffects: [null, null, null, {'增产效果': 1.25, '加速效果': 2}],
        proliferatorLevel: 3,
        proliferatorMode: 1,
    }), 1);
});
