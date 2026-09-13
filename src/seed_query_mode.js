import {persistGet, persistSet, persistRemove} from './sandbox.js';

const STORAGE_KEY = 'seed-query-mode';
const VALID_MODES = new Set(['browser', 'backend', 'auto']);

/**
 * 种子查询模式，存于 localStorage('seed-query-mode')。
 * 存储走 sandbox.js 的收口层：沙盒子窗口里改模式只影响本标签页，
 * 不会覆盖父窗口保存的模式（与其它配置一致）。
 */

/** @returns {'browser'|'backend'|'auto'} 非法值回退 browser */
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

// 控制台调试入口
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
