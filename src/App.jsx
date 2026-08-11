import {useContext, useEffect, useRef, useState} from 'react';
import {
    GameInfoContext,
    GameInfoSetterContext,
    SchemeDataSetterContext,
    SettingsSetterContext
} from './contexts.jsx';
import {NeedsList} from './needs_list.jsx';
import {Result} from './result.jsx';
import {init_scheme_data} from './scheme_data.jsx';
import {Settings, BatchSetting, FuelSelect} from './settings.jsx';
import {
    default_game_data,
    vanilla_game_version
} from "./game_data.jsx";
import {FaTrashAlt, FaCog} from 'react-icons/fa';

function safe_parse_json(str) {
    try { return JSON.parse(str); } catch { return null; }
}

function UserSettings({show}) {
    let class_show = show ? "" : "d-none";
    return <div className={`d-flex gap-3 ${class_show}`}>
        <fieldset>
            <legend><small>设置</small></legend>
            <Settings/>
        </fieldset>
    </div>;
}

function AppWithContexts({needs_list, set_needs_list}) {
    const game_info = useContext(GameInfoContext);
    const set_game_data = useContext(GameInfoSetterContext);
    const set_scheme_data = useContext(SchemeDataSetterContext);
    const [misc_show, set_misc_show] = useState(false);
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
            </div>
            {/*采矿参数&其他设置*/}
            <UserSettings show={misc_show}/>
            {/*添加需求、批量预设*/}
            <NeedsList needs_list={needs_list} set_needs_list={set_needs_list}
                       set_show_ore_popup={set_show_ore_popup}
                       set_show_building_popup={set_show_building_popup}/>
            <BatchSetting needs_list={needs_list}/>
        </div>
        {/* 结果区域：填充剩余高度，独立滚动 */}
        <div className="app-result-area">
            <Result needs_list={needs_list} set_needs_list={set_needs_list}
                    show_ore_popup={show_ore_popup} set_show_ore_popup={set_show_ore_popup}
                    show_building_popup={show_building_popup} set_show_building_popup={set_show_building_popup}/>
        </div>
    </div>;
}

export default function App({needs_list, set_needs_list}) {
    return <AppWithContexts needs_list={needs_list} set_needs_list={set_needs_list}/>;
}
