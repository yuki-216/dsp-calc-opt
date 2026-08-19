import { useState, useEffect, useCallback, useRef } from 'react';
import { FaPlay, FaStop, FaRedo, FaChartLine, FaSync, FaExclamationTriangle } from 'react-icons/fa';
import {
    startStats, stopStats, resumeStats,
    getStatsStatus, getStatsConvergence,
} from './seed_stats_api';

const CONVERGENCE_THRESHOLD = 0.03;
const WARNING_THRESHOLD = 0.10;

/**
 * 当前星区汇总指标的最大相对误差（CI95 半宽 / |mean|）。
 * 仅以每个种子的星区总和为样本，不混入各恒星位置的相对误差。
 */
function computeGalaxySummaryMaxRelativeError(conv) {
    if (!conv || conv.stale || !conv.galaxy_summary) return null;

    const FIELD_LABELS = {
        veins_point: '汇总矿点数',
        veins_amount: '汇总矿量',
    };
    let maxEntry = null;
    function consider(relErr, field, fieldIdx, label) {
        if (relErr === null || relErr === undefined) return;
        if (!maxEntry || relErr > maxEntry.value) {
            maxEntry = { value: relErr, field, fieldIndex: fieldIdx, label };
        }
    }
    for (const field of ['veins_point', 'veins_amount']) {
        (conv.galaxy_summary[field] || []).forEach((item, i) => {
            consider(item?.relative_error, field, i, `${FIELD_LABELS[field]}[${i}]`);
        });
    }
    return maxEntry;
}

/**
 * 统计分析控制面板
 * 放置于种子查看器查询按钮下方的空地。
 * 控制独立计算子进程（后端API管理），5秒轮询进度，选择恒星数量查看结果。
 */
