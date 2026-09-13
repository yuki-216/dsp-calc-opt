/**
 * 种子查询：查询模式存储 + 模式派发 + 浏览器 WASM 客户端。
 *
 * 原为 seed_query_mode.js / seed_query_service.js / seed_query_browser.js 三个文件，
 * 三者只有一条依赖链（模式 ← 派发），且消费者只有 seed_viewer_binding，
 * 故合并为一个模块。（Worker 入口 seed_query_worker.js 必须独立——
 * 它要被 `new Worker(new URL(...))` 按 URL 加载。）
 */
import {persistGet, persistSet, persistRemove} from './sandbox.js';

// ========== 查询模式 ==========

const STORAGE_KEY = 'seed-query-mode';
const VALID_MODES = new Set(['browser', 'backend', 'auto']);

/**
 * 读取查询模式。存储走 sandbox.js 的收口层：沙盒子窗口里改模式只影响本标签页，
 * 不会覆盖父窗口保存的模式（与其它配置一致）。
 * @returns {'browser'|'backend'|'auto'} 非法值回退 browser
 */
export function getSeedQueryMode() {
    const value = persistGet(STORAGE_KEY);
    return VALID_MODES.has(value) ? value : 'browser';
}

/**
 * @param {'browser'|'backend'|'auto'} mode
 * @returns {string} 生效的模式
 */
export function setSeedQueryMode(mode) {
    if (!VALID_MODES.has(mode)) {
        throw new Error(`Invalid seed query mode: ${mode}`);
    }
    persistSet(STORAGE_KEY, mode);
    return mode;
}

/** 恢复默认(browser)，返回生效的模式 */
export function resetSeedQueryMode() {
    persistRemove(STORAGE_KEY);
    return 'browser';
}

// ========== 模式派发 ==========

/**
 * 按当前查询模式派发到浏览器/后端查询实现。
 * 两个查询函数由调用方注入——这是唯一能对三分支（browser / backend /
 * auto 带回退）做单测的方式。
 */
export function createSeedQueryService({browserQuery, backendQuery}) {
    if (typeof browserQuery !== 'function' || typeof backendQuery !== 'function') {
        throw new TypeError('Seed query service requires browserQuery and backendQuery functions');
    }

    return {
        async querySeed(seedId, starNum, resourceIndex) {
            const mode = getSeedQueryMode();
            if (mode === 'backend') {
                return backendQuery(seedId, starNum, resourceIndex);
            }
            if (mode === 'auto') {
                try {
                    return await backendQuery(seedId, starNum, resourceIndex);
                } catch {
                    return browserQuery(seedId, starNum, resourceIndex);
                }
            }
            return browserQuery(seedId, starNum, resourceIndex);
        },
    };
}

// ========== 浏览器 WASM 客户端 ==========

let worker;
let nextRequestId = 1;
const pendingRequests = new Map();

function getWorker() {
    if (!worker) {
        worker = new Worker(new URL('./seed_query_worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => {
            const pending = pendingRequests.get(data.requestId);
            if (!pending) return;
            pendingRequests.delete(data.requestId);
            if (data.error) pending.reject(new Error(data.error));
            else pending.resolve(data.result);
        };
        worker.onerror = (event) => {
            const error = new Error(event.message || '浏览器种子计算线程启动失败');
            for (const pending of pendingRequests.values()) pending.reject(error);
            pendingRequests.clear();
            worker = null;
        };
    }
    return worker;
}

export function getBrowserSeedData(seedId, starNum, resourceIndex) {
    return new Promise((resolve, reject) => {
        const requestId = nextRequestId++;
        pendingRequests.set(requestId, { resolve, reject });
        const baseUrl = new URL(import.meta.env.BASE_URL, document.baseURI).href;
        getWorker().postMessage({ requestId, seedId, starNum, resourceIndex, baseUrl });
    });
}

// ========== 控制台调试入口 ==========

if (typeof window !== 'undefined') {
    window.setSeedQueryMode = (mode) => {
        const nextMode = setSeedQueryMode(mode);
        console.info(`Seed query mode: ${nextMode}`);
        return nextMode;
    };
    window.resetSeedQueryMode = () => {
        const nextMode = resetSeedQueryMode();
        console.info(`Seed query mode: ${nextMode}`);
        return nextMode;
    };
}
