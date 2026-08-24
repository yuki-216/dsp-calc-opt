/**
 * 验证用户的判断: 氢改为轨道采集器直接获取(choice=5)后, 结果应为氢多余且无需抽取。
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

    const needs = [
        { id: '电磁矩阵', name: '电磁矩阵', count: 60 },
        { id: '能量矩阵', name: '能量矩阵', count: 60 },
        { id: '结构矩阵', name: '结构矩阵', count: 60 },
        { id: '信息矩阵', name: '信息矩阵', count: 60 },
    ];

    const gameInfo = { game_data: gameData, item_data: {} };
    const globalState = new GlobalState(gameInfo, schemeData, settings);
    const engine = new CoreEngine(gameData, schemeData, settings, globalState.sprayCosts);
    const result = await engine.calculate(needs, gameData.recipe_data);

    console.log('\n===== 氢改为轨道采集器后的结果 =====');
    const ru = result.resourceUsage || {};
    console.log('氢(采集量,正=需要采集):', ru['氢'], ' 精炼油:', ru['精炼油'], ' 原油:', ru['原油']);
    console.log('重氢:', ru['重氢'], ' 氘核燃料棒:', ru['氘核燃料棒']);
    console.log('surplusByproducts:', JSON.stringify(result.surplusByproducts));

    // ===== 核心验收(LP 重构)=====
    // 预期: 氢由轨道采集器外部采集(resourceUsage 正值)且联产物精炼油不再多余
    console.log('\n===== 核心验收(LP 重构)=====');
    console.log('氢 usage(轨道采集):', result.resourceUsage['氢']);     // 预期 正值
    console.log('精炼油 surplus:', result.surplusByproducts['精炼油']); // 预期 undefined(恰好满足)
} finally {
    await server.close();
}
