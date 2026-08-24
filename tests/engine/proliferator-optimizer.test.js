import test from 'node:test';
import assert from 'node:assert/strict';

// game_data.jsx 使用 Vite 专属语法(.jsx 扩展名 + import.meta.glob),
// 通过共享的 vite SSR 实例加载引擎模块,与前端构建工具链保持一致。
import {getViteServer, closeViteServer} from '../helpers/vite-game-data.mjs';

const server = await getViteServer();
const {optimizeProliferatorStrategy} = await server.ssrLoadModule('/src/engine/proliferator-optimizer.js');

// 释放 vite 实例句柄,保证 node --test 正常退出
test.after(async () => {
    await closeViteServer();
});

// 极简游戏数据:
// 配方0: C+原矿R → A×2 (主产物 A)
// 配方1: A → C (主产物 C)
// 需求 A×10 时,物品投影边为 A→C 与 C→A,构成 {A,C} 双节点循环,
// 迫使优化器走"最高等级 SCC 自算 → 单节点逐个优化 + 循环组坐标下降 → 最终边际验证"全链路。
function makeGameData() {
    return {
        recipe_data: [
            {_id: 0, 原料: {C: 1, R: 1}, 产物: {A: 2}, 设施: 0, 时间: 1, Type: 0, 增产: 3},
            {_id: 1, 原料: {A: 1}, 产物: {C: 1}, 设施: 0, 时间: 1, Type: 0, 增产: 3},
        ],
        factory_data: {
            '0': [{'名称': '制造台', '倍率': 1, '耗能': 6}],
        },
        proliferator_data: [
            {增产剂: null, 喷涂次数: 1, 等级: 0},
            {增产剂: '增产剂 Mk.I', 喷涂次数: 12, 等级: 1},
            {增产剂: '增产剂 Mk.II', 喷涂次数: 24, 等级: 2},
            {增产剂: '增产剂 Mk.III', 喷涂次数: 60, 等级: 3},
        ],
        proliferator_effect: [
            {增产效果: 1.0, 加速效果: 1.0, 耗电倍率: 1.0},
            {增产效果: 1.125, 加速效果: 1.25, 耗电倍率: 1.3},
            {增产效果: 1.2, 加速效果: 1.5, 耗电倍率: 1.7},
            {增产效果: 1.25, 加速效果: 2.0, 耗电倍率: 2.5},
        ],
    };
}

function makeScheme() {
    return {
        item_recipe_choices: {},
        scheme_for_recipe: [
            {'建筑': 0, '增产剂等级': 0, '增产模式': 0},
            {'建筑': 0, '增产剂等级': 0, '增产模式': 0},
        ],
        selected_fuel: null,
    };
}

function makeSettings() {
    return {
        is_time_unit_minute: true,
        proliferate_itself: false,
        proliferate_no_accelerate: false,
        proliferate_allowed_levels: [3],
        proliferate_flexible_levels: false,
        mineralize_list: {R: true},
        ore_quantities: {},
    };
}

test('optimizeProliferatorStrategy: 异步重构后四策略均可跑通(自算SCC+坐标下降+最终验证)', async () => {
    const gd = makeGameData();
    const needs = [{id: 'A', name: 'A', count: 10}];

    for (const strategy of ['min_power', 'min_footprint', 'min_net_heat', 'min_rare_weight']) {
        const logs = [];
        const result = await optimizeProliferatorStrategy(
            gd,
            makeScheme(),
            makeSettings(),
            needs,
            null,
            msg => logs.push(msg),
            strategy,
            {}
        );

        // 返回结构完整、目标值有限
        assert.ok(result.optimalScheme, `${strategy}: 应有 optimalScheme`);
        assert.ok(Number.isFinite(result.initialObjective), `${strategy}: initialObjective 应为有限数`);
        assert.ok(Number.isFinite(result.optimalObjective), `${strategy}: optimalObjective 应为有限数`);
        assert.ok(Array.isArray(result.changes), `${strategy}: changes 应为数组`);
        assert.ok(result.activeRecipeIndices.size > 0, `${strategy}: activeRecipeIndices 非空`);

        // 自算 SCC 阶段应进入"最高等级配置下 SCC"日志
        assert.ok(
            logs.some(msg => msg.includes('最高等级配置下 SCC')),
            `${strategy}: 应输出 SCC 分析日志,实际日志:\n${logs.join('\n')}`
        );

        // 审查 I-2:必须真实走过"循环组坐标下降"与"最终边际验证"分支。
        // {A,C} 构成双节点循环 → optimizeCycleGroupPhase 应打印 "循环组 [C, A]" 组头日志
        // (Set 遍历顺序不保证,但成员必然含 A 与 C),最终验证应打印 "最终边际验证开始"。
        const cycleLog = logs.find(msg => msg.startsWith('循环组 ['));
        assert.ok(cycleLog, `${strategy}: 应进入循环组坐标下降(循环组 [...] 日志),实际日志:\n${logs.join('\n')}`);
        assert.ok(
            cycleLog.includes('A') && cycleLog.includes('C'),
            `${strategy}: 循环组日志应含 A 与 C,实际: ${cycleLog}`
        );
        assert.ok(
            logs.some(msg => msg.includes('最终边际验证开始')),
            `${strategy}: 应进入最终边际验证,实际日志:\n${logs.join('\n')}`
        );

        // 循环组坐标下降后,changes 应包含循环组条目(itemId 形如 [A,C])
        const cycleChange = result.changes.find(c => typeof c.itemId === 'string' && c.itemId.startsWith('['));
        assert.ok(cycleChange, `${strategy}: changes 应含循环组条目 [A,C]`);
    }
});

test('optimizeProliferatorStrategy: 无生产链时返回空结果不抛错', async () => {
    const gd = makeGameData();
    const result = await optimizeProliferatorStrategy(
        gd,
        makeScheme(),
        makeSettings(),
        [{id: '不存在', name: '不存在', count: 1}],
        null,
        null,
        'min_power',
        {}
    );
    assert.ok(result.optimalScheme);
    assert.deepEqual(result.changes, []);
});
