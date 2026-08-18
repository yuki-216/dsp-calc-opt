## Task 5: 创建前端统计面板组件

**Files:**
- Create: `src/SeedStatsPanel.jsx`
- Create: `src/seed_stats_binding.js`
- Modify: `src/SeedViewerPage.jsx`

**Interfaces:**
- Consumes: Statistics API endpoints from Task 4
- Produces: SeedStatsPanel component, seed_stats_binding functions

- [ ] **Step 1: 创建API绑定文件**

```javascript
// src/seed_stats_binding.js
/**
 * 统计API绑定
 * 提供前端调用统计API的函数
 */

const API_BASE = 'http://localhost:8000/api/seed-stats';

/**
 * 启动统计计算
 */
export async function startStatsCalculation(startSeedId = 1, endSeedId = 99999999, batchSize = 100) {
    const response = await fetch(`${API_BASE}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            start_seed_id: startSeedId,
            end_seed_id: endSeedId,
            batch_size: batchSize
        })
    });
    
    if (!response.ok) {
        throw new Error(`启动计算失败: ${response.statusText}`);
    }
    
    return response.json();
}

/**
 * 停止统计计算
 */
export async function stopStatsCalculation() {
    const response = await fetch(`${API_BASE}/stop`, {
        method: 'POST'
    });
    
    if (!response.ok) {
        throw new Error(`停止计算失败: ${response.statusText}`);
    }
    
    return response.json();
}

/**
 * 恢复统计计算
 */
export async function resumeStatsCalculation() {
    const response = await fetch(`${API_BASE}/resume`, {
        method: 'POST'
    });
    
    if (!response.ok) {
        throw new Error(`恢复计算失败: ${response.statusText}`);
    }
    
    return response.json();
}

/**
 * 获取计算状态
 */
export async function getStatsStatus() {
    const response = await fetch(`${API_BASE}/status`);
    
    if (!response.ok) {
        throw new Error(`获取状态失败: ${response.statusText}`);
    }
    
    return response.json();
}

/**
 * 获取指定恒星数量的统计结果
 */
export async function getStatsResult(starNum) {
    const response = await fetch(`${API_BASE}/${starNum}`);
    
    if (!response.ok) {
        if (response.status === 404) {
            return null;
        }
        throw new Error(`获取统计结果失败: ${response.statusText}`);
    }
    
    return response.json();
}

/**
 * 获取统计概览
 */
export async function getStatsOverview() {
    const response = await fetch(`${API_BASE}/overview`);
    
    if (!response.ok) {
        throw new Error(`获取统计概览失败: ${response.statusText}`);
    }
    
    return response.json();
}
```

- [ ] **Step 2: 创建统计面板组件**

```jsx
// src/SeedStatsPanel.jsx
import { useState, useEffect, useCallback } from 'react';
import { FaPlay, FaStop, FaSync, FaSpinner } from 'react-icons/fa';
import {
    startStatsCalculation,
    stopStatsCalculation,
    resumeStatsCalculation,
    getStatsStatus,
    getStatsResult,
    getStatsOverview
} from './seed_stats_binding';

