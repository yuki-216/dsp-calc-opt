import {useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {
    GameInfoContext,
    SettingsContext,
    SettingsSetterContext
} from './contexts.jsx';
import {NeedsList} from './needs_list.jsx';
import {Result} from './result.jsx';
import {Settings, BatchPresetControls, OptimizerControls, FuelSelect} from './settings.jsx';
import {ItemIcon} from './ui_components.jsx';
import {FaTrashAlt, FaCog, FaMountain} from 'react-icons/fa';
import {formatAmount} from './seed_viewer_binding';
import {getStats} from './seed_stats_api';
import {buildOreQuantities, getStatsOreIndex, STATS_ORE_ITEMS} from './ore_stats_binding';
import OreQuantityModeToggle from './OreQuantityModeToggle.jsx';

function UserSettings({show}) {
    let class_show = show ? "" : "d-none";
    return <div className={`d-flex gap-3 ${class_show}`}>
        <fieldset>
            <legend><small>设置</small></legend>
            <Settings/>
        </fieldset>
    </div>;
}

function formatAvailableValue(item, value, mode = 'amount') {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '';
    if (item === '原油' && mode === 'amount') return `${numeric.toFixed(2)}/s`;
    if (item === '原油') return numeric.toFixed(2);
    if (Math.abs(numeric) >= 1000) return formatAmount(numeric);
    return numeric.toFixed(2).replace(/\.00$/, '');
}

function OreInput({item, value, mode, onChange}) {
    const [editing, setEditing] = useState(null);

    const handleChange = (e) => {
        const str = e.target.value;
        setEditing(str);
        const numVal = parseFloat(str);
        if (!isNaN(numVal) && numVal > 0) {
            onChange(item, numVal);
        } else if (str === '' || str === '0') {
            onChange(item, 0);
        }
    };

    const handleBlur = () => {
        setEditing(null);
    };

    return (
        <input
            type="text"
            className="form-control form-control-sm"
            style={{width: '90px', fontSize: '11px'}}
            placeholder="∞"
            value={editing !== null ? editing : (value ? formatAvailableValue(item, value, mode) : '')}
            onFocus={() => setEditing(value > 0 ? String(value) : '')}
            onChange={handleChange}
            onBlur={handleBlur}
        />
    );
}

// 真正无限的物品（抽水站/轨道采集器等可无限获取）
const INFINITE_ITEMS = new Set(['水', '硫酸', '临界光子', '氢', '重氢', '可燃冰']);
// 稳定空引用，避免 `|| {}` / `|| []` 每次渲染新建对象导致依赖数组不稳定
const EMPTY_OBJ = {};
const EMPTY_ARR = [];

function OreQuantitiesPanel({game_info, settings, set_settings, onNavigate, onStatsApplied}) {
    const oreQuantities = settings.ore_quantities || EMPTY_OBJ;
    const recipeData = game_info?.game_data?.recipe_data || EMPTY_ARR;
    const mineralizeList = settings.mineralize_list || EMPTY_OBJ;
    // 收集可由非行星基地设施采集的无原料物品作为原矿（useMemo 稳定引用，避免每次渲染重建导致 effect 重复触发）
    const oreItems = useMemo(() => {
        const oreItems = [];
        const seen = new Set();
        for (const recipe of recipeData) {
            const outputs = recipe['产物'] || {};
            const inputs = recipe['原料'] || {};
            const outputKeys = Object.keys(outputs);
            if (Object.keys(inputs).length === 0 && outputKeys.length === 1 && recipe['可采集']) {
                const item = outputKeys[0];
                if (!INFINITE_ITEMS.has(item) && !seen.has(item)) { seen.add(item); oreItems.push(item); }
            }
        }
        for (const item of Object.keys(mineralizeList)) {
            if (!INFINITE_ITEMS.has(item) && !seen.has(item)) { seen.add(item); oreItems.push(item); }
        }
        return oreItems;
    }, [recipeData, mineralizeList]);

    const handleChange = (item, numVal) => {
        const newQ = { ...oreQuantities };
        if (numVal > 0) { newQ[item] = numVal; } else { delete newQ[item]; }
        set_settings({ ore_quantities: newQ });
    };

    const statsStarNum = Number(settings.ore_quantity_star_num) || 64;
    const statsMode = settings.ore_quantity_mode || 'amount';
    const [statsLoading, setStatsLoading] = useState(false);
    const [statsError, setStatsError] = useState(null);
    // 仅当"矿物可用量为空"或"用户显式更改了恒星数量"时才自动应用统计均值，
    // 避免刷新或切换矿量/矿点模式时覆盖掉已手写/已应用的值。
    const userChangedStarRef = useRef(false);

    useEffect(() => {
        const isEmpty = Object.keys(oreQuantities).length === 0;
        const starNumChanged = userChangedStarRef.current;
        userChangedStarRef.current = false; // 消费标记
        if (!isEmpty && !starNumChanged) return; // 非空且非用户改恒星数：保留原值，不自动应用

        let cancelled = false;
        const applyStatsSummary = async () => {
            setStatsLoading(true);
            setStatsError(null);
            try {
                const data = await getStats(statsStarNum);
                const summary = data?.summary_avg;
                if (!summary?.veins_point || !summary?.veins_amount) {
                    throw new Error('该恒星数量暂无星区汇总统计数据');
                }

                const statsQuantities = buildOreQuantities(summary.veins_point, summary.veins_amount, statsMode);
                const nextQuantities = {};
                for (const item of oreItems) {
                    const index = getStatsOreIndex(item);
                    if (index < 0) continue;
                    const canonicalItem = STATS_ORE_ITEMS[index];
                    if (statsQuantities[canonicalItem] > 0) nextQuantities[item] = statsQuantities[canonicalItem];
                }
                if (!cancelled) {
                    set_settings({
                        ore_quantities: nextQuantities,
                        ore_quantity_star_num: statsStarNum,
                        ore_quantity_mode: statsMode,
                    });
                    onStatsApplied?.();
                }
            } catch (err) {
                if (!cancelled) setStatsError(err.message);
            } finally {
                if (!cancelled) setStatsLoading(false);
            }
        };
        applyStatsSummary();
        return () => { cancelled = true; };
    }, [statsStarNum, statsMode, oreItems, oreQuantities, set_settings, onStatsApplied]);

    return (
        <div className="border rounded p-2 mt-1">
            <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
                <OreQuantityModeToggle mode={statsMode} onChange={(mode) => set_settings({ ore_quantity_mode: mode })} />
                <label className="small text-muted" htmlFor="oreStatsStarNum">恒星数</label>
                <select
                    id="oreStatsStarNum"
                    className="form-select form-select-sm"
                    style={{ width: '88px' }}
                    value={statsStarNum}
                    onChange={(e) => {
                        userChangedStarRef.current = true;
                        set_settings({ ore_quantity_star_num: Number(e.target.value) });
                    }}
                    disabled={statsLoading}
                >
                    {Array.from({ length: 33 }, (_, i) => i + 32).map(n => (
                        <option key={n} value={n}>{n}星</option>
                    ))}
                </select>
                <button
                    type="button"
                    className="btn btn-link btn-sm p-0"
                    onClick={() => onNavigate?.('seed-viewer')}
                >
                    前往种子查看器应用具体种子及恒星范围
                </button>
            </div>
            {statsError && <small className="text-danger d-block mb-2">统计数据应用失败：{statsError}</small>}
            <div className="d-flex flex-wrap gap-2">
                {oreItems.map(item => (
                    <div key={item} className="d-flex align-items-center gap-1" title={item}>
                        <ItemIcon item={item} size={24} />
                        <OreInput item={item} value={oreQuantities[item]} mode={statsMode} onChange={handleChange} />
                    </div>
                ))}
                <small className="text-muted align-self-center">留空 = 无限（不参与瓶颈计算），若全部填空，则无权重加和</small>
            </div>
        </div>
    );
}

export default function App({needs_list, set_needs_list, newTabData, onNavigate}) {
    const game_info = useContext(GameInfoContext);
    const settings = useContext(SettingsContext);
    const set_settings = useContext(SettingsSetterContext);
    const [misc_show, set_misc_show] = useState(false);
    const [show_ore_quantities, set_show_ore_quantities] = useState(false);
    const [show_ore_popup, set_show_ore_popup] = useState(false);
    const [show_building_popup, set_show_building_popup] = useState(false);
    const [statsApplySignal, setStatsApplySignal] = useState(0);
    const handleStatsApplied = useCallback(() => setStatsApplySignal(s => s + 1), []);
    const [resultHasCollector, setResultHasCollector] = useState(false); // 结果表建筑统计是否含轨道采集器(提示用)
    const prev_game_name = useRef(game_info?.game_data?.game_name ?? '');
    // 注:游戏数据初始化由 ContextProvider 惰性完成(set_game_data 负责数据源切换),此处不再重复初始化

    // 处理新标签页数据：清空原矿化列表（新页面不继承原页面的原矿表）
    useEffect(() => {
        if (newTabData) {
            set_settings({ mineralize_list: {} });
        }
    }, [newTabData, set_settings]);

    useEffect(() => {
        // 只有当游戏名称真正变化时（不是组件重新挂载导致对象引用变化），才清空 needs_list
        const current_name = game_info?.game_data?.game_name ?? '';
        if (prev_game_name.current !== current_name) {
            prev_game_name.current = current_name;
            set_needs_list({});
        }
    }, [game_info, set_needs_list]);

    function clearData() {
        if (!confirm(`即将清空所有保存的生产策略、需求列表等数据，初始化整个计算器，是否继续`)) {
            return;// 用户取消保存
        }
        localStorage.clear();
        window.location.reload();
    }

    return <div className="app-layout">
        {/* 顶部面板：不参与滚动 */}
        <div className="app-top-panel">
            {/*燃料选择、清空数据缓存按钮、采矿参数&其他设置是否显示按钮*/}
            <div className="d-flex column-gap-4 row-gap-2 flex-wrap mt-2 align-items-center">
                <FuelSelect/>
                {/* 清空缓存/参数设置/矿物可用量:精简模式靠右紧密(同弹出面板按钮) */}
                <div className="d-inline-flex align-items-center toolbar-btns">
                    <button className="btn btn-outline-danger btn-sm d-inline-flex align-items-center gap-1"
                            onClick={clearData} title="清空数据缓存">
                        <FaTrashAlt/>
                        <span className="toolbar-btn-text">清空缓存</span>
                    </button>
                    <button className={`btn btn-sm d-inline-flex align-items-center gap-1 ${misc_show ? 'btn-primary' : 'btn-outline-primary'}`}
                            onClick={() => set_misc_show(s => !s)} title="参数设置">
                        <FaCog/>
                        <span className="toolbar-btn-text">设置</span>
                    </button>
                    <button className={`btn btn-sm d-inline-flex align-items-center gap-1 ${show_ore_quantities ? 'btn-primary' : 'btn-outline-secondary'}`}
                            onClick={() => set_show_ore_quantities(s => !s)} title="矿物可用量设置">
                        <FaMountain/>
                        <span className="toolbar-btn-text">矿物可用量</span>
                    </button>
                </div>
            </div>
            {/*采矿参数&其他设置*/}
            <UserSettings show={misc_show}/>
            {/*矿物可用量设置*/}
            {show_ore_quantities && <OreQuantitiesPanel game_info={game_info} settings={settings} set_settings={set_settings} onNavigate={onNavigate} onStatsApplied={handleStatsApplied}/>}
            {/*可选增产剂、策略与自动优化（矿物可用量下、添加需求上）*/}
            <OptimizerControls needs_list={needs_list} set_show_ore_quantities={set_show_ore_quantities} statsApplySignal={statsApplySignal}
                               resultHasCollector={resultHasCollector} onNavigate={onNavigate}/>
            {/*添加需求*/}
            <NeedsList needs_list={needs_list} set_needs_list={set_needs_list}
                       set_show_ore_popup={set_show_ore_popup}
                       set_show_building_popup={set_show_building_popup}/>
            {/*批量预设*/}
            <BatchPresetControls/>
        </div>
        {/* 结果区域：填充剩余高度，独立滚动 */}
        <div className="app-result-area">
            <Result needs_list={needs_list} set_needs_list={set_needs_list}
                    show_ore_popup={show_ore_popup} set_show_ore_popup={set_show_ore_popup}
                    show_building_popup={show_building_popup} set_show_building_popup={set_show_building_popup}
                    onCollectorDetected={setResultHasCollector} onNavigate={onNavigate}/>
        </div>
    </div>;
}
