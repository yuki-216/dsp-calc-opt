import test from 'node:test';
import assert from 'node:assert/strict';

import {compute_item_layers, filter_cycle_bridge_edges} from '../src/dependency-graph-layout.js';

test('无环图:原料层0,产物按 1+max(原料层) 逐层加深', () => {
    const items = new Set(['铁矿', '铁块', '齿轮', '铜块', '电动机']);
    const edges = [
        {from: '铁块', to: '铁矿'},
        {from: '齿轮', to: '铁块'},
        {from: '电动机', to: '铁块'},
        {from: '电动机', to: '齿轮'},
        {from: '电动机', to: '铜块'},
    ];
    const layers = compute_item_layers(items, edges);
    assert.equal(layers.get('铁矿'), 0);
    assert.equal(layers.get('铜块'), 0);
    assert.equal(layers.get('铁块'), 1);
    assert.equal(layers.get('齿轮'), 2);
    assert.equal(layers.get('电动机'), 3);
});

test('副产回路:临界光子透镜桥接边剔除后全图可分层,下游不再堆到层0', () => {
    // 2026-10 用户实测的最小回路:氢→临界光子(对撞机副产氢)→引力透镜(透镜配方)
    // →奇异物质→重氢→氢;临界光子的桥接边是回路唯一出口
    const items = new Set(['可燃冰', '原油', '金刚石', '铁矿', '氢', '重氢', '奇异物质',
        '引力透镜', '临界光子', '反物质', '磁线圈', '电磁矩阵', '宇宙矩阵']);
    const edges = [
        {from: '氢', to: '可燃冰'},        // 氢的产线原料
        {from: '氢', to: '原油'},
        {from: '氢', to: '临界光子'},      // 对撞机副产氢的依赖边(回路源头)
        {from: '临界光子', to: '引力透镜'}, // 桥接边(透镜配方)
        {from: '引力透镜', to: '金刚石'},
        {from: '引力透镜', to: '奇异物质'},
        {from: '奇异物质', to: '重氢'},
        {from: '重氢', to: '氢'},          // 回到氢,成环
        {from: '反物质', to: '临界光子'},
        {from: '电磁矩阵', to: '磁线圈'},
        {from: '磁线圈', to: '铁矿'},
        {from: '宇宙矩阵', to: '反物质'},
        {from: '宇宙矩阵', to: '电磁矩阵'},
    ];
    const layers = compute_item_layers(items, edges);

    // 全部物品都获得层级,不再有靠防御性默认层0兜底的物品
    assert.equal(layers.size, items.size);

    // 层0 = 纯原料;临界光子剔除桥接边后回归层0源头
    for (const item of ['可燃冰', '原油', '金刚石', '铁矿', '临界光子']) {
        assert.equal(layers.get(item), 0, `${item} 应在层0`);
    }
    // 环上物品按剔除后的最长原料链正常加深
    assert.equal(layers.get('氢'), 1);
    assert.equal(layers.get('重氢'), 2);
    assert.equal(layers.get('奇异物质'), 3);
    assert.equal(layers.get('引力透镜'), 4);
    assert.equal(layers.get('反物质'), 1);
    assert.equal(layers.get('电磁矩阵'), 2);
    // 修复前宇宙矩阵会被级联压到层0,现在正常下沉
    assert.equal(layers.get('宇宙矩阵'), 3);

    // 不变量:所有非桥接边保持 产物层 > 原料层
    for (const {from, to} of filter_cycle_bridge_edges(edges)) {
        assert.ok(layers.get(from) >= layers.get(to) + 1, `${from}(${layers.get(from)}) 应深于 ${to}(${layers.get(to)})`);
    }
});

test('filter_cycle_bridge_edges:只剔除临界光子→引力透镜一条边', () => {
    const edges = [
        {from: '临界光子', to: '引力透镜'},
        {from: '氢', to: '临界光子'},
        {from: '引力透镜', to: '奇异物质'},
        {from: '临界光子', to: '其他'},   // 非桥接边,保留
    ];
    const filtered = filter_cycle_bridge_edges(edges);
    assert.equal(filtered.length, 3);
    assert.ok(!filtered.some(e => e.from === '临界光子' && e.to === '引力透镜'));
    // 未选透镜配方时边不存在,过滤为空操作
    assert.equal(filter_cycle_bridge_edges([{from: '临界光子', to: '氢'}]).length, 1);
});
