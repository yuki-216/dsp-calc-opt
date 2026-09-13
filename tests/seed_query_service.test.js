import test from 'node:test';
import assert from 'node:assert/strict';

import { createSeedQueryService } from '../src/seed_query_service.js';
import {install_fake_storage} from './helpers/fake-storage.mjs';

test('the query service uses browser mode by default', async () => {
    install_fake_storage();
    const calls = [];
    const service = createSeedQueryService({
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
    install_fake_storage({'seed-query-mode': 'backend'});
    const service = createSeedQueryService({
        browserQuery: async () => ({ source: 'browser' }),
        backendQuery: async (...args) => ({ source: 'backend', args }),
    });

    const result = await service.querySeed(456, 32, 5);

    assert.deepEqual(result, { source: 'backend', args: [456, 32, 5] });
});

test('auto 模式在后端失败时回退浏览器', async () => {
    install_fake_storage({'seed-query-mode': 'auto'});
    const service = createSeedQueryService({
        browserQuery: async (...args) => ({ source: 'browser', args }),
        backendQuery: async () => { throw new Error('后端不可用'); },
    });

    const result = await service.querySeed(789, 64, 4);

    assert.deepEqual(result, { source: 'browser', args: [789, 64, 4] });
});

test('缺少查询函数时构造即抛错', () => {
    assert.throws(() => createSeedQueryService({browserQuery: async () => {}}), TypeError);
});
