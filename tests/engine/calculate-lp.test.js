import test from 'node:test';
import assert from 'node:assert/strict';

// game_data.jsx 使用 Vite 专属语法(.jsx 扩展名 + import.meta.glob),
// 通过共享的 vite SSR 实例加载引擎模块,与前端构建工具链保持一致。
import {getViteServer, closeViteServer} from '../helpers/vite-game-data.mjs';

const server = await getViteServer();
const {CoreEngine} = await server.ssrLoadModule('/src/engine/index.js');

// 释放 vite 实例句柄,保证 node --test 正常退出
test.after(async () => {
    await closeViteServer();
});

// 极简游戏数据:配方0 铁矿→铁块×1;配方1 铁块→齿轮×1;配方2 燃料→电力×10(isFuelRecipe)
function makeGameData() {
    return {
        recipe_data: [
            {_id: 0, 原料: {铁矿: 1}, 产物: {铁块: 1}, 设施: 0, 时间: 2, Type: 0, 增产: 0},
            {_id: 1, 原料: {铁块: 1}, 产物: {齿轮: 1}, 设施: 0, 时间: 1, Type: 0, 增产: 0},
            {_id: 2, Type: 3, 原料: {燃料: 1}, 产物: {电力: 10}, 设施: 5, 时间: 1, isFuelRecipe: true, fuelName: '燃料', 增产: 0},
        ],
        factory_data: {
            '0': [{'名称': '制造台', '倍率': 1, '耗能': 6}],
            '5': [{'名称': '火力发电厂', '倍率': 1, '耗能': 0, '发电功率': 100}],
        },
        proliferator_data: [],
        proliferator_effect: [],
    };
}

function makeScheme() {
    return {
        item_recipe_choices: {},
        scheme_for_recipe: [
            {'建筑': 0, '增产剂等级': 0, '增产模式': 0},
            {'建筑': 0, '增产剂等级': 0, '增产模式': 0},
            {'建筑': 0, '增产剂等级': 0, '增产模式': 0},
        ],
        selected_fuel: null,
    };
}

test('端到端:需求齿轮×10 → 铁矿缺口/执行次数/电力聚合', async () => {
    const gd = makeGameData();
    const scheme = makeScheme();
    scheme.selected_fuel = '燃料';
    const engine = new CoreEngine(gd, scheme, {is_time_unit_minute: true}, null);
    const result = await engine.calculate([{id: '齿轮', name: '齿轮', count: 10}], gd.recipe_data);

    assert.equal(result.recipeExecutions['齿轮'], 10);
    assert.equal(result.resourceUsage['铁矿'], 10);
    // 电力:齿轮10次×0.1 + 铁块10次×0.2 = 3 MW·min;发电配方每次产10电力 → 执行 3/10 次
    const totalPower = result.totalEnergyCost;
    assert.ok(Math.abs(totalPower - 3) < 1e-6);
    assert.ok(Math.abs(result.recipeExecutions['电力'] - totalPower / 10) < 1e-6);
    assert.ok(!result.surplusByproducts['齿轮']);
});

test('端到端:联产物抵消——多余副产品进 surplusByproducts(正值)', async () => {
    const gd = makeGameData();
    // 加联产配方:原油→氢×1+精炼油×2;配方:氢×2→水×1(虚构但线性)
    gd.recipe_data.push({_id: 3, 原料: {原油: 1}, 产物: {氢: 1, 精炼油: 2}, 设施: 0, 时间: 1, Type: 0, 增产: 0});
    gd.recipe_data.push({_id: 4, 原料: {氢: 2}, 产物: {水: 1}, 设施: 0, 时间: 1, Type: 0, 增产: 0});
    const scheme = makeScheme();
    // 需求 水×10 → 氢20 → 跑联产20次 → 精炼油40全多余
    const engine = new CoreEngine(gd, scheme, {is_time_unit_minute: true}, null);
    const result = await engine.calculate([
        {id: '水', name: '水', count: 10},
    ], gd.recipe_data);

    assert.ok(Math.abs(result.surplusByproducts['精炼油'] - 40) < 1e-6);
    assert.ok(Math.abs(result.resourceUsage['原油'] - 20) < 1e-6);
});

