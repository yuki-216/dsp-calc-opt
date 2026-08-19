// 统计矿脉索引与计算器物品名的统一映射。
// 源项目统计标签不一定带“矿”后缀，计算器物品名可能带后缀，因此统一在这里解析。
export const STATS_ORE_ITEMS = [
    '铁矿', '铜矿', '硅石', '钛石', '石矿', '煤矿', '原油', '可燃冰',
    '金伯利矿石', '分形硅石', '有机晶体', '光栅石', '刺笋结晶', '单极磁石',
];

const STATS_ORE_ALIASES = [
    ['铁矿', '铁'], ['铜矿', '铜'], ['硅石', '硅矿', '硅'], ['钛石', '钛矿', '钛'],
    ['石矿', '石'], ['煤矿', '煤'], ['原油', '油'], ['可燃冰'], ['金伯利矿石', '金伯利矿', '金伯利'],
    ['分形硅石', '分形硅'], ['有机晶体'], ['光栅石'], ['刺笋结晶'], ['单极磁石'],
];

export const EXCLUDED_STATS_ORE_INDEX = 7;

export function getStatsOreIndex(itemName) {
    return STATS_ORE_ALIASES.findIndex(aliases => aliases.includes(itemName));
}

export function buildOreQuantities(veinsPoint, veinsAmount, mode = 'amount') {
    const quantities = {};
    for (let index = 0; index < STATS_ORE_ITEMS.length; index++) {
        if (index === EXCLUDED_STATS_ORE_INDEX) continue;
        const rawValue = Number((mode === 'point' ? veinsPoint : veinsAmount)?.[index] || 0);
        if (rawValue <= 0) continue;
        quantities[STATS_ORE_ITEMS[index]] = index === 6 && mode === 'amount'
            ? rawValue * 0.00004
            : rawValue;
    }
    return quantities;
}
