/**
 * 珍稀矿实用性修正
 *
 * 珍稀权重法 / 最大瓶颈法只按矿脉可用量衡量稀缺度，未考虑某些珍稀矿可被普通矿配方替代。
 * 本模块为刺笋结晶、金伯利矿石、分形硅石定义"等价普通矿"规则，将它们的稀缺度按
 * 替代比例折算到普通矿上（保留少量珍稀溢价，以体现占地/产线复杂度等未量化优势）。
 *
 * 等价规则来自用户给定的实用等价：每 180 刺笋结晶 ≈ 60 钛石；每 30 金伯利矿石 ≈ 120 煤矿；
 * 每 30 分形硅石 ≈ 120 硅石。等价中的电力部分忽略（后期电力由高级燃料供给，相对不值钱）。
 */

/** 替代比例：0.95 折算到普通矿，0.05 保留自身珍稀溢价 */
export const RARE_ORE_PRACTICALITY_RATIO = 0.95;

/**
 * 等价规则：珍稀矿 -> { commonOre, rareAmount, commonAmount, factor }
 * factor = commonAmount / rareAmount（1 单位珍稀矿等价多少单位普通矿）
 */
export const RARE_ORE_EQUIVALENCE = {
    '刺笋结晶': {commonOre: '钛石', rareAmount: 180, commonAmount: 60, factor: 60 / 180},
    '金伯利矿石': {commonOre: '煤矿', rareAmount: 30, commonAmount: 120, factor: 120 / 30},
    '分形硅石': {commonOre: '硅石', rareAmount: 30, commonAmount: 120, factor: 120 / 30},
};

/**
 * 判断某珍稀矿是否可修正。
 * 需同时满足：存在等价规则、自身可用量 > 0、普通矿可用量 > 0。
 * @param {string} item - 物品ID
 * @param {Object} availMap - 物品 -> 有效可用量（已做原油产率换算）
 * @returns {Object|null} {rule, rareAvail, commonAvail} 或 null
 */
export function getRareOreCorrection(item, availMap) {
    const rule = RARE_ORE_EQUIVALENCE[item];
    if (!rule) return null;
    const rareAvail = availMap[item];
    const commonAvail = availMap[rule.commonOre];
    if (!rareAvail || !commonAvail) return null;
    return {rule, rareAvail, commonAvail};
}

/**
 * 修正后单位权重（珍稀权重法）
 * 单位权重 = ratio × factor × (基准可用量/普通矿可用量) + (1-ratio) × (基准可用量/珍稀矿可用量)
 */
export function correctedRareWeightUnit(correction, baseAvail, ratio = RARE_ORE_PRACTICALITY_RATIO) {
    const {rule, rareAvail, commonAvail} = correction;
    return ratio * rule.factor * (baseAvail / commonAvail) + (1 - ratio) * (baseAvail / rareAvail);
}

/**
 * 修正后单位瓶颈（最大瓶颈法）
 * 单位瓶颈 = ratio × factor / 普通矿可用量 + (1-ratio) / 珍稀矿可用量
 */
export function correctedRareBottleneckUnit(correction, ratio = RARE_ORE_PRACTICALITY_RATIO) {
    const {rule, rareAvail, commonAvail} = correction;
    return ratio * rule.factor / commonAvail + (1 - ratio) / rareAvail;
}

/**
 * 修正后的折算明细（用于日志）：消耗量按替代比例拆成"折算到普通矿的量"与"保留的量"。
 * @returns {{converted: number, retained: number}}
 */
export function convertedRareOreAmount(correction, amount, ratio = RARE_ORE_PRACTICALITY_RATIO) {
    const {rule} = correction;
    return {
        converted: amount * ratio * rule.factor,
        retained: amount * (1 - ratio),
    };
}
