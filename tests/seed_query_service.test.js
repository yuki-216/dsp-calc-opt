import test from 'node:test';
import assert from 'node:assert/strict';

import { createSeedQueryService } from '../src/seed_query_service.js';

test('the query service uses browser mode by default', async () => {
    const calls = [];
    const service = createSeedQueryService({
        storage: new Map(),
        browserQuery: async (...args) => {
            calls.push(['browser', args]);
            return { source: 'browser' };
        },
        backendQuery: async (...args) => {
            calls.push(['backend', args]);
            return { source: 'backend' };
        },
    });

    const result = await service.querySeed(123, 64, 4);

    assert.deepEqual(result, { source: 'browser' });
    assert.deepEqual(calls, [['browser', [123, 64, 4]]]);
});

test('the query service honors the console-selected backend mode', async () => {
    const storage = new Map([['seed-query-mode', 'backend']]);
    const service = createSeedQueryService({
        storage,
        browserQuery: async () => ({ source: 'browser' }),
        backendQuery: async (...args) => ({ source: 'backend', args }),
    });

    const result = await service.querySeed(456, 32, 5);

    assert.deepEqual(result, { source: 'backend', args: [456, 32, 5] });
});
