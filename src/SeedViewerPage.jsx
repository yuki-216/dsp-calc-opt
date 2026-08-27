import { useState, useEffect, useCallback, useContext } from 'react';
import { FaSearch, FaSpinner, FaExclamationTriangle, FaChartLine, FaArrowLeft } from 'react-icons/fa';
import { doInit, getSeedData, isSeedDataValid, RESOURCE_RATES } from './seed_viewer_binding';
import { getStats, getStatsConvergence } from './seed_stats_api';
import { SettingsContext, SettingsSetterContext } from './contexts.jsx';
import { buildOreQuantities } from './ore_stats_binding';
import SeedViewerResult from './SeedViewerResult';
import SeedStatsPanel from './SeedStatsPanel';
import SeedStatsResult from './SeedStatsResult';
import OreQuantityModeToggle from './OreQuantityModeToggle.jsx';
import OrbitalCollectorPanel from './OrbitalCollectorPanel';
import './SeedViewer.css';

// 验证函数
const validateSeedId = (id) => {
    const num = parseInt(id);
    if (isNaN(num) || num < 1 || num > 99999999) {
        return { valid: false, error: '种子ID必须是1-99999999之间的整数' };
    }
    return { valid: true, value: num };
};

const validateStarNum = (num) => {
    const n = parseInt(num);
    if (isNaN(n) || n < 32 || n > 64) {
        return { valid: false, error: '恒星数量必须是32-64之间的整数' };
    }
    return { valid: true, value: n };
};

const validateResourceIndex = (index) => {
    const num = parseInt(index);
    if (isNaN(num) || num < 0 || num > 10) {
        return { valid: false, error: '无效的资源倍率索引' };
    }
    return { valid: true, value: num };
};

const STORAGE_KEY = 'seed-viewer-settings';
const CACHE_KEY = 'seed-viewer-cache';

