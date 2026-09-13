/**
 * 共享图算法工具模块
 * 职责：提供 Tarjan SCC。当前唯一消费者是增产优化器
 * （src/engine/proliferator-optimizer.js，用它做循环组分组）；
 * 依赖图页已改为纯 DAG 布局，不再使用本模块。
 */

/**
 * Tarjan SCC 算法（通用实现）
 * @param {Set<string>} items - 所有物品节点集合
 * @param {Array<{from: string, to: string}>} edges - 边列表 (from=产物, to=原料)
 * @returns {Array<Set<string>>} SCC 分组（逆拓扑序：sccGroups[0]=最终产物，sccGroups[last]=原矿）
 * 单节点 SCC = 普通 DAG 节点，多节点 SCC = 循环依赖组
 */
export function tarjanSCC(items, edges) {
  // 构建邻接表
  const adj = new Map();
  items.forEach(item => adj.set(item, []));
  edges.forEach(({ from, to }) => {
    if (from !== to && adj.has(from) && adj.has(to)) {
      adj.get(from).push(to);
    }
  });

  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const lowlinks = new Map();
  const sccGroups = [];

  function strongConnect(v) {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    const neighbors = adj.get(v) || [];
    for (const w of neighbors) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v), lowlinks.get(w)));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v), indices.get(w)));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc = new Set();
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.add(w);
      } while (w !== v);
      sccGroups.push(scc);
    }
  }

  items.forEach(item => {
    if (!indices.has(item)) {
      strongConnect(item);
    }
  });

  // 反转为逆拓扑序：sccGroups[0] = 最终产物（顶层），sccGroups[last] = 原矿（底层）
  sccGroups.reverse();
  return sccGroups;
}
