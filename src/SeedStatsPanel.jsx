import { useState, useEffect, useCallback, useRef } from 'react';
import { FaPlay, FaStop, FaRedo, FaChartLine, FaSync, FaExclamationTriangle } from 'react-icons/fa';
import {
    startStats, stopStats, resumeStats,
    getStatsStatus,
    STATS_STAR_NUMS,
} from './seed_stats_api';

/**
 * 统计分析控制面板
 * 放置于种子查看器查询按钮下方的空地。
 * 控制独立计算子进程（后端API管理），5秒轮询进度，选择恒星数量查看结果。
 */
export default function SeedStatsPanel({ isActive, onViewStats }) {
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusText, setStatusText] = useState('尚未开始计算');
    const [detailText, setDetailText] = useState('');
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);      // 按钮操作进行中
    const [hasProgress, setHasProgress] = useState(false);
    const [selStarNum, setSelStarNum] = useState(64);
    const firstLoad = useRef(true);

    // 解析状态并更新UI
    const applyStatus = useCallback((st) => {
        setIsRunning(!!st.is_running);
        setProgress(Number(st.progress_percent) || 0);
        setHasProgress((Number(st.current_seed_id) || 0) > 0);
        if (st.is_running) {
            setStatusText(`计算中: ${Number(st.current_seed_id || 0).toLocaleString()}`);
            setDetailText(`/ ${Number(st.total_seeds || 0).toLocaleString()} | 已用 ${st.elapsed_time || '0秒'} | 剩余 ${st.estimated_remaining || '未知'}`);
        } else if ((Number(st.current_seed_id) || 0) > 0) {
            setStatusText(`已暂停于: ${Number(st.current_seed_id).toLocaleString()}`);
            setDetailText(`/ ${Number(st.total_seeds || 0).toLocaleString()} | 可恢复继续计算或重新开始`);
        } else {
            setStatusText('尚未开始计算');
            setDetailText('计算范围 1 - 99,999,999，每100个种子一批');
        }
    }, []);

    // 拉取一次状态
    const refresh = useCallback(async () => {
        try {
            const st = await getStatsStatus();
            applyStatus(st);
            setError(null);
        } catch (err) {
            setError('获取状态失败: ' + err.message);
        }
    }, [applyStatus]);

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
            applyStatus({ is_running: true, current_seed_id: 0, total_seeds: 99999999, progress_percent: 0, elapsed_time: '0秒', estimated_remaining: '未知', ...res });
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
        if (onViewStats) onViewStats(selStarNum);
    };

    return (
        <div className="stats-panel">
            <div className="stats-panel-header">
                <FaChartLine className="stats-panel-icon" />
                <span>统计分析</span>
            </div>
            <p className="stats-panel-desc">遍历全部种子，按恒星数量分组计算统计期望（1倍资源）</p>

            <div className="stats-buttons">
                <button className="stats-btn primary" onClick={handleStart} disabled={busy || isRunning} title="从头开始计算（会保留已有进度，从当前位置继续可点恢复）">
                    <FaPlay /> 开始
                </button>
                <button className="stats-btn danger" onClick={handleStop} disabled={busy || !isRunning} title="优雅停止计算">
                    <FaStop /> 停止
                </button>
                <button className="stats-btn" onClick={handleResume} disabled={busy || isRunning || !hasProgress} title="从上次进度继续计算">
                    <FaRedo /> 恢复
                </button>
            </div>

            {/* 进度条 */}
            <div className="stats-progress">
                <div className="stats-progress-bar" style={{ width: `${Math.min(100, progress)}%` }} />
            </div>
            <div className="stats-progress-label">{progress.toFixed(2)}%</div>

            <div className="stats-status">
                <div className="stats-status-main">
                    <span className={isRunning ? 'dot running' : 'dot'} />
                    {isRunning ? '正在计算...' : statusText}
                    <FaSync className={`stats-refresh ${isRunning ? 'spin' : ''}`} onClick={refresh} title="刷新状态" />
                </div>
                <div className="stats-status-detail">{detailText}</div>
            </div>

            <div className="stats-view-row">
                <select
                    value={selStarNum}
                    onChange={(e) => setSelStarNum(Number(e.target.value))}
                    disabled={!hasProgress && !isRunning}
                >
                    {STATS_STAR_NUMS.map(n => <option key={n} value={n}>{n}星</option>)}
                </select>
                <button className="stats-btn" onClick={handleView} disabled={busy} title="在右侧查看该恒星数量的统计结果">
                    查看结果
                </button>
            </div>

            {error && (
                <div className="stats-error">
                    <FaExclamationTriangle />
                    <span>{error}</span>
                </div>
            )}
        </div>
    );
}