import {useContext, useEffect, useRef, useState} from 'react';
import {
    GameInfoContext,
    GameInfoSetterContext,
    SchemeDataSetterContext,
    SettingsContext,
    SettingsSetterContext,
    safe_parse_json
} from './contexts.jsx';
import {NeedsList} from './needs_list.jsx';
import {Result} from './result.jsx';
import {init_scheme_data} from './scheme_data.jsx';
import {Settings, BatchSetting, FuelSelect} from './settings.jsx';
import {default_game_data} from "./game_data.jsx";
import {ItemIcon} from './ui_components.jsx';
import {FaTrashAlt, FaCog, FaMountain} from 'react-icons/fa';

function UserSettings({show}) {
    let class_show = show ? "" : "d-none";
    return <div className={`d-flex gap-3 ${class_show}`}>
        <fieldset>
            <legend><small>设置</small></legend>
            <Settings/>
        </fieldset>
    </div>;
}

function OreInput({item, value, onChange}) {
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
            value={editing !== null ? editing : (value || '')}
            onChange={handleChange}
            onBlur={handleBlur}
        />
    );
}

function OreQuantitiesPanel({game_info, settings, set_settings}) {
    const oreQuantities = settings.ore_quantities || {};
    const recipeData = game_info?.game_data?.recipe_data || [];
    const mineralizeList = settings.mineralize_list || {};
    // 真正无限的物品（抽水站/轨道采集器等可无限获取）
    const infiniteItems = new Set(['水', '硫酸', '临界光子', '氢', '重氢']);
    const oreItems = [];
    const seen = new Set();
    // 收集可由非行星基地设施采集的无原料物品作为原矿
    for (const recipe of recipeData) {
        const outputs = recipe['产物'] || {};
        const inputs = recipe['原料'] || {};
        const outputKeys = Object.keys(outputs);
        if (Object.keys(inputs).length === 0 && outputKeys.length === 1 && recipe['可采集']) {
            const item = outputKeys[0];
            if (!infiniteItems.has(item) && !seen.has(item)) { seen.add(item); oreItems.push(item); }
        }
    }
    for (const item of Object.keys(mineralizeList)) {
        if (!infiniteItems.has(item) && !seen.has(item)) { seen.add(item); oreItems.push(item); }
    }

    const handleChange = (item, numVal) => {
        const newQ = { ...oreQuantities };
        if (numVal > 0) { newQ[item] = numVal; } else { delete newQ[item]; }
        set_settings({ ore_quantities: newQ });
    };

    return (
        <div className="border rounded p-2 mt-1">
            <div className="d-flex flex-wrap gap-2">
                {oreItems.map(item => (
                    <div key={item} className="d-flex align-items-center gap-1" title={item}>
                        <ItemIcon item={item} size={24} />
                        <OreInput item={item} value={oreQuantities[item]} onChange={handleChange} />
                    </div>
                ))}
                <small className="text-muted align-self-center">留空 = 无限（不参与瓶颈计算），若全部填空等效于无权重加和</small>
            </div>
        </div>
    );
}

export default function App({needs_list, set_needs_list, newTabData}) {
    const game_info = useContext(GameInfoContext);
    const set_game_data = useContext(GameInfoSetterContext);
    const set_scheme_data = useContext(SchemeDataSetterContext);
    const settings = useContext(SettingsContext);
    const set_settings = useContext(SettingsSetterContext);
    const [misc_show, set_misc_show] = useState(false);
    const [show_ore_quantities, set_show_ore_quantities] = useState(false);
    const [show_ore_popup, set_show_ore_popup] = useState(false);
    const [show_building_popup, set_show_building_popup] = useState(false);
    const prev_game_name = useRef(game_info?.game_data?.game_name ?? '');

    useEffect(() => {
        // 初始化时加载默认游戏数据
        set_game_data(default_game_data);
        const all_schemes = safe_parse_json(localStorage.getItem("auto_scheme")) || {};
        const saved_scheme = all_schemes[default_game_data.game_name];
        if (saved_scheme && saved_scheme.scheme_for_recipe &&
            saved_scheme.scheme_for_recipe.length === default_game_data.recipe_data.length) {
            set_scheme_data(saved_scheme);
        } else {
            set_scheme_data(init_scheme_data(default_game_data));
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // 处理新标签页数据：清空原矿化列表（新页面不继承原页面的原矿表）
    useEffect(() => {
        if (newTabData) {
            set_settings({ mineralize_list: {} });
        }
    }, [newTabData]);

    useEffect(() => {
        // 只有当游戏名称真正变化时（不是组件重新挂载导致对象引用变化），才清空 needs_list
        const current_name = game_info?.game_data?.game_name ?? '';
        if (prev_game_name.current !== current_name) {
            prev_game_name.current = current_name;
            set_needs_list({});
        }
    }, [game_info]);

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
                <button className="btn btn-outline-danger btn-sm d-inline-flex align-items-center gap-1"
                        onClick={clearData} title="清空数据缓存">
                    <FaTrashAlt/>
                    <span className="compact-hide-text">清空数据缓存</span>
                </button>
                <button className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-1"
                        onClick={() => set_misc_show(s => !s)} title="采矿参数 & 其他设置">
                    <FaCog/>
                    <span className="compact-hide-text">采矿参数 & 其他设置</span>
                </button>
                <button className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1"
                        onClick={() => set_show_ore_quantities(s => !s)} title="矿物可用量设置">
                    <FaMountain/>
                    <span className="compact-hide-text">矿物可用量</span>
                </button>
            </div>
            {/*采矿参数&其他设置*/}
            <UserSettings show={misc_show}/>
            {/*矿物可用量设置*/}
            {show_ore_quantities && <OreQuantitiesPanel game_info={game_info} settings={settings} set_settings={set_settings}/>}
            {/*添加需求、批量预设*/}
            <NeedsList needs_list={needs_list} set_needs_list={set_needs_list}
                       set_show_ore_popup={set_show_ore_popup}
                       set_show_building_popup={set_show_building_popup}/>
            <BatchSetting needs_list={needs_list} set_show_ore_quantities={set_show_ore_quantities}/>
        </div>
        {/* 结果区域：填充剩余高度，独立滚动 */}
        <div className="app-result-area">
            <Result needs_list={needs_list} set_needs_list={set_needs_list}
                    show_ore_popup={show_ore_popup} set_show_ore_popup={set_show_ore_popup}
                    show_building_popup={show_building_popup} set_show_building_popup={set_show_building_popup}/>
        </div>
    </div>;
}
