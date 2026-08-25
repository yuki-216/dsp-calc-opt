/**
 * 验收:LP 重构 + 主配方优先(z-分摊约束,spec §十一)在真实方案下的两个分支。
 *
 * 方案背景:用户把氢的配方选为轨道采集器(choice=5)。
 *
 * 分支A(默认需求,四矩阵各 60/min)——验证用户原始判断:"结果应为氢多余且无需抽取"。
 *   精炼链/石墨烯链被各自 zcap 钉死在其主物品需求水平,被动联产氢超过燃料链消耗,
 *   无净缺口 → 采集器不执行(resourceUsage['氢'] 为 undefined),氢作显性盈余展示。
 *   z-分摊保证精炼没有为产氢超跑一步(联产是"被动填需求",语义允许)。
 *
 * 分支B(能量矩阵 ×10 = 600/min)——主配方责任制正例。
 *   氢消耗暴涨,被动联产不足出现净缺口 → 缺口必须由采集器补足,
 *   resourceUsage['氢'] 应为大正值,氢守恒行恰好平衡(盈余≈0)。
 */
import { createServer } from 'vite';
import fs from 'fs';

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'error' });
try {
    const { get_game_data, GlobalState } = await server.ssrLoadModule('/src/game_data.jsx');
    const { CoreEngine } = await server.ssrLoadModule('/src/engine/index.js');

    const gameData = get_game_data();
    const exportData = JSON.parse(fs.readFileSync('./scheme_export.json', 'utf8'));
    exportData.item_recipe_choices['氢'] = 5; // 轨道采集器(位置5: [null,15,31,56,72,174])

    const schemeData = {
        item_recipe_choices: exportData.item_recipe_choices,
        scheme_for_recipe: exportData.scheme_for_recipe,
        selected_fuel: exportData.selected_fuel || '氘核燃料棒',
    };

    const settings = {
        mining_speed_multiple: 1, covered_veins_small: 6, covered_veins_large: 16, mining_efficiency_large: 3,
        mining_speed_oil: 3, mining_speed_hydrogen: 1, mining_speed_deuterium: 0.05, mining_speed_gas_hydrate: 0.8,
        fractionating_speed: 30, is_time_unit_minute: true, proliferate_itself: true, proliferate_no_accelerate: true,
        ore_quantities: {}, mineralize_list: {},
    };

    const run = async (matrixCount) => {
        const needs = [
            { id: '电磁矩阵', name: '电磁矩阵', count: 60 },
            { id: '能量矩阵', name: '能量矩阵', count: matrixCount },
            { id: '结构矩阵', name: '结构矩阵', count: 60 },
            { id: '信息矩阵', name: '信息矩阵', count: 60 },
        ];
        const gameInfo = { game_data: gameData, item_data: {} };
        const globalState = new GlobalState(gameInfo, schemeData, settings);
        const engine = new CoreEngine(gameData, schemeData, settings, globalState.sprayCosts);
        return engine.calculate(needs, gameData.recipe_data);
    };

    // ===== 分支A:联产充足 → 无需抽取,盈余展示 =====
    console.log('===== 分支A:默认需求(能量矩阵60/min)=====');
    const resultA = await run(60);
    const ruA = resultA.resourceUsage || {};
    console.log('氢(采集量):', ruA['氢'], '(预期 undefined——联产充足无需抽取)');
    console.log('surplusByproducts[氢]:', resultA.surplusByproducts['氢'], '(预期 正值)');
    console.log('精炼油 surplus:', resultA.surplusByproducts['精炼油']);

    // ===== 分支B:净缺口 → 采集器补足 =====
    console.log('\n===== 分支B:能量矩阵600/min(氢消耗暴涨)=====');
    const resultB = await run(600);
    const ruB = resultB.resourceUsage || {};
    console.log('氢(采集量):', ruB['氢'], '(预期 大正值——缺口由轨道采集器补足)');
    console.log('surplusByproducts[氢]:', resultB.surplusByproducts['氢'], '(预期 ≈0 或 undefined——恰好平衡)');
} finally {
    await server.close();
}
