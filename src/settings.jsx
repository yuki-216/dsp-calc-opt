import {useContext} from 'react';
import {CompactModeContext, DefaultSettingsContext, GlobalStateContext, SchemeDataSetterContext, SettingsContext, SettingsSetterContext} from './contexts.jsx';
import {HorizontalMultiButtonSelect} from './recipe.jsx';
import {pro_mode_class} from './result.jsx';

export function Settings() {
    const settings = useContext(SettingsContext);
    const set_settings = useContext(SettingsSetterContext);
    const DEFAULT_SETTINGS = useContext(DefaultSettingsContext);

    let percent_val = {
        mining_efficiency_large: Math.round(settings.mining_efficiency_large * 100),
        mining_speed_multiple: Math.round(settings.mining_speed_multiple * 100),
        acc_rate: Math.round(settings.acc_rate * 100),
        inc_rate: Math.round(settings.inc_rate * 100),
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
                <td>增产剂加速效率修正</td>
                <td className="ps-2">
                    <input type="number" value={percent_val["acc_rate"]} step={5}
                           style={{maxWidth: '5em'}}
                           onChange={e => change_percent_setting(e, "acc_rate", 1)}/>
                </td>
                <td className="ps-2">{"%"}</td>
            </tr>
            <tr>
                <td>增产剂增产效率修正</td>
                <td className="ps-2">
                    <input type="number" value={percent_val["inc_rate"]} step={5}
                           style={{maxWidth: '5em'}}
                           onChange={e => change_percent_setting(e, "inc_rate", 1)}/>
                </td>
                <td className="ps-2">{"%"}</td>
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
        value: idx, item_icon: data["名称"],
        label: cur == idx ? <span className="mx-1 compact-hide-text">{data["名称"]}</span> : null
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
                                        onChange={set_factory} no_gap={true} icon_size={icon_size}/>;
}

export function BatchSetting() {
    const global_state = useContext(GlobalStateContext);
    const set_scheme_data = useContext(SchemeDataSetterContext);
    const compact_mode = useContext(CompactModeContext);
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

    return <div className="mt-3 d-inline-flex flex-wrap column-gap-3 row-gap-2 align-items-center batch-setting-container">
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
        <HorizontalMultiButtonSelect choice={pro_num} options={proliferate_options}
                                     onChange={change_pro_num} no_gap={true} className={"raw-text-selection"}
                                     icon_size={mob_icon}/>
        {factory_doms}
    </div>;
}
