/**
 * 统计面板 - API绑定
 * 与后端 /api/seed-stats/* 交互（子进程 + 文件通信架构）
 */

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

// 统计面板各恒星的矿物/气体/液体名称（与展示复用VEIN_NAMES等）
export const STATS_STAR_NUMS = (() => {
    const list = [];
    for (let i = 32; i <= 64; i++) list.push(i);
    return list;
})();

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

/** 启动统计计算 */
export async function startStats(startSeedId = 1, endSeedId = 99999999, batchSize = 100) {
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
    return _request(API_CONFIG.endpoints.status);
}

/** 获取统计概览（各恒星数已有数据的 seed_count） */
export async function getStatsOverview() {
    return _request(API_CONFIG.endpoints.overview);
}

/** 获取指定恒星数量的统计结果 */
export async function getStats(starNum) {
    return _request(`/api/seed-stats/${starNum}`);
}