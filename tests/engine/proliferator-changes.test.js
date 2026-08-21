import test from 'node:test';
import assert from 'node:assert/strict';

import {
    collectProliferatorChanges,
    collectProliferatorModeChanges,
    formatProliferatorChoice,
} from '../../src/engine/proliferator-changes.js';

test('treats a proliferator level without a mode as no proliferator', () => {
    assert.equal(formatProliferatorChoice(1, 0), '不使用');
    assert.equal(formatProliferatorChoice(0, 2), '不使用');
});

test('only reports changes for recipes used by the current calculation', () => {
    const recipes = [
        {'产物': {'塑料': 1}},
        {'产物': {'金刚石': 1}},
    ];
    const before = {
        scheme_for_recipe: [
            {'增产剂等级': 0, '增产模式': 0},
            {'增产剂等级': 0, '增产模式': 0},
        ],
    };
    const after = {
        scheme_for_recipe: [
            {'增产剂等级': 1, '增产模式': 2},
            {'增产剂等级': 1, '增产模式': 2},
        ],
    };

    assert.deepEqual(collectProliferatorChanges(before, after, recipes, new Set([0])), [
        {item: '塑料', before: '不使用', after: 'Mk.1 增产'},
    ]);
});

test('mode changes hide level-only changes but keep mode changes', () => {
    const recipes = [
        {'产物': {'塑料': 1}},
        {'产物': {'金刚石': 1}},
    ];
    const before = {
        scheme_for_recipe: [
            {'增产剂等级': 1, '增产模式': 2},
            {'增产剂等级': 1, '增产模式': 2},
        ],
    };
    const after = {
        scheme_for_recipe: [
            {'增产剂等级': 3, '增产模式': 2},
            {'增产剂等级': 1, '增产模式': 1},
        ],
    };

    assert.deepEqual(collectProliferatorModeChanges(before, after, recipes, new Set([0, 1])), [
        {item: '金刚石', before: '增产', after: '加速'},
    ]);
});
