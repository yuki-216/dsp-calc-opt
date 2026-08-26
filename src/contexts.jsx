import {createContext, useEffect, useState, useMemo, useCallback} from 'react';
import {GameInfo, GlobalState} from './game_data';
import {init_scheme_data} from './scheme_data';
import {default_game_data} from "./game_data.jsx";
import {useSetState} from "ahooks";
import {CoreEngine} from './engine/index.js';
import {DEBUG} from './engine/debug.js'; // 初始化 __DEBUG 全局开关并导出 DEBUG 标志

/** set_game_name_and_data(game_name, game_data) */
export const GameInfoSetterContext = createContext(null);
export const SchemeDataSetterContext = createContext(null);
/** set_settings({prop: value}) */
export const SettingsSetterContext = createContext(null);
export const GlobalStateContext = createContext(null);
export const SettingsContext = createContext(null);
export const GameInfoContext = createContext(null);
export const EngineGraphDataContext = createContext(null);
export const EngineCalculateContext = createContext(null);
export const CalculationErrorContext = createContext(null);
export const EngineLogContext = createContext(null);
export const FuelContext = createContext(null);
export const FuelSetterContext = createContext(null);

const DEFAULT_SETTINGS = {
    mining_speed_oil: 3.0,
    // 3 接口:核心计算轨道采集器的采集速率(氢/重氢/可燃冰),默认取 气巨 的氢/重氢 与 冰巨 的可燃冰
    mining_speed_hydrogen: 0.9151,
    mining_speed_deuterium: 0.0443,
    mining_speed_gas_hydrate: 0.6902,
    // 轨道采集器:采集速度(科技%,默认100%,10%步进)与 3 类气态行星默认参数(独立维度,各2速率)
    gas_collect_speed: 1.0,
    gas_planet_types: {
        冰巨: {氢: 0.3281, 可燃冰: 0.6902},
        气巨: {氢: 0.9151, 重氢: 0.0443},
        高产气巨: {氢: 0.8502, 重氢: 0.1616},
    },

    hide_mines: false,
    covered_veins_small: 6,
    covered_veins_large: 16,
    mining_efficiency_large: 3.0,
    mining_speed_multiple: 1.0,
    fractionating_speed: 30,

    is_time_unit_minute: true,
    fixed_num: 2,
    stack_research_lab: 15,
    proliferate_itself: true,
    proliferate_no_accelerate: false,
    proliferate_allowed_levels: [3],  // 默认仅允许 Mk.III；1=MK1, 2=MK2, 3=MK3
    proliferate_flexible_levels: false,  // 自动优化时是否允许各级增产剂自由选择(≤最高等级)，不受可选增产剂限制
    rare_ore_practicality: true,  // 珍稀矿实用性修正（刺笋结晶/金伯利矿石/分形硅石按可替代普通矿折算稀缺度）
    exclude_miner_power: false,  // 不计挖矿电力（原矿采集设备耗电不计入总电力）

    mineralize_list: [],
    ore_quantities: {}, // {矿名: 可用量}，用于最大瓶颈法优化
    ore_quantity_star_num: 64,
    ore_quantity_mode: 'amount', // 'amount' | 'point'
    factory_optimize_mode: 'compact', // 整数优化方向(仅中间等级设备): 'compact'(紧凑/向下取整) | 'economy'(省料/向上取整);最低级固定紧凑、最高级固定省料
};
export const DefaultSettingsContext = createContext(DEFAULT_SETTINGS);

// "full" >= 1400px | "compact" 1024-1399px | "narrow" 768-1023px | "mobile" < 768px
function get_compact_mode(width) {
    if (width >= 1400) return "full";
    if (width >= 1024) return "compact";
    if (width >= 768) return "narrow";
    return "mobile";
}

export const CompactModeContext = createContext("full");

export function safe_parse_json(str) {
    try {
        return JSON.parse(str);
    } catch {
        return null;
    }
}

