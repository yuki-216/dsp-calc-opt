import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getSeedQueryMode,
    resetSeedQueryMode,
    setSeedQueryMode,
} from '../src/seed_query_mode.js';

test('browser is the default seed query mode', () => {
    const storage = new Map();

    assert.equal(getSeedQueryMode(storage), 'browser');
});

test('console mode changes persist and invalid modes are rejected', () => {
    const storage = new Map();

    assert.equal(setSeedQueryMode('backend', storage), 'backend');
    assert.equal(getSeedQueryMode(storage), 'backend');
    assert.throws(() => setSeedQueryMode('unknown', storage), /Invalid seed query mode/);

    assert.equal(resetSeedQueryMode(storage), 'browser');
    assert.equal(getSeedQueryMode(storage), 'browser');
});
