import {useContext, useMemo, useState, useEffect, useRef} from 'react';
import {createPortal} from 'react-dom';
import {Modal} from 'bootstrap';
import {CompactModeContext, GlobalStateContext, SchemeDataSetterContext, SettingsSetterContext, ValidationContext, EngineCalculateContext, FuelContext, CalculationErrorContext} from './contexts';
import {getFuelRecipe, getFuelData, DEVICE_POWER_CONSUMPTION} from './game_data.jsx';
import {ItemIcon} from './ui_components';
import {HorizontalMultiButtonSelect, Recipe} from './recipe';
import {AutoSizedInput} from './ui_components/auto_sized_input.jsx';
import allowed_recipes from '../data/allowed_recipes.json';

// 智能格式化数字：整数显示整数，小数显示到必要位数但不超过fixedNum
const formatValue = (value, fixedNum) => {
    if (Number.isInteger(value)) return value.toString();
    // 去除末尾的0，但保留至少fixedNum位小数
    const str = value.toFixed(fixedNum);
    // 去除末尾的0，但保留至少一位小数
    return str.replace(/\.?0+$/, '') || '0';
};

// 进1法格式化数字：向上取整到指定小数位数
const formatValueCeil = (value, fixedNum) => {
    if (Number.isInteger(value)) return value.toString();
    const factor = Math.pow(10, fixedNum);
    const ceiled = Math.ceil(value * factor) / factor;
    const str = ceiled.toFixed(fixedNum);
    // 去除末尾的0，但保留至少一位小数
    return str.replace(/\.?0+$/, '') || '0';
};

const ValueWithDifference = ({currentValue, previousValue}) => {
    const global_state = useContext(GlobalStateContext);
    const fixedNum = global_state.settings.fixed_num;
    // 如果没有上一次的值或者值相同，则只显示当前值
    if (previousValue === undefined || Math.abs(currentValue - previousValue) < 1e-6) {
        return <>
            {formatValue(currentValue, fixedNum)}
        </>;
    }

    // 计算差值
    const diff = currentValue - previousValue;
    const diffSign = diff > 0 ? '+' : '';

    // 根据差值正负设置颜色
    const color = diff > 0 ? 'red' : 'green';

    return (
        <>
            {formatValue(currentValue, fixedNum)}
            <span className="text-xs align-sub" style={{ fontSize: '0.7em', verticalAlign: 'sub', color: color, opacity: '0.5', marginLeft: '2px', marginRight: '2px' }}>
                {diffSign}{formatValue(diff, fixedNum)}
            </span>
        </>
    );
};

export function RecipeSelect({item, choice, onChange, compact}) {
    const global_state = useContext(GlobalStateContext);

    let game_data = global_state.game_data;
    let item_data = global_state.item_data;

    // 构建 recipe_data索引 -> item_data位置 的映射
    let recipe_index_to_position = {};
    for (let i = 1; i < item_data[item].length; i++) {
        recipe_index_to_position[item_data[item][i]] = i;
    }

    // 根据 allowed_recipes 决定可选配方及顺序
    let allowed = allowed_recipes[item];
    let filtered_indices = [];
    if (allowed) {
        // 按 allowed_recipes 中的顺序遍历
        for (let recipe_index of allowed) {
            if (recipe_index_to_position[recipe_index] !== undefined) {
                filtered_indices.push(recipe_index_to_position[recipe_index]);
            }
        }
    }

    // 校验：如果缓存的 choice 不在 allowed_recipes 允许范围内，自动重置
    useEffect(() => {
        if (filtered_indices.length > 0 && !filtered_indices.includes(choice)) {
            onChange(filtered_indices[0]);
        }
    }, [choice, filtered_indices.length]);

    // 如果过滤后只剩一个配方，直接显示
    if (filtered_indices.length <= 1) {
        let idx = filtered_indices[0] || 1;
        let recipe_index = item_data[item][idx];
        let recipe = game_data.recipe_data[recipe_index];
        return <div className="my-1 px-2 py-1"><Recipe recipe={recipe} compact={compact}/></div>
    }

    // 多个配方，显示选择列表
    let doms = filtered_indices.map(i => {
        let recipe_index = item_data[item][i];
        let recipe = game_data.recipe_data[recipe_index];
        let bg_class = (i == choice) ? "selected" : "";
        return <a key={i}
                  className={`recipe-item px-2 py-1 d-block text-decoration-none text-reset cursor-pointer ${bg_class}`}
                  onClick={() => onChange(i)}>
            <Recipe recipe={recipe} compact={compact}/>
        </a>;
    });

    return <div className="border-recipe-item">{doms}</div>;
}

export function ProNumSelect({recipe_id, choice, onChange, icon_size}) {
    const global_state = useContext(GlobalStateContext);
    let game_data = global_state.game_data;

    // 检查配方是否有增产模式选项，如果没有则隐藏增产剂等级选择
    let recipe_prolif = game_data.recipe_data[recipe_id]["增产"];
    if (!recipe_prolif) return null;

    let pro_num_options = [{value: 0, label: "无"}];
    for (let i = 1; i < game_data.proliferator_data.length; i++) {
        if (game_data.proliferator_data[i]?.增产剂 != null) {
            pro_num_options.push({value: i, item_icon: game_data.proliferator_data[i].增产剂});
        }
    }

    return <HorizontalMultiButtonSelect choice={choice} options={pro_num_options} onChange={onChange}
                                        icon_size={icon_size} optionType={"proNumSelect"} rounded={true}/>;
}

