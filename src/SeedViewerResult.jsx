import { useState, useContext } from 'react';
import { VEIN_NAMES, STAR_TYPES, formatAmount, formatOilRate } from './seed_viewer_binding';
import { CompactModeContext } from './contexts.jsx';

// 恒星颜色
const STAR_COLORS = {
    0: '#ff4500', 1: '#ffd700', 2: '#4169e1', 3: '#f0f8ff',
    4: '#e6e6fa', 5: '#00ffff', 6: '#000000',
    7: '#4169e1', 8: '#9370db', 9: '#87ceeb', 10: '#ffd700',
    11: '#ffa07a', 12: '#ff6b6b', 13: '#ff69b4'
};

// 行星颜色
const PLANET_COLORS = {
    0: '#4682b4', 1: '#ff8c00', 2: '#e6e6fa', 3: '#daa520',
    4: '#b0c4de', 5: '#228b22', 6: '#ff4500', 7: '#f0f8ff',
    8: '#d2b48c', 9: '#d2b48c', 10: '#696969', 11: '#b22222',
    12: '#90ee90', 13: '#1e90ff', 14: '#2f4f4f', 15: '#ffb6c1',
    16: '#808080', 17: '#dc143c', 18: '#f0e68c', 19: '#ff8c00',
    20: '#b0c4de', 21: '#556b2f', 22: '#ff8c00'
};

