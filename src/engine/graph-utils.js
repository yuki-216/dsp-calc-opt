/**
 * 共享图算法工具模块
 * 职责：提供 Tarjan SCC、DAG 压缩、DAG 层级计算等通用图算法
 * 供 CoreEngine 和 DependencyGraphPage 共同使用，消除重复实现
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

/**
 * 将 SCC 分组压缩为 DAG
 * @param {Array<Set<string>>} sccGroups - SCC 分组
 * @param {Array<{from: string, to: string}>} edges - 原始边列表
 * @returns {Object} {dagNodes, dagEdges, nodeToScc}
 * dagNodes: [{id, members, is_scc}]
 * dagEdges: [{from_id, to_id}] (from_id=产物SCC, to_id=原料SCC)
 * nodeToScc: Map<string, number>
 */
export function compressToDag(sccGroups, edges) {
  const nodeToScc = new Map();
  sccGroups.forEach((scc, idx) => {
    scc.forEach(item => nodeToScc.set(item, idx));
  });

  const dagNodes = sccGroups.map((scc, idx) => ({
    id: idx,
    members: [...scc],
    is_scc: scc.size > 1
  }));

  const dagEdgeSet = new Set();
  const dagEdges = [];

  edges.forEach(({ from, to }) => {
    const fromScc = nodeToScc.get(from);
    const toScc = nodeToScc.get(to);
    if (fromScc === undefined || toScc === undefined) return;
    if (fromScc === toScc) return;

    const edgeKey = `${fromScc}->${toScc}`;
    if (!dagEdgeSet.has(edgeKey)) {
      dagEdgeSet.add(edgeKey);
      dagEdges.push({ from_id: fromScc, to_id: toScc });
    }
  });

  return { dagNodes, dagEdges, nodeToScc };
}

/**
 * DAG 层级计算（Kahn 拓扑排序，入度=0 先出队）
 * @param {Array} dagNodes - DAG 节点列表 [{id, members, is_scc}]
 * @param {Array} dagEdges - DAG 边列表 [{from_id, to_id}]
 * @returns {Map<number, number>} scc_id → 层级（原料在低层，产物在高层）
 */
export function dagTopologicalSort(dagNodes, dagEdges) {
  // 入度：依赖数量（from_id 出现次数）
  const dagInDegree = new Map();
  dagNodes.forEach(n => dagInDegree.set(n.id, 0));
  dagEdges.forEach(({ from_id }) => dagInDegree.set(from_id, dagInDegree.get(from_id) + 1));

  // 邻接表：原料SCC → 依赖它的产物SCC
  const dagChildren = new Map();
  dagNodes.forEach(n => dagChildren.set(n.id, []));
  dagEdges.forEach(({ from_id, to_id }) => {
    dagChildren.get(to_id).push(from_id);
  });

  // 入度副本，用于 Kahn 算法
  const remaining = new Map(dagInDegree);

  // Kahn 拓扑排序
  const dagLayer = new Map();
  let frontier = dagNodes.filter(n => remaining.get(n.id) === 0).map(n => n.id);

  let layer = 0;
  while (frontier.length > 0) {
    const nextFrontier = [];
    frontier.forEach(id => {
      dagLayer.set(id, layer);
      dagChildren.get(id).forEach(childId => {
        remaining.set(childId, remaining.get(childId) - 1);
        if (remaining.get(childId) === 0) {
          nextFrontier.push(childId);
        }
      });
    });
    layer++;
    frontier = nextFrontier;
  }

  return dagLayer;
}
