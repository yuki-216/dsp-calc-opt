import test from 'node:test';
import assert from 'node:assert/strict';

import {validateFinalProliferatorChoices} from './proliferator-final-validation.js';

function makeScheme(aLevel = 1, bLevel = 1) {
    return {
        scheme_for_recipe: [
            {'增产剂等级': aLevel, '增产模式': aLevel ? 2 : 0},
            {'增产剂等级': bLevel, '增产模式': bLevel ? 2 : 0},
        ],
    };
}

test('removes a final proliferator whose marginal improvement is below threshold', async () => {
    const logs = [];
    const result = await validateFinalProliferatorChoices({
        sccs: [new Set(['A']), new Set(['B'])],
        scheme: makeScheme(1, 1),
        itemToRecipe: new Map([['A', 0], ['B', 1]]),
        strategy: 'min_power',
        threshold: 0.011,
        onLog: message => logs.push(message),
        calculateResult: (_gameData, scheme) => ({
            totalEnergyCost: 100 - (scheme.scheme_for_recipe[0]['增产剂等级'] ? 0.5 : 0)
                - (scheme.scheme_for_recipe[1]['增产剂等级'] ? 2 : 0),
        }),
    });

    assert.equal(result.scheme.scheme_for_recipe[0]['增产剂等级'], 0);
    assert.equal(result.scheme.scheme_for_recipe[1]['增产剂等级'], 1);
    assert.deepEqual(result.revertedItems, ['A']);
    assert.equal(logs[0], '最终边际验证开始（阈值：1.10%）');
    assert.equal(logs[1], 'A：改善 0.51%，撤销');
});

test('checks SCCs in forward order and returns the recalculated final result', async () => {
    const visited = [];
    const result = await validateFinalProliferatorChoices({
        sccs: [new Set(['A']), new Set(['B'])],
        scheme: makeScheme(1, 1),
        itemToRecipe: new Map([['A', 0], ['B', 1]]),
        strategy: 'min_power',
        threshold: 0.005,
        calculateResult: (_gameData, scheme) => {
            visited.push(`${scheme.scheme_for_recipe[0]['增产剂等级']}${scheme.scheme_for_recipe[1]['增产剂等级']}`);
            return {
                totalEnergyCost: 100 - (scheme.scheme_for_recipe[0]['增产剂等级'] ? 2 : 0)
                    - (scheme.scheme_for_recipe[1]['增产剂等级'] ? 3 : 0),
            };
        },
    });

    assert.deepEqual(result.revertedItems, []);
    assert.equal(result.result.totalEnergyCost, 95);
    assert.ok(visited.length > 0);
});
