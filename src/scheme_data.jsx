import {useContext, useEffect, useState} from 'react';
import {GameInfoContext, GlobalStateContext, SchemeDataSetterContext} from './contexts.jsx';
import {FaRegSave, FaRegFolderOpen, FaTrash} from 'react-icons/fa';
import {build_item_data} from './game_data.jsx';

const DEFAULT_SCHEME_DATA = {
    "item_recipe_choices": {"氢": 1},
    "scheme_for_recipe": [{"建筑": 0, "增产剂等级": 0, "增产模式": 0}],
    "selected_fuel": "无",
    // 这是示例,实际上cost_weight之后会在init_scheme_data中重置
    "cost_weight": {
        "占地": 1,
        "电力": 0,
        "建筑成本": {
            "分拣器": 0,
            "制造台": 0,
        },
        "物品额外成本": {
            "单极磁石": {"成本": 10, "启用": 1, "与其它成本累计": 0},
            "铁": {"成本": 1, "启用": 0, "与其它成本累计": 0}
        }
    },
};

export function init_scheme_data(game_data) {
    let scheme_data = structuredClone(DEFAULT_SCHEME_DATA);
    let item_data = build_item_data(game_data.recipe_data);
    scheme_data.item_recipe_choices = {};
    scheme_data.scheme_for_recipe = [];
    scheme_data.selected_fuel = "无";
    scheme_data.cost_weight["占地"] = 1;
    scheme_data.cost_weight["电力"] = 0;
    scheme_data.cost_weight["建筑成本"] = {"分拣器": 0};
    scheme_data.cost_weight["物品额外成本"] = {};
    for (var factory in game_data.factory_data) {
        for (var building_id in game_data.factory_data[factory]) {
            scheme_data.cost_weight["建筑成本"][game_data.factory_data[factory][building_id]["名称"]] = 0;
        }
    }
    for (var item in item_data) {
        scheme_data.cost_weight["物品额外成本"][item] = {
            "成本": 0,
            "启用": 0,
            "与其它成本累计": 0,
            "溢出时处理成本": 0
        };
    }
    for (let item in item_data) {
        scheme_data.item_recipe_choices[item] = 1;
    }
    for (var i = 0; i < game_data.recipe_data.length; i++) {
        scheme_data.scheme_for_recipe.push({"建筑": 0, "增产剂等级": 0, "增产模式": 0});
    }
    return scheme_data;
}

export function SchemeStorage() {
    const global_state = useContext(GlobalStateContext);
    const game_info = useContext(GameInfoContext);
    const set_scheme_data = useContext(SchemeDataSetterContext);
    let scheme_data = global_state.scheme_data;
    let game_name = global_state.game_data.game_name;

    const all_saved = JSON.parse(localStorage.getItem("scheme_data")) || {};
    const [all_scheme, set_all_scheme] = useState(all_saved[game_name] || {});
    // TODO implement 实时保存

    useEffect(() => {
        let all_scheme_data = JSON.parse(localStorage.getItem("scheme_data")) || {};
        let all_scheme_init = all_scheme_data[game_name] || {};
        console.log("Loading storage", game_name, Object.keys(all_scheme_init));
        set_all_scheme(all_scheme_init);
    }, [game_info, game_name]);

    useEffect(() => {
        let all_scheme_saved = JSON.parse(localStorage.getItem("scheme_data")) || {};
        all_scheme_saved[game_name] = all_scheme;
        localStorage.setItem("scheme_data", JSON.stringify(all_scheme_saved));
    }, [all_scheme, game_name])

    //删除当前保存的策略
    function delete_(name) {
        if (name in all_scheme) {
            if (!confirm(`即将删除名为${name}的方案，是否继续`)) {
                return;// 用户取消保存
            }
            let all_scheme_copy = structuredClone(all_scheme);
            delete all_scheme_copy[name];
            set_all_scheme(all_scheme_copy);
        }
    }

    //读取生产策略
    function load(name) {
        if (all_scheme[name]) {
            let loaded = structuredClone(all_scheme[name]);
            // 迁移旧数据：确保 scheme_for_recipe 长度与 recipe_data 一致
            const recipeLen = game_info.game_data.recipe_data.length;
            const defaultEntry = {"建筑": 0, "增产剂等级": 0, "增产模式": 0};
            if (!loaded.scheme_for_recipe) {
                loaded.scheme_for_recipe = Array.from({length: recipeLen}, () => ({...defaultEntry}));
            } else {
                // 兼容旧数据：将增产点数转换为增产剂等级
                for (const recipe of loaded.scheme_for_recipe) {
                    if (recipe && recipe['增产点数'] !== undefined && recipe['增产剂等级'] === undefined) {
                        recipe['增产剂等级'] = recipe['增产点数'];
                        delete recipe['增产点数'];
                    }
                }
                while (loaded.scheme_for_recipe.length < recipeLen) {
                    loaded.scheme_for_recipe.push({...defaultEntry});
                }
                if (loaded.scheme_for_recipe.length > recipeLen) {
                    loaded.scheme_for_recipe.length = recipeLen;
                }
            }
            // 确保 selected_fuel 字段存在
            if (!loaded.selected_fuel) {
                loaded.selected_fuel = "无";
            }
            set_scheme_data(loaded);
        } else {
            alert(`未找到名为${name}的方案`);
        }
    }

    //保存生产策略
    function save() {
        let name = prompt("输入方案名");
        if (!name) return;
        if (name in all_scheme) {
            if (!confirm(`已存在名为${name}的方案，继续保存将覆盖原方案`)) {
                return;// 用户取消保存
            }
        }
        let all_scheme_copy = structuredClone(all_scheme);
        all_scheme_copy[name] = structuredClone(scheme_data);
        set_all_scheme(all_scheme_copy);
    }

    let dd_load_list = Object.keys(all_scheme).map(scheme_name => (
        <li key={scheme_name}>
            <a className="dropdown-item cursor-pointer"
               onClick={() => load(scheme_name)}>{scheme_name}</a>
        </li>));

    let dd_delete_list = Object.keys(all_scheme).map(scheme_name => (
        <li key={scheme_name}>
            <a className="dropdown-item cursor-pointer"
               onClick={() => delete_(scheme_name)}>{scheme_name}</a>
        </li>));

    return <div className="d-flex gap-2 align-items-center">
        <div className="text-nowrap storage-label">生产策略</div>
        <div className="input-group input-group-sm">
            <button className="btn btn-outline-secondary d-inline-flex align-items-center gap-1"
                    type="button" onClick={save} title="保存生产策略">
                <FaRegSave className="compact-show"/>
                <span className="compact-hide-text">保存</span>
            </button>
            <button className="btn btn-outline-secondary dropdown-toggle d-inline-flex align-items-center gap-1"
                    type="button" data-bs-toggle="dropdown" aria-expanded="false" title="加载生产策略">
                <FaRegFolderOpen className="compact-show"/>
                <span className="compact-hide-text">加载</span>
            </button>
            <ul className="dropdown-menu">{dd_load_list}</ul>
            <button className="btn btn-outline-secondary dropdown-toggle d-inline-flex align-items-center gap-1"
                    type="button" data-bs-toggle="dropdown" aria-expanded="false" title="删除生产策略">
                <FaTrash className="compact-show"/>
                <span className="compact-hide-text">删除</span>
            </button>
            <ul className="dropdown-menu">{dd_delete_list}</ul>
        </div>
    </div>;
}
