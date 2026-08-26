import {useContext, useState, useCallback, useRef, useEffect} from 'react';
import {CompactModeContext, DefaultSettingsContext, FuelContext, FuelSetterContext, GlobalStateContext, SchemeDataSetterContext, SettingsContext, SettingsSetterContext} from './contexts.jsx';
import {HorizontalMultiButtonSelect} from './recipe.jsx';
import {pro_mode_class} from './result.jsx';
import {optimizeProliferatorStrategy} from './engine/proliferator-optimizer.js';
import {FaMagic, FaChevronDown, FaChevronUp} from 'react-icons/fa';
import {ItemIcon} from './ui_components.jsx';
import {getFuelData} from './game_data.jsx';
import {collectProliferatorChanges, collectProliferatorModeChanges} from './engine/proliferator-changes.js';

// 整数优化方向选项（仅决定中间等级设备的方向；最低级固定紧凑、最高级固定省料）
// 颜色/顺序对齐增产/加速: 省料↔增产(蓝,前), 紧凑↔加速(橙,后)
const FACTORY_OPTIMIZE_MODES = [
    {key: 'economy', label: '省料', className: 'pro-mode-extra-products',
     tooltip: '尝试所有等级'},
    {key: 'compact', label: '紧凑', className: 'pro-mode-speedup',
     tooltip: '仅尝试高1级，失败则回退省料'},
];

// 分馏传送带选项(数值=带速/min,传给后端 fractionating_speed = 带速/60)
const BELT_OPTIONS = [
    {value: 360, item_icon: '传送带'},
    {value: 720, item_icon: '高速传送带'},
    {value: 1800, item_icon: '极速传送带'},
];

