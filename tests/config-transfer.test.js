import test from 'node:test';
import assert from 'node:assert/strict';
import {
    EXPORT_KEYS, buildExportPayload, parseImportFile, validateImport, applyImport,
    default_file_name, sanitize_file_name,
} from '../src/config_transfer.js';

/** 伪造的 storage 适配器 */
function fake_storage(init = {}) {
    const map = new Map(Object.entries(init));
    return {getItem: k => (map.has(k) ? map.get(k) : null), map};
}

// 两个数据源：Vanilla 3 个配方 / GenesisBook 5 个配方
const opts = {
    current_source: 'Vanilla',
    recipe_count_of: n => ({Vanilla: 3, GenesisBook: 5}[n]),
    item_names_of: n => ({
        Vanilla: new Set(['铁块', '水']),
        GenesisBook: new Set(['铁块', '水', '新物品']),
    }[n]),
};

test('导出只含核心 6 键，不含界面状态与缓存', () => {
    assert.deepEqual(EXPORT_KEYS, [
        'auto_scheme', 'dsp-calc-needs-list', 'auto_settings',
        'game_source', 'dsp-optim-strategy', 'dsp-no-proliferator-weight-percent',
    ]);
    const storage = fake_storage({
        'auto_scheme': '{}',
        'game_source': 'Vanilla',
        'theme': '"dark"',
        'dependency_graph_deleted_items': '[]',
        'seed-viewer-settings': '{}',
        'seed-viewer-cache': '{"big":1}',
        'dsp-calc-debug': 'true',
    });
    const payload = buildExportPayload({storage, version: '0.0.0-test'});
    assert.deepEqual(Object.keys(payload.data), ['auto_scheme', 'game_source']);
    assert.deepEqual(Object.keys(payload).sort(), ['app', 'data', 'exported_at', 'type', 'version']);
    assert.equal(payload.type, 'config');
});

test('storage 里不存在的键不进导出文件', () => {
    const payload = buildExportPayload({storage: fake_storage({}), version: 'x'});
    assert.deepEqual(payload.data, {});
});

test('解析文件：非法 JSON / 非本工具文件 / 数组 均被拒绝', () => {
    assert.equal(parseImportFile('{oops').ok, false);
    assert.equal(parseImportFile('{"a":1}').ok, false);
    assert.equal(parseImportFile('[]').ok, false);
    assert.equal(parseImportFile('null').ok, false);
    // type 对但 data 不是对象
    assert.equal(parseImportFile('{"app":"dsp-calc-opt","type":"config","data":[]}').ok, false);
    const good = parseImportFile(JSON.stringify({
        app: 'dsp-calc-opt', type: 'config', data: {'game_source': 'Vanilla'},
    }));
    assert.equal(good.ok, true);
});

test('game_source 是裸字符串，不做 JSON 解析', () => {
    const payload = {type: 'config', data: {'game_source': 'GenesisBook'}};
    const r = validateImport(payload, opts);
    assert.equal(r.ok, true);
    assert.deepEqual(r.entries, [['game_source', 'GenesisBook']]);
    assert.equal(r.effective_source, 'GenesisBook');
    assert.deepEqual(r.warnings, []);
});

test('未知数据源被忽略并告警', () => {
    const payload = {type: 'config', data: {
        'game_source': 'NotAMod',
        'dsp-calc-needs-list': JSON.stringify({'铁块': 60}),
    }};
    const r = validateImport(payload, opts);
    assert.equal(r.ok, true);
    assert.deepEqual(r.entries, [['dsp-calc-needs-list', JSON.stringify({'铁块': 60})]]);
    assert.equal(r.effective_source, 'Vanilla');   // 回退当前数据源
    assert.ok(r.warnings.some(w => w.includes('数据源不存在')));
});

test('方案长度与数据源不匹配时跳过该桶', () => {
    const payload = {type: 'config', data: {
        'auto_scheme': JSON.stringify({Vanilla: {scheme_for_recipe: [1, 2]}}),   // 期望 3 个
    }};
    const r = validateImport(payload, {...opts, current_auto_scheme: {GenesisBook: {marker: 1}}});
    assert.equal(r.ok, false);   // 没有任何可导入项
    assert.ok(r.warnings.some(w => w.includes('不匹配')));
});