export default function SeedViewerResult({
    data,
    onSelectItem,
    oreSelection,
    onToggleGalaxySelection,
    onToggleStarSelection,
}) {
    const [expandedStars, setExpandedStars] = useState(new Set());
    const [selectedItem, setSelectedItem] = useState(null);
    // mobile:隐藏星球树与轨道采集器(轨道采集器移到 SeedViewerPage 致谢位置)
    const compact_mode = useContext(CompactModeContext);
    const is_mobile = compact_mode === 'mobile';

    // 切换恒星展开状态
    const toggleStar = (starIndex) => {
        setExpandedStars(prev => {
            const next = new Set(prev);
            if (next.has(starIndex)) {
                next.delete(starIndex);
            } else {
                next.add(starIndex);
            }
            return next;
        });
    };

    // 选择天体
    const handleSelectItem = (type, starIdx, planetIdx) => {
        setSelectedItem({ type, starIdx, planetIdx });
        if (onSelectItem) onSelectItem(type, starIdx, planetIdx);
    };

    // 渲染矿脉列表
    const renderVeinsList = (veinsPoint, veinsAmount, gasVeins, liquid, isGas = false) => {
        let items = [];

        if (!isGas) {
            // 基础矿脉
            for (let i = 0; i < 6; i++) {
                if (veinsPoint[i] > 0) {
                    items.push(
                        <div key={i} className="detail-vein-item">
                            <span className="detail-vein-name">{VEIN_NAMES[i]}</span>
                            <span className="detail-vein-value">{veinsPoint[i]} ({formatAmount(veinsAmount[i])})</span>
                        </div>
                    );
                }
            }

            // 油井
            if (veinsPoint[6] > 0) {
                items.push(
                    <div key={6} className="detail-vein-item">
                        <span className="detail-vein-name">{VEIN_NAMES[6]}</span>
                        <span className="detail-vein-value">{veinsPoint[6]} ({formatOilRate(veinsAmount[6])})</span>
                    </div>
                );
            }

            // 稀有矿脉
            for (let i = 7; i < 14; i++) {
                if (veinsPoint[i] > 0) {
                    items.push(
                        <div key={i} className="detail-vein-item rare">
                            <span className="detail-vein-name">{VEIN_NAMES[i]}</span>
                            <span className="detail-vein-value">{veinsPoint[i]} ({formatAmount(veinsAmount[i])})</span>
                        </div>
                    );
                }
            }

            // 液体
            if (liquid === 1) {
                items.push(<div key="water" className="detail-vein-item"><span className="detail-vein-name">水</span><span className="detail-vein-value">海洋</span></div>);
            } else if (liquid === 2) {
                items.push(<div key="acid" className="detail-vein-item rare"><span className="detail-vein-name">硫酸</span><span className="detail-vein-value">海洋</span></div>);
            }
        }

        // 气体
        if (gasVeins && gasVeins[0] > 0) {
            items.push(<div key="h2" className="detail-vein-item"><span className="detail-vein-name">氢</span><span className="detail-vein-value">{gasVeins[0].toFixed(4)}/s</span></div>);
        }
        if (gasVeins && gasVeins[1] > 0) {
            items.push(<div key="d2" className="detail-vein-item"><span className="detail-vein-name">重氢</span><span className="detail-vein-value">{gasVeins[1].toFixed(4)}/s</span></div>);
        }
        if (gasVeins && gasVeins[2] > 0) {
            items.push(<div key="ice" className="detail-vein-item rare"><span className="detail-vein-name">可燃冰</span><span className="detail-vein-value">{gasVeins[2].toFixed(4)}/s</span></div>);
        }

        return <div className="detail-veins">{items}</div>;
    };

    // 渲染详情面板
    const renderDetail = () => {
        if (!selectedItem) {
            return <div className="detail-placeholder">点击天体查看详情</div>;
        }

        const { type, starIdx, planetIdx } = selectedItem;

        if (type === 'galaxy') {
            return renderGalaxyDetail();
        } else if (type === 'star') {
            return renderStarDetail(data.stars[starIdx]);
        } else if (type === 'planet') {
            return renderPlanetDetail(data.stars[starIdx].planets[planetIdx]);
        }

        return null;
    };

    // 渲染星区详情
    const renderGalaxyDetail = () => {
        const starTypeCounts = new Array(14).fill(0);
        data.stars.forEach(star => {
            starTypeCounts[star.type_id]++;
        });

        return (
            <div className="detail-content">
                <div className="detail-title">星区信息</div>
                <div className="detail-subtitle">恒星数量: {data.star_num}</div>

                <div className="detail-section">
                    <h4>矿脉汇总</h4>
                    {renderVeinsList(data.veins_point, data.veins_amount, data.gas_veins, data.liquid)}
                </div>

                <div className="detail-section">
                    <h4>恒星类型分布</h4>
                    <div className="detail-info">
                        {[12, 11, 10, 9, 7, 8, 13, null, 4, 5, 6, null, 0, 1, 3, 2].map((idx, i) => {
                            if (idx === null) return <br key={`br${i}`} />;
                            if (starTypeCounts[idx] > 0) {
                                return <span key={idx}>{STAR_TYPES[idx]}: {starTypeCounts[idx]} </span>;
                            }
                            return null;
                        })}
                    </div>
                </div>
            </div>
        );
    };

    // 渲染恒星详情
    const renderStarDetail = (star) => {
        return (
            <div className="detail-content">
                <div className="detail-title">{star.name}</div>
                <div className="detail-subtitle">
                    <span className="tag">{star.type}</span>
                </div>

                <div className="detail-section">
                    <h4>矿脉</h4>
                    {renderVeinsList(star.veins_point, star.veins_amount, star.gas_veins, star.liquid)}
                </div>

                <div className="detail-section">
                    <h4>其他信息</h4>
                    <div className="detail-info">
                        <div className="detail-info-item">戴森球半径: {star.dyson_radius.toFixed(0)} m</div>
                        <div className="detail-info-item">戴森球亮度: {star.dyson_lumino.toFixed(3)}</div>
                        <div className="detail-info-item">距离: {star.distance.toFixed(2)} LY</div>
                    </div>
                </div>
            </div>
        );
    };

    // 渲染行星详情
    const renderPlanetDetail = (planet) => {
        const tags = [planet.type];
        if (planet.dsp_level === 2) tags.push('全包星');
        else if (planet.dsp_level === 1) tags.push('全接收星');
        planet.singularity_str.forEach(s => tags.push(s));

        return (
            <div className="detail-content">
                <div className="detail-title">{planet.name}</div>
                <div className="detail-subtitle">
                    {tags.map((t, i) => <span key={i} className="tag">{t}</span>)}
                </div>

                <div className="detail-section">
                    <h4>矿脉</h4>
                    {renderVeinsList(planet.veins_point, planet.veins_amount, planet.gas_veins, planet.liquid, planet.is_gas)}
                </div>

                <div className="detail-section">
                    <h4>其他信息</h4>
                    <div className="detail-info">
                        {planet.is_gas ? (
                            <>
                                <div className="detail-info-item">轨道半径: {planet.radius.toFixed(2)} AU</div>
                                <div className="detail-info-item">自转轴倾角: {planet.obliquity.toFixed(1)}°</div>
                            </>
                        ) : (
                            <>
                                <div className="detail-info-item">风能利用率: {planet.wind.toFixed(2)}</div>
                                <div className="detail-info-item">光能利用率: {planet.lumino.toFixed(2)}</div>
                                <div className="detail-info-item">陆地率: {(planet.land_percent * 100).toFixed(1)}%</div>
                                <div className="detail-info-item">轨道半径: {planet.radius.toFixed(2)} AU</div>
                                <div className="detail-info-item">自转轴倾角: {planet.obliquity.toFixed(1)}°</div>
                                <div className="detail-info-item"
                                     title="仅戴森球壳层时,行星接收戴森球射线的覆盖角度(0°=被完全包裹/全包,90°=完全外露)">
                                    原始射线接收角度: {planet.raw_dsp_degree.toFixed(3)}°
                                </div>
                                <div className="detail-info-item"
                                     title="计入戴森云(电离层)增强后,行星接收戴森球射线的覆盖角度(≤0°=全接收)">
                                    增强射线接收角度: {planet.enhance_dsp_degree.toFixed(3)}°
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    // 渲染天体树
    const renderTree = () => {
        return (
            <div className="tree-container">
                {/* 星区节点 */}
                <div className="tree-item" onClick={() => handleSelectItem('galaxy', null, null)}>
                    <div className="tree-item-header">
                        <input
                            className="form-check-input tree-selection-checkbox"
                            type="checkbox"
                            checked={!!oreSelection?.galaxy}
                            onChange={(e) => onToggleGalaxySelection?.(e.target.checked)}
                            onClick={(e) => e.stopPropagation()}
                            title="选择整个星区的汇总数据"
                        />
                        <span className="tree-icon galaxy">星</span>
                        <span className="tree-label">星区</span>
                        <span className="tree-info">{data.seed_id} | {data.star_num}星 | {data.resource_rate}x</span>
                    </div>
                </div>

                {/* 恒星节点 - 按距离排序 */}
                {[...data.stars]
                    .sort((a, b) => a.distance - b.distance)
                    .map((star) => {
                    const starIdx = star.star_index;
                    const rareVeins = [];
                    for (let i = 6; i < 14; i++) {
                        if (star.veins_point[i] > 0) {
                            rareVeins.push(VEIN_NAMES[i]);
                        }
                    }

                    const isExpanded = expandedStars.has(starIdx);

                    return (
                        <div key={starIdx} className="tree-item">
                            <div className="tree-item-header" onClick={(e) => {
                                e.stopPropagation();
                                toggleStar(starIdx);
                                handleSelectItem('star', starIdx, null);
                            }}>
                                <input
                                    className="form-check-input tree-selection-checkbox"
                                    type="checkbox"
                                    checked={!!oreSelection?.stars?.has(starIdx)}
                                    onChange={() => onToggleStarSelection?.(starIdx)}
                                    onClick={(e) => e.stopPropagation()}
                                    title={`选择${star.name}的矿物数据`}
                                />
                                <span className={`tree-toggle ${isExpanded ? 'expanded' : ''}`}>
                                    {isExpanded ? '▼' : '▶'}
                                </span>
                                <span className="tree-icon star" style={{ backgroundColor: STAR_COLORS[star.type_id] || '#e6a23c' }}>★</span>
                                <span className="tree-label">{star.name} <span className="star-type-tag">{star.type}</span></span>
                                <span className="tree-info">
                                    {star.distance.toFixed(1)}LY
                                    {[...new Set((star.planets || []).filter(p => p.is_gas).map(p => p.type))].map(t =>
                                        <span key={t} className="tag gas-tag">{t}</span>)}
                                    {rareVeins.map(v => <span key={v} className="tag rare">{v}</span>)}
                                </span>
                            </div>
                            {isExpanded && (
                                <div className="tree-children">
                                    {star.planets.map((planet, planetIdx) => {
                                        const tags = [];
                                        if (planet.dsp_level === 2) tags.push(<span key="dsp" className="tag special">全包</span>);
                                        else if (planet.dsp_level === 1) tags.push(<span key="dsp" className="tag special">全接收</span>);
                                        planet.singularity_str.forEach((s, i) => tags.push(<span key={`s${i}`} className="tag">{s}</span>));
                                        if (planet.liquid === 1) tags.push(<span key="water" className="tag">水</span>);
                                        else if (planet.liquid === 2) tags.push(<span key="acid" className="tag rare">硫酸</span>);
                                        for (let i = 6; i < 14; i++) {
                                            if (planet.veins_point[i] > 0) {
                                                tags.push(<span key={`v${i}`} className="tag rare">{VEIN_NAMES[i]}</span>);
                                            }
                                        }

                                        return (
                                            <div key={planetIdx} className="tree-item" onClick={(e) => {
                                                e.stopPropagation();
                                                handleSelectItem('planet', starIdx, planetIdx);
                                            }}>
                                                <div className="tree-item-header">
                                                    <span className="tree-icon planet" style={{ backgroundColor: planet.is_gas ? '#909399' : (PLANET_COLORS[planet.type_id] || '#67c23a') }}>
                                                        {planet.is_gas ? '气' : '星'}
                                                    </span>
                                                    <span className="tree-label">{planet.name} <span className={`star-type-tag ${planet.is_gas ? 'gas-tag' : ''}`}>{planet.type}</span></span>
                                                    <span className="tree-info">{tags}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="result-panel">
            {!is_mobile && (
                <div className="tree-panel">
                    {renderTree()}
                </div>
            )}
            {/* 右侧:星球详情(mobile 隐藏;轨道采集器已移到 SeedViewerPage 左面板) */}
            <div className="result-right">
                {!is_mobile && (
                    <div className="detail-panel">
                        {renderDetail()}
                    </div>
                )}
                {/* 致谢:右下角,星球详情面板下方 */}
                <div className="source-info">
                    <h4>致谢</h4>
                    <p>
                        本功能基于开源项目
                        <a href="https://github.com/botany233/dsp_search_seed" target="_blank" rel="noopener noreferrer">
                            「戴森球计划种子搜索&查看器」
                        </a>
                        移植集成
                    </p>
                    <p>源项目支持种子条件搜索和筛选</p>
                    <p className="source-license">License: GPLv3</p>
                </div>
            </div>
        </div>
    );
}
