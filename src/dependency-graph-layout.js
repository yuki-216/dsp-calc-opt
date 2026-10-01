/**
 * 依赖图分层(纯函数,无 React 依赖)
 * 职责:物品图(边方向 {from: 产物, to: 原料}) → 每个物品的层级(原料为 0,产物逐层加深)。
 *
 * ★ 副产回路桥接边的特殊处理:
 * 临界光子选引力透镜配方时,对撞机副产氢的依赖边与透镜链构成生产回路
 * (氢→临界光子→引力透镜→奇异物质→重氢→氢),破坏 Kahn 分层的无环前提——
 * 环上物品入度永不清零,其全部下游也无法分层,若按防御性默认层 0 处理,
 * 大量产物会被错误堆到顶层(2026-10 用户实测)。
 * 该边是回路唯一桥接(临界光子无其他出边),分层前剔除即恢复严格无环;
 * 渲染不受影响——调用方照常画这条跨层长边,只是不再参与分层与下移优化。
 */

/** 构成生产回路的桥接边(临界光子透镜配方 → 引力透镜) */
function is_cycle_bridge_edge(e) {
    return e.from === '临界光子' && e.to === '引力透镜';
}

/**
 * 剔除副产回路桥接边,返回可用于无环分层的边集
 * @param {Array<{from: string, to: string}>} edges
 * @returns {Array<{from: string, to: string}>}
 */
export function filter_cycle_bridge_edges(edges) {
    return edges.filter(e => !is_cycle_bridge_edge(e));
}

/**
 * 计算物品层级(纯 Kahn 分层;调用前需保证边集无环,见 filter_cycle_bridge_edges)
 * layer = 1 + max(各原料层),无任何原料的物品为层 0
 * @param {Set<string>|Iterable<string>} items
 * @param {Array<{from: string, to: string}>} edges
 * @returns {Map<string, number>} 物品 → 层级
 */
export function compute_item_layers(items, edges) {
    const layering_edges = filter_cycle_bridge_edges(edges);

    // 邻接:children(原料→消费它的产物) / in_degree(产物的原料种类数)
    const children = new Map();
    const in_degree = new Map();
    for (const item of items) {
        children.set(item, []);
        in_degree.set(item, 0);
    }
    for (const {from, to} of layering_edges) {
        if (from === to) continue;                       // 自环(自喷)不参与分层
        if (!children.has(from) || !children.has(to)) continue; // 防御:端点必须在节点集内
        children.get(to).push(from);
        in_degree.set(from, in_degree.get(from) + 1);
    }

    // Kahn:层 0 = 无任何原料的物品(原矿/无中生有),逐层向下推产物
    const item_layer = new Map();
    const remaining = new Map(in_degree);
    let frontier = [...items].filter(item => remaining.get(item) === 0);
    frontier.forEach(item => item_layer.set(item, 0));
    let current_layer = 0;
    while (frontier.length > 0) {
        const next_frontier = [];
        frontier.forEach(item => {
            children.get(item).forEach(child => {
                remaining.set(child, remaining.get(child) - 1);
                if (remaining.get(child) === 0) {
                    item_layer.set(child, current_layer + 1);
                    next_frontier.push(child);
                }
            });
        });
        current_layer++;
        frontier = next_frontier;
    }
    // 防御:孤立节点默认层 0(正常情况下 Kahn 已覆盖全部节点)
    for (const item of items) {
        if (!item_layer.has(item)) item_layer.set(item, 0);
    }
    return item_layer;
}
