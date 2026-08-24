/**
 * LP 构模层
 * 职责:二部图 → 结构化 LP 模型(变量=配方执行次数;约束=物品守恒 ≥;目标=min Σx)
 */

export function buildLPModel(graph) {
    const variables = [];
    const objectiveCoeffs = {};
    const varToRecipe = new Map();

    for (const recipeKey of graph.recipes.keys()) {
        variables.push({name: recipeKey});
        objectiveCoeffs[recipeKey] = 1;
        varToRecipe.set(recipeKey, recipeKey);
    }

    // 每物品一条守恒行
    const conRows = new Map(); // itemId -> {coeffs: Map<varName, coeff>}
    const ensureRow = (itemId) => {
        if (!conRows.has(itemId)) conRows.set(itemId, {coeffs: new Map()});
        return conRows.get(itemId);
    };

    for (const [recipeKey, r] of graph.recipes) {
        for (const [item, qty] of Object.entries(r.outputs)) {
            if (!qty) continue;
            const row = ensureRow(item);
            row.coeffs.set(recipeKey, (row.coeffs.get(recipeKey) || 0) + qty);
        }
        for (const [item, qty] of Object.entries(r.inputs)) {
            if (!qty) continue;
            const row = ensureRow(item);
            row.coeffs.set(recipeKey, (row.coeffs.get(recipeKey) || 0) - qty);
        }
    }

    const constraints = [];
    const allItems = new Set([...graph.items]);
    for (const item of allItems) {
        const row = ensureRow(item); // 无流量物品也建空行(RHS=需求,触发不可行诊断)
        const coeffs = {};
        for (const [v, c] of row.coeffs) {
            if (c) coeffs[v] = c;
        }
        constraints.push({
            name: `con_${item}`,
            coeffs,
            sense: '>=',
            rhs: graph.demandByItem[item] || 0,
        });
    }

    return {
        model: {variables, objective: {coeffs: objectiveCoeffs}, constraints},
        varToRecipe,
    };
}
