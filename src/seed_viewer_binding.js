/**
 * 种子查看器 - 查询引擎绑定
 * 默认使用浏览器 WASM，控制台可切换到本地后端
 */

import { createSeedQueryService } from './seed_query_service.js';
import { getSeedQueryMode } from './seed_query_mode.js';
import { getBrowserSeedData } from './seed_query_browser.js';

// API配置 - 开发模式使用代理，生产模式使用完整URL
const API_CONFIG = {
    baseUrl: import.meta.env.VITE_BACKEND_URL || (import.meta.env.DEV ? '' : 'http://localhost:8000'),
    endpoints: {
        seed: '/api/seed',
        health: '/api/health'
    }
};

// 常量定义
export const VEIN_NAMES = ['铁', '铜', '硅', '钛', '石', '煤', '油', '可燃冰', '金伯利', '分形硅', '有机晶体', '光栅石', '刺笋结晶', '单极磁石'];
export const STAR_TYPES = ['红巨星', '黄巨星', '蓝巨星', '白巨星', '白矮星', '中子星', '黑洞', 'A型恒星', 'B型恒星', 'F型恒星', 'G型恒星', 'K型恒星', 'M型恒星', 'O型恒星'];
export const RESOURCE_RATES = [
    { index: 0, label: '0.1x (极少)' },
    { index: 1, label: '0.3x' },
    { index: 2, label: '0.5x' },
    { index: 3, label: '0.8x' },
    { index: 4, label: '1.0x' },
    { index: 5, label: '1.5x' },
    { index: 6, label: '2.0x' },
    { index: 7, label: '3.0x' },
    { index: 8, label: '5.0x' },
    { index: 9, label: '8.0x' },
    { index: 10, label: '无限' }
];

/**
 * 初始化API连接
 */
export async function doInit() {
    if (getSeedQueryMode() !== 'backend') return true;
    try {
        const response = await fetch(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.health}`);
        if (response.ok) {
            console.log('API服务器连接成功');
            return true;
        }
    } catch (error) {
        console.error('API服务器连接失败:', error);
        throw new Error('无法连接到后端服务器，请确保Python后端正在运行');
    }
}

/**
 * 验证种子数据是否有效
 */
export function isSeedDataValid(seedData) {
    return seedData &&
           seedData.seed_id !== undefined &&
           seedData.stars &&
           Array.isArray(seedData.stars);
}

/**
 * 获取种子数据 - 本地后端实现
 */
export async function getBackendSeedData(seedId, starNum = 64, resourceIndex = 0) {
    try {
        const response = await fetch(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.seed}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                seed_id: seedId,
                star_num: starNum,
                resource_index: resourceIndex
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || '请求失败');
        }

        const data = await response.json();
        return data;  // 直接返回原始数据，不做转换
    } catch (error) {
        console.error('获取种子数据失败:', error);
        throw error;
    }
}

function normalizePlanet(planet, starIndex, planetIndex) {
    return {
        star_index: planet.starIndex ?? starIndex,
        planet_index: planet.planetIndex ?? planetIndex,
        name: planet.name,
        type: planet.type,
        type_id: planet.typeId,
        singularity: planet.singularity,
        singularity_str: planet.singularityStr || [],
        pos_m: planet.posM || [0, 0, 0],
        pos_ly: planet.posLy || [0, 0, 0],
        seed: planet.seed,
        lumino: planet.lumino,
        wind: planet.wind,
        radius: planet.radius,
        liquid: planet.liquid,
        is_gas: planet.isGas,
        dsp_level: planet.dspLevel,
        raw_dsp_degree: planet.rawDspDegree,
        enhance_dsp_degree: planet.enhanceDspDegree,
        obliquity: planet.obliquity,
        land_percent: planet.landPercent,
        veins_point: planet.veinsPoint,
        veins_amount: planet.veinsAmount,
        gas_veins: planet.gasVeins,
        moons: (planet.moons || []).map((moon, index) => normalizePlanet(moon, starIndex, index)),
    };
}

function normalizeBrowserData(data) {
    return {
        seed_id: data.seedId,
        star_num: data.starNum,
        resource_index: data.resourceIndex,
        resource_rate: data.resourceRate,
        stars: (data.stars || []).map((star, index) => ({
            star_index: star.starIndex ?? index,
            name: star.name,
            type: star.type,
            type_id: star.typeId,
            seed: star.seed,
            dyson_lumino: star.dysonLumino,
            dyson_radius: star.dysonRadius,
            distance: star.distance,
            pos_m: star.posM || [0, 0, 0],
            pos_ly: star.posLy || [0, 0, 0],
            planets: (star.planets || []).map((planet, planetIndex) => normalizePlanet(planet, index, planetIndex)),
            veins_point: star.veinsPoint,
            veins_amount: star.veinsAmount,
            gas_veins: star.gasVeins,
            liquid: star.liquid,
        })),
        veins_point: data.veinsPoint,
        veins_amount: data.veinsAmount,
        gas_veins: data.gasVeins,
        liquid: data.liquid,
    };
}

const queryService = createSeedQueryService({
    browserQuery: async (...args) => normalizeBrowserData(await getBrowserSeedData(...args)),
    backendQuery: getBackendSeedData,
});

/** 获取种子数据，默认使用浏览器 WASM。 */
export async function getSeedData(seedId, starNum = 64, resourceIndex = 0) {
    return queryService.querySeed(seedId, starNum, resourceIndex);
}

/**
 * 格式化储量数字
 */
export function formatAmount(num) {
    if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'G';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toString();
}

/**
 * 格式化油井产量
 */
export function formatOilRate(amount) {
    return (amount / 25000).toFixed(2) + '/s';
}