export function Settings() {
    const settings = useContext(SettingsContext);
    const set_settings = useContext(SettingsSetterContext);
    const DEFAULT_SETTINGS = useContext(DefaultSettingsContext);

    // 通用设置变更函数
    function change_setting(e, name, type = 'int', minVal = 0) {
        if (type === 'bool') {
            set_settings({[name]: !settings[name]});
            return;
        }

        const parseFn = type === 'float' ? parseFloat : parseInt;
        const defaultVal = DEFAULT_SETTINGS[name];
        let val = Math.max(parseFn(e.target.value) || defaultVal, minVal);

        if (type === 'float') {
            val = Math.round(val * 10000) / 10000; // 输入框最多四位小数
        }

        set_settings({[name]: val});
    }

    // 分馏传送带当前值(带速/min)
    const beltSpeed = Math.round((settings.fractionating_speed || 30) * 60);

    return <div className="d-flex flex-column gap-1 flex-wrap">
        {/* 行1:精度位数 研究站层数 增产剂自喷涂 限制加速模式 */}
        <div className="d-flex flex-wrap align-items-center gap-3">
            <label className="d-flex align-items-center gap-1 text-nowrap">
                <span>精度位数</span>
                <input type="number" value={settings.fixed_num} min={0} max={2} step={1} style={{width: '2em'}}
                       onChange={e => change_setting(e, "fixed_num", 'int', 0)}/>
            </label>
            <label className="d-flex align-items-center gap-1 text-nowrap">
                <span>研究站层数</span>
                <input type="number" value={settings.stack_research_lab} min={3} max={15} step={1} style={{width: '3em'}}
                       onChange={e => change_setting(e, "stack_research_lab", 'int', 3)}/>
            </label>
            <label className="d-flex align-items-center gap-1 text-nowrap">
                <input type="checkbox" checked={!!settings.proliferate_itself}
                       onChange={e => set_settings(prev => ({...prev, proliferate_itself: e.target.checked}))}/>
                增产剂自喷涂
            </label>
            <label className="d-flex align-items-center gap-1 text-nowrap"
                   title="限制批量预设和自动优化的加速模式选择">
                <input type="checkbox" checked={!!settings.proliferate_no_accelerate}
                       onChange={e => set_settings(prev => ({...prev, proliferate_no_accelerate: e.target.checked}))}/>
                限制加速模式
            </label>
        </div>

        {/* 行2:挖矿单位耗电 采集速度 不计挖矿电力 */}
        <div className="d-flex flex-wrap align-items-center gap-3">
            <div className="d-flex align-items-center gap-1">
                <span className="text-nowrap">挖矿单位耗电</span>
                <input type="range" min={0} max={100} step={1}
                       value={settings.mining_power_slider || 0}
                       onChange={e => set_settings({mining_power_slider: Number(e.target.value)})}
                       title="最左=挖矿机覆盖6矿脉(2.333 kW/个)，最右=大矿机覆盖16矿脉3倍速(9.19 kW/个)"
                       style={{width: '7em'}}/>
                <span className="small text-muted">
                    {(2.333 + ((settings.mining_power_slider || 0) / 100) * (9.19 - 2.333)).toFixed(2)} kW/个
                </span>
            </div>
            <div className="d-flex align-items-center gap-1">
                <span className="text-nowrap">采集速度</span>
                <input type="number" value={Math.round((settings.gas_collect_speed || 1) * 100)} step={10} min={100}
                       style={{width: '4em'}}
                       onChange={e => set_settings({gas_collect_speed: Math.max(100, parseFloat(e.target.value) || 100) / 100})}/>
                <span>%</span>
            </div>
            <label className="d-flex align-items-center gap-1 text-nowrap">
                <input type="checkbox" checked={!!settings.exclude_miner_power}
                       onChange={e => set_settings(prev => ({...prev, exclude_miner_power: e.target.checked}))}/>
                不计挖矿电力
            </label>
        </div>

        {/* 行3:分馏传送带 中间设备整数建议 */}
        <div className="d-flex flex-wrap align-items-center gap-3">
            <div className="d-flex align-items-center gap-1 text-nowrap">
                <span>分馏传送带</span>
                <HorizontalMultiButtonSelect choice={beltSpeed} options={BELT_OPTIONS}
                                            onChange={v => set_settings({fractionating_speed: v / 60})}
                                            no_gap={true} icon_size={22} rounded={true}/>
            </div>
            <div className="d-flex align-items-center gap-1 text-nowrap">
                <span className="fast-tooltip" data-tooltip="最低级强制紧凑，最高级强制省料">中间设备整数建议</span>
                <div className="pro-mode-toggle" role="radiogroup" aria-label="中间设备整数建议方向">
                    {FACTORY_OPTIMIZE_MODES.map(m => (
                        <div key={m.key}
                             className={`fast-tooltip pro-mode-option ${m.className || ''} ${settings.factory_optimize_mode === m.key ? 'pro-mode-active' : ''}`}
                             role="radio" aria-checked={settings.factory_optimize_mode === m.key} tabIndex={0}
                             data-tooltip={m.tooltip}
                             onClick={() => set_settings({factory_optimize_mode: m.key})}
                             onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') set_settings({factory_optimize_mode: m.key}); }}>
                            {m.label}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    </div>;
}

// TODO refactor to some other modules
function FactorySelect({factory, list, icon_size}) {
    const global_state = useContext(GlobalStateContext);
    const set_scheme_data = useContext(SchemeDataSetterContext);
    let game_data = global_state.game_data;
    let scheme_data = global_state.scheme_data;

    // 从 scheme_data 推导当前选中建筑（取该设施类型下第一个配方的建筑索引）
    let cur = 0;
    for (let i = 0; i < game_data.recipe_data.length; i++) {
        if (game_data.recipe_data[i]["设施"] == factory) {
            cur = scheme_data.scheme_for_recipe[i]["建筑"];
            break;
        }
    }

    // 挖矿简化:采矿机/大型采矿机合并为"挖矿机"(移除大型采矿机,保留原索引)
    const options = list
        .map((data, idx) => ({value: idx, item_icon: data["名称"]}))
        .filter(o => o.item_icon !== "大型采矿机")
        .map(o => o.item_icon === "采矿机" ? {...o, item_icon: "挖矿机"} : o);

    function set_factory(building) {
        // 取本设施类型选中建筑的名称，用于跨设施类型匹配
        const building_name = list[building]["名称"];
        set_scheme_data(old_scheme_data => {
            let scheme_data = structuredClone(old_scheme_data);
            for (var i = 0; i < game_data.recipe_data.length; i++) {
                const facility = game_data.recipe_data[i]["设施"];
                const facility_list = game_data.factory_data[facility];
                // 找同名建筑在该设施类型中的索引
                const matched_idx = facility_list.findIndex(b => b["名称"] === building_name);
                if (matched_idx !== -1) {
                    scheme_data.scheme_for_recipe[i]["建筑"] = matched_idx;
                }
            }
            return scheme_data;
        });
    }

    return <HorizontalMultiButtonSelect choice={cur} options={options}
                                        onChange={set_factory} no_gap={true} icon_size={icon_size} rounded={true}/>;
}

export function FuelSelect() {
    const selectedFuel = useContext(FuelContext);
    const setSelectedFuel = useContext(FuelSetterContext);
    const global_state = useContext(GlobalStateContext);
    const compact_mode = useContext(CompactModeContext);
    const is_mobile = compact_mode === "mobile";
    const mob_icon = is_mobile ? 22 : undefined;
    const icon_size = mob_icon || 32;

    // 从游戏数据获取燃料列表（包含动态获取的增产剂名称）
    const fuelData = getFuelData(global_state.game_data);

    return (
        <div className="d-flex align-items-center flex-wrap">
            <small className="fw-bold me-2">燃料选择</small>
            <div className="d-flex" style={{gap: '2px'}}>
                {fuelData.map(fuel => (
                    <div
                        key={fuel.name}
                        className={`py-1 px-1 d-flex align-items-center justify-content-center cursor-pointer small border rounded ${
                            selectedFuel === fuel.name
                                ? 'bg-selected'
                                : 'bg-unselected'
                        }`}
                        style={fuel.name === "无" ? {minWidth: `${icon_size + 8}px`} : {}}
                        onClick={() => setSelectedFuel(fuel.name)}
                        title={fuel.name === "无" ? "不进行燃料计算" : `${fuel.name} (${fuel.heatValue}MJ) - ${fuel.device}`}
                    >
                        {fuel.name === "无" ? (
                            <span className="small">无</span>
                        ) : (
                            <ItemIcon item={fuel.name} size={icon_size} />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

export function OptimizerControls({needs_list, set_show_ore_quantities, statsApplySignal, resultHasCollector, onNavigate}) {
    const global_state = useContext(GlobalStateContext);
    const set_scheme_data = useContext(SchemeDataSetterContext);
    const set_settings = useContext(SettingsSetterContext);
    const compact_mode = useContext(CompactModeContext);
    let game_data = global_state.game_data;
    let scheme_data = global_state.scheme_data;

    // 优化器状态
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [optimProgress, setOptimProgress] = useState({ current: 0, total: 0, message: '' });
    const [optimLogs, setOptimLogs] = useState([]);
    const [showLogs, setShowLogs] = useState(false);
    const [optimStrategy, setOptimStrategy] = useState(() => {
        const saved = localStorage.getItem('dsp-optim-strategy');
        // min_raw_ore（最大瓶颈法）已移除，映射到上位替代珍稀权重；默认珍稀权重
        return saved === 'min_raw_ore' ? 'min_rare_weight' : (saved || 'min_rare_weight');
    });
    const [noProliferatorPercent, setNoProliferatorPercent] = useState(() => {
        return localStorage.getItem('dsp-no-proliferator-weight-percent') || '0.1';
    });

    // 持久化优化策略选择
    useEffect(() => {
        localStorage.setItem('dsp-optim-strategy', optimStrategy);
    }, [optimStrategy]);
    useEffect(() => {
        localStorage.setItem('dsp-no-proliferator-weight-percent', noProliferatorPercent);
    }, [noProliferatorPercent]);
    const [showStatsApplied, setShowStatsApplied] = useState(false);
    // 结果表含轨道采集器时的"去获取精确值"提示(10秒消失)
    const [showCollectorHint, setShowCollectorHint] = useState(false);
    useEffect(() => {
        if (resultHasCollector) {
            setShowCollectorHint(true);
            const t = setTimeout(() => setShowCollectorHint(false), 10000);
            return () => clearTimeout(t);
        }
        setShowCollectorHint(false);
    }, [resultHasCollector]);
    const logContainerRef = useRef(null);

    // 切换优化目标时自动调整
    useEffect(() => {
        // 珍稀权重法→展开矿物可用量；切到其他策略→自动收回
        if (optimStrategy === 'min_rare_weight') {
            set_show_ore_quantities?.(true);
        } else {
            set_show_ore_quantities?.(false);
        }
        // 最小占地→全部模式；其他→仅增产
        if (optimStrategy === 'min_footprint') {
            set_settings({proliferate_no_accelerate: false});
        } else {
            set_settings({proliferate_no_accelerate: true});
        }
    }, [optimStrategy, set_settings, set_show_ore_quantities]);

    // 统计均值应用提示：仅应用后显示，5 秒后消失
    useEffect(() => {
        if (!statsApplySignal) return;
        setShowStatsApplied(true);
        const timer = setTimeout(() => setShowStatsApplied(false), 5000);
        return () => clearTimeout(timer);
    }, [statsApplySignal]);

    // 自动滚动到底部
    useEffect(() => {
        if (logContainerRef.current && showLogs) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [optimLogs, showLogs]);

    // 运行优化
    const runOptimization = useCallback(async () => {
        const needsArray = Object.entries(needs_list || {}).map(([id, count]) => ({ id, name: id, count }));
        if (needsArray.length === 0) {
            alert('请先添加需求物品');
            return;
        }

        setIsOptimizing(true);
        setOptimLogs([]);
        setOptimProgress({ current: 0, total: 0, message: '正在初始化...' });

        // 使用 setTimeout 让 UI 有时间更新
        setTimeout(async () => {
            try {
                const logs = [];
                const allowed_levels_length = (global_state.settings.proliferate_allowed_levels || [3]).length;
                const result = await optimizeProliferatorStrategy(
                    game_data,
                    scheme_data,
                    global_state.settings,
                    needsArray,
                    (current, total, message) => {
                        setOptimProgress({ current, total, message });
                    },
                    (message) => {
                        logs.push(message);
                        setOptimLogs([...logs]);
                    },
                    optimStrategy,
                    {
                        no_proliferator_weight: Number(noProliferatorPercent) / 100,
                    }
                );

                const changes = collectProliferatorChanges(
                    scheme_data,
                    result.optimalScheme,
                    game_data.recipe_data || [],
                    result.activeRecipeIndices,
                );
                const modeChanges = collectProliferatorModeChanges(
                    scheme_data,
                    result.optimalScheme,
                    game_data.recipe_data || [],
                    result.activeRecipeIndices,
                );
                const changeLogs = [
                    ...(allowed_levels_length > 1 ? [
                        '\n========== 增产选择纯改动（对比优化前） ==========',
                        ...(changes.length > 0
                            ? changes.map(change => `${change.item}: ${change.before} → ${change.after}`)
                            : ['没有物品的增产选择发生改动']),
                    ] : []),
                    '\n========== 增产选择改动（对比优化前） ==========',
                    ...(modeChanges.length > 0
                        ? modeChanges.map(change => `${change.item}: ${change.before} → ${change.after}`)
                        : ['没有物品的增产模式发生改动']),
                ];
                setOptimLogs([...logs, ...changeLogs]);

                // 应用优化结果
                set_scheme_data(result.optimalScheme);
            } catch (e) {
                console.error('优化失败:', e);
                setOptimLogs(prev => [...prev, `\n优化失败: ${e.message}`]);
                alert('优化失败: ' + e.message);
            } finally {
                setIsOptimizing(false);
            }
        }, 50);
    }, [game_data, scheme_data, global_state.settings, needs_list, set_scheme_data, optimStrategy, noProliferatorPercent]);

    const is_mobile = compact_mode === "mobile";
    const mob_icon = is_mobile ? 22 : undefined;

    // 增产剂等级多选
    const settings = useContext(SettingsContext);
    const allowed_levels = settings.proliferate_allowed_levels || [3];
    const toggle_level = (level) => {
        const new_levels = allowed_levels.includes(level)
            ? allowed_levels.filter(l => l !== level)
            : [...allowed_levels, level].sort();
        // 至少保留一个等级
        if (new_levels.length === 0) return;
        set_settings({ proliferate_allowed_levels: new_levels });
    };

    return <>
        <div className="mt-3 d-inline-flex flex-wrap column-gap-3 row-gap-2 align-items-center batch-setting-container">
            <select
                className="form-select form-select-sm"
                style={{width: 'auto', minWidth: '100px'}}
                value={optimStrategy}
                onChange={(e) => setOptimStrategy(e.target.value)}
                disabled={isOptimizing}
                title="选择优化策略"
            >
                <option value="min_power">最小电力</option>
                <option value="min_rare_weight">珍稀权重</option>
                <option value="min_net_heat">最小净热值</option>
                <option value="min_footprint">最小占地</option>
            </select>
            <button
                className="btn btn-sm btn-outline-success d-inline-flex align-items-center gap-1"
                onClick={runOptimization}
                disabled={isOptimizing || Object.keys(needs_list || {}).length === 0}
                title={isOptimizing ? '优化进行中...' : `自动优化增产策略（${optimStrategy === 'min_rare_weight' ? '珍稀权重' : optimStrategy === 'min_net_heat' ? '最小净热值' : optimStrategy === 'min_footprint' ? '最小占地' : '最小化总耗电'}）`}
            >
                <FaMagic/>
                <span className="compact-hide-text">
                    {isOptimizing ? `优化中 ${optimProgress.current}/${optimProgress.total}` : '自动优化'}
                </span>
            </button>
            <small className="fw-bold">可选增产剂</small>
            <div className="d-flex" style={{gap: '2px'}}>
                {[1, 2, 3].map(level => {
                    const pro_data = game_data.proliferator_data[level];
                    const is_selected = allowed_levels.includes(level);
                    return <div key={level}
                                className={`py-1 px-1 d-flex align-items-center cursor-pointer small border rounded
                                    ${is_selected ? 'bg-selected' : 'bg-unselected'}`}
                                onClick={() => toggle_level(level)}
                                title={`${pro_data?.增产剂 || 'MK' + level} ${is_selected ? '(已选)' : '(未选)'}`}
                    >
                        {pro_data?.增产剂 && <ItemIcon item={pro_data.增产剂} size={mob_icon || 32}/>}
                    </div>;
                })}
            </div>
            <button
                className={`btn btn-sm ${settings.proliferate_flexible_levels ? 'btn-outline-success' : 'btn-outline-secondary'}`}
                onClick={() => set_settings({ proliferate_flexible_levels: !settings.proliferate_flexible_levels })}
                disabled={isOptimizing}
                title="自动优化时，生产增产剂 Mk.I/II/III 的配方可自由选择各级增产剂（≤最高等级），不受可选增产剂限制（各级增产剂本就在产线上，无混用顾虑）"
            >
                增产剂自由等级:{settings.proliferate_flexible_levels ? '开' : '关'}
            </button>
            {optimStrategy === 'min_rare_weight' && (
                <button
                    className={`btn btn-sm ${settings.rare_ore_practicality ? 'btn-outline-success' : 'btn-outline-secondary'}`}
                    onClick={() => set_settings({ rare_ore_practicality: !settings.rare_ore_practicality })}
                    disabled={isOptimizing}
                    title="将刺笋结晶/金伯利矿石/分形硅石的稀缺度按可替代普通矿折算（替代比例95%）"
                >
                    珍稀实用性修正:{settings.rare_ore_practicality ? '开' : '关'}
                </button>
            )}
            <label className="d-inline-flex align-items-center gap-1 small text-nowrap" title="增产剂带来的目标改善低于此比例时，保留无增产剂方案">
                <span>无增产剂加权</span>
                <input
                    className="form-control form-control-sm"
                    style={{width: '64px'}}
                    type="number"
                    min="0"
                    step="0.1"
                    value={noProliferatorPercent}
                    onChange={(e) => setNoProliferatorPercent(e.target.value)}
                    disabled={isOptimizing}
                    aria-label="无增产剂加权百分比"
                />
                <span>%</span>
            </label>
            {showCollectorHint && (
                <a className="ms-2 small text-nowrap orbital-hint-link" onClick={() => onNavigate?.('seed-viewer')}
                   title="前往种子查看器的轨道采集器面板，按该星球参数获取精确产量">
                    去获取轨道采集器精确值
                </a>
            )}
            {optimStrategy === 'min_power' && (
                <small className="text-muted ms-1 mobile-hide" style={{whiteSpace: 'nowrap'}}>💡 最小净热值更精确</small>
            )}
            {showStatsApplied && optimStrategy === 'min_rare_weight' && (
                <small className="text-muted ms-1" style={{whiteSpace: 'nowrap'}}>💡已自动应用统计均值</small>
            )}
        </div>
        {optimLogs.length > 0 && (
            <div className="mt-2 border rounded p-2">
                <div className="d-flex align-items-center justify-content-between mb-1">
                    <small className="fw-bold">优化日志</small>
                    <button
                        className="btn btn-sm btn-link p-0 text-decoration-none"
                        onClick={() => setShowLogs(!showLogs)}
                    >
                        {showLogs ? <><FaChevronUp/> 收起</> : <><FaChevronDown/> 展开</>}
                    </button>
                </div>
                {showLogs && (
                    <pre
                        ref={logContainerRef}
                        className="mb-0 small"
                        style={{
                            maxHeight: '300px',
                            overflowY: 'auto',
                            fontFamily: 'monospace',
                            fontSize: '12px',
                            lineHeight: '1.4',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all'
                        }}
                    >
                        {optimLogs.join('\n')}
                    </pre>
                )}
            </div>
        )}
    </>;
}

export function BatchPresetControls() {
    const global_state = useContext(GlobalStateContext);
    const set_scheme_data = useContext(SchemeDataSetterContext);
    const compact_mode = useContext(CompactModeContext);
    const settings = useContext(SettingsContext);
    let game_data = global_state.game_data;
    let scheme_data = global_state.scheme_data;

    // 从 scheme_data 推导当前增产剂等级和增产模式（取第一个配方的值）
    let pro_num = 0;
    let pro_mode = 0;
    if (scheme_data.scheme_for_recipe.length > 0) {
        pro_num = scheme_data.scheme_for_recipe[0]["增产剂等级"];
        pro_mode = scheme_data.scheme_for_recipe[0]["增产模式"];
    }

    const is_mobile = compact_mode === "mobile";
    const mob_icon = is_mobile ? 22 : undefined;

    let factory_doms = [];
    // TODO rename to [factory_kind]
    Object.keys(game_data.factory_data).forEach(factory => {
        let list = game_data.factory_data[factory];
        // 挖矿简化:采矿机/大型采矿机 统一为挖矿机,已是单选必选项,批量预设无需提供
        if (list.some(f => f['名称'] === '采矿机' || f['名称'] === '大型采矿机')) return;
        let used_num = game_data.recipe_data.filter(data => data["设施"] == factory).length;
        //只有可选工厂类型大于等于2，并且这种工厂类型至少被3个配方使用时，才允许批量预设
        if (list.length >= 2 && used_num >= 3) {
            factory_doms.push(<FactorySelect key={factory} factory={factory} list={list} icon_size={mob_icon}/>);
        }
    });

    let proliferate_options = [{value: 0, label: "无"}];
    game_data.proliferator_data.forEach((data, idx) => {
        if (idx === 0) return;
        if (data?.增产剂 != null) {
            proliferate_options.push({
                value: idx, label: null,
                item_icon: data.增产剂
            })
        }
    });

    function change_pro_num(pro_num) {
        set_scheme_data(old_scheme_data => {
            let scheme_data = structuredClone(old_scheme_data);
            const noAccelerate = settings.proliferate_no_accelerate || false;
            for (var i = 0; i < game_data.recipe_data.length; i++) {
                const recipe = game_data.recipe_data[i];
                const proliferator = recipe["增产"] || 0;
                const canAccelerate = proliferator & 1;  // 配方本身支持加速
                const canExtraProduct = proliferator & 2;  // 配方本身支持增产

                // 如果开启了限制加速模式，且物品只能加速（不能增产），则设置为无增产剂
                if (noAccelerate && canAccelerate && !canExtraProduct) {
                    scheme_data.scheme_for_recipe[i]["增产剂等级"] = 0;
                } else {
                    scheme_data.scheme_for_recipe[i]["增产剂等级"] = pro_num;
                }
            }
            return scheme_data;
        });
    }

    function change_pro_mode(pro_mode) {
        set_scheme_data(old_scheme_data => {
            let scheme_data = structuredClone(old_scheme_data);
            for (var i = 0; i < game_data.recipe_data.length; i++) {
                if (!(pro_mode & game_data.recipe_data[i]["增产"])) {
                    continue;
                }
                scheme_data.scheme_for_recipe[i]["增产模式"] = Number(pro_mode);
            }
            return scheme_data;
        });
    }

    const promode_options = [
        {value: 2, label: "增产", className: pro_mode_class[2]},
        {value: 1, label: "加速", className: pro_mode_class[1]},
    ];

    return (
        <div className="mt-3 d-inline-flex flex-wrap column-gap-3 row-gap-2 align-items-center batch-setting-container">
            <small className="fw-bold">批量预设</small>
            <div className="d-flex pro-mode-toggle">
                {promode_options.map(({value, label, className}) => (
                    <div key={value}
                         className={`pro-mode-option ${pro_mode == value ? 'pro-mode-active' : ''} ${className || ''}`}
                         onClick={() => change_pro_mode(value)}>
                        {label}
                    </div>
                ))}
            </div>
            <div className="d-flex" style={{gap: '2px'}}>
                <HorizontalMultiButtonSelect choice={pro_num} options={proliferate_options}
                                             onChange={change_pro_num} no_gap={true} className={"raw-text-selection"}
                                             icon_size={mob_icon} rounded={true}/>
            </div>
            {factory_doms}
        </div>
    );
}
