import {useContext, useEffect, useMemo, useRef, useState, useCallback} from 'react';
import {FaArrowLeft, FaHome, FaUndo, FaList, FaFilter} from 'react-icons/fa';
import {GlobalStateContext, EngineGraphDataContext} from './contexts.jsx';
import {ItemIcon} from './ui_components.jsx';
import './DependencyGraph.css';

const STORAGE_KEY_DELETED = 'dependency_graph_deleted_items';
const STORAGE_KEY_POSITIONS = 'dependency_graph_custom_positions';
const STORAGE_KEY_POSITIONS_NEEDS = 'dependency_graph_custom_positions_needs';

/**
 * 构建依赖图数据
 * @param {Object} game_data - 游戏数据
 * @param {Object} item_data - 物品数据
 * @param {Object} scheme_data - 方案数据
 * @returns {Object} {edges, items_with_edges}
 * 边方向: from=产物, to=原料
 * 浅层化：不再含电力边、燃料配方边、增产剂边
 */
function build_dependency_graph(game_data, item_data, scheme_data) {
    const edges = [];
    const edge_set = new Set();
    const items_with_edges = new Set();

    const recipe_handled = new Set();

    for (const item in item_data) {
        // 电力不进依赖图（燃料配方/设备耗电均不在此展示）
        if (item === '电力') continue;

        const choice = scheme_data.item_recipe_choices[item] || 1;
        const recipe_index = item_data[item][choice];
        if (recipe_index === undefined) continue;
        if (recipe_handled.has(recipe_index)) continue;
        recipe_handled.add(recipe_index);

        const recipe = game_data.recipe_data[recipe_index];
        if (!recipe) continue;

        const materials = new Set(Object.keys(recipe.原料));

        for (const product of Object.keys(recipe.产物)) {
            for (const material of materials) {
                const edge_key = `${product}->${material}`;
                if (!edge_set.has(edge_key)) {
                    edge_set.add(edge_key);
                    edges.push({from: product, to: material});
                    items_with_edges.add(material);
                    items_with_edges.add(product);
                }
            }
        }
    }

    return {edges, items_with_edges};
}

/**
 * 依赖图布局算法：纯 Kahn 分层 + 重心法优化（图已保证无环，无需 SCC）
 * @param {Set} items - 所有物品集合
 * @param {Array} edges - 边列表 [{from: 产物, to: 原料}, ...]
 * @param {number} canvas_width - 画布宽度
 * @param {number} canvas_height - 画布最小高度
 * @param {Map|null} custom_first_layer_positions - 首层自定义位置
 * @param {number|null} page_width - 页面宽度
 * @returns {Object} {positions, debug_layers, canvas_width, canvas_height, layers_map, sorted_layers, detect_y_array, item_dag_layer}
 */
