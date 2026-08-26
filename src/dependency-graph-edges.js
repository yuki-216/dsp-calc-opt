/**
 * 依赖图"仅需求模式"的无环投影
 * 职责:从核心引擎二部图的 recipes 投影出依赖图页使用的无环生产边。
 *
 * 语义(与引擎 edges 不同):引擎 edges 是"完整依赖图"(含 物品→电力 耗电边、
 * 物品→喷涂增产剂 消耗边),供优化器做真实有环 SCC 分组;依赖图页只需要
 * "简化的无环关系":
 *   - 去掉 其他物品→电力 的耗电依赖边、去掉 其他物品→喷涂增产剂 的消耗边;
 *   - 保留 增产剂配方内部真实原料边(如 增产剂Mk.III→增产剂Mk.II、Mk.II→Mk.I)
 *     与 燃料链(电力→燃料),电力/增产剂作为独立需求节点出现;
 *   - 副产物与主产物一样建"产物→真实原料"普通依赖边(不孤立,与全部配方模式一致)。
 * 区分"真实原料"与"喷涂附加输入"的唯一可靠依据是原始配方表 recipe.原料:
 * 电力与喷涂增产剂都是引擎按方案附加进 inputs 的,不在原始表里。
 */

/**
 * 从 graph.recipes 投影无环生产边
 * @param {Object} params
 * @param {Map<string, {recipeId: string, mainItem: string, outputs: Object, inputs: Object}>} params.recipes - 引擎二部图 recipes(= graph.recipes)
 * @param {Array} params.recipeData - 原始配方表 game_data.recipe_data(读 recipe.原料 区分真实原料)
 * @param {Object|null} params.needsList - 需求表 {物品: 数量},键强制入节点集
 * @param {Set|string[]|null} params.deletedItems - 被用户删除的物品(边/节点过滤)
 * @param {Set<string>} params.proliferatorItemNames - 全部增产剂物品名
 * @returns {{edges: Array<{from: string, to: string}>, items: Set<string>}}
 */
export function projectNeedsOnlyEdges({recipes, recipeData, needsList, deletedItems, proliferatorItemNames}) {
    const deleted = new Set(deletedItems || []);
    const needsSet = new Set(needsList ? Object.keys(needsList) : []);
    const proliferatorNames = new Set(proliferatorItemNames || []);

    const edges = [];
    const edgeSet = new Set();
    const items = new Set();
    const addEdge = (from, to) => {
        const key = `${from}->${to}`;
        if (edgeSet.has(key)) return;
        edgeSet.add(key);
        edges.push({from, to});
        items.add(from);
        items.add(to);
    };

    // ---- 第一遍:投影生产边 ----
    // 对配方的每个产物（含副产物）都建"产物→原料"普通依赖边（与全部配方模式一致）：
    // 副产物同样依赖配方的真实原料，不应成为孤立节点。
    for (const r of recipes.values()) {
        const outputs = Object.keys(r?.outputs || {});
        if (outputs.length === 0) continue;
        const raw = recipeData ? recipeData[Number(r.recipeId)] : null;
        const rawInputs = raw && raw.原料 ? new Set(Object.keys(raw.原料)) : null;

        for (const out of outputs) {
            for (const [k, coeff] of Object.entries(r.inputs || {})) {
                if (!(coeff > 0)) continue;
                if (k === out) continue;                    // 自环(自喷/自身消耗)
                if (k === '电力') continue;                 // 耗电:不做消耗目标边
                if (rawInputs !== null) {
                    if (!rawInputs.has(k)) continue;        // 喷涂附加输入(增产剂等)
                } else if (proliferatorNames.has(k)) {
                    continue;                               // 无原始表时保守丢弃增产剂目标
                }
                addEdge(out, k);
            }
        }
    }

    // ---- 第二遍:独立需求节点(电力/增产剂即使无生产边也保留)----
    let powerDemand = needsSet.has('电力');
    const proliferatorDemands = new Set();
    for (const r of recipes.values()) {
        for (const [k, coeff] of Object.entries(r.inputs || {})) {
            if (!(coeff > 0)) continue;
            if (k === '电力') powerDemand = true;
            else if (proliferatorNames.has(k)) proliferatorDemands.add(k);
        }
    }
    if (powerDemand) items.add('电力');
    for (const p of proliferatorDemands) items.add(p);

    // ---- 需求物品强制入节点 ----
    for (const n of needsSet) items.add(n);

    // ---- 删除过滤 ----
    for (const d of deleted) items.delete(d);
    const filteredEdges = edges.filter(e => !deleted.has(e.from) && !deleted.has(e.to));

    return {edges: filteredEdges, items};
}
