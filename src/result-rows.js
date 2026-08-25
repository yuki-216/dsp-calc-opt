/**
 * 结果表行序列计算：主物品（有净产量的物品）按 productionByItem 原序，
 * 纯联产物（自身无净产量、仅由其他配方联产产生）统一追加到表尾。
 *
 * @param {string[]} result_keys - productionByItem 的键序
 * @param {Object<string, Object<string, number>>} side_products - {联产物: {来源主物品: 数量}}
 * @returns {Array<{item: string, isCoProduct: boolean}>}
 */
export function buildResultRowOrder(result_keys, side_products) {
    const mainItems = new Set(result_keys);
    const rows = result_keys.map(item => ({item, isCoProduct: false}));
    for (const coItem of Object.keys(side_products)) {
        if (!mainItems.has(coItem)) {
            rows.push({item: coItem, isCoProduct: true});
        }
    }
    return rows;
}
