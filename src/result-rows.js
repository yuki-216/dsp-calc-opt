/**
 * 结果表行序列计算：主物品（有净产量的物品）按 productionByItem 原序，
 * 纯联产物（自身无净产量、仅由其他配方联产产生）仅在"被需求过"时追加到表尾，
 * 纯多余联产物不独立成行（多余量走「多余产物」面板）。
 *
 * @param {string[]} result_keys - productionByItem 的键序
 * @param {Object<string, Object<string, number>>} side_products - {联产物: {来源主物品: 数量}}
 * @param {Set<string>|null} demanded - 被需求过的物品集合（顶层需求 ∪ 各配方原料）；
 *   null 时保持旧行为（全部追加），空 Set 时所有纯联产物均不追加
 * @returns {Array<{item: string, isCoProduct: boolean}>}
 */
export function buildResultRowOrder(result_keys, side_products, demanded = null) {
    const mainItems = new Set(result_keys);
    const rows = result_keys.map(item => ({item, isCoProduct: false}));
    for (const coItem of Object.keys(side_products)) {
        if (!mainItems.has(coItem) && (!demanded || demanded.has(coItem))) {
            rows.push({item: coItem, isCoProduct: true});
        }
    }
    return rows;
}

/**
 * 收集"被需求过"的物品集合（CHANGELOG「联产物独立成行边界偏宽」的判据）：
 * 顶层需求 demandByItem 的键 ∪ 各已入图配方 inputs 的键。
 * 被其中任一命中即视为本次计算对该联产物有内部需求。
 *
 * @param {Object|null} graph - 引擎返回的 this.graph（含 demandByItem 与 recipes: Map）
 * @returns {Set<string>}
 */
export function collectDemandedItems(graph) {
    const demanded = new Set();
    if (!graph) return demanded;
    for (const k of Object.keys(graph.demandByItem || {})) demanded.add(k);
    for (const r of (graph.recipes?.values ? graph.recipes.values() : [])) {
        for (const k of Object.keys(r?.inputs || {})) demanded.add(k);
    }
    return demanded;
}
