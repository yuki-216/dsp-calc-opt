import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getThresholdMetric,
    relativeObjectiveImprovement,
    shouldAcceptProliferator,
} from '../../src/engine/proliferator-threshold.js';

test('returns the objective value for threshold comparisons', () => {
    assert.equal(getThresholdMetric({objectiveValue: 123}), 123);
    assert.equal(getThresholdMetric({}), 0);
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