test('productionByItem:UI 展示口径=执行次数×单次净产出(多产物配方不折半)', async () => {
    const gd = makeGameData();
    // 石墨烯式配方:可燃冰2→石墨烯2+氢1(单次净产2)
    gd.recipe_data.push({_id: 3, 原料: {可燃冰: 2}, 产物: {石墨烯: 2, 氢: 1}, 设施: 0, 时间: 1, Type: 0, 增产: 0});
    const scheme = makeScheme();
    // 需求 石墨烯60 → 执行30次(次数口径),净产量60(展示口径),联产氢30全多余
    const engine = new CoreEngine(gd, scheme, {is_time_unit_minute: true}, null);
    const result = await engine.calculate([
        {id: '石墨烯', name: '石墨烯', count: 60},
    ], gd.recipe_data);

    assert.equal(result.recipeExecutions['石墨烯'], 30);
    assert.ok(Math.abs(result.productionByItem['石墨烯'] - 60) < 1e-6,
        `productionByItem 应为产量口径60,实际 ${result.productionByItem['石墨烯']}`);
    assert.ok(Math.abs(result.surplusByproducts['氢'] - 30) < 1e-6);
});

test('主配方优先:氢有净需求时缺口由主配方(采集器)补,禁止为副产扩精炼(z-分摊约束)', async () => {
    const gd = makeGameData();
    // 联产配方3:原油→氢×1+精炼油×2;采集配方5:空原料→氢×1;消耗配方4:氢×2→水×1
    gd.recipe_data.push({_id: 3, 原料: {原油: 1}, 产物: {氢: 1, 精炼油: 2}, 设施: 0, 时间: 1, Type: 0, 增产: 0});
    gd.recipe_data.push({_id: 4, 原料: {氢: 2}, 产物: {水: 1}, 设施: 0, 时间: 1, Type: 0, 增产: 0});
    gd.factory_data['9'] = [{'名称': '轨道采集器', '倍率': 1, '耗能': 0}];
    gd.recipe_data.push({_id: 5, 原料: {}, 产物: {氢: 1}, 设施: 9, 时间: 1, Type: -1, 增产: 0, 可采集: true});
    const scheme = makeScheme();
    // 用户把氢的主配方选为轨道采集器(itemData['氢'] = [null, 3, 5],choice=2 → 配方下标5)
    scheme.item_recipe_choices = {氢: 2};
    const engine = new CoreEngine(gd, scheme, {is_time_unit_minute: true}, null);
    // 需求 水×10 → 需氢20。若允许为副产扩精炼:跑20次精炼即免费得氢20(x采集=0)
    // z-分摊约束下精炼被卡住(其主物品精炼油无人要)→ 氢只能由采集器产
    const result = await engine.calculate([
        {id: '水', name: '水', count: 10},
    ], gd.recipe_data);

    // 采集器必须真跑且产量计入外部获取(主配方责任制)
    assert.ok(result.resourceUsage['氢'] > 20 - 1e-6,
        `氢应由采集器采集 ≥20,实际 resourceUsage['氢']=${result.resourceUsage['氢']}`);
    // 联产的精炼油无人要 → 全部盈余(若 x_精炼>0 才有;本场景 min Σx 下精炼应为 0)
    if (result.surplusByproducts['精炼油']) {
        assert.ok(result.surplusByproducts['精炼油'] > 0);
    }
});

test('主配方优先不误伤:choices[氢]=精炼时联产照常抵消(默认行为不变)', async () => {
    const gd = makeGameData();
    gd.recipe_data.push({_id: 3, 原料: {原油: 1}, 产物: {氢: 1, 精炼油: 2}, 设施: 0, 时间: 1, Type: 0, 增产: 0});
    gd.recipe_data.push({_id: 4, 原料: {氢: 2}, 产物: {水: 1}, 设施: 0, 时间: 1, Type: 0, 增产: 0});
    gd.factory_data['9'] = [{'名称': '轨道采集器', '倍率': 1, '耗能': 0}];
    gd.recipe_data.push({_id: 5, 原料: {}, 产物: {氢: 1}, 设施: 9, 时间: 1, Type: -1, 增产: 0, 可采集: true});
    const scheme = makeScheme();
    // 氢的选择保持默认(choice=1 → itemData['氢'][1] = 配方3 精炼),M(精炼)={氢,精炼油}
    const engine = new CoreEngine(gd, scheme, {is_time_unit_minute: true}, null);
    const result = await engine.calculate([
        {id: '水', name: '水', count: 10},
    ], gd.recipe_data);

    // 与无采集器时一致:联产驱动,精炼跑20次,氢恰好被水链吸收
    assert.ok(Math.abs(result.recipeExecutions['精炼油'] ?? result.recipeExecutions['氢'] - 20) < 1e-6
        || Math.abs((result.recipeExecutions['氢'] ?? 0) - 20) < 1e-6,
        `精炼应执行20次(联产驱动),实际 recipeExecutions=${JSON.stringify(result.recipeExecutions)}`);
    assert.ok(!result.resourceUsage['氢'], '不应启动采集器(联产足够)');
});