function layout_graph(items, edges, canvas_width, canvas_height, custom_first_layer_positions = null, page_width = null) {
    const positions = new Map();
    const MARGIN_X = 50;
    const MARGIN_Y = 80;

    // 构建邻接关系（自环边跳过）
    // 边方向 {from: 产物, to: 原料}，children=下游产物，parents=上游原料
    const children = new Map();
    const parents = new Map();
    const in_degree = new Map();
    const out_degree = new Map();

    items.forEach(item => {
        children.set(item, []);
        parents.set(item, []);
        in_degree.set(item, 0);
        out_degree.set(item, 0);
    });

    edges.forEach(({from, to}) => {
        if (from === to) return;
        children.get(to).push(from);
        parents.get(from).push(to);
        in_degree.set(from, in_degree.get(from) + 1);
        out_degree.set(to, out_degree.get(to) + 1);
    });

    // 5. 物品初始层级映射（纯 Kahn：layer = 1 + max(parents' layer)，原料为 0）
    const item_layer = new Map();
    const remaining_in_degree = new Map(in_degree);
    let frontier = [...items].filter(item => remaining_in_degree.get(item) === 0);
    frontier.forEach(item => item_layer.set(item, 0));
    let current_layer = 0;
    while (frontier.length > 0) {
        const next_frontier = [];
        frontier.forEach(item => {
            children.get(item).forEach(child => {
                remaining_in_degree.set(child, remaining_in_degree.get(child) - 1);
                if (remaining_in_degree.get(child) === 0) {
                    item_layer.set(child, current_layer + 1);
                    next_frontier.push(child);
                }
            });
        });
        current_layer++;
        frontier = next_frontier;
    }
    // 防御：纯源物品或孤立节点默认层 0
    items.forEach(item => {
        if (!item_layer.has(item)) item_layer.set(item, 0);
    });

    // 6. 下移优化：按层级从高到低（产物在前），尝试增大层级直到遇到产物同层
    //    目标：拉大原料与产物的间距，减少引线交叉
    //    回退机制：原本是第一层（layer 0）的物品，如果下移只能移动1层，就保持第一层
    const items_by_layer_desc = [...items].sort((a, b) => (item_layer.get(b) ?? 0) - (item_layer.get(a) ?? 0));
    items_by_layer_desc.forEach(item => {
        const child_items = children.get(item) || [];
        if (child_items.length === 0) return;
        const original_layer = item_layer.get(item) ?? 0;
        const min_child_layer = Math.min(...child_items.map(c => item_layer.get(c) ?? 0));
        const max_allowed = min_child_layer - 1;
        if (max_allowed > original_layer) {
            const new_layer = max_allowed;
            // 回退机制：原本是第一层，下移只能移动1层，就保持第一层
            if (original_layer === 0 && new_layer === 1) {
                return;
            }
            item_layer.set(item, new_layer);
        }
    });

    // 7. 构建层级映射
    const layers_map = new Map();
    item_layer.forEach((layer, item) => {
        if (!layers_map.has(layer)) layers_map.set(layer, []);
        layers_map.get(layer).push(item);
    });

    const sorted_layers = [...layers_map.keys()].sort((a, b) => a - b);

    const debug_layers = [];
    sorted_layers.forEach(layer_idx => {
        const items = layers_map.get(layer_idx);
        if (items && items.length > 0) {
            debug_layers.push({layer: layer_idx, items});
        }
    });

    // 8. 动态层间距（90px-115px，根据引线密度调整）
    const MIN_LAYER_GAP = 90;
    const MAX_LAYER_GAP = 115;

    const layer_edge_count = new Map();
    sorted_layers.forEach(layer => layer_edge_count.set(layer, 0));

    edges.forEach(({from, to}) => {
        const from_layer = item_layer.get(from);
        const to_layer = item_layer.get(to);
        if (from_layer !== undefined && to_layer !== undefined) {
            const min_layer = Math.min(from_layer, to_layer);
            const max_layer = Math.max(from_layer, to_layer);
            for (let l = min_layer; l <= max_layer; l++) {
                if (layer_edge_count.has(l)) {
                    layer_edge_count.set(l, layer_edge_count.get(l) + 1);
                }
            }
        }
    });

    let max_edge_count = 0;
    layer_edge_count.forEach(count => {
        max_edge_count = Math.max(max_edge_count, count);
    });

    const layer_gap = new Map();
    sorted_layers.forEach((layer_idx, i) => {
        if (i === 0) {
            layer_gap.set(layer_idx, 0);
        } else {
            const density = layer_edge_count.get(layer_idx) || 0;
            const density_ratio = max_edge_count > 0 ? density / max_edge_count : 0;
            const gap = MIN_LAYER_GAP + (MAX_LAYER_GAP - MIN_LAYER_GAP) * density_ratio;
            layer_gap.set(layer_idx, Math.round(gap));
        }
    });

    const layer_y = new Map();
    let current_y = MARGIN_Y;

    sorted_layers.forEach((layer_idx, i) => {
        if (i === 0) {
            layer_y.set(layer_idx, current_y);
        } else {
            current_y += layer_gap.get(layer_idx);
            layer_y.set(layer_idx, current_y);
        }
    });

    const effective_page_width = page_width || canvas_width;
    let final_canvas_width = effective_page_width;
    let final_canvas_height = Math.max(canvas_height, current_y + MARGIN_Y);

    // 9. 初始位置分配（含首层矿石排序）
    function assign_positions() {
        const available_width = effective_page_width - MARGIN_X * 2;

        let max_items = 0;
        layers_map.forEach(items => max_items = Math.max(max_items, items.length));

        const min_gap_for_max_layer = available_width / max_items;
        const MIN_GAP = Math.max(min_gap_for_max_layer, 30);

        const layer_gap_map = new Map();

        sorted_layers.forEach((layer_idx, layer_order) => {
            const count = layers_map.get(layer_idx).length;
            if (layer_order === 0) {
                layer_gap_map.set(layer_idx, available_width / Math.max(count, 1));
            } else if (count >= max_items) {
                layer_gap_map.set(layer_idx, MIN_GAP);
            } else {
                const gap = available_width / (count + 1);
                layer_gap_map.set(layer_idx, gap);
            }
        });

        sorted_layers.forEach((layer_idx, layer_order) => {
            const layer_items = layers_map.get(layer_idx);
            const base_y = layer_y.get(layer_idx);
            const gap = layer_gap_map.get(layer_idx);

            // 首层排列：按矿石顺序排列
            if (layer_order === 0) {
                const layer_gap_first = available_width / Math.max(layer_items.length, 1);
                const start_x = MARGIN_X + layer_gap_first / 2;

                // 按矿石顺序排列
                const default_order = ['铁矿', '铜矿', '石矿', '硅矿', '原油', '煤矿', '钛矿'];
                const sorted_layer_items = [...layer_items].sort((a, b) => {
                    const index_a = default_order.indexOf(a);
                    const index_b = default_order.indexOf(b);
                    if (index_a !== -1 && index_b !== -1) return index_a - index_b;
                    if (index_a !== -1) return -1;
                    if (index_b !== -1) return 1;
                    return 0;
                });

                sorted_layer_items.forEach((item, i) => {
                    let x = start_x + i * layer_gap_first;
                    if (custom_first_layer_positions && custom_first_layer_positions.has(item)) {
                        x = custom_first_layer_positions.get(item).x;
                    }
                    positions.set(item, {
                        x: x,
                        y: base_y,
                        is_source: in_degree.get(item) === 0,
                        is_sink: out_degree.get(item) === 0,
                        is_cycle: false,
                        layer: layer_idx,
                        index: i,
                        is_first_layer: true
                    });
                });

                layers_map.set(layer_idx, sorted_layer_items);
            } else {
                // 非首层：正常排列
                const layer_width = layer_items.length * gap;
                const start_x = (effective_page_width - layer_width) / 2 + gap / 2;

                layer_items.forEach((item, i) => {
                    positions.set(item, {
                        x: start_x + i * gap,
                        y: base_y,
                        is_source: in_degree.get(item) === 0,
                        is_sink: out_degree.get(item) === 0,
                        is_cycle: false,
                        layer: layer_idx,
                        index: i,
                        is_first_layer: false
                    });
                });
            }
        });
    }

    // 10. 重心法优化（两遍遍历）
    function assign_positions_by_barycenter() {
        const NODE_WIDTH = 56;
        const MIN_GAP = NODE_WIDTH + 4;

        const deferred_nodes = [];
        const deferred_set = new Set();

        /**
         * 重排组内节点位置
         * @param {Object} group - 节点组
         * @param {number} min_gap - 最小间距
         * @param {Function} get_half_width - 获取节点半宽的函数
         */
        function repack_group(group, min_gap, get_half_width) {
            group.items.sort((a, b) => a.ideal_x - b.ideal_x);
            if (group.items.length > 0) {
                group.items[0].render_x = group.items[0].ideal_x;
                for (let i = 1; i < group.items.length; i++) {
                    const prev = group.items[i - 1];
                    const curr = group.items[i];
                    const gap = get_half_width(prev) + get_half_width(curr);
                    curr.render_x = Math.max(curr.ideal_x, prev.render_x + gap);
                }
            }
            group.left = group.items.length > 0 ? group.items[0].render_x - get_half_width(group.items[0]) : 0;
            group.right = group.items.length > 0 ? group.items[group.items.length - 1].render_x + get_half_width(group.items[group.items.length - 1]) : 0;
            group.center = group.items.reduce((sum, p) => sum + p.ideal_x, 0) / Math.max(group.items.length, 1);
        }

        /**
         * 合并相邻的重叠组
         * @param {Array} groups - 组列表
         * @param {number} min_gap - 最小间距
         * @param {Function} get_half_width - 获取节点半宽的函数
         */
        function merge_adjacent_groups(groups, min_gap, get_half_width) {
            let merged = true;
            let iterations = 0;
            const MAX_ITERATIONS = 100;
            while (merged && iterations < MAX_ITERATIONS) {
                merged = false;
                iterations++;
                for (let i = 0; i < groups.length - 1; i++) {
                    const g1 = groups[i];
                    const g2 = groups[i + 1];
                    const gap = get_half_width(g1.items[g1.items.length - 1]) + get_half_width(g2.items[0]);
                    if (g1.right > g2.left - gap) {
                        g1.items = [...g1.items, ...g2.items];
                        g1.items.sort((a, b) => a.ideal_x - b.ideal_x);
                        g1.center = g1.items.reduce((sum, p) => sum + p.ideal_x, 0) / g1.items.length;
                        repack_group(g1, min_gap, get_half_width);
                        groups.splice(i + 1, 1);
                        merged = true;
                        break;
                    }
                }
            }
        }

        /**
         * 通用的节点组布局算法
         * @param {Array} items_to_layout - 待布局节点 [{item, ideal_x}, ...]
         * @param {number} min_gap - 最小间距
         * @returns {Map} item -> render_x
         */
        function layout_items_in_groups(items_to_layout, min_gap) {
            const groups = [];
            const get_half_width = () => min_gap / 2;

            for (const new_item of items_to_layout) {
                const new_x = new_item.ideal_x;

                // 检测与现有组的重叠
                const overlapping_indices = [];
                for (let j = 0; j < groups.length; j++) {
                    const g = groups[j];
                    if (new_x >= g.left - min_gap && new_x <= g.right + min_gap) {
                        overlapping_indices.push(j);
                    }
                }

                if (overlapping_indices.length === 0) {
                    const new_group = {
                        items: [{item: new_item.item, ideal_x: new_x, render_x: new_x}],
                        left: new_x,
                        right: new_x,
                        center: new_x
                    };
                    let insert_idx = groups.findIndex(g => g.left > new_x);
                    if (insert_idx === -1) insert_idx = groups.length;
                    groups.splice(insert_idx, 0, new_group);
                } else {
                    const target_group = groups[overlapping_indices[0]];
                    target_group.items.push({item: new_item.item, ideal_x: new_x, render_x: new_x});

                    for (let j = 1; j < overlapping_indices.length; j++) {
                        target_group.items.push(...groups[overlapping_indices[j]].items);
                    }

                    target_group.items.sort((a, b) => a.ideal_x - b.ideal_x);
                    target_group.center = target_group.items.reduce((sum, p) => sum + p.ideal_x, 0) / target_group.items.length;
                    repack_group(target_group, min_gap, get_half_width);

                    for (let j = overlapping_indices.length - 1; j >= 1; j--) {
                        groups.splice(overlapping_indices[j], 1);
                    }

                    merge_adjacent_groups(groups, min_gap, get_half_width);
                }
            }

            // 收集结果
            const result = new Map();
            groups.forEach(group => {
                group.items.forEach(p => {
                    result.set(p.item, p.render_x);
                });
            });
            return result;
        }

        // 第一遍：从上到下，普通节点排布
        sorted_layers.forEach((layer_idx, layer_order) => {
            const layer_items = layers_map.get(layer_idx);
            const base_y = layer_y.get(layer_idx);
            if (layer_items.length === 0) return;

            const ideal_positions = new Map();
            layer_items.forEach(item => {
                const parent_items = parents.get(item) || [];
                const valid_parents = parent_items.filter(p => positions.has(p) && !deferred_set.has(p));
                if (valid_parents.length > 0) {
                    const avg_x = valid_parents.reduce((sum, p) => sum + positions.get(p).x, 0) / valid_parents.length;
                    ideal_positions.set(item, avg_x);
                } else if (layer_order === 0) {
                    ideal_positions.set(item, positions.get(item)?.x ?? (final_canvas_width / 2));
                } else {
                    deferred_nodes.push(item);
                    deferred_set.add(item);
                    ideal_positions.set(item, null);
                }
            });

            const sorted_items = [...layer_items]
                .filter(item => ideal_positions.get(item) !== null)
                .sort((a, b) => ideal_positions.get(a) - ideal_positions.get(b));

            const items_to_layout = sorted_items.map(item => ({
                item,
                ideal_x: ideal_positions.get(item)
            }));
            const layout_result = layout_items_in_groups(items_to_layout, MIN_GAP);

            sorted_items.forEach(item => {
                const x = layout_result.get(item) ?? ideal_positions.get(item);
                positions.set(item, {
                    x: x,
                    y: base_y,
                    is_source: in_degree.get(item) === 0,
                    is_sink: out_degree.get(item) === 0,
                    is_cycle: false,
                    layer: layer_idx,
                    is_first_layer: layer_order === 0
                });
            });
        });

        // 11. 第二遍：从下到上，处理延迟节点
        if (deferred_nodes.length > 0) {
            const deferred_by_layer = new Map();
            deferred_nodes.forEach(item => {
                const layer_idx = item_layer.get(item) || 0;
                if (!deferred_by_layer.has(layer_idx)) deferred_by_layer.set(layer_idx, []);
                deferred_by_layer.get(layer_idx).push(item);
            });

            const deferred_layers = [...deferred_by_layer.keys()].sort((a, b) => b - a);

            deferred_layers.forEach(layer_idx => {
                const deferred_items = deferred_by_layer.get(layer_idx);
                const base_y = layer_y.get(layer_idx);
                const layer_all_items = layers_map.get(layer_idx) || [];

                // 计算延迟节点的理想位置（靠近子节点）
                const ideal_positions = new Map();
                deferred_items.forEach(item => {
                    const child_items = children.get(item) || [];
                    const valid_children = child_items.filter(c => positions.has(c));
                    if (valid_children.length > 0) {
                        const avg_x = valid_children.reduce((sum, c) => sum + positions.get(c).x, 0) / valid_children.length;
                        ideal_positions.set(item, avg_x);
                    } else {
                        ideal_positions.set(item, final_canvas_width / 2);
                    }
                });

                // 该层所有节点一起进入重叠处理：非延迟节点用当前 x，延迟节点用重心位置
                const all_items_for_layout = layer_all_items.map(item => ({
                    item,
                    ideal_x: deferred_set.has(item) ? (ideal_positions.get(item) ?? final_canvas_width / 2) : (positions.get(item)?.x ?? final_canvas_width / 2)
                }));
                const layout_result = layout_items_in_groups(all_items_for_layout, MIN_GAP);

                all_items_for_layout.forEach(({item}) => {
                    const x = layout_result.get(item) ?? positions.get(item)?.x ?? final_canvas_width / 2;
                    positions.set(item, {
                        x: x,
                        y: base_y,
                        is_source: in_degree.get(item) === 0,
                        is_sink: out_degree.get(item) === 0,
                        is_cycle: false,
                        layer: layer_idx,
                        is_first_layer: false
                    });
                });
            });
        }
    }

    // 执行布局
    assign_positions();
    assign_positions_by_barycenter();

    let max_y = 0;
    positions.forEach(pos => max_y = Math.max(max_y, pos.y));
    final_canvas_height = Math.max(canvas_height, max_y + MARGIN_Y);

    const NODE_R = 32;
    const {detect_y_array} = collect_dots(positions, in_degree, out_degree, NODE_R);

    return {
        positions,
        debug_layers,
        canvas_width: final_canvas_width,
        canvas_height: final_canvas_height,
        layers_map,
        sorted_layers,
        detect_y_array,
        item_dag_layer: item_layer
    };
}

