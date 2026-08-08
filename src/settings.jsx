import {useContext, useState, useCallback, useRef, useEffect} from 'react';
import {CompactModeContext, DefaultSettingsContext, EngineGraphDataContext, FuelContext, FuelSetterContext, GlobalStateContext, SchemeDataSetterContext, SettingsContext, SettingsSetterContext} from './contexts.jsx';
import {HorizontalMultiButtonSelect} from './recipe.jsx';
import {pro_mode_class} from './result.jsx';
import {optimizeProliferatorStrategy, formatProliferatorLevel, formatProliferatorMode} from './engine/proliferator-optimizer.js';
import {FaMagic, FaChevronDown, FaChevronUp} from 'react-icons/fa';
import {ItemIcon} from './ui_components.jsx';
import {FUEL_DATA} from './game_data.jsx';

export function Settings() {
    const settings = useContext(SettingsContext);
    const set_settings = useContext(SettingsSetterContext);
    const DEFAULT_SETTINGS = useContext(DefaultSettingsContext);

    let percent_val = {
        mining_efficiency_large: Math.round(settings.mining_efficiency_large * 100),
        mining_speed_multiple: Math.round(settings.mining_speed_multiple * 100),
    }

    function change_int_setting(e, name, minVal) {
        let val = Math.max(parseInt(e.target.value) || DEFAULT_SETTINGS[name], minVal);
        set_settings({[name]: val});
    }

    function change_float_setting(e, name, minVal) {
        let val = Math.max(parseFloat(e.target.value) || DEFAULT_SETTINGS[name], minVal);
        set_settings({[name]: Math.round(val * 10000) / 10000});//输入框最多四位小数
    }

    function change_percent_setting(e, name, minVal) {
        let val = Math.max(parseInt(e.target.value) || (DEFAULT_SETTINGS[name] * 100), minVal);
        percent_val[name] = val;
        set_settings({[name]: val / 100});
    }

    function change_bool_setting(e, name) {
        set_settings({[name]: !settings[name]});
    }

    const fractionating_speed = settings.is_time_unit_minute
        ? settings.fractionating_speed * 60
        : settings.fractionating_speed;

    function change_fractionating_speed(e) {
        let fractionating_speed = parseFloat(e.target.value) || (settings.is_time_unit_minute ? 1800 : 30);
        if (settings.is_time_unit_minute) {
            fractionating_speed /= 60;
        }
        set_settings({"fractionating_speed": fractionating_speed});
    }

    return <div style={{display: 'flex', flexWrap: 'wrap'}}>
        <table>
            <tbody>
            <tr>
                <td>原油面板</td>
                <td className="ps-2">
                    <input type="number" value={settings.mining_speed_oil} step={0.10}
                           style={{maxWidth: '5em'}}
                           onChange={e => change_float_setting(e, "mining_speed_oil", 0.01)}/>
                </td>
                <td className="ps-2">{"/s（单个油井）"}</td>
            </tr>
            <tr>
                <td>巨星氢面板</td>
                <td className="ps-2">
                    <input type="number" value={settings.mining_speed_hydrogen} step={0.10}
                           style={{maxWidth: '5em'}}
                           onChange={e => change_float_setting(e, "mining_speed_hydrogen", 0.01)}/>
                </td>
                <td className="ps-2">{"/s（星球资源详情）"}</td>
            </tr>
            <tr>
                <td>巨星重氢面板</td>
                <td className="ps-2">
                    <input type="number" value={settings.mining_speed_deuterium} step={0.10}
                           style={{maxWidth: '5em'}}
                           onChange={e => change_float_setting(e, "mining_speed_deuterium", 0.01)}/>
                </td>
                <td className="ps-2">{"/s（星球资源详情）"}</td>
            </tr>
            <tr>
                <td>巨星可燃冰面板</td>
                <td className="ps-2">
                    <input type="number" value={settings.mining_speed_gas_hydrate} step={0.10}
                           style={{maxWidth: '5em'}}
                           onChange={e => change_float_setting(e, "mining_speed_gas_hydrate", 0.01)}/>
                </td>
                <td className="ps-2">{"/s（星球资源详情）"}</td>
            </tr>
            </tbody>
        </table>
        <table>
            <tbody>
            <tr>
                <td>原矿显示</td>
                <td className="ps-2">{settings.hide_mines ? "隐藏原矿" : "显示原矿"}</td>
                <td className="ps-2">
                    <button onClick={e => change_bool_setting(e, "hide_mines")}>
                        {settings.hide_mines ? "显示原矿" : "隐藏原矿"}</button>
                </td>
            </tr>
            <tr>
                <td>小矿机覆盖矿脉数</td>
                <td className="ps-2">
                    <input type="number" value={settings.covered_veins_small} step={1}
                           style={{maxWidth: '5em'}}
                           onChange={e => change_int_setting(e, "covered_veins_small", 1)}/>
                </td>
            </tr>
            <tr>
                <td>大矿机覆盖矿脉数</td>
                <td className="ps-2">
                    <input type="number" value={settings.covered_veins_large} step={1}
                           style={{maxWidth: '5em'}}
                           onChange={e => change_int_setting(e, "covered_veins_large", 1)}/>
                </td>
            </tr>
            <tr>
                <td>大矿机开采速度</td>
                <td className="ps-2">
                    <input type="number" value={percent_val["mining_efficiency_large"]} step={100}
                           style={{maxWidth: '5em'}}
                           onChange={e => change_percent_setting(e, "mining_efficiency_large", 100)}/>
                </td>
                <td className="ps-2">{"%"}</td>
            </tr>
            <tr>
                <td>采矿速度</td>
                <td className="ps-2">
                    <input type="number" value={percent_val["mining_speed_multiple"]} step={10}
                           style={{maxWidth: '5em'}}
                           onChange={e => change_percent_setting(e, "mining_speed_multiple", 100)}/>
                </td>
                <td className="ps-2">{"%（科技面板右上）"}</td>
            </tr>
            <tr>
                <td>分馏带速</td>
                <td className="ps-2">
                    <input value={fractionating_speed} onChange={change_fractionating_speed}
                           style={{maxWidth: '5em'}}/>
                </td>
                <td className="ps-2">{settings.is_time_unit_minute ? "/min" : "/sec"}</td>
            </tr>
            </tbody>
        </table>
        <table>
            <tbody>
            <tr>
                <td>速率单位</td>
                <td className="ps-2">{settings.is_time_unit_minute ? "个/min" : "个/sec"}</td>
                <td className="ps-2">
                    <button onClick={e => change_bool_setting(e, "is_time_unit_minute")}>
                        {settings.is_time_unit_minute ? "转化为秒" : "转化为分"}</button>
                </td>
            </tr>
            <tr>
                <td>精度位数</td>
                <td className="ps-2">
                    <input type="number" value={settings.fixed_num} step={1} style={{maxWidth: '5em'}}
                           onChange={e => change_int_setting(e, "fixed_num", 0)}/>
                </td>
            </tr>
            <tr>
                <td>研究站层数</td>
                <td className="ps-2">
                    <input type="number" value={settings.stack_research_lab} step={1}
                           style={{maxWidth: '5em'}}
                           onChange={e => change_int_setting(e, "stack_research_lab", 1)}/>
                </td>
            </tr>
            <tr>
                <td>增产剂自喷涂</td>
                <td className="ps-2">{settings.proliferate_itself ? "启用" : "禁用"}</td>
                <td className="ps-2">
                    <button onClick={e => change_bool_setting(e, "proliferate_itself")}>
                        {settings.proliferate_itself ? "改为禁用" : "改为启用"}</button>
                </td>
            </tr>
            <tr>
                <td>限制加速模式</td>
                <td className="ps-2">{settings.proliferate_no_accelerate ? "仅增产" : "全部"}</td>
                <td className="ps-2">
                    <button onClick={e => change_bool_setting(e, "proliferate_no_accelerate")}>
                        {settings.proliferate_no_accelerate ? "改为全部" : "改为仅增产"}</button>
                </td>
            </tr>
            </tbody>
        </table>
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

    const options = list.map((data, idx) => ({
        value: idx, item_icon: data["名称"]
    }));

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

function FuelSelect() {
    const selectedFuel = useContext(FuelContext);
    const setSelectedFuel = useContext(FuelSetterContext);
    const compact_mode = useContext(CompactModeContext);
    const is_mobile = compact_mode === "mobile";
    const mob_icon = is_mobile ? 22 : undefined;

    return (
        <div className="d-flex align-items-center gap-2 flex-wrap">
            <small className="fw-bold">燃料选择</small>
            <div className="d-flex gap-1 flex-wrap">
                {FUEL_DATA.map(fuel => (
                    <div
                        key={fuel.name}
                        className={`cursor-pointer border rounded p-1 d-flex align-items-center justify-content-center ${
                            selectedFuel === fuel.name
                                ? 'border-primary bg-primary bg-opacity-10'
                                : 'border-secondary'
                        }`}
                        onClick={() => setSelectedFuel(fuel.name)}
                        style={{minWidth: '32px', minHeight: '32px'}}
                        title={fuel.name === "无" ? "不进行燃料计算" : `${fuel.name} (${fuel.heatValue}MJ) - ${fuel.device}`}
                    >
                        {fuel.name === "无" ? (
                            <span className="small text-muted">无</span>
                        ) : (
                            <ItemIcon item={fuel.name} size={mob_icon || 24} />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

export function BatchSetting({needs_list}) {
    const global_state = useContext(GlobalStateContext);
    const set_scheme_data = useContext(SchemeDataSetterContext);
    const set_settings = useContext(SettingsSetterContext);
    const compact_mode = useContext(CompactModeContext);
    let game_data = global_state.game_data;
    let scheme_data = global_state.scheme_data;

    // 优化器状态
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [optimProgress, setOptimProgress] = useState({ current: 0, total: 0, message: '' });
    const [optimResult, setOptimResult] = useState(null);
    const [optimLogs, setOptimLogs] = useState([]);
    const [showLogs, setShowLogs] = useState(true);
    const logContainerRef = useRef(null);

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
        setOptimResult(null);
        // 先添加一条初始日志，让日志页面展开
        setOptimLogs(['正在初始化优化...']);
        setOptimProgress({ current: 0, total: 0, message: '正在初始化...' });
        setShowLogs(true);

        // 使用 setTimeout 让 UI 有时间更新
        setTimeout(async () => {
            try {
                const logs = ['正在初始化优化...'];
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
                    }
                );

                setOptimResult(result);
                setOptimLogs([...logs]);

                // 应用优化结果
                if (result.changes.length > 0) {
                    set_scheme_data(result.optimalScheme);
                }
            } catch (e) {
                console.error('优化失败:', e);
                setOptimLogs(prev => [...prev, `\n优化失败: ${e.message}`]);
                alert('优化失败: ' + e.message);
            } finally {
                setIsOptimizing(false);
            }
        }, 50);
    }, [game_data, scheme_data, global_state.settings, needs_list, set_scheme_data]);

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
        let used_num = game_data.recipe_data.filter(data => data["设施"] == factory).length;
        //只有可选工厂类型大于等于2，并且这种工厂类型至少被3个配方使用时，才允许批量预设
        if (list.length >= 2 && used_num >= 3) {
            factory_doms.push(<FactorySelect key={factory} factory={factory} list={list} icon_size={mob_icon}/>);
        }
    });

    let proliferate_options = [{value: 0, label: "无"}];
    game_data.proliferator_data.forEach((data, idx) => {
        if (idx === 0) return;
        if (data?.增产剂) {
            proliferate_options.push({
                value: idx, label: null,
                item_icon: data["名称"]
            })
        }
    });

    function change_pro_num(pro_num) {
        set_scheme_data(old_scheme_data => {
            let scheme_data = structuredClone(old_scheme_data);
            for (var i = 0; i < game_data.recipe_data.length; i++) {
                scheme_data.scheme_for_recipe[i]["增产剂等级"] = pro_num;
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

    // 增产剂等级多选
    const settings = useContext(SettingsContext);
    const allowed_levels = settings.proliferate_allowed_levels || [1, 2, 3];
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
            {/* 燃料选择 */}
            <FuelSelect />

            {/* 分隔线 */}
            <div className="vr d-none d-md-block" style={{height: '24px'}}></div>

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
            <small className="fw-bold">可选增产剂</small>
            <div className="d-flex" style={{gap: '2px'}}>
                {[1, 2, 3].map(level => {
                    const pro_data = game_data.proliferator_data[level];
                    const is_selected = allowed_levels.includes(level);
                    return <div key={level}
                                className={`py-1 px-1 d-flex align-items-center cursor-pointer small border rounded
                                    ${is_selected ? 'bg-success text-white' : 'bg-secondary text-white-50'}`}
                                onClick={() => toggle_level(level)}
                                title={`${pro_data?.名称 || 'MK' + level} ${is_selected ? '(已选)' : '(未选)'}`}
                    >
                        {pro_data?.名称 && <ItemIcon item={pro_data.名称} size={mob_icon || 32}/>}
                    </div>;
                })}
            </div>
            <button
                className="btn btn-sm btn-outline-success d-inline-flex align-items-center gap-1"
                onClick={runOptimization}
                disabled={isOptimizing || Object.keys(needs_list || {}).length === 0}
                title={isOptimizing ? '优化进行中...' : '按 SCC 正序自动优化增产策略（最小化总耗电）'}
            >
                <FaMagic/>
                <span className="compact-hide-text">
                    {isOptimizing ? `优化中 ${optimProgress.current}/${optimProgress.total}` : '自动优化'}
                </span>
            </button>
        </div>
        {optimLogs.length > 0 && (
            <div className="mt-2 border rounded p-2" style={{maxWidth: '800px'}}>
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

function formatPower(value) {
    if (value >= 1e6) return (value / 1e6).toFixed(2) + ' GW';
    if (value >= 1e3) return (value / 1e3).toFixed(2) + ' MW';
    return value.toFixed(2) + ' kW';
}
