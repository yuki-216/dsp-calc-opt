/**
 * 测试辅助:共享 vite SSR 实例加载 game_data.jsx
 * game_data.jsx 顶层使用 import.meta.glob(vite 专属),纯 node 无法直接 import;
 * 通过 vite ssrLoadModule 在 node:test 中加载,全测试进程共享一个 server 实例。
 */
import { createServer } from 'vite';

let serverPromise = null;

export function getViteServer() {
    if (!serverPromise) {
        serverPromise = (async () => {
            // configFile:false 跳过项目根 vite.config.js
            // (其插件会为全部游戏图标生成精灵图,测试进程不需要也不该触发);
            // .jsx 转换与 import.meta.glob 是 Vite 内建能力,无需项目配置。
            const s = await createServer({
                configFile: false,
                server: {middlewareMode: true},
                watch: null,
                logLevel: 'error',
            });
            return s;
        })();
    }
    return serverPromise;
}

/** 测试结束后调用:释放 vite 实例持有的句柄,让 node --test 正常退出。 */
export async function closeViteServer() {
    if (!serverPromise) return;
    const s = await serverPromise.catch(() => null);
    serverPromise = null;
    if (s) await s.close();
}
