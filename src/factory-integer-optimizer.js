// 整数优化建议：混合工厂等级凑偶数台
//
// 纯前端后处理：只在结果表渲染层提供"如何用多等级设备凑出偶数台"的建议，
// 不进入 LP 核心计算，不改电力/占地/建筑统计，也不覆盖原浮点台数列。
//
// 两类优化方向：
//  - compact（第一类·紧凑）：台数向下取整到偶数，只允许换到"高一级"设备，
//    高级设备越少越好（省占地）。
//  - economy（第二类·省料）：台数向上取整到最小偶数，只允许用"低级+基础"等级，
//    低级越多越好（避免浪费）。
//
// 方向判定：最低级基础强制 compact，最高级基础强制 economy，中间等级按全局设置。
// 仅适用于熔炉/制造台/化工厂三类设备（其余类型无混排意义）。

const OPTIMIZABLE_FACTORY_KEYWORDS = ['制造台', '熔炉', '化工厂'];

/** 是否为可做整数优化的设备类型组（仅熔炉/制造台/化工厂三类） */
export function isOptimizableFactoryGroup(group) {
    if (!Array.isArray(group)) return false;
    return group.some(f => OPTIMIZABLE_FACTORY_KEYWORDS.some(k => (f?.['名称'] || '').includes(k)));
}

/**
 * 计算整数优化建议
 * @param {object} opts
 * @param {number} opts.c            当前选中等级的浮点设备数（buildingDetails[item].设备数量）
 * @param {Array<{名称:string, 倍率:number}>} opts.levels 该设备类型全部等级（按下标序）
 * @param {number} opts.baseIndex    当前选中等级下标（scheme_for_recipe[id]["建筑"]）
 * @param {'compact'|'economy'} opts.direction 全局设置方向（仅中间等级使用；最低/最高级被覆盖）
 * @returns {{total:number, mix:Array<{levelIndex:number,count:number}>, type:'compact'|'economy'}|null}
 *          建议无效/无需调整时返回 null
 */
export function optimizeFactoryMix({c, levels, baseIndex, direction}) {
    if (!(c > 0) || !Array.isArray(levels) || levels.length < 2) return null;
    if (baseIndex < 0 || baseIndex >= levels.length) return null;

    // 各等级相对基础等级的产能（基础等级 = 1）
    const fBase = levels[baseIndex]['倍率'] || 1;
    const rel = levels.map(l => (l['倍率'] || 1) / fBase);

    // 方向判定：最低级→紧凑，最高级→省料，中间→全局设置
    // （历史 localStorage 可能残留 'off' 等非法值，按默认紧凑兜底）
    let dir;
    if (baseIndex === 0) dir = 'compact';
    else if (baseIndex === levels.length - 1) dir = 'economy';
    else dir = direction === 'economy' ? 'economy' : 'compact';

    const ceilC = Math.ceil(c);

    if (dir === 'compact') {
        if (ceilC % 2 === 0) {
            // 台数已是最小偶数，无需向下取整，自动转入省料：用低级削减过剩产能
            return solveEconomy(c, rel, baseIndex, ceilC);
        }
        // 向下取整到偶数
        const N = ceilC - 1;
        if (N < 2 || N * rel[baseIndex + 1] < c) {
            // 无法向下取整到合法偶数台（设备数过小、或全换高一级也补不够产能）：
            // 最低级强制紧凑 → 已最紧凑，无需建议；中间级紧凑 → 回退省料方案
            if (baseIndex === 0) return null;
            return solveEconomy(c, rel, baseIndex, ceilC + 1);
        }
        // 只允许 base 与 base+1 两等级，高级设备越少越好（k 最小）
        const fUp = rel[baseIndex + 1];
        let k = Math.ceil((c - N) / (fUp - 1));
        k = Math.max(0, Math.min(N, k));
        const mix = [];
        if (N - k > 0) mix.push({levelIndex: baseIndex, count: N - k});
        if (k > 0) mix.push({levelIndex: baseIndex + 1, count: k});
        return {total: N, mix, type: 'compact'};
    }

    // 省料：向上取整到最小偶数
    const N = ceilC % 2 === 0 ? ceilC : ceilC + 1;
    return solveEconomy(c, rel, baseIndex, N);
}

/**
 * 省料解：N 台固定（最小偶数），只允许 levelIndex <= baseIndex 的等级，
 * 从最低级到基础级贪心（低级越多越好），剩余产能由基础级兜底。
 * 全部落在基础级（无混排）时返回 null。
 */
function solveEconomy(c, rel, baseIndex, N) {
    let remaining = c;
    let slots = N;
    const mix = [];
    for (let i = 0; i <= baseIndex; i++) {
        if (slots <= 0) break;
        if (i === baseIndex) {
            if (slots > 0) mix.push({levelIndex: i, count: slots});
            break;
        }
        const fi = rel[i];
        // 最大 n 使 n*fi + (slots-n)*1 >= remaining（其余由基础级兜底）
        let n = Math.floor((slots - remaining) / (1 - fi));
        n = Math.max(0, Math.min(slots, n));
        if (n > 0) mix.push({levelIndex: i, count: n});
        remaining -= n * fi;
        slots -= n;
    }
    // 无混排（全部落在基础级）→ 无建议
    if (mix.length === 1 && mix[0].levelIndex === baseIndex) return null;
    return {total: N, mix, type: 'economy'};
}
