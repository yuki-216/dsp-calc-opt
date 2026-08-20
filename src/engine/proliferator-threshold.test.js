import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getThresholdMetric,
    relativeBottleneckImprovement,
    relativeObjectiveImprovement,
    shouldAcceptProliferator,
} from './proliferator-threshold.js';

test('returns the sorted bottleneck vector for raw-ore threshold comparisons', () => {
    const result = {
        totalRawOre: 123,
        bottleneckArray: [
            {item: '铁', bottleneck: 0.00000125},
            {item: '铜', bottleneck: 0.00000090},
        ],
    };

    assert.deepEqual(getThresholdMetric(result, 'min_raw_ore'), result.bottleneckArray);
});

test('uses the next bottleneck when the highest bottleneck is unchanged', () => {
    const baseline = [
        {item: '煤矿', bottleneck: 1},
        {item: '原油', bottleneck: 0.8},
    ];
    const candidate = [
        {item: '煤矿', bottleneck: 1},
        {item: '原油', bottleneck: 0.795},
    ];

    assert.ok(Math.abs(relativeBottleneckImprovement(baseline, candidate) - 0.005 / 0.8) < 1e-12);
    assert.equal(shouldAcceptProliferator({baseline, candidate, threshold: 0.005}), true);
});

test('uses the no-proliferator objective as the relative improvement baseline', () => {
    assert.ok(Math.abs(relativeObjectiveImprovement(100, 99.5) - 0.005) < 1e-12);
    assert.ok(Math.abs(relativeObjectiveImprovement(100, 99.6) - 0.004) < 1e-12);
});

test('rejects proliferator when improvement is below the configured threshold', () => {
    assert.equal(shouldAcceptProliferator({baseline: 100, candidate: 99.6, threshold: 0.005}), false);
    assert.equal(shouldAcceptProliferator({baseline: 100, candidate: 99.5, threshold: 0.005}), true);
});

test('accepts a strictly better candidate when the no-proliferator baseline is zero', () => {
    assert.equal(shouldAcceptProliferator({baseline: 0, candidate: -1, threshold: 0.005}), true);
    assert.equal(shouldAcceptProliferator({baseline: 0, candidate: 0, threshold: 0.005}), false);
});
