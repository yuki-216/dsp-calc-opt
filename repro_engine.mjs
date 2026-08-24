/**
 * 用真实游戏数据 + 用户完整方案(配方选择+增产选择)复现日志场景。
 * 需求: 信息/能量/结构/电磁矩阵×60, 燃料 氘核燃料棒
 */
import { createServer } from 'vite';
import fs from 'fs';

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'error' });
try {
    const { get_game_data, GlobalState } = await server.ssrLoadModule('/src/game_data.jsx');
    const { CoreEngine } = await server.ssrLoadModule('/src/engine/index.js');

    const gameData = get_game_data();
    const exportData = JSON.parse(fs.readFileSync('./scheme_export.json', 'utf8'));

    const schemeData = {
        item_recipe_choices: exportData.item_recipe_choices,
        scheme_for_recipe: exportData.scheme_for_recipe,
        selected_fuel: exportData.selected_fuel || '氘核燃料棒',
    };
    console.log('scheme_for_recipe 长度:', schemeData.scheme_for_recipe.length, 'recipe_data 长度:', gameData.recipe_data.length);
    if (schemeData.scheme_for_recipe.length !== gameData.recipe_data.length) {
        console.error('长度不匹配!');
    }

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
    const cpLogs = [];
    // 性能记录(规格 §八): 单次计算耗时(不含首次 HiGHS 初始化, 该初始化在应用生命周期只发生一次)
    await import('./src/engine/lp-solver.js').then(m => m.getHighs()); // 预热 HiGHS
    const t0 = performance.now();
    const result = await engine.calculate(needs, gameData.recipe_data, new Set(), false, (m) => cpLogs.push(m));
    const t1 = performance.now();
    console.log(`\n[性能] 单次计算耗时: ${(t1 - t0).toFixed(1)} ms`);

    console.log('\n===== 计算结果 =====');
    const ru = result.resourceUsage || {};
    console.log('氢:', ru['氢'], ' 精炼油:', ru['精炼油'], ' 原油:', ru['原油']);
    console.log('重氢:', ru['重氢'], ' 氘核燃料棒:', ru['氘核燃料棒'], ' 电力:', ru['电力']);
    console.log('增产剂Mk.III:', ru['增产剂 Mk.III']);
    console.log('surplusByproducts:', JSON.stringify(result.surplusByproducts));
    console.log('totalEnergyCost:', result.totalEnergyCost);

    // ===== 核心验收指标(LP 重构)=====
    // 预期: 氢为多余副产品(surplusByproducts 正值 ≈5.63)、精炼油恰好满足(不在 surplusByproducts)、
    // 原油走原油萃取站采集配方(resourceUsage 正值)。
    // 旧算法错误解: 氢 -5.63(短缺)/精炼油 +200.94(多余)。
    console.log('\n===== 核心验收(LP 重构)=====');
    console.log('氢 surplus:', result.surplusByproducts['氢']);       // 预期 ≈ 5.63(多余,正值)
    console.log('精炼油 surplus:', result.surplusByproducts['精炼油']); // 预期 undefined(恰好满足)
    console.log('原油 usage:', result.resourceUsage['原油']);          // 预期 正值(原油萃取站采集量)

    // 设备表抽查: 原油萃取站必须存在(旧 bug 回退时采矿设备会从设备表消失)
    const oilRig = result.buildingDetails?.['原油'];
    if (oilRig) {
        console.log('原油萃取站设备数:', oilRig.设备数量, '(', oilRig.factoryName, ')');
    } else {
        console.error('!! 设备表缺失原油萃取站行 !!');
    }
} finally {
    await server.close();
}
