/**
 * 统计面板 - 数据绑定
 * browser 模式读取公开 stats.json，backend 模式连接本地 API。
 */

import { getSeedQueryMode } from './seed_query.js';

// API配置 - 与 seed_viewer_binding 一致
const API_CONFIG = {
    baseUrl: import.meta.env.DEV ? '' : 'http://localhost:8000',
    endpoints: {
        start: '/api/seed-stats/start',
        stop: '/api/seed-stats/stop',
        resume: '/api/seed-stats/resume',
        status: '/api/seed-stats/status',
        overview: '/api/seed-stats/overview',
    }
};

async function _request(url, options = {}) {
    const response = await fetch(`${API_CONFIG.baseUrl}${url}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.detail || '请求失败 (' + response.status + ')');
    }
    return data;
}

let publishedStatsPromise;

async function loadPublishedStats() {
    if (!publishedStatsPromise) {
        publishedStatsPromise = fetch(`${import.meta.env.BASE_URL}stats.json`).then(async response => {
            if (!response.ok) throw new Error(`公开统计数据请求失败 (${response.status})`);
            return response.json();
        });
    }
    return publishedStatsPromise;
}

function getPublishedStats(starNum) {
    return loadPublishedStats().then(data => {
        const stats = data[String(starNum)];
        if (!stats) throw new Error(`没有${starNum}恒星的公开统计数据`);
        return stats;
    });
}

function ciInfo(mean, m2, n) {
    if (n < 2) return { mean, std: 0, se: 0, ci_half: 0, relative_error: null };
    if (m2 <= 0) {
        return { mean, std: 0, se: 0, ci_half: 0, relative_error: mean === 0 ? null : 0 };
    }
    const std = Math.sqrt(m2 / (n - 1));
    const se = std / Math.sqrt(n);
    const ciHalf = 1.96 * se;
    return {
        mean,
        std,
        se,
        ci_half: ciHalf,
        relative_error: Math.abs(mean) < Number.EPSILON ? null : ciHalf / Math.abs(mean),
    };
}

function getPublishedConvergence(stats) {
    const n = stats.seed_count || 0;
    const galaxySummary = {};
    for (const field of ['veins_point', 'veins_amount']) {
        galaxySummary[field] = (stats.summary_avg?.[field] || []).map((mean, index) =>
            ciInfo(mean, stats.summary_m2?.[field]?.[index] || 0, n));
    }
    const fields = (stats.stars_stats || []).map(star => ({
        distance: ciInfo(star.avg_distance, star.m2_distance, n),
        veins_point: (star.avg_veins_point || []).map((mean, index) =>
            index === 7 ? ciInfo(0, 0, n) : ciInfo(mean, star.m2_veins_point?.[index] || 0, n)),
        veins_amount: (star.avg_veins_amount || []).map((mean, index) =>
            index === 7 ? ciInfo(0, 0, n) : ciInfo(mean, star.m2_veins_amount?.[index] || 0, n)),
    }));
    return { seed_count: n, confidence: 0.95, fields, galaxy_summary: galaxySummary, stale: false };
}

/** 启动统计计算（从头开始：清空进度和已有均值） */
export async function startStats(startSeedId = 1, endSeedId = 99999999, batchSize = 1) {
    return _request(API_CONFIG.endpoints.start, {
        method: 'POST',
        body: JSON.stringify({ start_seed_id: startSeedId, end_seed_id: endSeedId, batch_size: batchSize }),
    });
}

/** 停止统计计算（优雅停止） */
export async function stopStats() {
    return _request(API_CONFIG.endpoints.stop, { method: 'POST' });
}

/** 恢复统计计算 */
export async function resumeStats() {
    return _request(API_CONFIG.endpoints.resume, { method: 'POST' });
}

/** 获取计算状态 */
export async function getStatsStatus() {
    if (getSeedQueryMode() !== 'backend') {
        const stats = await getStatsOverview();
        const max = stats.stats.reduce((value, item) => Math.max(value, item.seed_count || 0), 0);
        return { is_running: false, current_seed_id: max, total_seeds: max, progress_percent: 100, seed_count: max };
    }
    return _request(API_CONFIG.endpoints.status);
}

/** 获取统计概览（各恒星数已有数据的 seed_count） */
export async function getStatsOverview() {
    if (getSeedQueryMode() !== 'backend') {
        const data = await loadPublishedStats();
        return {
            stats: Object.entries(data).map(([starNum, value]) => ({
                star_num: Number(starNum),
                seed_count: value.seed_count || 0,
            })),
        };
    }
    return _request(API_CONFIG.endpoints.overview);
}

/** 获取指定恒星数量的统计结果 */
export async function getStats(starNum) {
    if (getSeedQueryMode() !== 'backend') return getPublishedStats(starNum);
    return _request(`/api/seed-stats/${starNum}`);
}

/** 获取指定恒星数量的收敛信息（含每个指标的 CI 与相对误差） */
export async function getStatsConvergence(starNum) {
    if (getSeedQueryMode() !== 'backend') {
        return getPublishedStats(starNum).then(getPublishedConvergence);
    }
    return _request(`/api/seed-stats/${starNum}/convergence`);
}

// ========== 统计矿脉索引 ↔ 计算器物品名映射 ==========

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

const EXCLUDED_STATS_ORE_INDEX = 7;

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
