/**
 * LP 构模层
 * 职责:二部图 → 结构化 LP 模型(变量=配方执行次数;约束=物品守恒 ≥;目标=min Σx + Σslack)
 */

const SLACK_PREFIX = 'slack_';
// 不变量:配方键恒为数字串,故 'slack_' 前缀与配方键不可能碰撞;slack 变量仅服务无配方物品。

/**
 * 生成 noRecipeItems 物品的松弛变量名
 * @param {string} itemId - 物品名
 * @returns {string} 松弛变量名
 */
export function slackVar(itemId) {
    return SLACK_PREFIX + itemId;
}

/**
 * 判断变量名是否为松弛变量,是则返回物品名
 * @param {string} varName - 变量名
 * @returns {string|null} 物品名;非松弛变量返回 null
 */
export function parseSlackItem(varName) {
    return varName.startsWith(SLACK_PREFIX) ? varName.slice(SLACK_PREFIX.length) : null;
}

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

    // 真·无配方物品(未选燃料的电力、mineralize_list 原矿等):守恒行只有负系数会 Infeasible,
    // 加松弛列 slack_item ≥ 0 进该物品行正侧(+1),目标系数 1——
    // min 目标下 slack 只在必要时取正值,即"外部获取缺口"。
    // 注意:有采集配方的原矿(铁矿/原油/氢轨道采集器等)不在 noRecipeItems 中,
    // 走正常配方路径,绝不加 slack(否则设备表丢失采矿机)。
    for (const item of graph.noRecipeItems) {
        variables.push({name: slackVar(item)});
        objectiveCoeffs[slackVar(item)] = 1;
        const row = ensureRow(item);
        row.coeffs.set(slackVar(item), (row.coeffs.get(slackVar(item)) || 0) + 1);
    }

    const constraints = [];
    const allItems = new Set([...graph.items]);
    for (const item of allItems) {
        const row = ensureRow(item); // 无流量物品也建空行(RHS=需求)
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
