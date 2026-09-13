/**
 * 数值精度工具：消除浮点尾巴（只去浮点误差，不做有损舍入）。
 *
 * 背景：LP 结果与等比缩放会产生 59.99999999999999 / 45.00000000000001 这类尾巴。
 * 统一按显示精度四舍五入会把真值 57.3333... 改写成 57.33（有损，且会累计误差）；
 * 原样保留则尾巴会被写进需求表并经 localStorage 永久固化，之后再缩放也无法还原。
 */

/** 尾巴判定阈值：吸附前后相对误差小于该值才认为"只是尾巴" */
const TAIL_EPS = 1e-9;
/** 真值截断的有效位数：double 约 15~17 位有效数字，12 位足以去掉尾巴 */
const TAIL_PRECISION = 12;

/** 两个数是否只差一条浮点尾巴（相对误差在阈值内） */
function is_tail(a, b) {
    return Math.abs(a - b) <= TAIL_EPS * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * 消除浮点尾巴：按显示精度吸附 → 整数吸附 → 截断到 12 位有效数字。
 * 吸附仅在误差确实是尾巴（相对误差 < 1e-9）时采用，避免把 57.3333... 变成 57.33。
 * @param {number} value - 待处理数值
 * @param {number} [fixed_num=2] - 当前显示精度位数
 * @returns {number}
 */
export function trimFloatTail(value, fixed_num = 2) {
    if (!Number.isFinite(value) || value === 0) return value;
    // 1) 按显示精度吸附：45.00000000000001 → 45、59.99999999999999 → 60
    const factor = Math.pow(10, fixed_num);
    const snapped = Math.round(value * factor) / factor;
    if (is_tail(value, snapped)) return snapped;
    // 2) 整数吸附：兜底非整数显示精度下的 60.000000000000014
    const snapped_int = Math.round(value);
    if (is_tail(value, snapped_int)) return snapped_int;
    // 3) 真值（如 57.333333333333336）：只截掉纯误差位，不改写成 57.33
    return Number(value.toPrecision(TAIL_PRECISION));
}

/**
 * 自适应精度格式化（不带单位后缀）。
 * 目标值量级跨度大（约 1e-3 ~ 1e2），固定小数位会把小值截成 0.00，
 * 故按量级切换精度。结果表与增产优化器的目标值显示共用本实现。
 * @param {number} value
 * @returns {string}
 */
export function formatAdaptivePrecision(value) {
    if (!Number.isFinite(value) || value === 0) return '0';
    const a = Math.abs(value);
    if (a >= 100) return value.toFixed(2);
    if (a >= 1) return value.toFixed(3);
    if (a >= 0.01) return value.toFixed(4);
    return Number(value.toPrecision(4)).toString();
}

/**
 * 按比例缩放需求表并消除浮点尾巴。
 * 全部写回需求表的数值都过 trimFloatTail，保证不会再把 17 位小数固化进 localStorage。
 *
 * 被调整行的物品（item 是需求表 key 时）按净需求口径精确赋值：
 * 结果表该行的显示口径是毛产出 = 净需求 × (1 + 自耗)，故净需求 = 输入值 / (1 + 自耗)。
 * 自耗为 0 时即精确等于用户输入值。
 *
 * @param {Object<string, number>} prev - 原需求表 {物品名: 数量}
 * @param {Object} opts
 * @param {number} opts.ratio - 缩放比 = 用户输入值 / 该行显示值
 * @param {number} opts.user_value - 用户输入的新值（该行显示口径）
 * @param {number} [opts.fixed_num=2] - 显示精度位数
 * @param {string} [opts.item] - 被调整行对应的物品名（无对应物品时省略）
 * @param {number} [opts.self_consumption=0] - 该物品自耗比例（引擎 selfConsumption）
 * @returns {Object<string, number>} 新需求表（键序不变）
 */
export function adjustNeedsList(prev, {ratio, user_value, fixed_num = 2, item, self_consumption = 0}) {
    const next = {};
    for (const [k, v] of Object.entries(prev)) {
        next[k] = trimFloatTail(v * ratio, fixed_num);
    }
    // 用 hasOwnProperty 而非 in：避免命中 Object.prototype 上的同名属性
    if (item !== undefined && Object.prototype.hasOwnProperty.call(prev, item)) {
        next[item] = trimFloatTail(user_value / (1 + self_consumption), fixed_num);
    }
    return next;
}