export function ContextProvider({children}) {
    const [game_info, set_game_info] = useState(new GameInfo(default_game_data));
    const [scheme_data, set_scheme_data] = useState(() => {
        const game_name = default_game_data.game_name;
        const all = safe_parse_json(localStorage.getItem("auto_scheme")) || {};
        const saved = all[game_name];
        if (saved && saved.scheme_for_recipe &&
            saved.scheme_for_recipe.length === default_game_data.recipe_data.length) {
            // 兼容旧数据：将增产点数转换为增产剂等级
            for (const recipe of saved.scheme_for_recipe) {
                if (recipe['增产点数'] !== undefined && recipe['增产剂等级'] === undefined) {
                    recipe['增产剂等级'] = recipe['增产点数'];
                    delete recipe['增产点数'];
                }
            }
            // 清理遗留死数据：cost_weight 从未被引擎/优化器读取，仅占位
            delete saved.cost_weight;
            return saved;
        }
        return init_scheme_data(default_game_data);
    });
    const [settings, set_settings] = useSetState(() => {
        const saved = safe_parse_json(localStorage.getItem("auto_settings"));
        let merged = saved ? {...DEFAULT_SETTINGS, ...saved} : {...DEFAULT_SETTINGS};
        // 移除不在 DEFAULT_SETTINGS 中的旧字段（如 blue_buff）
        for (const key of Object.keys(merged)) {
            if (!(key in DEFAULT_SETTINGS)) {
                delete merged[key];
            }
        }
        // 速率单位固定按分钟(is_time_unit_minute 变常量):删除设置控件后仍强制 true,
        // 防止用户旧存档中的 is_time_unit_minute:false 经 auto_settings 合并复活。
        merged.is_time_unit_minute = true;
        return merged;
    });
    const [compact_mode, set_compact_mode] = useState(() => get_compact_mode(window.innerWidth));

    useEffect(() => {
        const mql_full = window.matchMedia("(min-width: 1400px)");
        const mql_compact = window.matchMedia("(min-width: 1024px)");
        const mql_narrow = window.matchMedia("(min-width: 768px)");

        function on_resize() {
            set_compact_mode(get_compact_mode(window.innerWidth));
        }

        mql_full.addEventListener("change", on_resize);
        mql_compact.addEventListener("change", on_resize);
        mql_narrow.addEventListener("change", on_resize);
        return () => {
            mql_full.removeEventListener("change", on_resize);
            mql_compact.removeEventListener("change", on_resize);
            mql_narrow.removeEventListener("change", on_resize);
        };
    }, []);

    // Auto-save scheme_data
    const game_name = game_info.game_data.game_name;
    useEffect(() => {
        let all = safe_parse_json(localStorage.getItem("auto_scheme")) || {};
        all[game_name] = scheme_data;
        localStorage.setItem("auto_scheme", JSON.stringify(all));
    }, [scheme_data, game_name]);

    // Auto-save settings
    useEffect(() => {
        localStorage.setItem("auto_settings", JSON.stringify(settings));
    }, [settings]);

    const global_state = useMemo(() => {
        console.log("[+] new GlobalState");
        return new GlobalState(game_info, scheme_data, settings);
    }, [game_info, scheme_data, settings]);

    // 主引擎（CoreEngine）
    const engine = useMemo(() => {
        console.log("[+] new CoreEngine (primary)");
        return new CoreEngine(game_info.game_data, scheme_data, settings, global_state.sprayCosts);
    }, [game_info, scheme_data, settings, global_state.sprayCosts]);

    const [engineGraphData, setEngineGraphData] = useState(null);
    const [calculationError, setCalculationError] = useState(null);
    const [engineLogs, setEngineLogs] = useState([]);

    // 主引擎计算函数（Task 4 后 calculate 为 async，此处改为异步等待）
    const engineCalculate = useMemo(() => {
        return async function(needs_dict) {
            // 需求为空时清除错误
            if (!needs_dict || Object.keys(needs_dict).length === 0) {
                setTimeout(() => setCalculationError(null), 0);
                return null;
            }
            // needs_dict 格式: {物品名: 数量}，转换为数组格式
            const needsArray = Object.entries(needs_dict).map(([id, count]) => ({
                id,
                name: id,
                count
            }));
            try {
                const runLogs = [];
                const onLog = DEBUG ? (msg) => { runLogs.push(msg); } : null;
                const result = await engine.calculate(
                    needsArray,
                    game_info.game_data.recipe_data,
                    new Set(),
                    false,
                    onLog
                );
                if (DEBUG) setTimeout(() => setEngineLogs(runLogs), 0);
                // 使用 setTimeout 延迟更新状态，避免在渲染过程中触发状态更新
                setTimeout(() => setCalculationError(null), 0);
                if (engine.graph && engine.edges) {
                    const graphData = {
                        edges: engine.edges,
                        graph: engine.graph,
                        proliferatorEdgeKeys: engine.proliferatorEdgeKeys || new Set()
                        // 注意:sccs 字段移除——依赖图页浅层化后不再消费(Task 7)
                    };
                    setTimeout(() => setEngineGraphData(graphData), 0);
                }
                return result;
            } catch (e) {
                setTimeout(() => setCalculationError(e.message), 0);
                return null;
            }
        };
    }, [engine, game_info]);

    // 燃料选择状态（从 scheme_data 中读取）
    const selected_fuel = scheme_data.selected_fuel || "无";

    // 燃料选择 setter
    const set_selected_fuel = useCallback((fuelName) => {
        set_scheme_data(prev => {
            // 确保 prev 是对象且 selected_fuel 字段被正确更新
            if (!prev || typeof prev !== 'object') return prev;
            if (prev.selected_fuel === fuelName) return prev; // 值未变，跳过更新
            return {...prev, selected_fuel: fuelName};
        });
    }, [set_scheme_data]);

    function set_game_data(game_data) {
        set_game_info(new GameInfo(game_data));
    }

    return <CompactModeContext.Provider value={compact_mode}>
        <GameInfoContext.Provider value={game_info}>
            <GlobalStateContext.Provider value={global_state}>
                <EngineCalculateContext.Provider value={engineCalculate}>
                    <CalculationErrorContext.Provider value={calculationError}>
                        <EngineLogContext.Provider value={engineLogs}>
                        <EngineGraphDataContext.Provider value={engineGraphData}>
                            <GameInfoSetterContext.Provider value={set_game_data}>
                                <SchemeDataSetterContext.Provider value={set_scheme_data}>
                                    <SettingsSetterContext.Provider value={set_settings}>
                                        <SettingsContext.Provider value={settings}>
                                            <FuelContext.Provider value={selected_fuel}>
                                                <FuelSetterContext.Provider value={set_selected_fuel}>
                                                    {children}
                                                </FuelSetterContext.Provider>
                                            </FuelContext.Provider>
                                        </SettingsContext.Provider>
                                    </SettingsSetterContext.Provider>
                                </SchemeDataSetterContext.Provider>
                            </GameInfoSetterContext.Provider>
                        </EngineGraphDataContext.Provider>
                        </EngineLogContext.Provider>
                    </CalculationErrorContext.Provider>
                </EngineCalculateContext.Provider>
            </GlobalStateContext.Provider>
        </GameInfoContext.Provider>
    </CompactModeContext.Provider>
}