export const pro_mode_class = {
    [1]: "pro-mode-speedup",
    [2]: "pro-mode-extra-products",
    [3]: "pro-mode-lens"
}

export function ProModeSelect({recipe_id, choice, onChange}) {
    const global_state = useContext(GlobalStateContext);
    const set_scheme_data = useContext(SchemeDataSetterContext);
    let game_data = global_state.game_data;
    let recipe_prolif = game_data.recipe_data[recipe_id]["增产"];
    // 固定顺序：增产、加速、透镜（与批量预设一致）
    let options = [];
    if (recipe_prolif & 2) options.push({value: 2, label: "增产", className: pro_mode_class[2]});
    if (recipe_prolif & 1) options.push({value: 1, label: "加速", className: pro_mode_class[1]});
    if (recipe_prolif & 4) options.push({value: 3, label: "透镜", className: pro_mode_class[3]});

    if (options.length === 0) return null;

    // 未选择时默认选中第一个选项（直接计算显示值，不依赖 useEffect）
    const effectiveChoice = (choice === 0 || !options.some(o => o.value === choice)) ? options[0].value : choice;

    // 使用 useEffect 异步更新 scheme_data 以持久化默认值
    useEffect(() => {
        if (effectiveChoice !== choice) {
            set_scheme_data(old => {
                let scheme_data = structuredClone(old);
                scheme_data.scheme_for_recipe[recipe_id]["增产模式"] = effectiveChoice;
                return scheme_data;
            });
        }
    }, [effectiveChoice, choice, recipe_id, set_scheme_data]);

    const isSingle = options.length === 1;

    return <div className={`d-flex pro-mode-toggle ${isSingle ? 'pro-mode-single' : ''}`}>
        {options.map(({value, label, className}) => (
            <div key={value}
                 className={`pro-mode-option ${effectiveChoice == value ? 'pro-mode-active' : ''} ${className || ''}`}
                 onClick={() => onChange(value)}>
                {label}
            </div>
        ))}
    </div>;
}

export function FactorySelect({recipe_id, choice, onChange, no_gap, icon_size}) {
    const global_state = useContext(GlobalStateContext);
    let game_data = global_state.game_data;

    let factory_kind = game_data.recipe_data[recipe_id]["设施"];
    let factory_list = game_data.factory_data[factory_kind];

    let options = factory_list.map((factory_data, idx) => (
        {value: idx, item_icon: factory_data["名称"]}
    ));

    return <HorizontalMultiButtonSelect choice={choice} options={options} onChange={onChange}
                                        no_gap={no_gap} icon_size={icon_size} rounded={true}/>;
}
// 简易的对象相等性检查函数
const isEqual = (obj1, obj2) => {
    if (!obj1 || !obj2) return obj1 === obj2;

    // 比较能源成本
    if (Math.abs(obj1.energyCost - obj2.energyCost) > 1e-6 ||
        Math.abs(obj1.totalEnergyCost - obj2.totalEnergyCost) > 1e-6) {
        return false;
    }

    // 比较建筑数量
    const buildings1 = Object.keys(obj1.buildingCounts);
    const buildings2 = Object.keys(obj2.buildingCounts);

    if (buildings1.length !== buildings2.length) {
        return false;
    }

    for (const building of buildings1) {
        if (obj1.buildingCounts[building] !== obj2.buildingCounts[building]) {
            return false;
        }
    }

    // 比较原矿材料
    const materials1 = Object.keys(obj1.rawMaterials);
    const materials2 = Object.keys(obj2.rawMaterials);

    if (materials1.length !== materials2.length) {
        return false;
    }

    for (const material of materials1) {
        if (Math.abs(obj1.rawMaterials[material] - (obj2.rawMaterials[material] || 0)) > 1e-6) {
            return false;
        }
    }

    return true;
};

