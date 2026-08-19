import { useState } from 'react';
import { FaStar, FaChartLine } from 'react-icons/fa';
import { VEIN_NAMES, formatAmount, formatOilRate } from './seed_viewer_binding';

/**
 * 统计结果展示组件
 * 视觉上复刻星球树 + 信息面板，数据为各恒星位置的统计均值。
 *
 * data 结构（由后端 stats_{star_num}.json 提供）:
 * {
 *   star_num, seed_count,
 *   stars_stats: [{ avg_distance,
 *                   avg_veins_point[14], avg_veins_amount[14],
 *                 }]   // dyson_radius/dyson_lumino、liquid、gas_veins 已移除
 * }
 * stars_stats[0] 是距离最小的出生星（第0星），与查询界面排序规则一致。
 */

const STAR_COLORS = [
    '#ff4500', '#ffd700', '#4169e1', '#f0f8ff',
    '#e6e6fa', '#00ffff', '#000000',
    '#4169e1', '#9370db', '#87ceeb', '#ffd700',
    '#ffa07a', '#ff6b6b', '#ff69b4'
];

const isGasLike = (i) => i === 6; // 油井按速率展示
const EXCLUDED_VEIN_INDEX = 7; // 可燃冰不参与统计
const CONVERGENCE_THRESHOLD = 0.03;
const WARNING_THRESHOLD = 0.10;