/**
 * 收集所有圆点坐标，按 y 分层存储用于碰撞检测
 * @param {Map} positions - 所有节点位置
 * @param {Map} in_degree - 入度
 * @param {Map} out_degree - 出度
 * @param {number} NODE_R - 节点半径
 * @returns {Object} {top_dots_by_y, bottom_dots_by_y, detect_y_array}
 */
function collect_dots(positions, in_degree, out_degree, NODE_R) {
    const top_dots_by_y = new Map();
    const bottom_dots_by_y = new Map();

    positions.forEach((pos, item) => {
        const node_x = pos.x;
        const node_y = pos.y;

        if (in_degree.get(item) > 0) {
            const top_dot_y = node_y - NODE_R;
            if (!top_dots_by_y.has(top_dot_y)) {
                top_dots_by_y.set(top_dot_y, []);
            }
            top_dots_by_y.get(top_dot_y).push(node_x);
        }

        if (out_degree.get(item) > 0) {
            const bottom_dot_y = node_y + NODE_R;
            if (!bottom_dots_by_y.has(bottom_dot_y)) {
                bottom_dots_by_y.set(bottom_dot_y, []);
            }
            bottom_dots_by_y.get(bottom_dot_y).push(node_x);
        }
    });

    const detect_y_array = [];
    top_dots_by_y.forEach((x_list, y) => {
        detect_y_array.push({y: y, type: 'top', x_list: x_list});
    });
    bottom_dots_by_y.forEach((x_list, y) => {
        detect_y_array.push({y: y, type: 'bottom', x_list: x_list});
    });

    detect_y_array.sort((a, b) => a.y - b.y);

    return {top_dots_by_y, bottom_dots_by_y, detect_y_array};
}

