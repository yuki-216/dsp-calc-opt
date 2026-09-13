/**
 * 配置导入导出：核心 6 个 localStorage 键的收集、校验与合并。
 *
 * 导出范围（严格核心 6 项）：
 *   auto_scheme                        - 按数据源分桶的方案（scheme_data）
 *   dsp-calc-needs-list                - 需求表 {物品名: 数量}
 *   auto_settings                      - 扁平设置（含 mineralize_list / ore_quantities）
 *   game_source                        - 当前数据源
 *   dsp-optim-strategy                 - 优化策略
 *   dsp-no-proliferator-weight-percent - 无增产剂权重百分数
 * 不导出：依赖图三 key、theme、seed-viewer-settings、seed-query-mode、
 *         seed-viewer-cache、dsp-calc-debug、遗留 scheme_data、瞬态 dsp-calc-new-tab-data。
 *
 * 存储里的值原样保留字符串，不做 JSON 二次包装——因为其中三个键存的是 JSON 文本、
 * 另三个存的是裸字符串（如 game_source 直接就是 'Vanilla'），统一按字符串搬运才无损。
 */

/** 导出/导入涉及的核心键（顺序即写入顺序） */
export const EXPORT_KEYS = [
    'auto_scheme',
    'dsp-calc-needs-list',
    'auto_settings',
    'game_source',
    'dsp-optim-strategy',
    'dsp-no-proliferator-weight-percent',
];

/** 每个键的存储形态：json = JSON 文本；raw = 裸字符串 */
const KEY_KINDS = {
    'auto_scheme': 'json',
    'dsp-calc-needs-list': 'json',
    'auto_settings': 'json',
    'game_source': 'raw',
    'dsp-optim-strategy': 'raw',
    'dsp-no-proliferator-weight-percent': 'raw',
};

const FILE_APP = 'dsp-calc-opt';
const FILE_TYPE = 'config';

/** 值是否为普通对象（排除 null 与数组） */
function is_plain_object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 收集导出载荷
 * @param {Object} opts
 * @param {{getItem: (key: string) => (string|null)}} opts.storage - 读取适配器；
 *        生产环境传 {getItem: persistGet}，于是沙盒子窗口导出的是它自己看到的配置
 * @param {string} [opts.version] - 应用版本号（仅记录，不参与校验）
 * @returns {Object} 可 JSON.stringify 的导出载荷
 */
export function buildExportPayload({storage, version = ''} = {}) {
    const data = {};
    for (const key of EXPORT_KEYS) {
        const raw = storage ? storage.getItem(key) : null;
        if (raw !== null && raw !== undefined) data[key] = raw;
    }
    return {
        app: FILE_APP,
        type: FILE_TYPE,
        version,
        exported_at: new Date().toISOString(),
        data,
    };
}

/**
 * 解析导入文件文本
 * @param {string} text - 文件内容
 * @returns {{ok: true, payload: Object} | {ok: false, error: string}}
 */
export function parseImportFile(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return {ok: false, error: '文件不是合法的 JSON，导入已取消。'};
    }
    if (!is_plain_object(parsed) || parsed.app !== FILE_APP || parsed.type !== FILE_TYPE
        || !is_plain_object(parsed.data)) {
        return {ok: false, error: '这不是本计算器「配置管理」导出的配置文件，导入已取消。'};
    }
    return {ok: true, payload: parsed};
}

/**
 * 校验并整理导入载荷，产出可直接写入的 [key, value] 列表。
 *
 * 合并语义：按 localStorage 键粒度——文件里有哪个键就整个替换哪个键，没有的保持不变。
 * 例外是 auto_scheme：它是 {数据源: 方案} 的分桶对象，整键替换会连另一个数据源的方案
 * 一起抹掉，故按桶合并（只覆盖文件里存在且校验通过的那些桶）。
 *
 * @param {Object} payload - parseImportFile 的 payload
 * @param {Object} opts
 * @param {string} opts.current_source - 当前数据源名（文件未指定数据源时沿用）
 * @param {(name: string) => (number|undefined)} opts.recipe_count_of - 取某数据源的配方总数；undefined 表示数据源不存在
 * @param {(name: string) => (Set<string>|undefined)} opts.item_names_of - 取某数据源的物品名集合
 * @param {Object} [opts.current_auto_scheme] - 已解析的当前 auto_scheme（桶级合并的基底）
 * @returns {{ok: true, entries: Array<[string, string]>, warnings: string[], effective_source: string}
 *          | {ok: false, error: string, warnings: string[]}}
 */