export default function SeedStatsPanel({ isActive, starNum, onViewStats }) {
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusText, setStatusText] = useState('尚未开始计算');
    const [detailText, setDetailText] = useState('');
    const [maxRelErr, setMaxRelErr] = useState(null);  // 最大相对误差详情（含位置）
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);      // 按钮操作进行中
    const [hasProgress, setHasProgress] = useState(false);
    const [showControls, setShowControls] = useState(false);
    const firstLoad = useRef(true);

    // 统计计算控制区默认隐藏；开发/维护时在控制台执行 window.showStatsControls()。
    useEffect(() => {
        const show = () => setShowControls(true);
        const hide = () => setShowControls(false);
        window.showStatsControls = show;
        window.hideStatsControls = hide;
        return () => {
            if (window.showStatsControls === show) delete window.showStatsControls;
            if (window.hideStatsControls === hide) delete window.hideStatsControls;
        };
    }, []);

    // 解析状态并更新UI
    const applyStatus = useCallback((st) => {
        const current = Number(st.current_seed_id) || 0;
        const total = Number(st.total_seeds) || 0;
        const running = !!st.is_running;

        if (!showControls) {
            setIsRunning(running);
            setProgress(Number(st.progress_percent) || 0);
            setHasProgress(current > 0);
            setStatusText(current > 0 ? `已完成 ${current.toLocaleString()} 颗种子` : '尚未开始计算');
            setDetailText('');
            setMaxRelErr(null);
            return;
        }

        // 已完成判定：未在跑 + 有进度 + completed >= total
        const completed = !running && current > 0 && total > 0 && current >= total;
        const paused = !running && current > 0 && !completed;

        setIsRunning(running);
        setProgress(Number(st.progress_percent) || 0);
        setHasProgress(current > 0);
        if (running) {
            setStatusText(`计算中：已完成 ${current.toLocaleString()} 颗种子`);
            setDetailText(`已用 ${st.elapsed_time || '0秒'}`);
        } else if (completed) {
            setStatusText(`已完成 ${current.toLocaleString()} 颗种子`);
            setDetailText('计算已完成');
        } else if (paused) {
            setStatusText(`已暂停：已完成 ${current.toLocaleString()} 颗种子`);
            setDetailText('可继续计算或重新开始');
        } else {
            setStatusText('尚未开始计算');
            setDetailText('点击"开始"按钮启动计算');
        }
    }, [showControls]);

    // 拉取一次状态 + 收敛信息
    const refresh = useCallback(async () => {
        try {
            const st = await getStatsStatus();
            applyStatus(st);
            setError(null);
            // 样本足够时拉 /convergence 拿最大相对误差
            const current = Number(st.current_seed_id) || 0;
            if (showControls && current >= 2) {
                try {
                    const conv = await getStatsConvergence(starNum);
                    const entry = computeGalaxySummaryMaxRelativeError(conv);
                    if (entry) {
                        entry.starNum = starNum;
                    }
                    setMaxRelErr(entry);
                } catch {
                    setMaxRelErr(null);
                }
            } else {
                setMaxRelErr(null);
            }
        } catch (err) {
            setError('获取状态失败: ' + err.message);
        }
    }, [applyStatus, starNum, showControls]);

    // 首次加载 + 5秒轮询（仅页面激活时）
    useEffect(() => {
        if (!isActive) return;
        refresh();
        if (firstLoad.current) firstLoad.current = false;
        const interval = setInterval(refresh, 5000);
        return () => clearInterval(interval);
    }, [isActive, refresh]);

    const handleStart = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await startStats();
            applyStatus({ is_running: true, current_seed_id: 0, total_seeds: 99999999, progress_percent: 0, elapsed_time: '0秒', ...res });
            await refresh();
        } catch (err) {
            setError('启动失败: ' + err.message);
        } finally {
            setBusy(false);
        }
    };

    const handleResume = async () => {
        setBusy(true);
        setError(null);
        try {
            await resumeStats();
            await refresh();
        } catch (err) {
            setError('恢复失败: ' + err.message);
        } finally {
            setBusy(false);
        }
    };

    const handleStop = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await stopStats();
            setStatusText(res.message || '已请求停止');
            await refresh();
        } catch (err) {
            setError('停止失败: ' + err.message);
        } finally {
            setBusy(false);
        }
    };

    const handleView = () => {
        if (onViewStats) onViewStats(starNum);
    };

    return (
        <div className="stats-panel">
            <div className="stats-panel-header">
                <FaChartLine className="stats-panel-icon" />
                <span>统计分析</span>
            </div>
            {showControls && (
                <>
                    <p className="stats-panel-desc">遍历全部种子，按恒星数量分组计算统计期望（1倍资源）</p>
                    <div className="stats-buttons">
                        <button className="stats-btn primary" onClick={handleStart} disabled={busy || isRunning} title="从头开始计算（清空进度和已有均值，新数据从零累加）">
                            <FaPlay /> 开始
                        </button>
                        <button className="stats-btn danger" onClick={handleStop} disabled={busy || !isRunning} title="优雅停止计算">
                            <FaStop /> 停止
                        </button>
                        <button className="stats-btn" onClick={handleResume} disabled={busy || isRunning || !hasProgress} title="从上次完成的下一颗继续（保留已有均值继续累加）">
                            <FaRedo /> 恢复
                        </button>
                    </div>
                </>
            )}

            {/* 进度条（仅计算中显示，避免"已完成 100%"的视觉误导） */}
            {isRunning && (
                <>
                    <div className="stats-progress">
                        <div className="stats-progress-bar" style={{ width: `${Math.min(100, progress)}%` }} />
                    </div>
                    <div className="stats-progress-label">{progress.toFixed(2)}%</div>
                </>
            )}

            <div className="stats-status">
                <div className="stats-status-main">
                    <span className={isRunning ? 'dot running' : 'dot'} />
                    {statusText}
                    <FaSync className={`stats-refresh ${isRunning ? 'spin' : ''}`} onClick={refresh} title="刷新状态" />
                </div>
                <div className="stats-status-detail">{detailText}</div>
                {/* 最大相对误差：仅显示星区汇总的最差项（不混入位置 × 字段） */}
                {maxRelErr !== null && (
                    <div className="stats-rel-err">
                        星区汇总最大相对误差: <strong>{(maxRelErr.value * 100).toFixed(2)}%</strong>
                        {maxRelErr.value < CONVERGENCE_THRESHOLD && <span className="badge-ok"> ✓ 已收敛</span>}
                        {maxRelErr.value >= CONVERGENCE_THRESHOLD && maxRelErr.value < WARNING_THRESHOLD && <span className="badge-warn"> ⚠ 接近</span>}
                        {maxRelErr.value >= WARNING_THRESHOLD && <span className="badge-bad"> ✗ 需更多样本</span>}
                        <span style={{ marginLeft: 8, color: 'var(--bs-secondary-color)', fontSize: 12 }}>
                            @ {maxRelErr.starNum}星 {maxRelErr.label}
                        </span>
                    </div>
                )}
            </div>

            <button
                className="query-button"
                onClick={handleView}
                disabled={busy || (!hasProgress && !isRunning)}
                title={`查看${starNum}星统计结果`}
            >
                <FaChartLine />
                查看统计结果
            </button>

            {error && (
                <div className="stats-error">
                    <FaExclamationTriangle />
                    <span>{error}</span>
                </div>
            )}
        </div>
    );
}