export default function SeedStatsPanel({ onViewResult }) {
    const [status, setStatus] = useState(null);
    const [overview, setOverview] = useState(null);
    const [selectedStarNum, setSelectedStarNum] = useState(64);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    // 获取状态
    const fetchStatus = useCallback(async () => {
        try {
            const data = await getStatsStatus();
            setStatus(data);
        } catch (err) {
            console.error('获取状态失败:', err);
        }
    }, []);

    // 获取概览
    const fetchOverview = useCallback(async () => {
        try {
            const data = await getStatsOverview();
            setOverview(data);
        } catch (err) {
            console.error('获取概览失败:', err);
        }
    }, []);

    // 定时轮询状态
    useEffect(() => {
        fetchStatus();
        fetchOverview();

        const interval = setInterval(() => {
            fetchStatus();
            fetchOverview();
        }, 5000);

        return () => clearInterval(interval);
    }, [fetchStatus, fetchOverview]);

    // 启动计算
    const handleStart = async () => {
        try {
            setIsLoading(true);
            setError(null);
            await startStatsCalculation();
            await fetchStatus();
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    // 停止计算
    const handleStop = async () => {
        try {
            setIsLoading(true);
            setError(null);
            await stopStatsCalculation();
            await fetchStatus();
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    // 恢复计算
    const handleResume = async () => {
        try {
            setIsLoading(true);
            setError(null);
            await resumeStatsCalculation();
            await fetchStatus();
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    // 查看统计结果
    const handleViewResult = async () => {
        try {
            setIsLoading(true);
            setError(null);
            const result = await getStatsResult(selectedStarNum);
            if (result) {
                onViewResult(result);
            } else {
                setError(`没有${selectedStarNum}恒星的统计数据`);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    // 格式化进度条
    const formatProgress = (percent) => {
        const filled = Math.round(percent / 5);
        const empty = 20 - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
    };

    return (
        <div className="seed-stats-panel">
            <h3>统计分析</h3>
            
            {/* 控制按钮 */}
            <div className="stats-controls">
                {!status?.is_running ? (
                    <>
                        <button onClick={handleStart} disabled={isLoading}>
                            <FaPlay /> 开始计算
                        </button>
                        <button onClick={handleResume} disabled={isLoading}>
                            <FaSync /> 继续计算
                        </button>
                    </>
                ) : (
                    <button onClick={handleStop} disabled={isLoading}>
                        <FaStop /> 停止计算
                    </button>
                )}
            </div>

            {/* 错误提示 */}
            {error && (
                <div className="stats-error">
                    {error}
                </div>
            )}

            {/* 进度显示 */}
            {status && (
                <div className="stats-progress">
                    <div className="progress-bar">
                        {formatProgress(status.progress_percent)} {status.progress_percent.toFixed(1)}%
                    </div>
                    <div className="progress-info">
                        当前: {status.current_seed_id.toLocaleString()} / {status.total_seeds.toLocaleString()}
                    </div>
                    <div className="progress-time">
                        已用: {status.elapsed_time}  剩余: {status.estimated_remaining}
                    </div>
                </div>
            )}

            {/* 统计概览 */}
            {overview && overview.stats.length > 0 && (
                <div className="stats-overview">
                    <h4>已统计的恒星数量</h4>
                    <div className="overview-list">
                        {overview.stats.map(item => (
                            <div key={item.star_num} className="overview-item">
                                {item.star_num}恒星: {item.seed_count.toLocaleString()}个种子
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 查看统计结果 */}
            <div className="stats-view">
                <h4>查看统计结果</h4>
                <div className="view-controls">
                    <select
                        value={selectedStarNum}
                        onChange={(e) => setSelectedStarNum(Number(e.target.value))}
                    >
                        {Array.from({ length: 33 }, (_, i) => i + 32).map(num => (
                            <option key={num} value={num}>{num}恒星</option>
                        ))}
                    </select>
                    <button onClick={handleViewResult} disabled={isLoading}>
                        {isLoading ? <FaSpinner className="spinner" /> : null}
                        查看结果
                    </button>
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 3: 修改SeedViewerPage集成统计面板**

```jsx
// src/SeedViewerPage.jsx (添加以下导入和状态)
import SeedStatsPanel from './SeedStatsPanel';

// 在组件内部添加状态
const [statsResult, setStatsResult] = useState(null);

// 在return语句中添加统计面板
<SeedStatsPanel onViewResult={setStatsResult} />

// 如果有statsResult，显示统计结果
{statsResult && (
    <SeedViewerResult data={statsResult} />
)}
```

- [ ] **Step 4: 添加CSS样式**

```css
/* src/SeedViewer.css (添加以下样式) */
.seed-stats-panel {
    background: #f5f5f5;
    border-radius: 8px;
    padding: 16px;
    margin: 16px 0;
}

.seed-stats-panel h3 {
    margin-top: 0;
    margin-bottom: 12px;
    color: #333;
}

.seed-stats-panel h4 {
    margin-top: 12px;
    margin-bottom: 8px;
    color: #555;
}

.stats-controls {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
}

.stats-controls button {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    background: #007bff;
    color: white;
    cursor: pointer;
    font-size: 14px;
}

.stats-controls button:hover {
    background: #0056b3;
}

.stats-controls button:disabled {
    background: #ccc;
    cursor: not-allowed;
}

.stats-error {
    background: #f8d7da;
    color: #721c24;
    padding: 8px 12px;
    border-radius: 4px;
    margin-bottom: 12px;
}

.stats-progress {
    background: white;
    padding: 12px;
    border-radius: 4px;
    margin-bottom: 12px;
}

.progress-bar {
    font-family: monospace;
    font-size: 14px;
    margin-bottom: 8px;
    color: #007bff;
}

.progress-info {
    font-size: 13px;
    color: #666;
    margin-bottom: 4px;
}

.progress-time {
    font-size: 13px;
    color: #666;
}

.stats-overview {
    background: white;
    padding: 12px;
    border-radius: 4px;
    margin-bottom: 12px;
}

.overview-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.overview-item {
    background: #e9ecef;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 13px;
}

.stats-view {
    background: white;
    padding: 12px;
    border-radius: 4px;
}

.view-controls {
    display: flex;
    gap: 8px;
    align-items: center;
}

.view-controls select {
    padding: 8px;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 14px;
}

.view-controls button {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    background: #28a745;
    color: white;
    cursor: pointer;
    font-size: 14px;
}

.view-controls button:hover {
    background: #218838;
}

.view-controls button:disabled {
    background: #ccc;
    cursor: not-allowed;
}

.spinner {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
```

- [ ] **Step 5: 提交代码**

```bash
git add src/SeedStatsPanel.jsx src/seed_stats_binding.js src/SeedViewerPage.jsx src/SeedViewer.css
git commit -m "feat: add statistics panel to seed viewer"
```

---