/**
 * 检测引线是否穿过其他节点圆点，返回第一个碰撞点或 null
 * @param {number} x1 - 起点x
 * @param {number} y1 - 起点y
 * @param {number} x2 - 终点x
 * @param {number} y2 - 终点y
 * @param {Array} detect_y_array - 检测数组
 * @returns {Object|null} {avoid_x, avoid_y} 或 null
 */
function detect_first_collision(x1, y1, x2, y2, detect_y_array) {
    if (!detect_y_array || detect_y_array.length === 0) return null;

    const min_y = Math.min(y1, y2);
    const max_y = Math.max(y1, y2);

    for (const detect of detect_y_array) {
        const detect_y = detect.y;
        if (detect_y <= y1 || detect_y >= y2) continue;

        if (detect_y > min_y && detect_y < max_y) {
            const t = (detect_y - y1) / (y2 - y1);
            const line_x = x1 + (x2 - x1) * t;

            let min_dist = Infinity;
            let closest_x = null;

            detect.x_list.forEach(dot_x => {
                const dist = Math.abs(line_x - dot_x);
                if (dist < min_dist) {
                    min_dist = dist;
                    closest_x = dot_x;
                }
            });

            if (min_dist < 8 && closest_x !== null) {
                const avoid_x = line_x < closest_x ? closest_x - 30 : closest_x + 30;
                return { avoid_x, avoid_y: detect_y };
            }
        }
    }

    return null;
}

/**
 * 生成贝塞尔曲线路径，支持碰撞检测和绕行
 * @param {number} x1 - 起点x
 * @param {number} y1 - 起点y
 * @param {number} x2 - 终点x
 * @param {number} y2 - 终点y
 * @param {Array|null} detect_y_array - 检测数组
 * @param {number} control_offset - 控制点额外偏移量（正数向上）
 * @returns {string} SVG路径字符串
 */
function generate_simple_path(x1, y1, x2, y2, detect_y_array = null, control_offset = 0) {
    const MAX_COLLISIONS = 10;

    if (detect_y_array && detect_y_array.length > 0) {
        const path_parts = [];
        let current_x = x1;
        let current_y = y1;
        let collision_count = 0;

        while (collision_count < MAX_COLLISIONS) {
            const collision = detect_first_collision(current_x, current_y, x2, y2, detect_y_array);
            if (!collision) break;

            collision_count++;
            const avoid_x = collision.avoid_x;
            const avoid_y = collision.avoid_y;
            const dy_segment = Math.abs(avoid_y - current_y);
            const control_dist = Math.min(50, dy_segment / 2);
            const control_y1 = current_y + control_dist - control_offset;
            const control_y2 = avoid_y - control_dist - control_offset;
            path_parts.push(`C ${current_x} ${control_y1}, ${avoid_x} ${control_y2}, ${avoid_x} ${avoid_y}`);

            current_x = avoid_x;
            current_y = avoid_y;
        }

        if (path_parts.length > 0) {
            const dy_to_end = Math.abs(y2 - current_y);
            const control_dist_end = Math.min(50, dy_to_end / 2);
            const control_y = current_y + control_dist_end - control_offset;
            path_parts.push(`C ${current_x} ${control_y}, ${x2} ${y2 - control_dist_end - control_offset}, ${x2} ${y2}`);
            return `M ${x1} ${y1} ` + path_parts.join(' ');
        }
    }

    const dy = Math.abs(y2 - y1);
    const control_dist = Math.min(35, dy / 3);
    return `M ${x1} ${y1} C ${x1} ${y1 + control_dist - control_offset}, ${x2} ${y2 - control_dist - control_offset}, ${x2} ${y2}`;
}

/**
 * 为每条边分配颜色（按原料分组）
 * @param {Array} edges - 边列表
 * @returns {Map} edge_key -> color
 */
function assign_edge_colors(edges) {
    const color_map = new Map();
    const edge_colors = new Map();

    const colors = [
        '#4a9eff', '#ff6b6b', '#51cf66', '#ffd43b', '#cc5de8',
        '#ff922b', '#22b8cf', '#e64980', '#94d82d', '#845ef7',
        '#20c997', '#fd7e14', '#748ffc', '#f06595', '#63e6be',
        '#e8590c', '#868e96', '#4dabf7', '#69db7c', '#ffa94d'
    ];

    const out_edges = new Map();
    edges.forEach(({from, to}) => {
        if (!out_edges.has(to)) out_edges.set(to, []);
        out_edges.get(to).push(from);
    });

    let color_idx = 0;
    out_edges.forEach((froms, to) => {
        if (!color_map.has(to)) {
            color_map.set(to, colors[color_idx % colors.length]);
            color_idx++;
        }
        froms.forEach(from => {
            const edge_key = `${from}->${to}`;
            edge_colors.set(edge_key, color_map.get(to));
        });
    });

    return edge_colors;
}

/**
 * 依赖图页面组件
 * 功能：显示物品依赖关系、缩放拖拽、右键删除、节点位置持久化、SCC 循环组展示
 * 交互：左键拖拽节点/画布、右键删除、鼠标滚轮缩放、悬停高亮上下游
 * 持久化：删除列表、自定义位置、显示模式均保存在 localStorage
 */
