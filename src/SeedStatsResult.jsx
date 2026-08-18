import { useState } from 'react';
import { FaStar, FaChartLine } from 'react-icons/fa';
import { VEIN_NAMES, formatAmount } from './seed_viewer_binding';

/**
 * 统计结果展示组件
 * 视觉上复刻星球树 + 信息面板，数据为各恒星位置的统计均值。
 *
 * data 结构（由后端 stats_{star_num}.json 提供）:
 * {
 *   star_num, seed_count,
 *   stars_stats: [{ avg_distance, avg_dyson_radius, avg_dyson_lumino,
 *                   avg_veins_point[14], avg_veins_amount[14],
 *                   avg_gas_veins[3], avg_liquid[2] }]
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

export default function SeedStatsResult({ data }) {
    const [selectedIdx, setSelectedIdx] = useState(null); // null=星区汇总

    if (!data || !Array.isArray(data.stars_stats)) {
        return <div className="detail-placeholder">暂无统计数据</div>;
    }

    const { star_num, seed_count } = data;
    const stars = data.stars_stats;

    const handleSelect = (idx) => setSelectedIdx(idx);

    // ---- 矿脉条目（均值） ----
    const renderVeins = (point, amount, gas, liquid) => {
        const items = [];
        for (let i = 0; i < 14; i++) {
            if (point[i] > 0) {
                const rare = i >= 7;
                items.push(
                    <div key={i} className={`detail-vein-item ${rare ? 'rare' : ''}`}>
                        <span className="detail-vein-name">{VEIN_NAMES[i]}</span>
                        <span className="detail-vein-value">
                            {isGasLike(i) ? `${point[i]}井(均${formatAmount(amount[i])})` : `${ref(val(point[i]))} (${formatAmount(amount[i])})`}
                        </span>
                    </div>
                );
            }
        }
        if (gas && gas[0] > 0) items.push(vein('氢', `${gas[0].toFixed(4)}/s`));
        if (gas && gas[1] > 0) items.push(vein('重氢', `${gas[1].toFixed(4)}/s`));
        if (gas && gas[2] > 0) items.push(vein('可燃冰', `${gas[2].toFixed(4)}/s`, true));
        if (liquid && (liquid[0] > 0 || liquid[1] > 0)) {
            items.push(vein('液体(水/硫酸)', `${ref(liquid[0])} / ${ref(liquid[1])}`, liquid[1] > 0));
        }
        return <div className="detail-veins">{items}</div>;
    };
    const vein = (name, value, rare = false) => (
        <div key={name} className={`detail-vein-item ${rare ? 'rare' : ''}`}>
            <span className="detail-vein-name">{name}</span>
            <span className="detail-vein-value">{value}</span>
        </div>
    );
    const ref = (v) => (typeof v === 'number' && Number.isFinite(v)) ? (Math.round(v * 1) + '').replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '0';

    // ---- 星区汇总（E[Σ] = Σ E，对各星均值求和）----
    const renderGalaxyDetail = () => {
        const point = new Array(14).fill(0);
        const amount = new Array(14).fill(0);
        const gas = [0, 0, 0];
        const liquid = [0, 0];
        let totalDist = 0;
        let totalRadius = 0;
        let totalLumino = 0;
        stars.forEach(s => {
            totalDist += s.avg_distance;
            totalRadius += s.avg_dyson_radius;
            totalLumino += s.avg_dyson_lumino;
            for (let i = 0; i < 14; i++) { point[i] += s.avg_veins_point[i]; amount[i] += s.avg_veins_amount[i]; }
            for (let i = 0; i < 3; i++) gas[i] += s.avg_gas_veins[i];
            for (let i = 0; i < 2; i++) liquid[i] += s.avg_liquid[i];
        });

        return (
            <div className="detail-content">
                <div className="detail-title">星区统计汇总</div>
                <div className="detail-subtitle">
                    期望恒星数: {star_num} | 已统计种子: {seed_count.toLocaleString()} | 资源: 1.0x
                </div>
                <div className="detail-section">
                    <h4>矿脉汇总（期望合计）</h4>
                    {renderVeins(point, amount, gas, liquid)}
                </div>
                <div className="detail-section">
                    <h4>星区期望</h4>
                    <div className="detail-info">
                        恒星总期望距离: {totalDist.toFixed(1)} LY<br />
                        戴森球半径合计: {totalRadius.toFixed(0)} m<br />
                        戴森球亮度合计: {totalLumino.toFixed(3)}
                    </div>
                </div>
            </div>
        );
    };

    const renderStarDetail = (s, idx) => (
        <div className="detail-content">
            <div className="detail-title">第{idx}星</div>
            <div className="detail-subtitle">
                距离最小的出生星为第0星，其余按距离升序
            </div>
            <div className="detail-section">
                <h4>期望矿脉</h4>
                {renderVeins(s.avg_veins_point, s.avg_veins_amount, s.avg_gas_veins, s.avg_liquid)}
            </div>
            <div className="detail-section">
                <h4>恒星期望</h4>
                <div className="detail-info">
                    平均距离: {s.avg_distance.toFixed(2)} LY<br />
                    戴森球半径: {s.avg_dyson_radius.toFixed(0)} m<br />
                    戴森球亮度: {s.avg_dyson_lumino.toFixed(3)}
                </div>
            </div>
        </div>
    );

    // ---- 树 ----
    const tree = (
        <div className="tree-container">
            <div className={`tree-item ${selectedIdx === null ? 'selected' : ''}`}
                onClick={() => handleSelect(null)}>
                <div className="tree-item-header">
                    <span className="tree-icon galaxy"><FaChartLine /></span>
                    <span className="tree-label">星区统计</span>
                    <span className="tree-info">{star_num}星 | {seed_count.toLocaleString()}种子</span>
                </div>
            </div>

            {stars.map((s, i) => {
                const rare = [];
                for (let j = 6; j < 14; j++) {
                    if (s.avg_veins_point[j] > 0) rare.push(<span key={j} className="tag rare">{VEIN_NAMES[j]}</span>);
                }
                return (
                    <div key={i} className={`tree-item ${selectedIdx === i ? 'selected' : ''}`}
                        onClick={() => handleSelect(i)}>
                        <div className="tree-item-header">
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