test('桶级合并：只替换文件里存在的桶，另一数据源原样保留', () => {
    const incoming_bucket = {scheme_for_recipe: [1, 2, 3], item_recipe_choices: {}};
    const payload = {type: 'config', data: {
        'auto_scheme': JSON.stringify({Vanilla: incoming_bucket}),
    }};
    const kept = {scheme_for_recipe: [9, 9, 9, 9, 9]};
    const r = validateImport(payload, {...opts, current_auto_scheme: {GenesisBook: kept}});
    assert.equal(r.ok, true);
    const written = JSON.parse(r.entries.find(([k]) => k === 'auto_scheme')[1]);
    assert.deepEqual(written.Vanilla, incoming_bucket);
    assert.deepEqual(written.GenesisBook, kept);   // 关键：没被抹掉
});

test('设置里的矿物可用量/原矿化按目标数据源剔除未知物品', () => {
    const payload = {type: 'config', data: {
        'game_source': 'Vanilla',
        'auto_settings': JSON.stringify({
            mineralize_list: {'水': true, '新物品': true},
            ore_quantities: {'铁块': 100, '新物品': 50},
            fixed_num: 2,
        }),
    }};
    const r = validateImport(payload, opts);
    const written = JSON.parse(r.entries.find(([k]) => k === 'auto_settings')[1]);
    assert.deepEqual(written.mineralize_list, {'水': true});
    assert.deepEqual(written.ore_quantities, {'铁块': 100});
    assert.equal(written.fixed_num, 2);   // 其它字段不动
    assert.equal(r.warnings.filter(w => w.includes('已剔除')).length, 2);
});

test('格式不对的项逐个跳过并告警，其余照常导入', () => {
    const payload = {type: 'config', data: {
        'auto_scheme': '{oops',
        'auto_settings': JSON.stringify([1, 2]),          // 数组不是对象
        'dsp-calc-needs-list': JSON.stringify({'铁块': 1}),
        'dsp-no-proliferator-weight-percent': 'abc',      // 非数字
        'dsp-optim-strategy': 'min_footprint',
    }};
    const r = validateImport(payload, opts);
    assert.equal(r.ok, true);
    assert.deepEqual(r.entries, [
        ['dsp-calc-needs-list', JSON.stringify({'铁块': 1})],
        ['dsp-optim-strategy', 'min_footprint'],
    ]);
    assert.equal(r.warnings.length, 3);
});

test('文件里没有可导入的核心项时整体失败', () => {
    const r = validateImport({type: 'config', data: {'theme': '"dark"'}}, opts);
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('没有可导入'));
});

test('文件名：留空回退时间戳名，自动补 .json 后缀', () => {
    assert.match(default_file_name(), /^dsp-calc-config-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/);
    // 留空（含纯空白）→ 时间戳名 + .json
    assert.match(sanitize_file_name(''), /^dsp-calc-config-[\d-]+\.json$/);
    assert.match(sanitize_file_name('   '), /^dsp-calc-config-[\d-]+\.json$/);
    assert.equal(sanitize_file_name('我的配置'), '我的配置.json');
    assert.equal(sanitize_file_name('backup'), 'backup.json');
});

test('文件名：已带 .json 不重复追加，非法字符被替换', () => {
    assert.equal(sanitize_file_name('backup.json'), 'backup.json');
    assert.equal(sanitize_file_name('BACKUP.JSON'), 'BACKUP.JSON');
    // Windows 非法字符 \ / : * ? " < > | 与路径分隔符
    assert.equal(sanitize_file_name('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j.json');
    assert.equal(sanitize_file_name('  spaced  '), 'spaced.json');
});

test('applyImport 按键写入', () => {
    const written = [];
    applyImport([['a', '1'], ['b', '2']], (k, v) => written.push([k, v]));
    assert.deepEqual(written, [['a', '1'], ['b', '2']]);
});
