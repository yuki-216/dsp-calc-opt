import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getSeedQueryMode,
    resetSeedQueryMode,
    setSeedQueryMode,
} from '../src/seed_query_mode.js';
import {install_fake_storage} from './helpers/fake-storage.mjs';

test('browser is the default seed query mode', () => {
    install_fake_storage();

    assert.equal(getSeedQueryMode(), 'browser');
});

test('console mode changes persist and invalid modes are rejected', () => {
    const store = install_fake_storage();

    assert.equal(setSeedQueryMode('backend'), 'backend');
    assert.equal(getSeedQueryMode(), 'backend');
    assert.equal(store.get('seed-query-mode'), 'backend');
    assert.throws(() => setSeedQueryMode('unknown'), /Invalid seed query mode/);

    assert.equal(resetSeedQueryMode(), 'browser');
    assert.equal(getSeedQueryMode(), 'browser');
});

test('非法的已存值回退 browser', () => {
    install_fake_storage({'seed-query-mode': 'nonsense'});

    assert.equal(getSeedQueryMode(), 'browser');
});
