/**
 * 子窗口（沙盒）判定与持久化闸门。
 *
 * 子窗口由「在新窗口计算」与导航栏「新窗口」按钮打开，地址带 ?sandbox=1。
 * 它与父窗口共享同一份 localStorage —— 一旦写回就会覆盖父窗口的持久化状态
 * （需求表 / 方案 / 设置 + 原矿化 / 数据源）。因此子窗口把配置写进自己的
 * sessionStorage：sessionStorage 天然按标签页隔离、且刷新存活，
 * 既不污染父窗口，误按 F5 也不会丢试算成果。
 *
 * 用 URL 参数而非模块级变量或 React Context：
 *  - 模块级变量刷新即失效，子窗口会退回成普通窗口并开始写回 localStorage；
 *  - Context 读不到——main.jsx 的 useState 初始化器在 ContextProvider 之外执行。
 * 代价只是地址栏多一个查询参数。
 */

const SANDBOX_PARAM = 'sandbox';

/** 读取查询串（测试可注入 search，生产环境取当前地址） */
function read_search(search) {
    if (search !== undefined) return search;
    try {
        return window.location.search;
    } catch { return ''; }
}

/**
 * 当前窗口是否为沙盒子窗口
 * @param {string} [search] - 查询串（含前导 ?），省略时取 window.location.search
 * @returns {boolean}
 */
export function isSandbox(search) {
    try {
        return new URLSearchParams(read_search(search)).get(SANDBOX_PARAM) === '1';
    } catch { return false; }
}

/**
 * 在地址上附加子窗口标记
 * @param {string} href - 原地址（一般传 window.location.href）
 * @returns {string}
 */
export function sandboxUrl(href) {
    try {
        const url = new URL(href);
        // searchParams.set 是幂等的，孙窗口不会叠加出重复参数
        url.searchParams.set(SANDBOX_PARAM, '1');
        return url.toString();
    } catch { return href; }
}

/**
 * 本窗口的沙盒状态。地址栏在本应用生命周期内不会变化（页面切换用的是 React state
 * 而非路由），因此解析一次即可，避免每次读写都构造 URLSearchParams。
 */
let sandbox_mode = null;
function in_sandbox() {
    if (sandbox_mode === null) sandbox_mode = isSandbox();
    return sandbox_mode;
}

/** 读取本标签页 sessionStorage 中的值（不含从父窗口继承的部分） */
function own_get(key) {
    try { return sessionStorage.getItem(key); } catch { return null; }
}

/**
 * 读配置：沙盒窗口先查 sessionStorage（本标签页的改动），未命中再回落到
 * localStorage（继承父窗口）。普通窗口下等价于 localStorage.getItem。
 * @param {string} key
 * @returns {string|null}
 */
export function persistGet(key) {
    if (in_sandbox()) {
        const own = own_get(key);
        if (own !== null) return own;
    }
    try { return localStorage.getItem(key); } catch { return null; }
}

/**
 * 写配置：沙盒窗口写 sessionStorage（隔离且刷新存活），普通窗口写 localStorage。
 * @param {string} key
 * @param {string} value
 */
export function persistSet(key, value) {
    try {
        (in_sandbox() ? sessionStorage : localStorage).setItem(key, value);
    } catch { /* 写入失败(如配额满)可忽略 */ }
}

/**
 * 删除本窗口存储中的键。沙盒窗口删 sessionStorage，删除后读取会重新回落到
 * localStorage 继承值；普通窗口删 localStorage。
 * @param {string} key
 */
export function persistRemove(key) {
    try {
        (in_sandbox() ? sessionStorage : localStorage).removeItem(key);
    } catch { /* 忽略 */ }
}
