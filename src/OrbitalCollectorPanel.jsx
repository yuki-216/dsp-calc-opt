import {useMemo, useState, useContext} from 'react';
import {SettingsContext, SettingsSetterContext} from './contexts.jsx';
import {ItemIcon} from './ui_components';
import {computeOrbitalCollectorOutput} from './game_data.jsx';

// 三类气态行星:各自只产 2 个物品(气巨/高产气巨 = 氢+重氢;冰巨 = 氢+可燃冰)
const GAS_TYPES = [
    {key: '冰巨', items: ['氢', '可燃冰']},
    {key: '气巨', items: ['氢', '重氢']},
    {key: '高产气巨', items: ['氢', '重氢']},
];
// 真实种子行星类型名 → 面板类型 key
const TYPE_BY_NAME = {冰巨星: '冰巨', 气态巨星: '气巨', 高产气巨: '高产气巨'};
// 接口字段映射
const INTERFACE_KEY = {氢: 'mining_speed_hydrogen', 重氢: 'mining_speed_deuterium', 可燃冰: 'mining_speed_gas_hydrate'};
const GAS_ITEMS = ['氢', '重氢', '可燃冰'];

// 类"矿物可用量"输入:失焦显示 2 位小数近似,点开显示完整数字
function GasRateInput({value, onChange}) {
    const [editing, setEditing] = useState(null);
    return (
        <input type="text" className="form-control form-control-sm"
               style={{width: '72px', fontSize: '11px'}}
               value={editing !== null ? editing : (value > 0 ? value.toFixed(2) : '')}
               onFocus={() => setEditing(value > 0 ? String(value) : '')}
               onChange={e => {
                   setEditing(e.target.value);
                   const n = parseFloat(e.target.value);
                   if (!isNaN(n)) onChange(Math.max(0, n));
               }}
               onBlur={() => setEditing(null)}/>
    );
}

export default function OrbitalCollectorPanel({result}) {
    const settings = useContext(SettingsContext);
    const set_settings = useContext(SettingsSetterContext);
    const [type, setType] = useState('冰巨');

    const speed = settings.gas_collect_speed || 1;

    // 载入某类型预设 → 填入 3 接口中对应的 2 个(自动应用)
    const loadType = (t) => {
        setType(t);
        const p = settings.gas_planet_types?.[t] || {};
        const update = {};
        for (const it of GAS_ITEMS) {
            if (p[it] !== undefined) update[INTERFACE_KEY[it]] = p[it];
        }
        set_settings(update);
    };

    // 编辑框变动/行星选中 → 自动计算 + 自动应用(输入即 settings,天然持久化)
    const out = useMemo(() => {
        const rates = {
            氢: settings.mining_speed_hydrogen || 0,
            重氢: settings.mining_speed_deuterium || 0,
            可燃冰: settings.mining_speed_gas_hydrate || 0,
        };
        return computeOrbitalCollectorOutput(rates, speed);
    }, [settings.mining_speed_hydrogen, settings.mining_speed_deuterium, settings.mining_speed_gas_hydrate, speed]);

    // 真实种子气态行星
    const gasPlanets = useMemo(() => {
        if (!result?.stars) return [];
        const list = [];
        for (const star of result.stars) {
            for (const p of star.planets || []) {
                if (p.is_gas) {
                    list.push({
                        id: `${star.star_index}-${p.planet_index}`,
                        star: star.name, dist: star.distance,
                        name: p.name, type: p.type,
                        gas: p.gas_veins || [], // [氢, 重氢, 可燃冰]
                    });
                }
            }
        }
        return list.sort((a, b) => a.dist - b.dist);
    }, [result]);

    // 选中真实行星 → 应用 gas_veins 到类型参数 + 3 接口(自动计算)
    const applyPlanet = (planetId) => {
        const p = gasPlanets.find(x => x.id === planetId);
        if (!p) return;
        const key = TYPE_BY_NAME[p.type] || '冰巨';
        const [h, d, g] = p.gas;
        const pItems = GAS_TYPES.find(t => t.key === key).items;
        const typeRates = {};
        for (const it of pItems) typeRates[it] = it === '氢' ? h : (it === '重氢' ? d : g);
        setType(key);
        set_settings({
            gas_planet_types: {...(settings.gas_planet_types || {}), [key]: typeRates},
            mining_speed_hydrogen: h || 0,
            mining_speed_deuterium: d || 0,
            mining_speed_gas_hydrate: g || 0,
        });
    };

    return (
        <div className="orbital-panel">
            <div className="orbital-panel-header">轨道采集器</div>

            {gasPlanets.length > 0 && (
                <div className="form-group">
                    <select className="form-select form-select-sm"
                            value="" onChange={e => { applyPlanet(e.target.value); e.target.value = ''; }}>
                        <option value="" disabled>选择真实气态行星…</option>
                        {gasPlanets.map(p => (
                            <option key={p.id} value={p.id}>
                                {p.star} · {p.name}（{p.type}，{p.dist.toFixed(1)}LY）
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {/* 类型切换(载入预设) */}
            <div className="pro-mode-toggle" role="radiogroup" aria-label="气态行星类型">
                {GAS_TYPES.map(t => (
                    <div key={t.key}
                         className={`pro-mode-option ${type === t.key ? 'pro-mode-active' : ''}`}
                         role="radio" aria-checked={type === t.key} tabIndex={0}
                         onClick={() => loadType(t.key)}
                         onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') loadType(t.key); }}>
                        {t.key}
                    </div>
                ))}
            </div>

            {/* 3 接口输入(图标+数值,一行) */}
            <div className="d-flex flex-wrap gap-2">
                {GAS_ITEMS.map(it => (
                    <label key={it} className="d-flex align-items-center gap-1 mb-0">
                        <ItemIcon item={it} size={20}/>
                        <GasRateInput value={settings[INTERFACE_KEY[it]] || 0}
                                      onChange={v => set_settings({[INTERFACE_KEY[it]]: v})}/>
                    </label>
                ))}
            </div>

            {/* 采集速度 */}
            <div className="d-flex align-items-center gap-2">
                <label className="mb-0">采集速度</label>
                <input type="number" step={10} className="form-control form-control-sm" style={{width: '5em'}}
                       value={Math.round(speed * 100)}
                       onChange={e => set_settings({gas_collect_speed: (parseFloat(e.target.value) || 0) / 100})}/>
                <span>%</span>
            </div>

            {/* 自动计算结果 */}
            <div className="orbital-result small">
                <div>自耗比例：{((1 - out.eff) * 100).toFixed(1)}%</div>
                <div>单采集器/min：{GAS_ITEMS.filter(it => out.perMinute[it] !== undefined)
                    .map(it => `${it} ${out.perMinute[it].toFixed(2)}`).join('，')}</div>
                <div>单球/min（×40）：{GAS_ITEMS.filter(it => out.perPlanet[it] !== undefined)
                    .map(it => `${it} ${out.perPlanet[it].toFixed(2)}`).join('，')}</div>
            </div>
        </div>
    );
}
