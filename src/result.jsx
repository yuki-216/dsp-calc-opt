import {useCallback, useContext, useMemo, useState, useEffect, useLayoutEffect, useRef} from 'react';
import {createPortal} from 'react-dom';
import {Modal} from 'bootstrap';
import {CompactModeContext, GlobalStateContext, SchemeDataSetterContext, SettingsSetterContext, EngineCalculateContext, FuelContext, CalculationErrorContext} from './contexts';
import {DEBUG} from './engine/debug.js';
import {getFuelRecipe, getFuelData, DEVICE_POWER_CONSUMPTION, FUEL_DATA_BASE} from './game_data.jsx';
import {ItemIcon} from './ui_components';
import {HorizontalMultiButtonSelect, Recipe} from './recipe';
import {AutoSizedInput} from './ui_components.jsx';
import {getAllowedRecipes} from './scheme_data';
import {FaExternalLinkAlt, FaTimes} from 'react-icons/fa';
import {getPowerDeviceCount} from './power-device-count.js';
import {getRareOreCorrection, correctedRareWeightUnit} from './engine/rare-ore-practicality.js';
import {buildResultRowOrder, collectDemandedItems} from './result-rows.js';
import {optimizeFactoryMix, isOptimizableFactoryGroup} from './factory-integer-optimizer.js';

// 稳定空引用，避免 `|| {}` 每次渲染新建对象导致依赖数组不稳定
const EMPTY_OBJ = {};

// 挖矿简化:设备数不展示(×?)的建筑;建筑统计里不出现的(挖矿机/原油萃取站);采矿机/大型采矿机 统一显示为 挖矿机
// 轨道采集器设备数可按单采集器产量折算,设备列正常显示;仅建筑统计汇总值 ×?
// 设备列显示 ×?(设备数不计算):挖矿机/原油萃取站(单位采集耗电计电) + 分馏塔(补氢结构,仅估算电力)
const HIDDEN_DEVICE_BUILDINGS = new Set(['挖矿机', '原油萃取站', '分馏塔']);
// 建筑统计忽略:与 HIDDEN_DEVICE_BUILDINGS 一致,分馏塔台数不汇总
const NO_BUILDING_STATS = new Set(['挖矿机', '原油萃取站', '分馏塔']);
// 设备列 ×? 的悬浮提示(按建筑区分)
const DEVICE_HIDDEN_TIPS = {
    '挖矿机': '设备数不计算(依赖实际矿脉/摆放)，电力按单位采集耗电计',
    '原油萃取站': '设备数不计算(依赖实际矿脉/摆放)，电力按单位采集耗电计',
    '分馏塔': '设备依赖补氢结构，仅估算电力',
};
// 矿物行整行自动隐藏:无多配方选择 且 无设备计算的矿物(铁矿/铜矿/原油等)
const MINERAL_AUTO_HIDE_BUILDINGS = new Set(['挖矿机', '原油萃取站']);
const normalizeFactoryName = (name) => (name === '采矿机' || name === '大型采矿机') ? '挖矿机' : name;

// 精简下拉选项文本:建筑/物品名中的 "Mk.罗马" → "Mk3"(如 制造台Mk.III、增产剂Mk.II)
const ROMAN_TO_NUM = {I: 1, II: 2, III: 3, IV: 4, V: 5};
export function mkShort(name) {
    const m = String(name).match(/Mk\.?\s*([IVX]+)/i);
    if (!m) return name;
    const n = ROMAN_TO_NUM[m[1].toUpperCase()];
    return n ? `Mk${n}` : name;
}
// 设备等级列下拉:semi 及更窄触发(compact 仍保持按钮)
const isSemiOrNarrower = (m) => m === 'semi' || m === 'mid' || m === 'slender' || m === 'narrow' || m === 'mobile';
// 增产等级列下拉:mid 及更窄触发(semi/compact 仍保持按钮)
const isMidOrNarrower = (m) => m === 'mid' || m === 'slender' || m === 'narrow' || m === 'mobile';

// 面板显示阈值：LP 数值噪声（引擎相对容差已尽力）残留 < 0.01 的条目不显示，UI 兜底
const PANEL_DISPLAY_EPS = 0.01;

// 珍稀权重目标值：纯数字（自适应精度，不带单位后缀）
function formatRareWeightValue(value) {
    if (!Number.isFinite(value) || value === 0) return '0';
    const a = Math.abs(value);
    if (a >= 100) return value.toFixed(2);
    if (a >= 1) return value.toFixed(3);
    if (a >= 0.01) return value.toFixed(4);
    return Number(value.toPrecision(4)).toString();
}

/**
 * 创建 scheme_data 更新闭包
 * @param {Function} set_scheme_data - state setter
 * @param {string} type - 'recipe_choice' | 'recipe_field'
 * @param {number} recipeId - 配方索引（recipe_field 类型时使用）
 * @param {string} key - 字段名（recipe_field 类型时使用）
 */
function makeSchemeUpdater(set_scheme_data, type, recipeId, key) {
    return (value) => {
        set_scheme_data(old => {
            const s = structuredClone(old);
            if (type === 'recipe_choice') {
                s.item_recipe_choices[recipeId] = value;
            } else {
                if (!s.scheme_for_recipe[recipeId]) return old;
                s.scheme_for_recipe[recipeId][key] = value;
            }
            return s;
        });
    };
}

