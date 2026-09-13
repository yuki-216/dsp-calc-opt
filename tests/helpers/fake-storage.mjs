/**
 * 在 node 测试环境里安装一个假的 localStorage。
 *
 * sandbox.js 的 persistGet/persistSet/persistRemove 直连全局 localStorage，
 * 因此测试需要在调用前把它装好。node --test 每个测试文件跑在独立进程里，
 * 装全局不会互相污染。
 *
 * @param {Object<string,string>} [entries] - 初始键值
 * @returns {Map<string,string>} 底层 Map（可直接断言内容）
 */
export function install_fake_storage(entries = {}) {
    const map = new Map(Object.entries(entries));
    globalThis.localStorage = {
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: (key) => map.delete(key),
        clear: () => map.clear(),
    };
    return map;
}