export function DependencyGraphPage({onBack, needs_list, isActive}) {
    const global_state = useContext(GlobalStateContext);

    if (!global_state) {
        return <div className="dependency-graph-page">
            <div className="dependency-graph-header">
                <button className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" onClick={onBack}>
                    <FaArrowLeft/>
                    <span>返回计算器</span>
                </button>
                <h5>戴森球计划 - 依赖图</h5>
            </div>
            <div className="d-flex justify-content-center align-items-center flex-grow-1">
                <p className="text-muted">加载中...</p>
            </div>
        </div>;
    }

    return <DependencyGraphInner onBack={onBack} needs_list={needs_list} isActive={isActive} global_state={global_state}/>;
}

/**
 * 依赖图主体（global_state 保证非空，承载全部 hooks）
 */
function DependencyGraphInner({onBack, needs_list, isActive, global_state}) {
    const engineGraphData = useContext(EngineGraphDataContext);
    const container_ref = useRef(null);

    const game_data = global_state.game_data;
    const item_data = global_state.item_data;
    const scheme_data = global_state.scheme_data;



    const CANVAS_WIDTH = 4000;
    const CANVAS_HEIGHT = 2000;

    const [scale, setScale] = useState(1);
    const [pan, setPan] = useState({x: 0, y: 0});
    const [is_panning, setIsPanning] = useState(false);
    const [pan_start, setPanStart] = useState({x: 0, y: 0});

    const [deleted_items, setDeletedItems] = useState(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY_DELETED);
            if (saved) return new Set(JSON.parse(saved));
        } catch { /* 解析失败则空删除表 */ }
        return new Set();
    });

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_DELETED, JSON.stringify([...deleted_items]));
    }, [deleted_items]);

    const [show_deleted_list, setShowDeletedList] = useState(false);
    const [show_debug_panel, setShowDebugPanel] = useState(false);
    const [, setFirstLayerMoved] = useState(0);

    // 清除旧的持久化数据
    useEffect(() => {
        localStorage.removeItem('dependency_graph_show_needs_only');
    }, []);

    const [show_needs_only, setShowNeedsOnly] = useState(() => {
        // 根据需求表是否有内容决定默认模式
        return needs_list && Object.keys(needs_list).length > 0;
    });

    const [custom_positions, setCustomPositions] = useState(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY_POSITIONS);
            if (saved) {
                const obj = JSON.parse(saved);
                const map = new Map();
                Object.entries(obj).forEach(([k, v]) => map.set(k, v));
                return map;
            }
        } catch { /* 解析失败则空位置表 */ }
        return new Map();
    });

    const [custom_positions_needs, setCustomPositionsNeeds] = useState(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY_POSITIONS_NEEDS);
            if (saved) {
                const obj = JSON.parse(saved);
                const map = new Map();
                Object.entries(obj).forEach(([k, v]) => map.set(k, v));
                return map;
            }
        } catch { /* 解析失败则空位置表 */ }
        return new Map();
    });

    const active_custom_positions = show_needs_only ? custom_positions_needs : custom_positions;
    const setActiveCustomPositions = show_needs_only ? setCustomPositionsNeeds : setCustomPositions;

    useEffect(() => {
        if (show_needs_only) return;
        const obj = {};
        custom_positions.forEach((v, k) => obj[k] = v);
        localStorage.setItem(STORAGE_KEY_POSITIONS, JSON.stringify(obj));
    }, [custom_positions, show_needs_only]);

    useEffect(() => {
        if (!show_needs_only) return;
        const obj = {};
        custom_positions_needs.forEach((v, k) => obj[k] = v);
        localStorage.setItem(STORAGE_KEY_POSITIONS_NEEDS, JSON.stringify(obj));
    }, [custom_positions_needs, show_needs_only]);

    const handle_toggle_needs_only = useCallback(() => {
        setShowNeedsOnly(prev => !prev);
    }, []);

    const prev_needs_list_ref = useRef(needs_list);
    useEffect(() => {
        if (show_needs_only && prev_needs_list_ref.current !== needs_list) {
            setCustomPositionsNeeds(new Map());
        }
        prev_needs_list_ref.current = needs_list;
    }, [needs_list, show_needs_only]);

    const [dragging_node, setDraggingNode] = useState(null);
    const [node_drag_offset, setNodeDragOffset] = useState({x: 0, y: 0});

    const [container_width, setContainerWidth] = useState(() => window.innerWidth);
    useEffect(() => {
        const observer = new ResizeObserver(entries => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });
        if (container_ref.current) observer.observe(container_ref.current);
        return () => observer.disconnect();
    }, []);

    const full_graph_data = useMemo(() => {
        return build_dependency_graph(game_data, item_data, scheme_data);
    }, [game_data, item_data, scheme_data]);

    const filtered_graph = useMemo(() => {
        // 仅需求模式（复用核心计算数据）
        if (show_needs_only && needs_list && Object.keys(needs_list).length > 0 && engineGraphData) {
            // 直接复用核心计算的边（过滤已删除物品；核心计算的边含电力边——耗电边 product→电力 与
            // 燃料边 电力→燃料 两个方向，均不渲染，电力完全不进依赖图）
            const filtered_edges = engineGraphData.edges.filter(e =>
                !deleted_items.has(e.from) && !deleted_items.has(e.to)
                && e.to !== '电力' && e.from !== '电力'
            );
            const filtered_items = new Set();
            filtered_edges.forEach(e => {
                filtered_items.add(e.from);
                filtered_items.add(e.to);
            });

            return {edges: filtered_edges, items: filtered_items, power_edges: new Set(), sccs: [], proliferator_edges: new Set()};
        }

        // 全部配方模式：从全量数据中过滤已删除物品（无电力边、无增产剂边）
        const {edges} = full_graph_data;
        const filtered_edges = edges.filter(e =>
            !deleted_items.has(e.from) && !deleted_items.has(e.to)
        );

        // filtered_items 从渲染边集构建，不包含孤立物品
        const filtered_items = new Set();
        filtered_edges.forEach(e => {
            filtered_items.add(e.from);
            filtered_items.add(e.to);
        });

        return {edges: filtered_edges, items: filtered_items, power_edges: new Set(), sccs: [], proliferator_edges: new Set()};
    }, [full_graph_data, deleted_items, show_needs_only, needs_list, engineGraphData]);

    const edge_colors = useMemo(() => {
        return assign_edge_colors(filtered_graph.edges);
    }, [filtered_graph.edges]);

    const {
        positions: base_positions,
        debug_layers,
        layers_map: layout_layers_map,
        sorted_layers: layout_sorted_layers,
        detect_y_array: layout_detect_y_array,
        item_dag_layer: layout_item_dag_layer
    } = useMemo(() => {
        if (filtered_graph.items.size === 0) {
            return {
                positions: new Map(),
                debug_layers: [],
                canvas_width: CANVAS_WIDTH,
                canvas_height: CANVAS_HEIGHT,
                layers_map: new Map(),
                sorted_layers: [],
                detect_y_array: [],
                item_dag_layer: new Map()
            };
        }

        const first_layer_custom = new Map();
        filtered_graph.edges.forEach(({from}) => {
            // 收集所有有父节点的节点（from=产物, to=原料，产物有父节点）
            if (!first_layer_custom.has(from)) first_layer_custom.set(from, false);
        });
        const first_layer_positions = new Map();
        active_custom_positions.forEach((pos, item) => {
            if (filtered_graph.items.has(item) && !first_layer_custom.has(item)) {
                first_layer_positions.set(item, pos);
            }
        });

        const result = layout_graph(filtered_graph.items, filtered_graph.edges, CANVAS_WIDTH, CANVAS_HEIGHT, first_layer_positions, container_width);

        return result;
    }, [filtered_graph, active_custom_positions, container_width]);

    // 合并自定义位置，只对首层物品生效，并做重叠处理
    const positions = useMemo(() => {
        const merged = new Map(base_positions);
        active_custom_positions.forEach((pos, item) => {
            const base = merged.get(item);
            if (base && base.is_first_layer) {
                merged.set(item, {...base, x: pos.x});
            }
        });

        // 首层重叠处理：按层分组，每层内按 x 排序后迭代推开重叠
        const first_layer_items = [];
        merged.forEach((pos, item) => {
            if (pos.is_first_layer) first_layer_items.push({ item, x: pos.x, layer: pos.layer });
        });
        const by_layer = new Map();
        first_layer_items.forEach(it => {
            if (!by_layer.has(it.layer)) by_layer.set(it.layer, []);
            by_layer.get(it.layer).push(it);
        });
        const NODE_W = 60; // NODE_WIDTH + 4
        by_layer.forEach(layer_items => {
            layer_items.sort((a, b) => a.x - b.x);
            let shifted = true;
            let iter = 0;
            while (shifted && iter < 50) {
                shifted = false;
                iter++;
                for (let i = 1; i < layer_items.length; i++) {
                    const min_x = layer_items[i - 1].x + NODE_W;
                    if (layer_items[i].x < min_x) {
                        layer_items[i].x = min_x;
                        shifted = true;
                    }
                }
            }
            layer_items.forEach(it => {
                const pos = merged.get(it.item);
                if (pos) merged.set(it.item, {...pos, x: it.x});
            });
        });

        return merged;
    }, [base_positions, active_custom_positions]);

    const has_data = filtered_graph.items.size > 0;
    const is_layout_ready = base_positions.size > 0;

    // 布局变化时自动居中视角
    const prev_layout_key_ref = useRef(null);

    // 页面激活时重置，确保切换到依赖图时能重新居中
    useEffect(() => {
        if (isActive) {
            prev_layout_key_ref.current = null;
            // 根据需求表重新判断默认模式
            setShowNeedsOnly(needs_list && Object.keys(needs_list).length > 0);
        }
    }, [isActive, needs_list]);

    useEffect(() => {
        if (base_positions.size === 0) return;
        // 用base_positions的key集合判断布局是否变化（排除拖动导致的变化）
        const keys = [...base_positions.keys()].sort().join(',');
        if (prev_layout_key_ref.current === keys) return;
        prev_layout_key_ref.current = keys;

        // 计算首层节点的实际中心位置
        const first_layer_items = layout_sorted_layers.length > 0
            ? layout_layers_map.get(layout_sorted_layers[0]) || []
            : [];
        let first_layer_center_x = container_width / 2;
        if (first_layer_items.length > 0) {
            const positions_list = first_layer_items
                .map(item => base_positions.get(item))
                .filter(Boolean);
            if (positions_list.length > 0) {
                first_layer_center_x = positions_list.reduce((sum, pos) => sum + pos.x, 0) / positions_list.length;
            }
        }

        const rect = container_ref.current?.getBoundingClientRect();
        if (rect) {
            setScale(1);
            setPan({
                x: rect.width / 2 - first_layer_center_x,
                y: 0
            });
        }
    }, [base_positions, container_width, layout_sorted_layers, layout_layers_map]);

    const deleted_items_list = useMemo(() => {
        return [...deleted_items].filter(item => full_graph_data.items_with_edges.has(item));
    }, [deleted_items, full_graph_data]);

    const screen_to_canvas = useCallback((screen_x, screen_y) => {
        const rect = container_ref.current.getBoundingClientRect();
        return {
            x: (screen_x - rect.left - pan.x) / scale,
            y: (screen_y - rect.top - pan.y) / scale
        };
    }, [scale, pan]);

    const handle_mouse_down = useCallback((e) => {
        if (e.button === 0 && !dragging_node) {
            setIsPanning(true);
            setPanStart({x: e.clientX - pan.x, y: e.clientY - pan.y});
        }
    }, [pan, dragging_node]);

    const handle_mouse_move = useCallback((e) => {
        if (dragging_node) {
            const canvas_pos = screen_to_canvas(e.clientX, e.clientY);
            const node_pos = base_positions.get(dragging_node);
            if (node_pos) {
                setActiveCustomPositions(prev => {
                    const new_map = new Map(prev);
                    new_map.set(dragging_node, {
                        x: canvas_pos.x - node_drag_offset.x,
                        y: node_pos.y // 保持原始y坐标
                    });
                    return new_map;
                });
            }
            return;
        }

        if (is_panning) {
            setPan({
                x: e.clientX - pan_start.x,
                y: e.clientY - pan_start.y
            });
        }
    }, [is_panning, pan_start, dragging_node, node_drag_offset, screen_to_canvas, base_positions, setActiveCustomPositions]);

    const handle_mouse_up = useCallback(() => {
        setIsPanning(false);

        if (dragging_node && base_positions.has(dragging_node)) {
            const pos = base_positions.get(dragging_node);
            if (pos && pos.is_first_layer) {
                setFirstLayerMoved(prev => prev + 1);
            }
        }

        setDraggingNode(null);
    }, [dragging_node, base_positions]);

    const handle_node_mouse_down = useCallback((e, item) => {
        e.stopPropagation();
        e.preventDefault();
        const pos = base_positions.get(item);
        if (!pos || !pos.is_first_layer) return;

        const canvas_pos = screen_to_canvas(e.clientX, e.clientY);
        setDraggingNode(item);
        setNodeDragOffset({
            x: canvas_pos.x - pos.x,
            y: canvas_pos.y - pos.y
        });
    }, [base_positions, screen_to_canvas]);

    const handle_center_view = useCallback(() => {
        setScale(1);
        setPan({x: 0, y: 0});
    }, []);

    // 浏览器缩放改变时重置视角
    useEffect(() => {
        const BASE_DPR = 0.9;
        const mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        const update_scale = () => {
            setScale(BASE_DPR / window.devicePixelRatio);
            handle_center_view();
        };
        mql.addEventListener('change', update_scale);
        return () => mql.removeEventListener('change', update_scale);
    }, [handle_center_view]);

    const handle_reset_positions = useCallback(() => {
        setActiveCustomPositions(new Map());
    }, [setActiveCustomPositions]);

    const handle_context_menu = useCallback((e, item) => {
        e.preventDefault();
        e.stopPropagation();
        setDeletedItems(prev => new Set(prev).add(item));
    }, []);

    const handle_restore_item = useCallback((item) => {
        setDeletedItems(prev => {
            const s = new Set(prev);
            s.delete(item);
            return s;
        });
    }, []);

    const handle_restore_all = useCallback(() => setDeletedItems(new Set()), []);

    const [tooltip, setTooltip] = useState(null);
    const [highlighted_items, setHighlightedItems] = useState(new Set());
    const [legend_hover, setLegendHover] = useState(null); // 当前悬停的图例类型

    const get_related_items = useCallback((item) => {
        const related = new Set();
        related.add(item);

        filtered_graph.edges.forEach(edge => {
            if (edge.from === item) {
                related.add(edge.to); // 上游（原料）
            }
            if (edge.to === item) {
                related.add(edge.from); // 下游（产物）
            }
        });

        return related;
    }, [filtered_graph.edges]);

    const get_highlighted_edges = useCallback((item) => {
        const highlighted_edges = new Set();
        const direct_parents = new Set();

        filtered_graph.edges.forEach(edge => {
            if (edge.from === item || edge.to === item) {
                highlighted_edges.add(`${edge.from}->${edge.to}`);
            }
            if (edge.from === item) {
                direct_parents.add(edge.to);
            }
        });

        // 直接原料之间的引线也高亮
        filtered_graph.edges.forEach(edge => {
            if (direct_parents.has(edge.from) && direct_parents.has(edge.to)) {
                highlighted_edges.add(`${edge.from}->${edge.to}`);
            }
        });

        return highlighted_edges;
    }, [filtered_graph.edges]);

    const [highlighted_edges, setHighlightedEdges] = useState(new Set());

    const handle_node_hover = useCallback((item) => {
        setTooltip(item);
        setHighlightedItems(get_related_items(item));
        setHighlightedEdges(get_highlighted_edges(item));
    }, [get_related_items, get_highlighted_edges]);

    const handle_node_leave = useCallback(() => {
        setTooltip(null);
        setHighlightedItems(new Set());
        setHighlightedEdges(new Set());
    }, []);

    const handle_legend_hover = useCallback((type) => {
        setLegendHover(type);
    }, []);

    const handle_legend_leave = useCallback(() => {
        setLegendHover(null);
    }, []);

    const effective_highlighted_items = useMemo(() => {
        if (legend_hover) {
            const items = new Set();
            positions.forEach((pos, item) => {
                if (legend_hover === 'source' && pos.is_source) items.add(item);
                else if (legend_hover === 'intermediate' && !pos.is_source && !pos.is_sink) items.add(item);
                else if (legend_hover === 'sink' && pos.is_sink) items.add(item);
            });
            return items;
        }
        return highlighted_items;
    }, [legend_hover, highlighted_items, positions]);

    const render_edges = () => {
        const NODE_R = 32;
        const is_node_highlighting = !legend_hover && highlighted_items.size > 0;

        return filtered_graph.edges.map((edge, index) => {
            const edge_key = `${edge.from}->${edge.to}`;
            const color = edge_colors.get(edge_key) || '#666';

            const is_edge_highlighted = !legend_hover && highlighted_edges.size > 0 && highlighted_edges.has(edge_key);
            const edge_opacity = legend_hover ? 0.15 : (is_node_highlighting ? (is_edge_highlighted ? 1 : 0.15) : 1);
            const stroke_width = is_edge_highlighted ? 3 : 2;

            if (edge.from === edge.to) {
                // 自环边防御保留（无环图下不应出现）
                const pos = positions.get(edge.from);
                if (!pos) return null;
                const x = pos.x;
                const y = pos.y;
                const loop_offset = NODE_R * 1.5;
                const path = `M ${x} ${y + NODE_R} C ${x - loop_offset} ${y + NODE_R + 20}, ${x - loop_offset} ${y - NODE_R - 20}, ${x} ${y - NODE_R}`;

                return (
                    <g key={`${edge.from}->${edge.to}-${index}`} style={{ opacity: edge_opacity }}>
                        <path
                            d={path}
                            stroke={color}
                            strokeWidth={stroke_width}
                            fill="none"
                            markerStart="url(#dot-blue)"
                            markerEnd="url(#dot-black)"
                        />
                    </g>
                );
            }

            const material_pos = positions.get(edge.to);
            const product_pos = positions.get(edge.from);
            if (!material_pos || !product_pos) return null;

            const x1 = material_pos.x;
            const y1 = material_pos.y + NODE_R;
            const x2 = product_pos.x;
            const y2 = product_pos.y - NODE_R;
            const path = generate_simple_path(x1, y1, x2, y2, layout_detect_y_array);

            return (
                <g key={`${edge.from}->${edge.to}-${index}`} style={{ opacity: edge_opacity }}>
                    <path
                        d={path}
                        stroke={color}
                        strokeWidth={stroke_width}
                        fill="none"
                        markerStart="url(#dot-blue)"
                        markerEnd="url(#dot-black)"
                    />
                </g>
            );
        });
    };

    const render_nodes = () => {
        const node_doms = [];
        const is_highlighting = effective_highlighted_items.size > 0;

        positions.forEach((pos, item) => {
            let border_color = '#4a9eff'; // 中间产物：蓝色
            if (pos.is_source) border_color = '#51cf66'; // 原矿：绿色
            else if (pos.is_sink) border_color = '#ffd43b'; // 最终产物：黄色

            const is_highlighted = effective_highlighted_items.has(item);
            const opacity = is_highlighting ? (is_highlighted ? 1 : 0.3) : 1;
            const scale = is_highlighted && item !== tooltip ? 1.1 : 1;
            const shadow = is_highlighted ? '0 0 12px rgba(0, 0, 0, 0.3)' : 'none';

            node_doms.push(
                <div
                    key={item}
                    className="graph-node-html"
                    style={{
                        left: pos.x,
                        top: pos.y,
                        borderColor: border_color,
                        borderWidth: is_highlighted ? '4px' : '2px',
                        cursor: pos.is_first_layer ? (dragging_node === item ? 'grabbing' : 'grab') : 'default',
                        opacity,
                        transform: `translate(-50%, -50%) scale(${scale})`,
                        boxShadow: shadow,
                        transition: 'opacity 0.15s, transform 0.15s, box-shadow 0.15s, border-width 0.15s'
                    }}
                    onMouseEnter={() => handle_node_hover(item)}
                    onMouseLeave={handle_node_leave}
                    onMouseDown={(e) => handle_node_mouse_down(e, item)}
                    onContextMenu={(e) => handle_context_menu(e, item)}
                    title={item}
                >
                    <ItemIcon item={item} size={40} tooltip={false}/>
                </div>
            );
        });
        return node_doms;
    };

    return (
        <div className="dependency-graph-page">
            <div className="dependency-graph-header">
                <button className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
                        onClick={onBack}>
                    <FaArrowLeft/>
                    <span>返回计算器</span>
                </button>
                <h5>戴森球计划 - 依赖图</h5>
                <div className="graph-legend-inline">
                    <div className="graph-legend-item-inline"
                         onMouseEnter={() => handle_legend_hover('source')}
                         onMouseLeave={handle_legend_leave}>
                        <div className="graph-legend-color-inline" style={{borderColor: '#51cf66', background: legend_hover === 'source' ? 'rgba(81,207,102,0.3)' : 'rgba(81,207,102,0.1)'}}/>
                        <span>原矿</span>
                    </div>
                    <div className="graph-legend-item-inline"
                         onMouseEnter={() => handle_legend_hover('intermediate')}
                         onMouseLeave={handle_legend_leave}>
                        <div className="graph-legend-color-inline" style={{borderColor: '#4a9eff', background: legend_hover === 'intermediate' ? 'rgba(74,158,255,0.3)' : 'rgba(74,158,255,0.1)'}}/>
                        <span>中间</span>
                    </div>
                    <div className="graph-legend-item-inline"
                         onMouseEnter={() => handle_legend_hover('sink')}
                         onMouseLeave={handle_legend_leave}>
                        <div className="graph-legend-color-inline" style={{borderColor: '#ffd43b', background: legend_hover === 'sink' ? 'rgba(255,212,59,0.3)' : 'rgba(255,212,59,0.1)'}}/>
                        <span>最终</span>
                    </div>
                </div>
                <button
                    className="btn btn-sm btn-outline-info d-inline-flex align-items-center gap-1"
                    onClick={() => setShowDebugPanel(!show_debug_panel)}
                >
                    <FaList/>
                    <span>层级</span>
                </button>
                {needs_list && Object.keys(needs_list).length > 0 && (
                    <button
                        className={`btn btn-sm d-inline-flex align-items-center gap-1 ${show_needs_only ? 'btn-success' : 'btn-outline-success'}`}
                        onClick={handle_toggle_needs_only}
                        title={show_needs_only ? '点击显示全部物品' : '点击只显示需求表相关物品'}
                    >
                        <FaFilter/>
                        <span>{show_needs_only ? '仅需求' : '全部物品'}</span>
                    </button>
                )}
                {deleted_items_list.length > 0 && (
                    <button
                        className="btn btn-sm btn-outline-warning d-inline-flex align-items-center gap-1"
                        onClick={() => setShowDeletedList(!show_deleted_list)}
                    >
                        <FaUndo/>
                        <span>已删除 ({deleted_items_list.length})</span>
                    </button>
                )}
            </div>

            <div className="dependency-graph-body">
                <div
                    className="dependency-graph-container"
                    ref={container_ref}
                    onMouseDown={handle_mouse_down}
                    onMouseMove={handle_mouse_move}
                    onMouseUp={handle_mouse_up}
                    onMouseLeave={handle_mouse_up}
                >
                    {!has_data && (
                        <div className="no-data-message">
                            <p className="text-muted fs-5">暂无依赖数据</p>
                            <p className="text-muted">请先在计算器中添加需求物品</p>
                        </div>
                    )}

                    {has_data && is_layout_ready && (
                        <div
                            className="graph-canvas"
                            style={{
                                transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                                transformOrigin: '0 0',
                                width: '1px',
                                height: '1px'
                            }}
                        >
                            <svg
                                className="graph-svg-layer"
                                width="1"
                                height="1"
                            >
                                <defs>
                                    <marker
                                        id="dot-black"
                                        markerWidth="6"
                                        markerHeight="6"
                                        refX="3"
                                        refY="3"
                                    >
                                        <circle cx="3" cy="3" r="2" fill="#000"/>
                                    </marker>
                                    <marker
                                        id="dot-blue"
                                        markerWidth="6"
                                        markerHeight="6"
                                        refX="3"
                                        refY="3"
                                    >
                                        <circle cx="3" cy="3" r="2" fill="#4a9eff"/>
                                    </marker>
                                </defs>
                                {render_edges()}
                            </svg>

                            {render_nodes()}
                        </div>
                    )}


                    <div className="graph-controls">
                        <button className="btn btn-outline-secondary" onClick={handle_center_view} title="视角居中">
                            <FaHome/>
                        </button>
                        <button
                            className="btn btn-outline-warning"
                            onClick={handle_reset_positions}
                            title="恢复默认位置"
                            disabled={active_custom_positions.size === 0}
                        >
                            <FaUndo/>
                        </button>
                    </div>
                </div>

                {show_deleted_list && deleted_items_list.length > 0 && (
                    <div className="deleted-items-panel">
                        <div className="deleted-items-header">
                            <span>已删除物品</span>
                            <button className="btn btn-sm btn-outline-primary" onClick={handle_restore_all}>
                                全部恢复
                            </button>
                        </div>
                        <div className="deleted-items-list">
                            {deleted_items_list.map(item => (
                                <div key={item} className="deleted-item" onClick={() => handle_restore_item(item)} title="点击恢复">
                                    <ItemIcon item={item} size={28} tooltip={false}/>
                                    <span className="deleted-item-name">{item}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {show_debug_panel && (
                    <div className="debug-panel">
                        <div className="debug-panel-header">
                            <span>层级分布（共 {debug_layers.length} 层）</span>
                            <button className="btn btn-sm btn-outline-secondary" onClick={() => setShowDebugPanel(false)}>
                                关闭
                            </button>
                        </div>
                        <div className="debug-panel-content">
                            {debug_layers.map((layer, idx) => (
                                <div key={idx} className="debug-layer">
                                    <div className="debug-layer-title">
                                        <span>层级 {layer.layer}</span>
                                        <span className="debug-layer-count">({layer.items.length})</span>
                                    </div>
                                    <div className="debug-layer-items">
                                        {layer.items.map(item => {
                                            const dag_layer_val = layout_item_dag_layer?.get(item);
                                            return (
                                                <span key={item} className="debug-item">
                                                    {item}{dag_layer_val !== undefined ? ` (${dag_layer_val})` : ''}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