export default function SeedStatsResult({
    data,
    convergence,
    oreSelection,
    onToggleGalaxySelection,
    onToggleStarSelection,
}) {
    const [selectedIdx, setSelectedIdx] = useState(null); // null=星区汇总

    if (!data || !Array.isArray(data.stars_stats)) {
        return <div className="detail-placeholder">暂无统计数据</div>;
    }

    const { star_num, seed_count } = data;
    const stars = data.stars_stats;

    const handleSelect = (idx) => setSelectedIdx(idx);

    // ---- 矿脉条目（均值） ----
    // 注：liquid 已移除（无限资源，无需统计）。原代码的 liquid 参数已删除。
    const renderVeins = (point, amount) => {
        const items = [];
        for (let i = 0; i < 14; i++) {
            if (i === EXCLUDED_VEIN_INDEX) continue;
            if (point[i] > 0) {
                const rare = i >= 7;
                items.push(
                    <div key={i} className={`detail-vein-item ${rare ? 'rare' : ''}`}>
                        <span className="detail-vein-name">{VEIN_NAMES[i]}</span>
                        <span className="detail-vein-value">
                            {isGasLike(i) ? `${Math.round(point[i])} (${formatOilRate(amount[i])})` : `${ref(point[i])} (${formatAmount(amount[i])})`}
                        </span>
                    </div>
                );
            }
        }
        return <div className="detail-veins">{items}</div>;
    };
    const ref = (v) => (typeof v === 'number' && Number.isFinite(v)) ? (Math.round(v * 1) + '').replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '0';

/** 渲染单个字段的 CI 详情行（含 std） */
function renderCiLine(label, info) {
    if (!info) return null;
    return (
        <div className="detail-info" key={label}>
            {label}: mean=<strong>{info.mean.toFixed(2)}</strong>,
            std=<strong>{info.std.toFixed(2)}</strong>,
            CI95=±<strong>{info.ci_half.toFixed(2)}</strong>
            <span style={{ color: info.relative_error === null ? '#888' : (info.relative_error < CONVERGENCE_THRESHOLD ? '#28a745' : info.relative_error < WARNING_THRESHOLD ? '#fd7e14' : '#dc3545'), marginLeft: 8 }}>
                相对误差 {info.relative_error === null ? 'N/A' : `${(info.relative_error * 100).toFixed(2)}%`}
            </span>
        </div>
    );
}

    // ---- 星区汇总（E[Σ] = Σ E，对各星均值求和）----
    const renderGalaxyDetail = () => {
        const point = new Array(14).fill(0);
        const amount = new Array(14).fill(0);
        stars.forEach(s => {
            for (let i = 0; i < 14; i++) { point[i] += s.avg_veins_point[i]; amount[i] += s.avg_veins_amount[i]; }
        });

        // 星区汇总的 CI（真实测得，非"独立假设"推导）：
        // 每个种子 Σ X_i 由后端用 Welford 跟踪
        const summary = convergence && convergence.galaxy_summary;
        return (
            <div className="detail-content">
                <div className="detail-title">星区统计汇总</div>
                <div className="detail-subtitle">
                    期望恒星数: {star_num} | 已统计种子: {seed_count.toLocaleString()} | 资源: 1.0x
                </div>
                <div className="detail-section">
                    <h4>矿脉汇总（真实 CI，由每种子的 Σ X_i 直接测得）</h4>
                    <div className="detail-info" style={{ fontSize: 12 }}>
                        {Array.from({ length: 14 }).map((_, i) => {
                            if (i === EXCLUDED_VEIN_INDEX) return null;
                            const info = summary && summary.veins_point && summary.veins_point[i];
                            const label = VEIN_NAMES[i] || `矿脉[${i}]`;
                            if (!info) return null;
                            return (
                                <div key={`vp${i}`} style={{ marginBottom: 2 }}>
                                    矿点 {label}: <strong>{info.mean.toFixed(2)} ± {info.ci_half.toFixed(2)}</strong>
                                    <span style={{ color: info.relative_error === null ? '#888' : (info.relative_error < CONVERGENCE_THRESHOLD ? '#28a745' : info.relative_error < WARNING_THRESHOLD ? '#fd7e14' : '#dc3545'), marginLeft: 8 }}>
                                        相对误差 {info.relative_error === null ? 'N/A' : `${(info.relative_error * 100).toFixed(2)}%`}
                                    </span>
                                </div>
                            );
                        })}
                        {Array.from({ length: 14 }).map((_, i) => {
                            if (i === EXCLUDED_VEIN_INDEX) return null;
                            const info = summary && summary.veins_amount && summary.veins_amount[i];
                            const label = VEIN_NAMES[i] || `矿脉[${i}]`;
                            if (!info) return null;
                            return (
                                <div key={`va${i}`} style={{ marginBottom: 2 }}>
                                    矿量 {label}: <strong>{formatAmount(info.mean)} ± {formatAmount(info.ci_half)}</strong>
                                    <span style={{ color: info.relative_error === null ? '#888' : (info.relative_error < CONVERGENCE_THRESHOLD ? '#28a745' : info.relative_error < WARNING_THRESHOLD ? '#fd7e14' : '#dc3545'), marginLeft: 8 }}>
                                        相对误差 {info.relative_error === null ? 'N/A' : `${(info.relative_error * 100).toFixed(2)}%`}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    };

    const renderStarDetail = (s, idx) => {
        const ci = convergence && convergence.fields && convergence.fields[idx];
        return (
            <div className="detail-content">
                <div className="detail-title">第{idx}星</div>
                <div className="detail-subtitle">
                    距离最小的出生星为第0星，其余按距离升序
                </div>
                <div className="detail-section">
                    <h4>期望矿脉</h4>
                    {renderVeins(s.avg_veins_point, s.avg_veins_amount)}
                </div>
                <div className="detail-section">
                    <h4>恒星期望</h4>
                    <div className="detail-info">
                        平均距离: {s.avg_distance.toFixed(2)} LY
                        {/* dyson_radius / dyson_lumino 已删除 */}
                    </div>
                </div>
                {/* CI 详情（mean / std / CI95 / 相对误差） */}
                {ci && (
                    <div className="detail-section">
                        <h4>置信区间（CI95%）</h4>
                        {renderCiLine('距离', ci.distance)}
                        <details style={{ marginTop: 8 }}>
                            <summary style={{ cursor: 'pointer', color: 'var(--bs-secondary-color)' }}>
                                展开矿脉的 CI 详情
                            </summary>
                            <div style={{ marginTop: 6 }}>
                                {ci.veins_point.map((v, i) => (
                                    i === EXCLUDED_VEIN_INDEX ? null :
                                    <div key={`vp${i}`} className="detail-info" style={{ fontSize: 12 }}>
                                        矿点 {VEIN_NAMES[i]}: mean={v.mean.toFixed(2)}, std={v.std.toFixed(2)}, CI95=±{v.ci_half.toFixed(2)},
                                        <span style={{ color: v.relative_error === null ? '#888' : (v.relative_error < CONVERGENCE_THRESHOLD ? '#28a745' : v.relative_error < WARNING_THRESHOLD ? '#fd7e14' : '#dc3545'), marginLeft: 4 }}>
                                            相对误差 {v.relative_error === null ? 'N/A' : `${(v.relative_error * 100).toFixed(2)}%`}
                                        </span>
                                    </div>
                                ))}
                                {ci.veins_amount.map((v, i) => (
                                    i === EXCLUDED_VEIN_INDEX ? null :
                                    <div key={`va${i}`} className="detail-info" style={{ fontSize: 12 }}>
                                        矿量 {VEIN_NAMES[i]}: mean={formatAmount(v.mean)}, std={formatAmount(v.std)}, CI95=±{formatAmount(v.ci_half)},
                                        <span style={{ color: v.relative_error === null ? '#888' : (v.relative_error < CONVERGENCE_THRESHOLD ? '#28a745' : v.relative_error < WARNING_THRESHOLD ? '#fd7e14' : '#dc3545'), marginLeft: 4 }}>
                                            相对误差 {v.relative_error === null ? 'N/A' : `${(v.relative_error * 100).toFixed(2)}%`}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </details>
                    </div>
                )}
            </div>
        );
    };

    // ---- 树 ----
    const tree = (
        <div className="tree-container">
            <div className={`tree-item ${selectedIdx === null ? 'selected' : ''}`}
                onClick={() => handleSelect(null)}>
                <div className="tree-item-header">
                    <input
                        className="form-check-input tree-selection-checkbox"
                        type="checkbox"
                        checked={!!oreSelection?.galaxy}
                        onChange={(e) => onToggleGalaxySelection?.(e.target.checked)}
                        onClick={(e) => e.stopPropagation()}
                        title="选择全部恒星的统计汇总"
                    />
                    <span className="tree-icon galaxy"><FaChartLine /></span>
                    <span className="tree-label">星区统计</span>
                    <span className="tree-info">{star_num}星 | {seed_count.toLocaleString()}种子</span>
                </div>
            </div>

            {stars.map((s, i) => {
                const rare = [];
                for (let j = 6; j < 14; j++) {
                    if (j === EXCLUDED_VEIN_INDEX) continue;
                    if (s.avg_veins_point[j] > 0) rare.push(<span key={j} className="tag rare">{VEIN_NAMES[j]}</span>);
                }
                return (
                    <div key={i} className={`tree-item ${selectedIdx === i ? 'selected' : ''}`}
                        onClick={() => handleSelect(i)}>
                        <div className="tree-item-header">
                            <input
                                className="form-check-input tree-selection-checkbox"
                                type="checkbox"
                                checked={!!oreSelection?.stars?.has(i)}
                                onChange={() => onToggleStarSelection?.(i)}
                                onClick={(e) => e.stopPropagation()}
                                title={`选择第${i}星的统计数据`}
                            />
                            <span className="tree-icon star" style={{ backgroundColor: STAR_COLORS[i % STAR_COLORS.length] }}><FaStar /></span>
                            <span className="tree-label">第{i}星 {i === 0 ? <span className="star-type-tag">出生星</span> : null}</span>
                            <span className="tree-info">
                                {s.avg_distance.toFixed(1)}LY{rare}
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );

    return (
        <div className="result-panel">
            <div className="tree-panel">{tree}</div>
            <div className="detail-panel">
                {selectedIdx === null ? renderGalaxyDetail() : renderStarDetail(stars[selectedIdx], selectedIdx)}
            </div>
        </div>
    );
}
