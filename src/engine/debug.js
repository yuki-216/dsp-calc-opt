/**
 * 全局调试日志开关
 *
 * 浏览器控制台切换：
 *   __DEBUG.off()    // 关闭
 *   __DEBUG.on()     // 打开
 *   __DEBUG.toggle() // 切换
 *
 * 用法：
 *   import { DEBUG } from './debug.js';
 *   if (DEBUG) console.log('...', JSON.stringify(obj));
 *
 * DEBUG=false 时 if 块整体跳过，参数不会计算。
 * 状态持久化在 localStorage('dsp-calc-debug')。
 */

const STORAGE_KEY = 'dsp-calc-debug';

// 初始化：从 localStorage 读取，默认 true
export let DEBUG = (() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return saved !== 'false';
  } catch {}
  return true;
})();

function setEnabled(value) {
  DEBUG = !!value;
  try { localStorage.setItem(STORAGE_KEY, String(DEBUG)); } catch {}
  console.log(`[Debug] 调试日志: ${DEBUG ? '开启' : '关闭'}`);
}

if (typeof window !== 'undefined') {
  window.__DEBUG = {
    on: () => setEnabled(true),
    off: () => setEnabled(false),
    toggle: () => setEnabled(!DEBUG),
    status: () => console.log(`[Debug] 调试日志: ${DEBUG ? '开启' : '关闭'}`),
    get enabled() { return DEBUG; }
  };
}
