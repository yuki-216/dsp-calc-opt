"""
统计API接口测试
新架构：子进程 + 文件通信。
测试 mock subprocess.Popen，避免真正启动计算子进程。
"""

import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

# 添加原项目的CApi路径
SEED_VIEWER_PATH = Path("D:/编程/种子查看器")
sys.path.insert(0, str(SEED_VIEWER_PATH))

# Mock掉C库初始化，避免在测试时加载真实的C库
with patch('dsp_search_seed.CApi.search_seed.do_init_c'):
    from main import app

import stats_api
from stats_storage import StatsStorage


@pytest.fixture
def client(tmp_path, monkeypatch):
    """每个测试使用独立的临时数据目录，避免污染真实数据"""
    tmp_storage = StatsStorage(str(tmp_path))
    monkeypatch.setattr(stats_api, "storage", tmp_storage)
    monkeypatch.setattr(stats_api, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(stats_api, "STOP_FLAG", Path(tmp_path) / "stop.flag")
    monkeypatch.setattr(stats_api, "_process", None)

    # Mock subprocess.Popen，避免真正启动计算子进程
    mock_popen = MagicMock()
    mock_proc = MagicMock()
    mock_proc.poll.return_value = None  # 模拟子进程仍在运行
    mock_proc.wait.return_value = 0
    mock_popen.return_value = mock_proc
    monkeypatch.setattr(stats_api.subprocess, "Popen", mock_popen)

    client = TestClient(app)
    return client, mock_popen, mock_proc


def _save_stat(storage, star_num, seed_count=10):
    """向临时存储写入一个统计数据文件"""
    storage._save_json(str(Path(storage.data_dir) / f"stats_{star_num}.json"), {
        "star_num": star_num,
        "seed_count": seed_count,
        "stars_stats": []
    })


def test_start_stats_calculation(client):
    """测试启动统计计算（启动子进程）"""
    c, mock_popen, _ = client
    response = c.post("/api/seed-stats/start", json={
        "start_seed_id": 1,
        "end_seed_id": 10,
        "batch_size": 5
    })
    assert response.status_code == 200
    data = response.json()
    assert "task_id" in data
    assert "message" in data
    # 断言子进程被启动，且传入 start/end/batch 参数
    assert mock_popen.call_count == 1
    call_args = mock_popen.call_args[0][0]
    assert "--start" in call_args
    assert call_args[call_args.index("--start") + 1] == "1"
    assert call_args[call_args.index("--end") + 1] == "10"
    assert call_args[call_args.index("--batch") + 1] == "5"


def test_start_invalid_range(client):
    """测试无效的种子范围"""
    c, mock_popen, _ = client
    response = c.post("/api/seed-stats/start", json={
        "start_seed_id": 10,
        "end_seed_id": 1,
        "batch_size": 5
    })
    assert response.status_code == 400
    assert mock_popen.call_count == 0


def test_stop_stats_calculation(client):
    """测试停止统计计算（写入stop.flag并等待子进程退出）"""
    c, mock_popen, mock_proc = client
    c.post("/api/seed-stats/start", json={
        "start_seed_id": 1,
        "end_seed_id": 10,
        "batch_size": 5
    })

    # 停止：应写入stop.flag，等待子进程退出，然后清理
    response = c.post("/api/seed-stats/stop")
    assert response.status_code == 200
    assert "message" in response.json()
    # 子进程 wait 被调用（优雅等待退出）
    assert mock_proc.wait.call_count >= 1
    # 运行时标记应被清除
    assert stats_api.storage.load_runtime() is None


def test_get_stats_status(client):
    """测试获取统计状态（未运行时）"""
    c, _, _ = client
    response = c.get("/api/seed-stats/status")
    assert response.status_code == 200
    data = response.json()
    assert "is_running" in data
    assert "current_seed_id" in data
    assert "total_seeds" in data
    assert "progress_percent" in data
    assert "elapsed_time" in data
    assert "estimated_remaining" in data
    assert data["is_running"] is False


def test_get_stats_result(client):
    """测试获取统计结果"""
    c, _, _ = client
    # 写入64恒星统计文件
    _save_stat(stats_api.storage, 64)
    response = c.get("/api/seed-stats/64")
    assert response.status_code == 200
    assert response.json()["seed_count"] == 10


def test_get_stats_overview(client):
    """测试获取统计概览（/overview 路由必须在 /{star_num} 之前匹配）"""
    c, _, _ = client
    _save_stat(stats_api.storage, 32)
    _save_stat(stats_api.storage, 64)
    response = c.get("/api/seed-stats/overview")
    assert response.status_code == 200
    data = response.json()
    assert "stats" in data
    star_nums = [s["star_num"] for s in data["stats"]]
    assert 32 in star_nums
    assert 64 in star_nums


def test_resume_stats_calculation(client):
    """测试恢复统计计算（不传--start，子进程从progress恢复）"""
    c, mock_popen, _ = client
    # 预先写入进度（completed_seed_id=100）
    stats_api.storage.save_progress(
        completed_seed_id=100,
        seed_count=100,
        batch_size=100,
        start_seed_id=1,
        end_seed_id=99999999
    )

    response = c.post("/api/seed-stats/resume")
    assert response.status_code == 200
    assert "message" in response.json()
    assert mock_popen.call_count == 1
    # 恢复模式不传 --start 参数
    call_args = mock_popen.call_args[0][0]
    assert "--start" not in call_args


def test_resume_no_progress(client):
    """测试无进度时恢复"""
    c, mock_popen, _ = client
    response = c.post("/api/seed-stats/resume")
    assert response.status_code == 200
    assert "没有可恢复的进度" in response.json()["message"]
    assert mock_popen.call_count == 0


def test_get_stats_invalid_star_num(client):
    """测试无效的恒星数量"""
    c, _, _ = client
    response = c.get("/api/seed-stats/10")
    assert response.status_code == 400
    assert "detail" in response.json()


def test_get_stats_star_num_too_high(client):
    """测试恒星数量过大"""
    c, _, _ = client
    response = c.get("/api/seed-stats/100")
    assert response.status_code == 400
    assert "detail" in response.json()