// 智能格式化数字：整数显示整数，小数显示到必要位数但不超过fixedNum
const formatValue = (value, fixedNum) => {
    if (Number.isInteger(value)) return value.toString();
    // 去除末尾的0，但保留至少fixedNum位小数
    const str = value.toFixed(fixedNum);
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
    // 按当前数据源取 allowed_recipes（切换 mod 后配方索引不同，须用对应数据源的映射）
    const allowed_recipes = getAllowedRecipes(game_data.game_name);

    // 根据 allowed_recipes 决定可选配方及顺序（useMemo 稳定引用，避免 effect 依赖数组每次渲染变化）
    const filtered_indices = useMemo(() => {
        // 构建 recipe_data索引 -> item_data位置 的映射
        let recipe_index_to_position = {};
        for (let i = 1; i < item_data[item].length; i++) {
            recipe_index_to_position[item_data[item][i]] = i;
        }

        let filtered_indices = [];
        const allowed = allowed_recipes[item];
        if (allowed) {
            // 按 allowed_recipes 中的顺序遍历
            for (let recipe_index of allowed) {
                if (recipe_index_to_position[recipe_index] !== undefined) {
                    filtered_indices.push(recipe_index_to_position[recipe_index]);
                }
            }
        }
        return filtered_indices;
    }, [item_data, item, allowed_recipes]);

    // 校验：如果缓存的 choice 不在 allowed_recipes 允许范围内，自动重置
    useEffect(() => {
        if (filtered_indices.length > 0 && !filtered_indices.includes(choice)) {
            onChange(filtered_indices[0]);
        }
    }, [choice, filtered_indices, onChange]);

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
    const compact_mode = useContext(CompactModeContext);
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

    // mid 及更窄:按钮换成下拉选择框;只有"无"一个可选项时不可更改,直接隐藏
    if (isMidOrNarrower(compact_mode)) {
        if (pro_num_options.length <= 1) return null;
        return <select className="form-select form-select-sm"
                       style={{width: '100%', padding: '0.1rem 0.4rem', fontSize: '0.85em', appearance: 'none', backgroundImage: 'none'}}
                       value={choice} onChange={e => onChange(Number(e.target.value))}>
            {pro_num_options.map(o => <option key={o.value} value={o.value}>{o.label || mkShort(o.item_icon)}</option>)}
        </select>;
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
    const compact_mode = useContext(CompactModeContext);
    let game_data = global_state.game_data;
    let recipe_prolif = game_data.recipe_data[recipe_id]["增产"];
    // 固定顺序：增产、加速、透镜（与批量预设一致）
    let options = [];
    if (recipe_prolif & 2) options.push({value: 2, label: "增产", className: pro_mode_class[2]});
    if (recipe_prolif & 1) options.push({value: 1, label: "加速", className: pro_mode_class[1]});
    if (recipe_prolif & 4) options.push({value: 3, label: "透镜", className: pro_mode_class[3]});

    // 未选择时默认选中第一个选项（直接计算显示值，不依赖 useEffect）；无可用选项时为 null，跳过持久化
    const effectiveChoice = options.length === 0 ? null
        : ((choice === 0 || !options.some(o => o.value === choice)) ? options[0].value : choice);

    // 使用 useEffect 异步更新 scheme_data 以持久化默认值
    useEffect(() => {
        if (effectiveChoice !== null && effectiveChoice !== choice) {
            set_scheme_data(old => {
                let scheme_data = structuredClone(old);
                scheme_data.scheme_for_recipe[recipe_id]["增产模式"] = effectiveChoice;
                return scheme_data;
            });
        }
    }, [effectiveChoice, choice, recipe_id, set_scheme_data]);

    if (options.length === 0) return null;

    // 窄档(slender,原 narrow 语义):增产模式按钮改为下拉框(同增产等级列样式)
    if (compact_mode === 'slender') {
        return <select className="form-select form-select-sm"
                       style={{width: '100%', padding: '0.1rem 0.4rem', fontSize: '0.85em', appearance: 'none', backgroundImage: 'none'}}
                       value={effectiveChoice ?? ''}
                       onChange={e => onChange(Number(e.target.value))}>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>;
    }

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
    const compact_mode = useContext(CompactModeContext);
    let game_data = global_state.game_data;

    let factory_kind = game_data.recipe_data[recipe_id]["设施"];
    let factory_list = game_data.factory_data[factory_kind];

    // 挖矿简化:采矿机/大型采矿机合并为"挖矿机"(移除大型采矿机,保留原索引)
    let options = factory_list
        .map((factory_data, idx) => ({value: idx, item_icon: factory_data["名称"]}))
        .filter(o => o.item_icon !== "大型采矿机")
        .map(o => o.item_icon === "采矿机" ? {...o, item_icon: "挖矿机"} : o);

    // semi 及更窄:按钮换成下拉选择框;仅一种建筑可选用时不可更改,直接隐藏。
    // 选项直接按等级序号显示 Mk1/Mk2/Mk3(不依赖原名是否 Mk 命名,本质即第几级)
    if (isSemiOrNarrower(compact_mode)) {
        if (options.length <= 1) return null;
        return <select className="form-select form-select-sm"
                       style={{width: '100%', padding: '0.1rem 0.4rem', fontSize: '0.85em', appearance: 'none', backgroundImage: 'none'}}
                       value={choice} onChange={e => onChange(Number(e.target.value))}>
            {options.map((o, idx) => <option key={o.value} value={o.value}>Mk{idx + 1}</option>)}
        </select>;
    }

    return <HorizontalMultiButtonSelect choice={choice} options={options} onChange={onChange}
                                        no_gap={no_gap} icon_size={icon_size} rounded={true}/>;
}
// 简易的对象相等性检查函数
const isEqual = (obj1, obj2) => {
    if (!obj1 || !obj2) return obj1 === obj2;

    // 比较能源成本
    if (Math.abs(obj1.energyCost - obj2.energyCost) > 1e-6 ||
        Math.abs(obj1.totalEnergyCost - obj2.totalEnergyCost) > 1e-6 ||
        Math.abs((obj1.totalPowerDemand || 0) - (obj2.totalPowerDemand || 0)) > 1e-6) {
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

export function Result({needs_list, set_needs_list, show_ore_popup, set_show_ore_popup, show_building_popup, set_show_building_popup, onCollectorDetected, onNavigate}) {
    const global_state = useContext(GlobalStateContext);
    const engineCalculate = useContext(EngineCalculateContext);
    const calculationError = useContext(CalculationErrorContext);
    const set_scheme_data = useContext(SchemeDataSetterContext);
    const set_settings = useContext(SettingsSetterContext);
    const compact_mode = useContext(CompactModeContext);
    const selectedFuel = useContext(FuelContext);
    const is_compact = compact_mode !== "full";
    const is_mobile = compact_mode === "mobile";
    // 更窄(narrow/mobile)时隐藏合并列内的整数建议,改在设备列悬浮提示
    const hideIntHint = compact_mode === 'narrow';
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
    let game_data = global_state.game_data;
    let scheme_data = global_state.scheme_data;
    let settings = global_state.settings;
    let item_data = global_state.item_data;
    let time_tick = settings.is_time_unit_minute ? 60 : 1;

    /**
     * 在新窗口计算：原页面将物品视为原矿，新标签页添加为需求
     * @param {string} item - 物品名
     * @param {number} count - 数量（从输出表继承）
     */
    function openInNewTab(item, count) {
        // 原页面：标记为原矿
        mineralize(item);
        // 传递数据到新标签页（不标记为原矿）
        const data = { item, count, asOre: false };
        localStorage.setItem('dsp-calc-new-tab-data', JSON.stringify(data));
        window.open(window.location.href, '_blank');
    }

    // TODO refactor to a simple list
    let mineralize_list = settings.mineralize_list;
    // 主引擎计算（Task 4 后 engineCalculate 为 async，改为 useEffect 异步获取）
    const [engineResult, setEngineResult] = useState(null);
    // 合并「整数建议+配方选取」列宽：逐行测量(整数建议宽+配方内容宽)取最大值，行内整数建议居左、配方居右
    const [recipeColWidth, setRecipeColWidth] = useState(420);
    // 绘制前同步测量，避免闪烁；无依赖数组——行内容(配方选择/整数建议/紧凑模式/移动端)变化都会重渲染后重测
    // (无依赖数组是刻意的;防死循环由"仅宽度变化>1px才setState"保证)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useLayoutEffect(() => {
        let maxW = 0;
        document.querySelectorAll('.result-table tbody .recipe-col-cell').forEach(cell => {
            let w = 0;
            // 子项 flex-shrink:0 为自然宽，求和即该行所需总宽
            for (const ch of cell.children) w += ch.offsetWidth;
            if (w > maxW) maxW = w;
        });
        if (maxW > 0) {
            const next = Math.ceil(maxW + 20); // +20 ≈ td 左右 padding/border 余量
            // 仅变化>1px 才更新 state，防止每次渲染触发重测死循环
            setRecipeColWidth(prev => Math.abs(prev - next) > 1 ? next : prev);
        }
    });
    useEffect(() => {
        let cancelled = false;
        if (!engineCalculate || !needs_list || Object.keys(needs_list).length === 0) {
            setEngineResult(null);
            return;
        }
        engineCalculate(needs_list).then(res => {
            if (!cancelled) setEngineResult(res);
        });
        return () => { cancelled = true; };
    }, [engineCalculate, needs_list]);

    // 从新引擎结果中提取数据
    // result_dict 用主物品净产量口径(执行次数×单次净产出):表格"毛产出"列与联产
    // 来源括号展示的是产量。recipeExecutions 是执行次数契约,多产物配方(如可燃冰2→
    // 石墨烯2+氢1)两者相差一个单次产出倍数,不可混用。
    const result_dict = engineResult?.productionByItem || EMPTY_OBJ;
    const surplusByproducts = engineResult?.surplusByproducts || EMPTY_OBJ;
    const selfConsumption = engineResult?.selfConsumption || EMPTY_OBJ;
    const byproductSources = engineResult?.byproductSources || EMPTY_OBJ;
    const result_graph = engineResult?.graph;

    // 用于存储历史值的数组，最多保留两个版本
    const [historyValues, setHistoryValues] = useState([]);

    let fixed_num = settings.fixed_num;

    // 调试日志：占地详情
    useEffect(() => {
        if (DEBUG && engineResult?.footprintDetails) {
            console.group('[占地计算]');
            console.log('n = ceil(设备数量), l = 原料种类数 + 产物种类数');
            console.log('总占地:', engineResult.totalFootprint?.toFixed(2), '格');
            Object.entries(engineResult.footprintDetails).forEach(([item, info]) => {
                console.log(`  ${item}: ${info.factoryName} n=${info.n} l=${info.l} 面积=${info.area.toFixed(2)}`);
            });
            console.groupEnd();
        }
    }, [engineResult]);

    // 从新引擎获取耗电和建筑数据
    // 电力合一：引擎侧 energyCost==totalEnergyCost、minerEnergyCost 恒 0，UI 统一读总耗电
    let total_energy_cost = engineResult?.totalEnergyCost || 0;
    // 需求电力修复：总电力需求 = 总发电量（净输出需求 + 设备自耗），选燃料时有值；
    // 未选燃料时退化为设备耗电（本次不展示需求缺口）。
    let total_power_demand = engineResult?.totalPowerDemand ?? total_energy_cost;
    let building_list = engineResult?.buildingList || {};
    let building_details = engineResult?.buildingDetails || {};
    let total_footprint = engineResult?.totalFootprint || 0;

    // 建筑统计含轨道采集器 → 通知 App 显示"去获取精确值"提示
    useEffect(() => {
        const bl = engineResult?.buildingList;
        onCollectorDetected?.(bl ? Object.prototype.hasOwnProperty.call(bl, '轨道采集器') : false);
    }, [engineResult?.buildingList, onCollectorDetected]);

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
        // byproductSources[副产物物品] = {来源物品: 每单位主物品净产出的副产物量};
        // result_dict(productionByItem)同为主物品净产量口径,相乘即副产物总量。
        Object.entries(byproductSources).forEach(([side_product, sources]) => {
            Object.entries(sources).forEach(([source_item, amount]) => {
                const production = result_dict[source_item] || 0;
                if (production > 0) {
                    if (!sp[side_product]) sp[side_product] = {};
                    sp[side_product][source_item] = production * amount;
                }
            });
        });
        return sp;
    }, [result_dict, byproductSources]);

    // 被需求过的物品集合（顶层需求 ∪ 各已入图配方原料）：联产物只有被需求过才独立成行，
    // 纯多余联产物不占行，多余量走「多余产物」面板（surplusByproducts 驱动）。
    const demandedItems = useMemo(() => collectDemandedItems(result_graph), [result_graph]);

    function mineralize(item) {
        set_settings(prev => ({mineralize_list: {...prev.mineralize_list, [item]: true}}));
    }

    function unmineralize(item) {
        set_settings(prev => {
            const new_list = {...prev.mineralize_list};
            delete new_list[item];
            return {mineralize_list: new_list};
        });
    }

    function clear_mineralize_list() {
        set_settings({mineralize_list: {}});
    }

    let mineralize_doms = Object.keys(mineralize_list).map(item => (
        <a key={item} className="m-1 cursor-pointer" onClick={() => unmineralize(item)}><ItemIcon item={item} size={mob_icon}/></a>
    ));

    let result_table_rows = [];

    const RatioAdjustInput = ({value, trimZeros, ceil, noTooltip}) => {
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

        function set_needs_in_row(e_or_value) {
            if (base_value == 0) return;
            let new_value = e_or_value.target ? e_or_value.target.value : e_or_value;
            let ratio = new_value / base_value;
            set_needs_list(prev => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v * ratio])));
        }

        return <span data-tooltip={noTooltip ? undefined : "等比例调整需求"} className="fast-tooltip">
            <AutoSizedInput
                delayed={true}
                value={disp_value}
                onChange={set_needs_in_row}/>
        </span>;
    };

    // 置顶电力行（如果选择了燃料且有电力需求）
    if (selectedFuel && selectedFuel !== "无" && total_power_demand > 0) {
        const totalEnergy = total_power_demand;
        const fuelRecipe = getFuelRecipe(selectedFuel, game_data);
        if (fuelRecipe) {
            const fuelDataList = getFuelData(game_data);
            const fuelData = fuelDataList.find(f => f.name === selectedFuel);
            const deviceName = fuelData?.device;
            const devicePower = DEVICE_POWER_CONSUMPTION[deviceName];
            const fuelRecipeIndex = game_data.recipe_data.findIndex(r => r.isFuelRecipe && r.fuelName === selectedFuel);
            const fuelScheme = fuelRecipeIndex >= 0 ? scheme_data.scheme_for_recipe[fuelRecipeIndex] : null;
            const deviceCount = getPowerDeviceCount({
                totalEnergy,
                devicePower,
                proliferatorEffects: game_data.proliferator_effect,
                proliferatorLevel: fuelScheme?.['增产剂等级'] || 0,
                proliferatorMode: fuelScheme?.['增产模式'] || 0,
            });

            const changeFuelProMode = fuelRecipeIndex >= 0 ? makeSchemeUpdater(set_scheme_data, 'recipe_field', fuelRecipeIndex, "增产模式") : () => {};
            const changeFuelProNum = fuelRecipeIndex >= 0 ? makeSchemeUpdater(set_scheme_data, 'recipe_field', fuelRecipeIndex, "增产剂等级") : () => {};
            const changeFuelFactory = fuelRecipeIndex >= 0 ? makeSchemeUpdater(set_scheme_data, 'recipe_field', fuelRecipeIndex, "建筑") : () => {};

            result_table_rows.unshift(
                <tr key="__power__" className="table-info">
                    <td></td>
                    <td>
                        <div className="d-flex align-items-center text-nowrap">
                            <ItemIcon item="电力" tooltip={is_compact} size={mob_icon}/>
                        </div>
                    </td>
                    <td className="text-center">
                        <RatioAdjustInput value={totalEnergy}/>
                    </td>
                    <td className="text-nowrap">
                        {fuelScheme && (
                            <div className="d-inline-flex align-items-center gap-1">
                                <ItemIcon item={deviceName} size={is_mobile ? 18 : 30}/>
                                <RatioAdjustInput value={deviceCount} ceil={true}/>
                            </div>
                        )}
                    </td>
                    {/* 合并列：电力行不做混合工厂建议(左为空)，燃料配方居右 */}
                    <td className="text-nowrap">
                        <div className="recipe-col-cell d-flex justify-content-between">
                            <div className="d-inline-flex align-items-center" style={{flexShrink: 0}}></div>
                            <div style={{flexShrink: 0}}>
                                <div className="my-1 px-2 py-1"><Recipe recipe={fuelRecipe} compact={compact_mode}/></div>
                            </div>
                        </div>
                    </td>
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

    for (const {item: i} of buildResultRowOrder(Object.keys(result_dict), side_products, demandedItems)) {
        // 跳过"电力"——已由置顶电力行处理
        if (i === "电力") continue;

        side_products[i] = side_products[i] || {};
        // 纯联产物无自产净量,产能主数字显示 0,联产量走下方来源括号
        let own_production = result_dict[i] || 0;
        let side_sum = Object.values(side_products[i]).reduce((a, b) => a + b, 0);
        let total = own_production + side_sum;
        if (total < 1e-6) continue;
        let recipe_id = item_data[i][scheme_data.item_recipe_choices[i]];
        // 缓存配方和方案数据，避免重复查找
        let recipe = game_data.recipe_data[recipe_id];
        let scheme_recipe = scheme_data.scheme_for_recipe[recipe_id];
        // 纯无中生有物品（Type = -2）始终隐藏
        // 视为原矿的物品始终隐藏
        if (recipe["Type"] === -2 || (i in mineralize_list)) {
            continue;
        }
        // 联产物无独立设备(设备计入来源配方行),工厂列仅显示 0
        let building_detail = building_details[i];
        let factory_number = get_factory_number(own_production, i);
        let from_side_products = Object.entries(side_products[i]).map(([from, amount]) =>
            <div key={from} className="text-nowrap">+{amount.toFixed(fixed_num)} (<ItemIcon item={from} size={is_mobile ? 18 : 26}/>)
            </div>
        );
        let factory_name = game_data.factory_data[recipe["设施"]][scheme_recipe["建筑"]]["名称"];
        // 自动隐藏:无多配方选择 且 无设备计算 的矿物行(交互无意义,信息已充分显示在原矿需求表)
        const hasMultiRecipe = (getAllowedRecipes(game_data.game_name)[i]?.length || 1) > 1;
        if (!hasMultiRecipe && MINERAL_AUTO_HIDE_BUILDINGS.has(normalizeFactoryName(factory_name))) {
            continue;
        }
        // 整数优化建议：仅对熔炉/制造台/化工厂计算（纯提示，不改电力/占地）
        const factoryGroup = game_data.factory_data[recipe["设施"]];
        const mixSuggestion = (factoryGroup && isOptimizableFactoryGroup(factoryGroup))
            ? optimizeFactoryMix({c: factory_number, levels: factoryGroup,
                                  baseIndex: scheme_recipe["建筑"], direction: settings.factory_optimize_mode})
            : null;
        // 整数优化列图标尺寸：与"设备"列一致(30/18)；合并列宽为动态测量值，无需缩小
        const mixIconSize = mixSuggestion ? (is_mobile ? 18 : 30) : 0;
        // 整数建议文本(隐藏图标列时作为设备列悬浮提示)
        const mixText = mixSuggestion
            ? `${mixSuggestion.type === 'compact' ? '紧凑' : '省料'}: ${mixSuggestion.mix.map(m => `${m.count}×${factoryGroup[m.levelIndex]['名称']}`).join(' + ')}`
            : null;
        let is_mineralized = i in mineralize_list;
        let row_class = is_mineralized ? "table-secondary" : "";

        const change_recipe = makeSchemeUpdater(set_scheme_data, 'recipe_choice', i);
        const change_pro_num = makeSchemeUpdater(set_scheme_data, 'recipe_field', recipe_id, "增产剂等级");
        const change_pro_mode = makeSchemeUpdater(set_scheme_data, 'recipe_field', recipe_id, "增产模式");
        const change_factory = makeSchemeUpdater(set_scheme_data, 'recipe_field', recipe_id, "建筑");

        result_table_rows.push(<tr className={row_class} key={i}>
            {/* 操作 */}
            <td>
                <div className="d-flex gap-1">
                    {/* 精简模式(is_compact):视为原矿精简为 × 按钮(未矿化蓝/已矿化红) */}
                    {is_compact ? (
                        <button className={`btn btn-sm ssmall mineralize-btn ${is_mineralized ? 'btn-outline-danger' : 'btn-primary'}`}
                                onClick={() => (is_mineralized ? unmineralize(i) : mineralize(i))}
                                title={is_mineralized ? '恢复为正常需求' : '视为原矿'}>
                            <FaTimes/>
                        </button>
                    ) : (is_mineralized ?
                        <button className="btn btn-sm btn-outline-primary ssmall text-nowrap mineralize-btn"
                                onClick={() => unmineralize(i)}>恢复</button> :
                        <button className="btn btn-sm btn-outline-primary ssmall text-nowrap mineralize-btn"
                                onClick={() => mineralize(i)}>
                            <div>视为</div>
                            <div>原矿</div>
                        </button>
                    )}
                    <button className="btn btn-sm btn-outline-secondary ssmall mobile-hide"
                            onClick={() => openInNewTab(i, get_gross_output(own_production, i) + side_sum)}
                            title="在新窗口计算（视为原矿）">
                        <FaExternalLinkAlt/>
                    </button>
                </div>
            </td>
            {/* 目标物品（仅图标，名称靠悬停） */}
            <td>
                <div className="d-flex align-items-center text-nowrap">
                    <ItemIcon item={i} tooltip={is_compact} size={mob_icon}/>
                </div>
            </td>
            {/* 分钟毛产出 */}
            <td className="text-center">
                <RatioAdjustInput value={get_gross_output(own_production, i)}/>
                {/* 精简模式(is_compact)不显示联产物来源括号，腾出宽度 */}
                {!is_compact && from_side_products}
            </td>
            {/* 所需工厂*数目 */}
            <td className="text-nowrap">
                {is_mineralized ||
                    <>
                        {building_detail &&
                            <div className={`d-inline-flex align-items-center gap-1 ${hideIntHint ? 'fast-tooltip' : ''}`}
                                 data-tooltip={hideIntHint ? mixText : undefined}>
                                {/* hideIntHint 时禁用子元素 tooltip，让整数建议悬浮生效 */}
                                <ItemIcon item={normalizeFactoryName(factory_name)} tooltip={hideIntHint ? false : undefined}
                                          size={is_mobile ? 18 : 30}/>
                                {HIDDEN_DEVICE_BUILDINGS.has(normalizeFactoryName(factory_name))
                                    ? <span className="text-muted" title={DEVICE_HIDDEN_TIPS[normalizeFactoryName(factory_name)]}>×?</span>
                                    : <RatioAdjustInput value={factory_number} trimZeros={true} ceil={true} noTooltip={hideIntHint}/>}
                            </div>
                        }
                        {!building_detail &&
                            <RatioAdjustInput value={0} trimZeros={true} ceil={true}/>
                        }
                    </>
                }
            </td>
            {/* 整数建议+配方选取 合并列：列宽=逐行测量(建议宽+配方宽)取最大值，行内整数建议居左、配方居右(space-between) */}
            <td className="text-nowrap">
                <div className="recipe-col-cell d-flex justify-content-between">
                    {/* 左：整数优化建议（混合工厂等级凑偶数台，仅提示不改算）；narrow/mobile 隐藏，改设备列悬浮 */}
                    {!hideIntHint && (
                        <div className="d-inline-flex align-items-center" style={{flexShrink: 0}}>
                            {!is_mineralized && mixSuggestion && (
                                <span className="fast-tooltip d-inline-flex align-items-center"
                                      data-tooltip={mixSuggestion.type === 'compact' ? '紧凑（省占地）' : '省料（避免浪费）'}>
                                    {mixSuggestion.mix.map(m => [
                                        <ItemIcon key={`mix-i-${m.levelIndex}`} item={factoryGroup[m.levelIndex]['名称']} tooltip={false} size={mixIconSize}/>,
                                        <span key={`mix-c-${m.levelIndex}`} className="me-1 ssmall align-self-end"
                                              style={{color: mixSuggestion.type === 'compact' ? '#e8943a' : '#3a9de8'}}>{m.count}</span>,
                                    ])}
                                </span>
                            )}
                        </div>
                    )}
                    {/* 右：所选配方 */}
                    <div style={{flexShrink: 0}}>
                        <RecipeSelect item={i} onChange={change_recipe}
                                      choice={scheme_data.item_recipe_choices[i]}
                                      compact={compact_mode}/>
                    </div>
                </div>
            </td>
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
    // 挖矿机/原油萃取站 不统计(设备数不计算);轨道采集器显示 ×?(可点击跳种子查看器)
    let building_rows = Object.entries(building_list)
        .filter(([building]) => !NO_BUILDING_STATS.has(building))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([building, count]) => {
            const isCollector = building === '轨道采集器';
            // 原生 title:浏览器渲染、不被面板 overflow 裁切(absolute fast-tooltip 会被画幅截半)
            const collectorTip = '只计算单物品需求不汇总，去获取单采集器精确值';
            return (
            <tr key={building}>
                <td className="d-flex align-items-center text-nowrap">
                    <ItemIcon item={building} tooltip={false} size={mob_icon}/>
                    <div className="d-flex flex-column ms-1">
                        {isCollector ? (
                            <a className="orbital-hint-link" title={collectorTip}
                               onClick={() => onNavigate?.('seed-viewer')}>×?</a>
                        ) : (
                            <span>{'×'}{formatValue(count, fixed_num)}</span>
                        )}
                        {!isCollector && historyValues?.[1]?.buildingCounts?.[building] !== undefined && Math.abs(count - historyValues[1].buildingCounts[building]) > 1e-6 && (
                            <span style={{fontSize: '0.85em', color: count > historyValues[1].buildingCounts[building] ? 'red' : 'green'}}>
                                {count > historyValues[1].buildingCounts[building] ? '+' : ''}{formatValue(count - historyValues[1].buildingCounts[building], fixed_num)}
                            </span>
                        )}
                    </div>
                </td>
            </tr>
        );
    });

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

    const isRawMaterial = useCallback((item) => rawMaterialItems.has(item), [rawMaterialItems]);

    // 缓存原矿列表（用于主视图和Modal），按物品名称排序保持静态顺序
    const rawMaterials = useMemo(() => {
        return Object.entries(result_dict)
            .filter(([item]) => isRawMaterial(item))
            .sort(([a], [b]) => a.localeCompare(b));
    }, [result_dict, isRawMaterial]);

    // 当前珍稀权重目标值与最大瓶颈物品（仅展示当前计算值，不依赖优化运行）
    const rareWeightInfo = useMemo(() => {
        const oreQuantities = settings.ore_quantities || {};
        if (Object.keys(oreQuantities).length === 0) return null;

        const availMap = {};
        let baseAvail = 0;
        for (const [item, raw] of Object.entries(oreQuantities)) {
            let avail = Number(raw) || 0;
            if (item === '原油' && avail > 0 && settings.ore_quantity_mode !== 'point') {
                avail = avail / 0.00004; // 与优化器一致的油井产量还原
            }
            availMap[item] = avail;
            if (avail > baseAvail) baseAvail = avail;
        }
        if (baseAvail <= 0) return null;

        let objective = 0;
        for (const [item, amount] of Object.entries(result_dict)) {
            if (amount <= 0) continue;
            if (!isRawMaterial(item)) continue;
            const avail = availMap[item];
            if (!avail || avail <= 0) continue;

            const correction = settings.rare_ore_practicality ? getRareOreCorrection(item, availMap) : null;
            const weight = correction ? correctedRareWeightUnit(correction, baseAvail) : (baseAvail / avail);
            objective += amount * weight;
        }
        return { objective };
    }, [result_dict, settings.ore_quantities, settings.ore_quantity_mode, settings.rare_ore_practicality, isRawMaterial]);

    // 当前净热值（原矿热值 - 副产品热值，与最小净热值策略一致）
    const netHeat = useMemo(() => {
        let oreHeat = 0;
        for (const [item, amount] of Object.entries(result_dict)) {
            if (amount <= 0) continue;
            if (isRawMaterial(item)) {
                const fuel = FUEL_DATA_BASE.find(f => f.name === item);
                if (fuel && fuel.heatValue > 0) oreHeat += amount * fuel.heatValue;
            }
        }
        let byproductHeat = 0;
        for (const [item, amount] of Object.entries(surplusByproducts || {})) {
            if (amount <= 0) continue; // surplusByproducts 已为正值（多余量），正值直接累加
            const fuel = FUEL_DATA_BASE.find(f => f.name === item);
            if (fuel && fuel.heatValue > 0) byproductHeat += amount * fuel.heatValue;
        }
        return oreHeat - byproductHeat;
    }, [result_dict, surplusByproducts, isRawMaterial]);

    // 面板显示列表：过滤 |value| < PANEL_DISPLAY_EPS 的数值噪声条目（仅显示层兜底，不污染 history）
    const surplusDisplayEntries = Object.entries(surplusByproducts)
        .filter(([, amount]) => Math.abs(amount) >= PANEL_DISPLAY_EPS);
    const rawMaterialDisplayEntries = rawMaterials
        .filter(([, amount]) => Math.abs(amount) >= PANEL_DISPLAY_EPS);

    // 计算数值变化的差值
    // 更新历史值
    useEffect(() => {
        // M-1 修复：首次挂载 engineResult=null 时跳过，避免全零基线污染 history 导致净热值/电力虚假增减
        if (!engineResult) return;
        // 构建新的值对象
        const currentValues = {
            energyCost: total_energy_cost,
            totalEnergyCost: total_energy_cost,
            totalPowerDemand: total_power_demand,
            buildingCounts: { ...building_list },
            rawMaterials: {},
            // surplusByproducts 引擎侧已是正值（多余量），直接透传保持口径一致
            surplusByproducts: { ...surplusByproducts },
            totalFootprint: total_footprint,
            rareWeightObjective: rareWeightInfo?.objective ?? null,
            netHeat,
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

    // 其余目标值板块：指标的增减值（与上一次计算对比）
    const prevRare = historyValues?.[1]?.rareWeightObjective;
    const prevNet = historyValues?.[1]?.netHeat;
    const rareWeightDelta = (rareWeightInfo && prevRare != null) ? (rareWeightInfo.objective - prevRare) : null;
    const netHeatDelta = prevNet != null ? (netHeat - prevNet) : null;

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
                <th width={40}>物品</th>
                <th width={90}>产能</th>
                <th width={80}>设备</th>
                {/* 合并「整数建议+配方选取」列：列宽由 JS 动态测量（recipeColWidth），表头左右两段标题 */}
                <th style={{ width: recipeColWidth }}>
                    <div className="d-flex justify-content-between text-nowrap">
                        {!hideIntHint && <span className="fast-tooltip" data-tooltip="优化到满足产能的偶数设备">整数建议</span>}
                        <span className={hideIntHint ? 'ms-auto' : ''}>配方选取</span>
                    </div>
                </th>
                <th width={90}>增产</th>
                <th width={160}>{isMidOrNarrower(compact_mode) ? '等级' : '增产剂'}</th>
              <th width={170}>{isSemiOrNarrower(compact_mode) ? '设备' : '设备等级'}</th>
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
                                <span className="text-muted">总计：</span>
                                <span className="fast-tooltip" data-tooltip="总发电量=净输出需求+设备自耗">
                                    <ValueWithDifference
                                        currentValue={total_power_demand}
                                        previousValue={historyValues?.[1]?.totalPowerDemand}
                                        key="total-power-demand"
                                    />
                                </span>
                            </div>
                        </div>
                    </fieldset>}

                {/* 预估占地：仅 mobile 布局时显示 */}
                {is_mobile && total_footprint > 0 &&
                    <fieldset className="w-fit">
                        <legend><small>预估占地</small></legend>
                        <div className="d-flex flex-column">
                            <span>{formatValue(total_footprint, fixed_num)} 格</span>
                            {historyValues?.[1]?.totalFootprint !== undefined && Math.abs(total_footprint - historyValues[1].totalFootprint) > 1e-6 && (
                                <span style={{fontSize: '0.85em', color: total_footprint > historyValues[1].totalFootprint ? 'red' : 'green'}}>
                                    {total_footprint > historyValues[1].totalFootprint ? '+' : ''}{formatValue(total_footprint - historyValues[1].totalFootprint, fixed_num)} 格
                                </span>
                            )}
                        </div>
                    </fieldset>}
            </div>

            {/* 两列布局：左列多余产物+原矿+电力，右列建筑统计 */}
            <div className="d-flex gap-2 align-items-start">
                {/* 左列：多余产物 + 原矿需求 + 预估电力 */}
                <div className="d-flex flex-column gap-2">
                    {/* 多余产物 */}
                    {surplusDisplayEntries.length > 0 &&
                        <fieldset className="w-fit">
                            <legend><small>多余产物</small></legend>
                            <table>
                                <tbody>
                                    {surplusDisplayEntries.map(([item, amount]) => (
                                        <tr key={item}>
                                            <td className="d-flex align-items-center text-nowrap">
                                                <ItemIcon item={item} tooltip={false} size={mob_icon}/>
                                                <div className="d-flex flex-column ms-1">
                                                    <span>{'×'}{formatValue(amount, fixed_num)}</span>
                                                    {historyValues?.[1]?.surplusByproducts?.[item] !== undefined && Math.abs(amount - historyValues[1].surplusByproducts[item]) > 1e-6 && (
                                                        <span style={{fontSize: '0.85em', color: amount > historyValues[1].surplusByproducts[item] ? 'red' : 'green'}}>
                                                            {amount > historyValues[1].surplusByproducts[item] ? '+' : ''}{formatValue(amount - historyValues[1].surplusByproducts[item], fixed_num)}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </fieldset>
                    }

                    {/* 原矿输入总需求 */}
                    {rawMaterialDisplayEntries.length > 0 && (
                        <fieldset className="w-fit">
                            <legend><small>原矿输入总需求</small></legend>
                            <table>
                                <tbody>
                                    {rawMaterialDisplayEntries.map(([item, amount]) => (
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
                                    <span className="text-muted">总计：</span>
                                    <div className="d-flex flex-column">
                                        <span>{formatValue(total_power_demand, fixed_num)}</span>
                                        {historyValues?.[1]?.totalPowerDemand !== undefined && Math.abs(total_power_demand - historyValues[1].totalPowerDemand) > 1e-6 && (
                                            <span style={{fontSize: '0.85em', color: total_power_demand > historyValues[1].totalPowerDemand ? 'red' : 'green'}}>
                                                {total_power_demand > historyValues[1].totalPowerDemand ? '+' : ''}{formatValue(total_power_demand - historyValues[1].totalPowerDemand, fixed_num)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </fieldset>}

                    {/* 预估占地 */}
                    {!is_mobile && total_footprint > 0 &&
                        <fieldset className="w-fit">
                            <legend><small>预估占地</small></legend>
                            <div className="d-flex flex-column">
                                <span>{formatValue(total_footprint, fixed_num)} 格</span>
                                {historyValues?.[1]?.totalFootprint !== undefined && Math.abs(total_footprint - historyValues[1].totalFootprint) > 1e-6 && (
                                    <span style={{fontSize: '0.85em', color: total_footprint > historyValues[1].totalFootprint ? 'red' : 'green'}}>
                                        {total_footprint > historyValues[1].totalFootprint ? '+' : ''}{formatValue(total_footprint - historyValues[1].totalFootprint, fixed_num)} 格
                                    </span>
                                )}
                            </div>
                        </fieldset>}
                </div>

                {/* 右列：建筑统计 + 目标值(slender 起 CSS 收纳) */}
                <div className="d-flex flex-column gap-2 summary-right-col">
                    {building_rows.length > 0 &&
                        <fieldset className="w-fit">
                            <legend><small>建筑统计</small></legend>
                            <table>
                                <tbody>{building_rows}</tbody>
                            </table>
                        </fieldset>
                    }
                    {rareWeightInfo && (
                        <fieldset className="w-fit">
                            <legend><small>其余目标值</small></legend>
                            <div className="d-flex flex-column">
                                <span>珍稀权重</span>
                                <span>{formatRareWeightValue(rareWeightInfo.objective)}</span>
                                {rareWeightDelta != null && Math.abs(rareWeightDelta) > 1e-9 && (
                                    <span style={{fontSize: '0.85em', color: rareWeightDelta > 0 ? 'red' : 'green'}}>
                                        {rareWeightDelta > 0 ? '+' : ''}{formatValue(rareWeightDelta, fixed_num)}
                                    </span>
                                )}
                                <span>净热值（GJ）</span>
                                <span>{formatValue(netHeat / 1000, fixed_num)}</span>
                                {netHeatDelta != null && Math.abs(netHeatDelta / 1000) > 1e-9 && (
                                    <span style={{fontSize: '0.85em', color: netHeatDelta > 0 ? 'red' : 'green'}}>
                                        {netHeatDelta > 0 ? '+' : ''}{formatValue(netHeatDelta / 1000, fixed_num)}
                                    </span>
                                )}
                            </div>
                        </fieldset>
                    )}
                </div>
            </div>
        </div>}
        </div>

        {/* Modal A: 原矿化列表 + 多余产物 */}
        {createPortal(
            <div ref={ore_modal_ref} className="modal" tabIndex="-1">
                <div className="modal-dialog mw-fit">
                    <div className="modal-content bg-body flex-column" style={{"--bs-bg-opacity": 0.85}}>
                        <div className="modal-header border-secondary">
                            <h6 className="modal-title">原矿化 &amp; 多余产物 &amp; 原矿需求 &amp; 电力 &amp; 占地</h6>
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
                            {surplusDisplayEntries.length > 0 &&
                                <fieldset className="w-fit">
                                    <legend><small>多余产物</small></legend>
                                    <table>
                                        <tbody>
                                            {surplusDisplayEntries.map(([item, amount]) => (
                                                <tr key={item}>
                                                    <td className="d-flex align-items-center text-nowrap">
                                                        <ItemIcon item={item} tooltip={false} size={mob_icon}/>
                                                        <span className="ms-1">{item}</span>
                                                    </td>
                                                    <td className="ps-2 text-nowrap">
                                                        <div className="d-flex flex-column">
                                                            <span>{amount.toFixed(fixed_num)}/{time_tick === 60 ? 'min' : 'sec'}</span>
                                                            {historyValues?.[1]?.surplusByproducts?.[item] !== undefined && Math.abs(amount - historyValues[1].surplusByproducts[item]) > 1e-6 && (
                                                                <span style={{fontSize: '0.85em', color: amount > historyValues[1].surplusByproducts[item] ? 'red' : 'green'}}>
                                                                    {amount > historyValues[1].surplusByproducts[item] ? '+' : ''}{(amount - historyValues[1].surplusByproducts[item]).toFixed(fixed_num)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </fieldset>
                            }
                            {/* 原矿输入总需求(从建筑&电力模态移入,属"多余和需求"组) */}
                            {(() => {
                                const rawMaterials = Object.entries(result_dict)
                                    .filter(([item]) => isRawMaterial(item))
                                    .sort(([a], [b]) => a.localeCompare(b))
                                    .filter(([, amount]) => Math.abs(amount) >= PANEL_DISPLAY_EPS);
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
                            {/* 预估电力(左列资源类) */}
                            {total_power_demand > 0 &&
                                <fieldset className="w-fit">
                                    <legend><small>预估电力 (MW)</small></legend>
                                    <div className="d-flex align-items-center gap-1 text-nowrap">
                                        <span className="text-muted">总计：</span>
                                        <span className="fast-tooltip" data-tooltip="总发电量=净输出需求+设备自耗">
                                            <ValueWithDifference
                                                currentValue={total_power_demand}
                                                previousValue={historyValues?.[1]?.totalPowerDemand}
                                                key="total-power-demand"
                                            />
                                        </span>
                                    </div>
                                </fieldset>
                            }
                            {/* 预估占地(左列资源类) */}
                            {total_footprint > 0 &&
                                <fieldset className="w-fit">
                                    <legend><small>预估占地</small></legend>
                                    <div className="d-flex flex-column">
                                        <span>{formatValue(total_footprint, fixed_num)} 格</span>
                                        {historyValues?.[1]?.totalFootprint !== undefined && Math.abs(total_footprint - historyValues[1].totalFootprint) > 1e-6 && (
                                            <span style={{fontSize: '0.85em', color: total_footprint > historyValues[1].totalFootprint ? 'red' : 'green'}}>
                                                {total_footprint > historyValues[1].totalFootprint ? '+' : ''}{formatValue(total_footprint - historyValues[1].totalFootprint, fixed_num)} 格
                                            </span>
                                        )}
                                    </div>
                                </fieldset>
                            }
                        </div>
                    </div>
                </div>
            </div>
            , document.body)}

        {/* Modal B: 建筑统计 + 其余目标值 */}
        {createPortal(
            <div ref={building_modal_ref} className="modal" tabIndex="-1">
                <div className="modal-dialog mw-fit">
                    <div className="modal-content bg-body flex-column" style={{"--bs-bg-opacity": 0.85}}>
                        <div className="modal-header border-secondary">
                            <h6 className="modal-title">建筑统计 &amp; 其余目标值</h6>
                            <button type="button" className="btn-close" data-bs-dismiss="modal"/>
                        </div>
                        <div className="modal-body summary-modal-body">
                            {/* 建筑统计 */}
                            {building_rows.length > 0 &&
                                <fieldset className="w-fit">
                                    <legend><small>建筑统计</small></legend>
                                    <table>
                                        <tbody>{building_rows}</tbody>
                                    </table>
                                </fieldset>}
                            {/* 其余目标值(右列) */}
                            {rareWeightInfo && (
                                <fieldset className="w-fit">
                                    <legend><small>其余目标值</small></legend>
                                    <div className="d-flex flex-column">
                                        <span>珍稀权重</span>
                                        <span>{formatRareWeightValue(rareWeightInfo.objective)}</span>
                                        {rareWeightDelta != null && Math.abs(rareWeightDelta) > 1e-9 && (
                                            <span style={{fontSize: '0.85em', color: rareWeightDelta > 0 ? 'red' : 'green'}}>
                                                {rareWeightDelta > 0 ? '+' : ''}{formatValue(rareWeightDelta, fixed_num)}
                                            </span>
                                        )}
                                        <span>净热值（GJ）</span>
                                        <span>{formatValue(netHeat / 1000, fixed_num)}</span>
                                        {netHeatDelta != null && Math.abs(netHeatDelta / 1000) > 1e-9 && (
                                            <span style={{fontSize: '0.85em', color: netHeatDelta > 0 ? 'red' : 'green'}}>
                                                {netHeatDelta > 0 ? '+' : ''}{formatValue(netHeatDelta / 1000, fixed_num)}
                                            </span>
                                        )}
                                    </div>
                                </fieldset>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            , document.body)}
    </div>;
}