export function validateImport(payload, opts) {
    const {current_source, recipe_count_of, item_names_of, current_auto_scheme = {}} = opts;
    const warnings = [];
    const entries = [];
    const source_known = (name) => typeof name === 'string' && recipe_count_of(name) !== undefined;

    // 导入后生效的数据源：文件里指定且存在就用它，否则沿用当前数据源
    let effective_source = current_source;
    const raw_source = payload.data['game_source'];
    if (raw_source !== undefined) {
        if (source_known(raw_source)) {
            effective_source = raw_source;
            entries.push(['game_source', raw_source]);
        } else {
            warnings.push('配置里的数据源不存在，已忽略该项。');
        }
    }

    for (const key of EXPORT_KEYS) {
        if (key === 'game_source') continue;   // 上面已处理
        const value = payload.data[key];
        if (value === undefined) continue;
        if (typeof value !== 'string') {
            warnings.push(`「${key}」格式不正确，已跳过。`);
            continue;
        }

        if (KEY_KINDS[key] === 'raw') {
            if (key === 'dsp-no-proliferator-weight-percent' && !Number.isFinite(Number(value))) {
                warnings.push('无增产剂加权百分比不是有效数字，已跳过。');
                continue;
            }
            if (key === 'dsp-optim-strategy' && value === '') {
                warnings.push('优化策略为空，已跳过。');
                continue;
            }
            entries.push([key, value]);
            continue;
        }

        let parsed;
        try {
            parsed = JSON.parse(value);
        } catch {
            warnings.push(`「${key}」内容无法解析，已跳过。`);
            continue;
        }

        if (key === 'dsp-calc-needs-list') {
            if (!is_plain_object(parsed)) {
                warnings.push('需求表格式不正确，已跳过。');
                continue;
            }
            entries.push([key, value]);
        } else if (key === 'auto_settings') {
            if (!is_plain_object(parsed)) {
                warnings.push('设置格式不正确，已跳过。');
                continue;
            }
            const cleaned = clean_source_bound_settings(parsed, effective_source, item_names_of, warnings);
            entries.push([key, JSON.stringify(cleaned)]);
        } else if (key === 'auto_scheme') {
            const merged = merge_scheme_buckets(current_auto_scheme, parsed, recipe_count_of, warnings);
            if (merged) entries.push([key, JSON.stringify(merged)]);
        }
    }

    if (entries.length === 0) {
        return {ok: false, error: '文件里没有可导入的核心配置项。', warnings};
    }
    return {ok: true, entries, warnings, effective_source};
}

/**
 * 桶级合并方案：只覆盖文件里存在且长度校验通过的数据源分桶，其余桶原样保留。
 * @returns {Object|null} 合并结果；没有任何桶被采纳时返回 null（跳过该键）
 */
function merge_scheme_buckets(current, incoming, recipe_count_of, warnings) {
    if (!is_plain_object(incoming)) {
        warnings.push('方案格式不正确，已跳过。');
        return null;
    }
    const merged = {...current};
    let adopted = 0;
    for (const [name, bucket] of Object.entries(incoming)) {
        if (!is_plain_object(bucket) || !Array.isArray(bucket.scheme_for_recipe)) {
            warnings.push(`方案「${name}」格式不正确，已跳过。`);
            continue;
        }
        const expected = recipe_count_of(name);
        if (expected === undefined) {
            warnings.push(`方案「${name}」对应的数据源不存在，已跳过。`);
            continue;
        }
        // 长度必须与目标数据源的配方数一致，否则 contexts.jsx 初始化时会判定无效
        // 并静默回退默认方案
        if (bucket.scheme_for_recipe.length !== expected) {
            warnings.push(`方案「${name}」与当前游戏数据不匹配`
                + `（配方数 ${bucket.scheme_for_recipe.length} ≠ ${expected}），已跳过。`);
            continue;
        }
        merged[name] = bucket;
        adopted++;
    }
    return adopted > 0 ? merged : null;
}

/**
 * 过滤与数据源绑定的设置项：矿物可用量与原矿化列表都以物品名为键，
 * 跨数据源导入时会留下目标源不存在的名字（结果表会渲染成异常图标）。
 * @returns {Object} 过滤后的设置对象
 */
function clean_source_bound_settings(settings, source, item_names_of, warnings) {
    const known = item_names_of(source);
    if (!known) return settings;
    const cleaned = {...settings};
    for (const field of ['mineralize_list', 'ore_quantities']) {
        const value = cleaned[field];
        if (!is_plain_object(value)) continue;
        const kept = {};
        let dropped = 0;
        for (const [item, v] of Object.entries(value)) {
            if (known.has(item)) kept[item] = v; else dropped++;
        }
        if (dropped > 0) {
            warnings.push(`${field === 'mineralize_list' ? '原矿化列表' : '矿物可用量'}里有 `
                + `${dropped} 个当前数据源不存在的物品，已剔除。`);
            cleaned[field] = kept;
        }
    }
    return cleaned;
}

/**
 * 按键写入（合并语义由 validateImport 产出的 entries 决定）
 * @param {Array<[string, string]>} entries
 * @param {(key: string, value: string) => void} write
 */
export function applyImport(entries, write) {
    for (const [key, value] of entries) {
        write(key, value);
    }
}