test('设备数/耗电不随 BFS 入图物品漂移:60塑料 与 60塑料+60氢 同解同设备(2026-08 用户实测回归)', async () => {
    const gd = makeGameData();
    // 等离子精炼式多产物配方:原油2 → 精炼油2+氢1(时间4s);下游 塑料:精炼油2→1(T3)
    gd.recipe_data.push({_id: 3, 原料: {原油: 2}, 产物: {精炼油: 2, 氢: 1}, 设施: 0, 时间: 4, Type: 0, 增产: 0});
    gd.recipe_data.push({_id: 4, 原料: {精炼油: 2}, 产物: {塑料: 1}, 设施: 0, 时间: 3, Type: 0, 增产: 0});
    const scheme = makeScheme();
    // 原油视为原矿(外部获取),排除采矿设备干扰
    const settings = {is_time_unit_minute: true, mineralize_list: {原油: true}};
    const engine = new CoreEngine(gd, scheme, settings, null);
    const a = await engine.calculate([{id: '塑料', name: '塑料', count: 60}], gd.recipe_data);
    const b = await engine.calculate([
        {id: '塑料', name: '塑料', count: 60},
        {id: '氢', name: '氢', count: 60},
    ], gd.recipe_data);

    // 两方案 LP 解相同:精炼均跑 60 次(B 的氢需求恰好被联产吸收,A 多余氢60)
    assert.ok(Math.abs((a.recipeExecutions['精炼油'] ?? a.recipeExecutions['氢']) - 60) < 1e-6);
    assert.ok(Math.abs((b.recipeExecutions['精炼油'] ?? b.recipeExecutions['氢']) - 60) < 1e-6);
    assert.ok(Math.abs(a.surplusByproducts['氢'] - 60) < 1e-6, `A 应多余氢60,实际 ${a.surplusByproducts['氢']}`);
    assert.ok(!b.surplusByproducts['氢'], 'B 的氢应恰好被消耗');

    // ★ 核心断言:同一物理解 ⇒ 设备表与总耗电完全一致(修复前 A 按"精炼油净产出2"折算
    //   得 2 台/总耗电低于 B,B 按"氢净产出1"折算得 4 台——设备数随入图顺序翻倍)
    assert.deepEqual(a.buildingList, b.buildingList);
    assert.ok(Math.abs(a.totalEnergyCost - b.totalEnergyCost) < 1e-6,
        `总耗电应一致:A=${a.totalEnergyCost} B=${b.totalEnergyCost}`);
    assert.ok(Math.abs(a.totalFootprint - b.totalFootprint) < 1e-6,
        `占地应一致:A=${a.totalFootprint} B=${b.totalFootprint}`);

    // 绝对值:反应4s、制造台倍率1 → 单次执行 4/60 台,60 次 = 4 台(原版真值,非 2 台)
    assert.ok(Math.abs(a.buildingDetails['精炼油'].设备数量 - 4) < 1e-6,
        `精炼链设备应为4台,实际 ${a.buildingDetails['精炼油'].设备数量}`);
    assert.ok(Math.abs(b.buildingDetails['氢'].设备数量 - 4) < 1e-6,
        `B 精炼链设备应为4台,实际 ${b.buildingDetails['氢'].设备数量}`);
});

test('端到端:采集配方(空原料单产物)产量计入 resourceUsage', async () => {
    const gd = makeGameData();
    // 原油萃取站式采集配方:空原料→原油×1
    gd.factory_data['9'] = [{'名称': '原油萃取站', '倍率': 1, '耗能': 4}];
    gd.recipe_data.push({_id: 3, 原料: {}, 产物: {原油: 1}, 设施: 9, 时间: 1, Type: -1, 增产: 0, 可采集: true});
    // 简单加工:原油×2→塑料×1
    gd.recipe_data.push({_id: 4, 原料: {原油: 2}, 产物: {塑料: 1}, 设施: 0, 时间: 1, Type: 0, 增产: 0});
    const scheme = makeScheme();
    const settings = {is_time_unit_minute: true, mining_speed_multiple: 1, mining_speed_oil: 1};
    const engine = new CoreEngine(gd, scheme, settings, null);
    const result = await engine.calculate([{id: '塑料', name: '塑料', count: 5}], gd.recipe_data);

    // 塑料5次耗原油10 → 采集配方执行10次 → 采集量10计入 resourceUsage(设备表保留采集设备)
    assert.ok(Math.abs(result.recipeExecutions['原油'] - 10) < 1e-6);
    assert.ok(Math.abs(result.resourceUsage['原油'] - 10) < 1e-6);
    assert.ok(!result.surplusByproducts['原油']);
    // 采集设备进入设备表
    assert.ok(result.buildingDetails['原油']);
    assert.equal(result.buildingDetails['原油'].factoryName, '原油萃取站');
});