export default function SeedViewerPage({ onNavigate, isActive }) {
    const settings = useContext(SettingsContext);
    const set_settings = useContext(SettingsSetterContext);
    // 状态管理
    const [seedId, setSeedId] = useState(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved).seedId || 10381977 : 10381977;
        } catch {
            return 10381977;
        }
    });
    const [starNum, setStarNum] = useState(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved).starNum || 64 : 64;
        } catch {
            return 64;
        }
    });
    const [resourceIndex, setResourceIndex] = useState(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved).resourceIndex || 4 : 4;
        } catch {
            return 4;
        }
    });

    const [isLoading, setIsLoading] = useState(false);
    const [isInitializing, setIsInitializing] = useState(true);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(() => {
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            return cached ? JSON.parse(cached) : null;
        } catch {
            return null;
        }
    });
    const [wasmReady, setWasmReady] = useState(false);
    const [oreSelection, setOreSelection] = useState({ galaxy: true, stars: new Set() });
    const [statsOreSelection, setStatsOreSelection] = useState({ galaxy: true, stars: new Set() });

    // 统计视图状态：viewMode 'seed'=单种子查询结果, 'stats'=统计结果
    const [viewMode, setViewMode] = useState('seed');
    const [statsData, setStatsData] = useState(null);
    const [statsConvergence, setStatsConvergence] = useState(null);
    const [statsLoading, setStatsLoading] = useState(false);


    useEffect(() => {
        const starIndices = result?.stars?.map((star, index) => star.star_index ?? index) || [];
        setOreSelection({ galaxy: true, stars: new Set(starIndices) });
    }, [result]);

    useEffect(() => {
        const starIndices = statsData?.stars_stats?.map((_, index) => index) || [];
        setStatsOreSelection({ galaxy: true, stars: new Set(starIndices) });
    }, [statsData]);

    const toggleGalaxySelection = useCallback((checked) => {
        const starIndices = result?.stars?.map((star, index) => star.star_index ?? index) || [];
        setOreSelection({ galaxy: checked, stars: checked ? new Set(starIndices) : new Set() });
    }, [result]);

    const toggleStarSelection = useCallback((index) => {
        setOreSelection(prev => {
            const nextStars = new Set(prev.stars);
            if (nextStars.has(index)) nextStars.delete(index);
            else nextStars.add(index);
            const allSelected = result?.stars?.length > 0 && nextStars.size === result.stars.length;
            return { galaxy: allSelected, stars: nextStars };
        });
    }, [result]);

    const toggleStatsGalaxySelection = useCallback((checked) => {
        const starIndices = statsData?.stars_stats?.map((_, index) => index) || [];
        setStatsOreSelection({ galaxy: checked, stars: checked ? new Set(starIndices) : new Set() });
    }, [statsData]);

    const toggleStatsStarSelection = useCallback((index) => {
        setStatsOreSelection(prev => {
            const nextStars = new Set(prev.stars);
            if (nextStars.has(index)) nextStars.delete(index);
            else nextStars.add(index);
            const allSelected = statsData?.stars_stats?.length > 0 && nextStars.size === statsData.stars_stats.length;
            return { galaxy: allSelected, stars: nextStars };
        });
    }, [statsData]);

    const applySelectedOreQuantities = useCallback(() => {
        if (!result || !set_settings) return;
        const point = new Array(14).fill(0);
        const amount = new Array(14).fill(0);
        if (oreSelection.galaxy) {
            for (let i = 0; i < 14; i++) {
                point[i] = Number(result.veins_point?.[i] || 0);
                amount[i] = Number(result.veins_amount?.[i] || 0);
            }
        } else {
            for (const index of oreSelection.stars) {
                const star = result.stars?.find((candidate, candidateIndex) => (candidate.star_index ?? candidateIndex) === index);
                if (!star) continue;
                for (let i = 0; i < 14; i++) {
                    point[i] += Number(star.veins_point?.[i] || 0);
                    amount[i] += Number(star.veins_amount?.[i] || 0);
                }
            }
        }

        const mode = settings?.ore_quantity_mode || 'amount';
        const nextQuantities = buildOreQuantities(point, amount, mode);
        set_settings({ ore_quantities: nextQuantities });
        onNavigate?.('calculator');
    }, [onNavigate, oreSelection, result, set_settings, settings]);

    const applySelectedStatsOreQuantities = useCallback(() => {
        if (!statsData || !set_settings) return;
        const mode = settings?.ore_quantity_mode || 'amount';
        let point;
        let amount;
        if (statsOreSelection.galaxy && statsData.summary_avg) {
            point = statsData.summary_avg.veins_point;
            amount = statsData.summary_avg.veins_amount;
        } else {
            point = new Array(14).fill(0);
            amount = new Array(14).fill(0);
            for (const index of statsOreSelection.stars) {
                const star = statsData.stars_stats?.[index];
                if (!star) continue;
                for (let i = 0; i < 14; i++) {
                    point[i] += Number(star.avg_veins_point?.[i] || 0);
                    amount[i] += Number(star.avg_veins_amount?.[i] || 0);
                }
            }
        }
        set_settings({ ore_quantities: buildOreQuantities(point, amount, mode) });
        onNavigate?.('calculator');
    }, [onNavigate, set_settings, settings, statsData, statsOreSelection]);

    // 初始化API连接
    useEffect(() => {
        let isMounted = true;

        async function init() {
            try {
                setIsInitializing(true);
                setError(null);

                await doInit();

                if (isMounted) {
                    setWasmReady(true);
                }
            } catch (err) {
                if (isMounted) {
                    setError('连接后端服务器失败: ' + err.message);
                    setWasmReady(false);
                }
            } finally {
                if (isMounted) {
                    setIsInitializing(false);
                }
            }
        }

        if (isActive) {
            init();
        }

        return () => {
            isMounted = false;
        };
    }, [isActive]);

    // 保存设置到localStorage
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                seedId, starNum, resourceIndex
            }));
        } catch {
            // localStorage 不可用时不影响页面工作
        }
    }, [seedId, starNum, resourceIndex]);

    // 保存查询结果到localStorage
    useEffect(() => {
        try {
            if (result) {
                localStorage.setItem(CACHE_KEY, JSON.stringify(result));
            }
        } catch {
            // 缓存不可用时不影响查询结果展示
        }
    }, [result]);

    // 查询种子数据
    const handleQuery = useCallback(async () => {
        // 验证输入
        const seedIdValid = validateSeedId(seedId);
        if (!seedIdValid.valid) {
            setError(seedIdValid.error);
            return;
        }

        const starNumValid = validateStarNum(starNum);
        if (!starNumValid.valid) {
            setError(starNumValid.error);
            return;
        }

        const resourceIndexValid = validateResourceIndex(resourceIndex);
        if (!resourceIndexValid.valid) {
            setError(resourceIndexValid.error);
            return;
        }

        // 检查API是否就绪
        if (!wasmReady) {
            setError('后端服务器未连接，请确保Python后端正在运行');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // 调用API查询
            const data = await getSeedData(seedId, starNum, resourceIndex);

            if (data && isSeedDataValid(data)) {
                setResult(data);
                setViewMode('seed');
            } else {
                setError('查询失败，请检查输入参数');
            }
        } catch (err) {
            setError('查询错误: ' + err.message);
        } finally {
            setIsLoading(false);
        }
    }, [seedId, starNum, resourceIndex, wasmReady]);

    // 处理键盘事件
    const handleKeyPress = useCallback((e) => {
        if (e.key === 'Enter' && !isLoading && wasmReady) {
            handleQuery();
        }
    }, [handleQuery, isLoading, wasmReady]);

    // 查看统计结果（从统计面板触发，右侧切换为统计视图）
    const handleViewStats = useCallback(async (starNum) => {
        setStatsLoading(true);
        setError(null);
        try {
            const data = await getStats(starNum);
            if (data && Array.isArray(data.stars_stats)) {
                setStatsData(data);
                setViewMode('stats');
                // 同时拉收敛信息（CI/相对误差/标准差），失败不影响主显示
                try {
                    const conv = await getStatsConvergence(starNum);
                    setStatsConvergence(conv);
                } catch {
                    setStatsConvergence(null);
                }
            } else {
                setError(`没有${starNum}恒星的统计数据，请先开始计算`);
            }
        } catch (err) {
            setError('加载统计结果失败: ' + err.message);
        } finally {
            setStatsLoading(false);
        }
    }, []);

    // 渲染加载状态
    if (isInitializing) {
        return (
            <div className="seed-viewer-page">
                <div className="loading-container">
                    <FaSpinner className="spinner" />
                    <p>正在初始化WebAssembly模块...</p>
                    <p className="loading-hint">首次加载可能需要几秒钟</p>
                </div>
            </div>
        );
    }

    return (
        <div className="seed-viewer-page">
            {/* 输入面板 */}
            <div className="input-panel">
                <button className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1 mb-2"
                        onClick={() => onNavigate?.('calculator')}>
                    <FaArrowLeft/>
                    <span>返回计算器</span>
                </button>
                <h2>种子查看器</h2>
                <p className="description">
                    查询指定种子的资源分布，查看恒星和行星详情
                </p>

                <div className="form-group">
                    <label htmlFor="seedId">种子ID</label>
                    <input
                        id="seedId"
                        type="number"
                        value={seedId}
                        onChange={(e) => setSeedId(Number(e.target.value))}
                        onKeyPress={handleKeyPress}
                        placeholder="输入种子ID"
                        disabled={isLoading}
                        min="1"
                        max="2147483647"
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="starNum">恒星数量</label>
                    <select
                        id="starNum"
                        value={starNum}
                        onChange={(e) => setStarNum(Number(e.target.value))}
                        disabled={isLoading}
                    >
                        {Array.from({ length: 33 }, (_, index) => index + 32).map((count) => (
                            <option key={count} value={count}>{count}星</option>
                        ))}
                    </select>
                </div>

                <div className="form-group">
                    <label htmlFor="resourceIndex">资源倍率</label>
                    <select
                        id="resourceIndex"
                        value={resourceIndex}
                        onChange={(e) => setResourceIndex(Number(e.target.value))}
                        disabled={isLoading}
                    >
                        {RESOURCE_RATES.map(rate => (
                            <option key={rate.index} value={rate.index}>
                                {rate.label}
                            </option>
                        ))}
                    </select>
                </div>

                <button
                    className="query-button"
                    onClick={handleQuery}
                    disabled={isLoading || !wasmReady}
                >
                    {isLoading ? (
                        <>
                            <FaSpinner className="spinner" />
                            查询中...
                        </>
                    ) : (
                        <>
                            <FaSearch />
                            查询
                        </>
                    )}
                </button>

                {/* 统计分析面板（查询按钮下方空地） */}
                <SeedStatsPanel isActive={isActive} starNum={starNum} onViewStats={handleViewStats} />

                {error && (
                    <div className="error-message">
                        <FaExclamationTriangle />
                        <span>{error}</span>
                    </div>
                )}

                {/* 选择状态：独立显示，不与模式切换放在同一个框内 */}
                {result && viewMode === 'seed' && (
                    <div className="ore-selection-status small text-muted">
                        已选择：{oreSelection.galaxy ? '星区统计' : `${oreSelection.stars.size} 颗恒星`}
                    </div>
                )}

                {statsData && viewMode === 'stats' && (
                    <div className="ore-selection-status small text-muted">
                        已选择：{statsOreSelection.galaxy ? '星区统计' : `${statsOreSelection.stars.size} 颗恒星`}
                    </div>
                )}

                {/* 模式切换与操作按钮同一行 */}
                {(result || statsData) && (
                    <div className="ore-action-row">
                        <OreQuantityModeToggle
                            mode={settings?.ore_quantity_mode || 'amount'}
                            onChange={(mode) => set_settings({ ore_quantity_mode: mode })}
                        />
                        {result && viewMode === 'seed' && (
                            <button
                                className="action-button"
                                onClick={applySelectedOreQuantities}
                                disabled={!oreSelection.galaxy && oreSelection.stars.size === 0}
                                title="按当前模式应用到矿物可用量"
                            >
                                应用到矿物可用量
                            </button>
                        )}
                        {statsData && viewMode === 'stats' && (
                            <button
                                className="action-button"
                                onClick={applySelectedStatsOreQuantities}
                                disabled={!statsOreSelection.galaxy && statsOreSelection.stars.size === 0}
                                title="按当前模式应用统计数据到矿物可用量"
                            >
                                应用到矿物可用量
                            </button>
                        )}
                    </div>
                )}

                {/* 轨道采集器面板(始终显示,无星区数据时仅默认预设;选择真实气态行星需有结果) */}
                <OrbitalCollectorPanel result={result}/>
            </div>

            {/* 结果面板(致谢在 SeedViewerResult 右下角) */}
            {viewMode === 'stats' ? (
                <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {statsLoading ? (
                        <div className="result-placeholder">
                            <div className="placeholder-content">
                                <FaSpinner className="spinner placeholder-icon" />
                                <h3>加载统计结果...</h3>
                            </div>
                        </div>
                    ) : statsData ? (
                        <SeedStatsResult
                            data={statsData}
                            convergence={statsConvergence}
                            oreSelection={statsOreSelection}
                            onToggleGalaxySelection={toggleStatsGalaxySelection}
                            onToggleStarSelection={toggleStatsStarSelection}
                        />
                    ) : (
                        <div className="result-placeholder">
                            <div className="placeholder-content">
                                <FaChartLine className="placeholder-icon" />
                                <h3>尚未加载统计数据</h3>
                                <p>在左侧统计分析面板选择恒星数量并查看</p>
                            </div>
                        </div>
                    )}
                </div>
            ) : result ? (
                <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <SeedViewerResult
                        data={result}
                        oreSelection={oreSelection}
                        onToggleGalaxySelection={toggleGalaxySelection}
                        onToggleStarSelection={toggleStarSelection}
                    />
                </div>
            ) : (
                <div className="result-placeholder">
                    <div className="placeholder-content">
                        <FaSearch className="placeholder-icon" />
                        <h3>输入种子ID开始查询</h3>
                    </div>
                </div>
            )}
        </div>
    );
}