export function Result({needs_list, set_needs_list, show_ore_popup, set_show_ore_popup, show_building_popup, set_show_building_popup}) {
    const global_state = useContext(GlobalStateContext);
    const engineCalculate = useContext(EngineCalculateContext);
    const calculationError = useContext(CalculationErrorContext);
    const set_scheme_data = useContext(SchemeDataSetterContext);
    const set_settings = useContext(SettingsSetterContext);
    const compact_mode = useContext(CompactModeContext);
    const validation = useContext(ValidationContext);
    const selectedFuel = useContext(FuelContext);
    const is_compact = compact_mode !== "full";
    const is_mobile = compact_mode === "mobile";
    const mob_icon = is_mobile ? 20 : undefined;   // 总结面板/主图标

    // Refs for Bootstrap Modal instances
    const ore_modal_ref = useRef(null);
    const ore_modal_instance = useRef(null);
    const building_modal_ref = useRef(null);
    const building_modal_instance = useRef(null);

    // Initialize Bootstrap Modal instances
    useEffect(() => {
        if (ore_modal_ref.current) {
            ore_modal_instance.current = new Modal(ore_modal_ref.current);
            ore_modal_ref.current.addEventListener('hidden.bs.modal', () => {
                document.activeElement?.blur();
                set_show_ore_popup(false);
            });
        }
    }, [ore_modal_ref]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (building_modal_ref.current) {
            building_modal_instance.current = new Modal(building_modal_ref.current);
            building_modal_ref.current.addEventListener('hidden.bs.modal', () => {
                document.activeElement?.blur();
                set_show_building_popup(false);
            });
        }
    }, [building_modal_ref]); // eslint-disable-line react-hooks/exhaustive-deps

    // Show/hide Modal A based on show_ore_popup prop
    useEffect(() => {
        if (!ore_modal_instance.current) return;
        if (show_ore_popup) {
            ore_modal_instance.current.show();
        } else {
            ore_modal_instance.current.hide();
        }
    }, [show_ore_popup]);

    // Show/hide Modal B based on show_building_popup prop
    useEffect(() => {
        if (!building_modal_instance.current) return;
        if (show_building_popup) {
            building_modal_instance.current.show();
        } else {
            building_modal_instance.current.hide();
        }
    }, [show_building_popup]);

    // Auto-close both modals when exiting narrow/mobile mode
    useEffect(() => {
        if (compact_mode !== "narrow" && compact_mode !== "mobile") {
            set_show_ore_popup(false);
            set_show_building_popup(false);
        }
    }, [compact_mode, set_show_ore_popup, set_show_building_popup]);
    const mob_btn_icon = is_mobile ? 18 : undefined; // 表格内按钮图标
    // const [result_dict, set_result_dict] = useState(global_state.calculate());
    let game_data = global_state.game_data;
    let scheme_data = global_state.scheme_data;
    let settings = global_state.settings;
    let item_data = global_state.item_data;
    let time_tick = settings.is_time_unit_minute ? 60 : 1;

    // TODO refactor to a simple list
    let mineralize_list = settings.mineralize_list;
    // 主引擎计算
    const engineResult = useMemo(() => {
        if (!engineCalculate || !needs_list || Object.keys(needs_list).length === 0) {
            return null;
        }
        return engineCalculate(needs_list);
    }, [engineCalculate, needs_list]);

    // 从新引擎结果中提取数据
    const result_dict = engineResult?.recipeExecutions || {};
    const surplusByproducts = engineResult?.surplusByproducts || {};
    const selfConsumption = engineResult?.selfConsumption || {};
    const byproductSources = engineResult?.byproductSources || {};

    // 双引擎验证（复用已计算的新引擎结果）
    useEffect(() => {
        if (validation?.enabled && validation?.runValidation && needs_list && Object.keys(needs_list).length > 0) {
            validation.runValidation(needs_list, engineResult).catch(e => {
                console.warn("双引擎验证失败:", e);
            });
        }
    }, [engineResult, validation?.enabled]);

    // 用于存储历史值的数组，最多保留两个版本
    const [historyValues, setHistoryValues] = useState([]);

    let fixed_num = settings.fixed_num;
    // 从新引擎获取耗电和建筑数据
    let energy_cost = engineResult?.energyCost || 0;
    let miner_energy_cost = engineResult?.minerEnergyCost || 0;
    let building_list = engineResult?.buildingList || {};
    let building_details = engineResult?.buildingDetails || {};

    function get_factory_number(amount, item) {
        // 从引擎的 buildingDetails 中获取设备数量
        const detail = building_details[item];
        if (detail) {
            return detail.设备数量;
        }
        // fallback：如果引擎没有返回该物品的数据
        return 0;
    }

    function get_gross_output(amount, item) {
        if (selfConsumption[item]) {
            return Number(amount * (1 + selfConsumption[item]));
        }
        return Number(amount);
    }

    // Dict<item, Dict<from, quantity>> - 使用新引擎的 byproductSources
    const side_products = useMemo(() => {
        const sp = {};
        // byproductSources[副产物物品] = {来源物品: 每单位净产出的副产物量}
        Object.entries(byproductSources).forEach(([side_product, sources]) => {
            Object.entries(sources).forEach(([source_item, amount]) => {
                const exec_count = result_dict[source_item] || 0;
                if (exec_count > 0) {
                    if (!sp[side_product]) sp[side_product] = {};
                    sp[side_product][source_item] = exec_count * amount;
                }
            });
        });
        return sp;
    }, [result_dict, byproductSources]);

    function mineralize(item) {
        let new_mineralize_list = {...mineralize_list, [item]: true};
        set_settings({"mineralize_list": new_mineralize_list});
    }

    function unmineralize(item) {
        let new_mineralize_list = {...mineralize_list};
        delete new_mineralize_list[item];
        set_settings({"mineralize_list": new_mineralize_list});
    }

    function clear_mineralize_list() {
        set_settings({"mineralize_list": {}});
    }

    let mineralize_doms = Object.keys(mineralize_list).map(item => (
        <a key={item} className="m-1 cursor-pointer" onClick={() => unmineralize(item)}><ItemIcon item={item} size={mob_icon}/></a>
    ));

    let result_table_rows = [];

    const RatioAdjustInput = ({value, trimZeros, ceil}) => {
        let disp_value;
        if (ceil) {
            // 进1法，不去尾0
            const factor = Math.pow(10, fixed_num);
            const ceiled = Math.ceil(value * factor) / factor;
            disp_value = ceiled.toFixed(fixed_num);
        } else if (trimZeros) {
            disp_value = formatValue(value, fixed_num);
        } else {
            disp_value = value.toFixed(fixed_num);
        }
        let base_value = +disp_value;

        function set_needs_in_row() {
            return function (e_or_value) {
                // Either an event [e] or a raw [value] is supported
                if (base_value != 0) {
                    let new_value = e_or_value.target ? e_or_value.target.value : e_or_value;
                    let new_needs_list = {};
                    for (let i in needs_list) {
                        new_needs_list[i] = needs_list[i] * new_value / base_value;
                    }
                    set_needs_list(new_needs_list);
                }
            }
        }

        return <span data-tooltip="等比例调整需求" className="fast-tooltip">
            <AutoSizedInput
                delayed={true}
                value={disp_value}
                onChange={set_needs_in_row()}/>
        </span>;
    };

    // 置顶电力行（如果选择了燃料且有电力消耗）
    if (selectedFuel && selectedFuel !== "无" && (energy_cost > 0 || miner_energy_cost > 0)) {
        const totalEnergy = energy_cost + miner_energy_cost;
        const fuelRecipe = getFuelRecipe(selectedFuel);
        if (fuelRecipe) {
            const fuelDataList = getFuelData(game_data);
            const fuelData = fuelDataList.find(f => f.name === selectedFuel);
            const deviceName = fuelData?.device;
            const devicePower = DEVICE_POWER_CONSUMPTION[deviceName];
            const deviceCount = devicePower ? totalEnergy / devicePower : 0;
            const fuelRecipeIndex = game_data.recipe_data.findIndex(r => r.isFuelRecipe && r.fuelName === selectedFuel);
            const fuelScheme = fuelRecipeIndex >= 0 ? scheme_data.scheme_for_recipe[fuelRecipeIndex] : null;

            const changeFuelProMode = (value) => {
                if (fuelRecipeIndex < 0) return;
                set_scheme_data(old => {
                    let s = structuredClone(old);
                    if (!s.scheme_for_recipe[fuelRecipeIndex]) return old;
                    s.scheme_for_recipe[fuelRecipeIndex]["增产模式"] = value;
                    return s;
                });
            };
            const changeFuelProNum = (value) => {
                if (fuelRecipeIndex < 0) return;
                set_scheme_data(old => {
                    let s = structuredClone(old);
                    if (!s.scheme_for_recipe[fuelRecipeIndex]) return old;
                    s.scheme_for_recipe[fuelRecipeIndex]["增产剂等级"] = value;
                    return s;
                });
            };
            const changeFuelFactory = (value) => {
                if (fuelRecipeIndex < 0) return;
                set_scheme_data(old => {
                    let s = structuredClone(old);
                    if (!s.scheme_for_recipe[fuelRecipeIndex]) return old;
                    s.scheme_for_recipe[fuelRecipeIndex]["建筑"] = value;
                    return s;
                });
            };

            result_table_rows.unshift(
                <tr key="__power__" className="table-info">
                    <td></td>
                    <td>
                        <div className="d-flex align-items-center text-nowrap">
                            <ItemIcon item="电力" tooltip={is_compact} size={mob_icon}/>
                            <small className="ms-1 item-name-text">电力</small>
                        </div>
                    </td>
                    <td className="text-center">
                        <RatioAdjustInput value={totalEnergy}/>
                    </td>
                    <td className="text-nowrap">
                        {fuelScheme && (
                            <div className="d-inline-flex align-items-center gap-1">
                                <ItemIcon item={deviceName} size={is_mobile ? 18 : 30}/>
                                <RatioAdjustInput value={deviceCount}/>
                            </div>
                        )}
                    </td>
                    <td><div className="my-1 px-2 py-1"><Recipe recipe={fuelRecipe} compact={compact_mode}/></div></td>
                    <td>
                        {fuelRecipeIndex >= 0 && (
                            <ProModeSelect recipe_id={fuelRecipeIndex} onChange={changeFuelProMode}
                                           choice={fuelScheme?.增产模式 || 0}/>
                        )}
                    </td>
                    <td>
                        {fuelRecipeIndex >= 0 && (
                            <ProNumSelect recipe_id={fuelRecipeIndex} onChange={changeFuelProNum}
                                          choice={fuelScheme?.增产剂等级 || 0} icon_size={mob_btn_icon}/>
                        )}
                    </td>
                    <td>
                        {fuelRecipeIndex >= 0 && (
                            <FactorySelect recipe_id={fuelRecipeIndex} onChange={changeFuelFactory}
                                           choice={fuelScheme?.建筑 || 0} icon_size={mob_btn_icon}/>
                        )}
                    </td>
                </tr>
            );
        }
    }

    for (let i in result_dict) {
        // 跳过"电力"——已由置顶电力行处理
        if (i === "电力") continue;

        side_products[i] = side_products[i] || {};
        let total = result_dict[i] + Object.values(side_products[i]).reduce((a, b) => a + b, 0);
        if (total < 1e-6) continue;
        let recipe_id = item_data[i][scheme_data.item_recipe_choices[i]];
        // 缓存配方和方案数据，避免重复查找
        let recipe = game_data.recipe_data[recipe_id];
        let scheme_recipe = scheme_data.scheme_for_recipe[recipe_id];
        // 纯无中生有物品（Type = -2）始终隐藏
        // 视为原矿的物品始终隐藏
        // 无原料配方（当 hide_mines 开启时隐藏）
        if (recipe["Type"] === -2 || (i in mineralize_list) || (settings.hide_mines && Object.keys(recipe["原料"]).length < 1)) {
            continue;
        }
        let factory_number = get_factory_number(result_dict[i], i);
        let from_side_products = Object.entries(side_products[i]).map(([from, amount]) =>
            <div key={from} className="text-nowrap">+{amount.toFixed(fixed_num)} (<ItemIcon item={from} size={is_mobile ? 18 : 26}/>)
            </div>
        );
        let factory_name = game_data.factory_data[recipe["设施"]][scheme_recipe["建筑"]]["名称"];
        let is_mineralized = i in mineralize_list;
        let row_class = is_mineralized ? "table-secondary" : "";

        const change_recipe = (value) => {
            set_scheme_data(old_scheme_data => {
                let scheme_data = structuredClone(old_scheme_data);
                scheme_data.item_recipe_choices[i] = value;
                return scheme_data;
            })
        };

        const change_pro_num = (value) => {
            set_scheme_data(old_scheme_data => {
                let scheme_data = structuredClone(old_scheme_data);
                scheme_data.scheme_for_recipe[recipe_id]["增产剂等级"] = value;
                return scheme_data;
            })
        };

        const change_pro_mode = (value) => {
            set_scheme_data(old_scheme_data => {
                let scheme_data = structuredClone(old_scheme_data);
                scheme_data.scheme_for_recipe[recipe_id]["增产模式"] = value;
                return scheme_data;
            })
        };

        const change_factory = (value) => {
            set_scheme_data(old_scheme_data => {
                let scheme_data = structuredClone(old_scheme_data);
                scheme_data.scheme_for_recipe[recipe_id]["建筑"] = value;
                return scheme_data;
            })
        };

        result_table_rows.push(<tr className={row_class} key={i}>
            {/* 操作 */}
            <td>
                {is_mineralized ?
                    <button className="btn btn-sm btn-outline-primary ssmall text-nowrap mineralize-btn"
                            onClick={() => unmineralize(i)}>恢复</button> :
                    <button className="btn btn-sm btn-outline-primary ssmall text-nowrap mineralize-btn"
                            onClick={() => mineralize(i)}>
                        <div>视为</div>
                        <div>原矿</div>
                    </button>
                }
            </td>
            {/* 目标物品 */}
            <td>
                <div className="d-flex align-items-center text-nowrap">
                    <ItemIcon item={i} tooltip={is_compact} size={mob_icon}/>
                    <small className="ms-1 item-name-text">{i}</small>
                </div>
            </td>
            {/* 分钟毛产出 */}
            <td className="text-center">
                <RatioAdjustInput value={get_gross_output(result_dict[i], i)}/>
                {from_side_products}
            </td>
            {/* 所需工厂*数目 */}
            <td className="text-nowrap">
                {is_mineralized ||
                    <>
                        <div className="d-inline-flex align-items-center gap-1">
                            <ItemIcon item={factory_name} size={is_mobile ? 18 : 30}/>
                            <RatioAdjustInput value={factory_number} trimZeros={true} ceil={true}/>
                        </div>
                    </>
                }
            </td>
            {/* 所选配方 */}
            <td><RecipeSelect item={i} onChange={change_recipe}
                              choice={scheme_data.item_recipe_choices[i]}
                              compact={compact_mode}/></td>
            {/* 所选增产模式 */}
            <td><ProModeSelect recipe_id={recipe_id} onChange={change_pro_mode}
                               choice={scheme_data.scheme_for_recipe[recipe_id]["增产模式"]}/></td>
            {/* 所选增产剂 */}
            <td><ProNumSelect recipe_id={recipe_id} onChange={change_pro_num}
                              choice={scheme_data.scheme_for_recipe[recipe_id]["增产剂等级"]}
                              icon_size={mob_btn_icon}/></td>
            {/* 所选工厂种类 */}
            <td><FactorySelect recipe_id={recipe_id} onChange={change_factory}
                               choice={scheme_data.scheme_for_recipe[recipe_id]["建筑"]}
                               icon_size={mob_btn_icon}/></td>
        </tr>);
    }

    // 建筑统计按名称排序，保持静态顺序便于对比
    let building_rows = Object.entries(building_list)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([building, count]) => (
        <tr key={building}>
            <td className="d-flex align-items-center text-nowrap">
                <ItemIcon item={building} tooltip={false} size={mob_icon}/>
                <div className="d-flex flex-column ms-1">
                    <span>{'×'}{formatValue(count, fixed_num)}</span>
                    {historyValues?.[1]?.buildingCounts?.[building] !== undefined && Math.abs(count - historyValues[1].buildingCounts[building]) > 1e-6 && (
                        <span style={{fontSize: '0.85em', color: count > historyValues[1].buildingCounts[building] ? 'red' : 'green'}}>
                            {count > historyValues[1].buildingCounts[building] ? '+' : ''}{formatValue(count - historyValues[1].buildingCounts[building], fixed_num)}
                        </span>
                    )}
                </div>
            </td>
        </tr>));

    // 使用 useMemo 缓存原矿物品集合
    const rawMaterialItems = useMemo(() => {
        const items = new Set();
        for (const item of Object.keys(result_dict)) {
            if (item in mineralize_list) {
                items.add(item);
                continue;
            }
            try {
                const recipe_id = item_data[item][scheme_data.item_recipe_choices[item]];
                const recipe = game_data.recipe_data[recipe_id];
                const hasNoInputs = Object.keys(recipe["原料"]).length === 0;
                const hasSingleOutput = Object.keys(recipe["产物"]).length === 1;
                if (hasNoInputs && hasSingleOutput) {
                    items.add(item);
                }
            } catch {
                // skip
            }
        }
        return items;
    }, [result_dict, mineralize_list, item_data, scheme_data, game_data]);

    const isRawMaterial = (item) => rawMaterialItems.has(item);

    // 缓存原矿列表（用于主视图和Modal），按物品名称排序保持静态顺序
    const rawMaterials = useMemo(() => {
        return Object.entries(result_dict)
            .filter(([item]) => isRawMaterial(item))
            .sort(([a], [b]) => a.localeCompare(b));
    }, [result_dict, rawMaterialItems]);

    // 计算数值变化的差值
    // 更新历史值
    useEffect(() => {
        // 构建新的值对象
        const currentValues = {
            energyCost: energy_cost,
            totalEnergyCost: energy_cost + miner_energy_cost,
            buildingCounts: { ...building_list },
            rawMaterials: {}
        };

        Object.entries(result_dict).forEach(([item, amount]) => {
            if (isRawMaterial(item)) {
                currentValues.rawMaterials[item] = amount;
            }
        });

        // 如果historyValues为空或者第一个元素与当前值不同，则更新
        if (historyValues.length === 0 || !isEqual(historyValues[0], currentValues)) {
            // 将当前值添加到数组开头，最多保留两个版本
            const newHistory = [currentValues, ...historyValues].slice(0, 2);
            setHistoryValues(newHistory);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engineResult]);

    return <div className="result-container">
        {/* 计算错误提示 */}
        {calculationError && (
            <div className="alert alert-danger m-2" role="alert">
                <strong>计算错误：</strong>{calculationError}
            </div>
        )}
        {/* 左侧：结果表格独立滚动区域 */}
        <div className="result-table-scroll">
        <table className="table table-sm align-middle w-auto result-table">
            <thead>
            <tr className="text-center text-nowrap">
                <th width={60}>操作</th>
                <th width={140}>物品</th>
                <th width={130}>产能</th>
                <th width={110}>工厂</th>
                <th width={300}>配方选取</th>
                <th width={90}>增产模式</th>
                <th width={160}>增产剂</th>
                <th width={170}>工厂类型</th>
            </tr>
            </thead>
            <tbody className="table-group-divider">
            {result_table_rows}
            </tbody>
        </table>
        </div>
        {/* 右侧：总结面板独立滚动区域 */}
        <div className="result-summary-scroll">
        {compact_mode !== "narrow" && compact_mode !== "mobile" &&
        <div className="d-flex flex-column gap-2 summary-panel-content">

            {/* 双引擎验证状态（已禁用） */}
            {/* {validation && (
                <fieldset className="w-fit">
                    <legend><small>双引擎验证</small></legend>
                    ...
                </fieldset>
            )} */}

            {/* 引擎性能对比计时（已禁用） */}
            {/* {validation?.enabled && validation?.result?.details?.timing && (
                <fieldset>
                    ...
                </fieldset>
            )} */}

            {/* 双引擎数据对比（已禁用） */}
            {/* {validation?.enabled && validation?.result && !validation.result.match && validation.result.details && (
                <fieldset>
                    ...
                </fieldset>
            )} */}

            {/* 第一列：原矿化列表 + 多余产物（mobile 时还包含预估电力） */}
            <div className="d-flex flex-column gap-2 summary-col-1">
                {mineralize_doms.length > 0 &&
                    <fieldset className="w-fit">
                        <legend><small>原矿化列表</small></legend>
                        <div className="d-flex flex-wrap align-items-center">
                            {mineralize_doms}
                            <button className="ms-2 btn btn-sm btn-outline-danger text-nowrap"
                                    onClick={clear_mineralize_list}>清空
                            </button>
                        </div>
                    </fieldset>
                }

                {/* 预估电力：仅 mobile 布局时显示在第一列 */}
                {is_mobile && building_rows.length > 0 &&
                    <fieldset className="w-fit">
                        <legend><small>预估电力 (MW)</small></legend>
                        <div className="d-flex flex-column gap-1">
                            <div className="d-flex align-items-center gap-1 text-nowrap">
                                <span className="text-muted">生产：</span>
                                <span className="fast-tooltip" data-tooltip="不包含采集设备">
                                    <ValueWithDifference
                                        currentValue={energy_cost}
                                        previousValue={historyValues?.[1]?.energyCost}
                                        key="energy-cost"
                                    />
                                </span>
                            </div>
                            <div className="d-flex align-items-center gap-1 text-nowrap">
                                <span className="text-muted">总计：</span>
                                <span className="fast-tooltip" data-tooltip="包含采集设备">
                                    <ValueWithDifference
                                        currentValue={energy_cost + miner_energy_cost}
                                        previousValue={historyValues?.[1]?.totalEnergyCost}
                                        key="total-energy-cost"
                                    />
                                </span>
                            </div>
                        </div>
                    </fieldset>}
            </div>

            {/* 两列布局：左列多余产物+原矿+电力，右列建筑统计 */}
            <div className="d-flex gap-2 align-items-start">
                {/* 左列：多余产物 + 原矿需求 + 预估电力 */}
                <div className="d-flex flex-column gap-2">
                    {/* 多余产物 */}
                    {Object.keys(surplusByproducts).length > 0 &&
                        <fieldset className="w-fit">
                            <legend><small>多余产物</small></legend>
                            <table>
                                <tbody>
                                    {Object.entries(surplusByproducts).map(([item, amount]) => (
                                        <tr key={item}>
                                            <td className="d-flex align-items-center text-nowrap">
                                                <ItemIcon item={item} tooltip={false} size={mob_icon}/>
                                                <div className="d-flex flex-column ms-1">
                                                    <span>{'×'}{formatValue(-amount, fixed_num)}</span>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </fieldset>
                    }

                    {/* 原矿输入总需求 */}
                    {rawMaterials.length > 0 && (
                        <fieldset className="w-fit">
                            <legend><small>原矿输入总需求</small></legend>
                            <table>
                                <tbody>
                                    {rawMaterials.map(([item, amount]) => (
                                        <tr key={item}>
                                            <td className="d-flex align-items-center text-nowrap">
                                                <ItemIcon item={item} tooltip={false} size={mob_icon}/>
                                                <div className="d-flex flex-column ms-1">
                                                    <span>{'×'}{formatValue(amount, fixed_num)}</span>
                                                    {historyValues?.[1]?.rawMaterials?.[item] !== undefined && Math.abs(amount - historyValues[1].rawMaterials[item]) > 1e-6 && (
                                                        <span style={{fontSize: '0.85em', color: amount > historyValues[1].rawMaterials[item] ? 'red' : 'green'}}>
                                                            {amount > historyValues[1].rawMaterials[item] ? '+' : ''}{formatValue(amount - historyValues[1].rawMaterials[item], fixed_num)}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </fieldset>
                    )}

                    {/* 预估电力：非 mobile 布局时显示 */}
                    {!is_mobile && building_rows.length > 0 &&
                        <fieldset className="w-fit">
                            <legend><small>预估电力 (MW)</small></legend>
                            <div className="d-flex flex-column gap-2">
                                <div className="d-flex align-items-center text-nowrap">
                                    <span className="text-muted">生产：</span>
                                    <div className="d-flex flex-column">
                                        <span>{formatValue(energy_cost, fixed_num)}</span>
                                        {historyValues?.[1]?.energyCost !== undefined && Math.abs(energy_cost - historyValues[1].energyCost) > 1e-6 && (
                                            <span style={{fontSize: '0.85em', color: energy_cost > historyValues[1].energyCost ? 'red' : 'green'}}>
                                                {energy_cost > historyValues[1].energyCost ? '+' : ''}{formatValue(energy_cost - historyValues[1].energyCost, fixed_num)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="d-flex align-items-center text-nowrap">
                                    <span className="text-muted">总计：</span>
                                    <div className="d-flex flex-column">
                                        <span>{formatValue(energy_cost + miner_energy_cost, fixed_num)}</span>
                                        {historyValues?.[1]?.totalEnergyCost !== undefined && Math.abs((energy_cost + miner_energy_cost) - historyValues[1].totalEnergyCost) > 1e-6 && (
                                            <span style={{fontSize: '0.85em', color: (energy_cost + miner_energy_cost) > historyValues[1].totalEnergyCost ? 'red' : 'green'}}>
                                                {(energy_cost + miner_energy_cost) > historyValues[1].totalEnergyCost ? '+' : ''}{formatValue((energy_cost + miner_energy_cost) - historyValues[1].totalEnergyCost, fixed_num)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </fieldset>}
                </div>

                {/* 右列：建筑统计 */}
                {building_rows.length > 0 &&
                    <fieldset className="w-fit">
                        <legend><small>建筑统计</small></legend>
                        <table>
                            <tbody>{building_rows}</tbody>
                        </table>
                    </fieldset>
                }
            </div>
        </div>}
        </div>

        {/* Modal A: 原矿化列表 + 多余产物 */}
        {createPortal(
            <div ref={ore_modal_ref} className="modal" tabIndex="-1">
                <div className="modal-dialog mw-fit">
                    <div className="modal-content bg-body flex-column" style={{"--bs-bg-opacity": 0.85}}>
                        <div className="modal-header border-secondary">
                            <h6 className="modal-title">原矿 &amp; 多余产物</h6>
                            <button type="button" className="btn-close" data-bs-dismiss="modal"/>
                        </div>
                        <div className="modal-body summary-modal-body">
                            {mineralize_doms.length > 0 &&
                                <fieldset className="w-fit">
                                    <legend><small>原矿化列表</small></legend>
                                    <div className="d-flex flex-wrap align-items-center">
                                        {mineralize_doms}
                                        <button className="ms-2 btn btn-sm btn-outline-danger text-nowrap"
                                                onClick={clear_mineralize_list}>清空
                                        </button>
                                    </div>
                                </fieldset>
                            }
                            {Object.keys(surplusByproducts).length > 0 &&
                                <fieldset className="w-fit">
                                    <legend><small>多余产物</small></legend>
                                    <table>
                                        <tbody>
                                            {Object.entries(surplusByproducts).map(([item, amount]) => (
                                                <tr key={item}>
                                                    <td className="d-flex align-items-center text-nowrap">
                                                        <ItemIcon item={item} tooltip={false} size={mob_icon}/>
                                                        <span className="ms-1">{item}</span>
                                                    </td>
                                                    <td className="ps-2 text-nowrap">
                                                        {(-amount).toFixed(fixed_num)}/{time_tick === 60 ? 'min' : 'sec'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </fieldset>
                            }
                        </div>
                    </div>
                </div>
            </div>
            , document.body)}

        {/* Modal B: 原矿输入总需求 + 建筑统计 + 预估电力 */}
        {createPortal(
            <div ref={building_modal_ref} className="modal" tabIndex="-1">
                <div className="modal-dialog mw-fit">
                    <div className="modal-content bg-body flex-column" style={{"--bs-bg-opacity": 0.85}}>
                        <div className="modal-header border-secondary">
                            <h6 className="modal-title">建筑 &amp; 需求</h6>
                            <button type="button" className="btn-close" data-bs-dismiss="modal"/>
                        </div>
                        <div className="modal-body summary-modal-body">
                            {/* 原矿输入总需求 */}
                            {(() => {
                                const rawMaterials = Object.entries(result_dict)
                                    .filter(([item]) => isRawMaterial(item))
                                    .sort(([a], [b]) => a.localeCompare(b));
                                return rawMaterials.length > 0 && (
                                    <fieldset className="w-fit">
                                        <legend><small>原矿输入总需求</small></legend>
                                        <table>
                                            <tbody>
                                                {rawMaterials.map(([item, amount]) => (
                                                    <tr key={item}>
                                                        <td className="d-flex align-items-center text-nowrap">
                                                            <span className="ms-auto me-1 compact-hide-text">{item}</span>
                                                            <ItemIcon item={item} tooltip={false} size={mob_icon}/>
                                                        </td>
                                                        <td className="ps-2 text-nowrap">
                                                            {'x '}
                                                            <ValueWithDifference
                                                                currentValue={amount}
                                                                previousValue={historyValues?.[1]?.rawMaterials?.[item]}
                                                                key={`raw-material-${item}`}
                                                            />/{time_tick === 60 ? 'min' : 'sec'}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </fieldset>
                                );
                            })()}
                            {/* 建筑统计 */}
                            {building_rows.length > 0 &&
                                <fieldset className="w-fit">
                                    <legend><small>建筑统计</small></legend>
                                    <table>
                                        <tbody>{building_rows}</tbody>
                                    </table>
                                </fieldset>}
                        </div>
                        {/* 预估电力 — 固定在底部 */}
                        {building_rows.length > 0 &&
                            <div className="modal-footer border-secondary justify-content-start">
                                <div className="d-flex flex-column gap-1">
                                    <div className="d-flex align-items-center gap-1 text-nowrap">
                                        <span className="text-muted">生产电力：</span>
                                        <span className="fast-tooltip" data-tooltip="不包含采集设备">
                                            <ValueWithDifference
                                                currentValue={energy_cost}
                                                previousValue={historyValues?.[1]?.energyCost}
                                                key="energy-cost"
                                            />
                                        </span>
                                        <span className="text-muted">MW</span>
                                    </div>
                                    <div className="d-flex align-items-center gap-1 text-nowrap">
                                        <span className="text-muted">总电力：</span>
                                        <span className="fast-tooltip" data-tooltip="包含采集设备">
                                            <ValueWithDifference
                                                currentValue={energy_cost + miner_energy_cost}
                                                previousValue={historyValues?.[1]?.totalEnergyCost}
                                                key="total-energy-cost"
                                            />
                                        </span>
                                        <span className="text-muted">MW</span>
                                    </div>
                                </div>
                            </div>}
                    </div>
                </div>
            </div>
            , document.body)}
    </div>;
}
