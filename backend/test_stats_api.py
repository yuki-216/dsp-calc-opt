"""
统计API接口测试
新架构：子进程 + 文件通信。
测试 mock subprocess.Popen，避免真正启动计算子进程。
"""

import json
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
    """向临时存储写入一个统计数据（新版：合并到 stats.json）"""
    stats_file = Path(storage.data_dir) / "stats.json"
    existing = {}
    if stats_file.exists():
        with open(stats_file, "r", encoding="utf-8") as f:
            existing = json.load(f)
    existing[str(star_num)] = {
        "star_num": star_num,
        "seed_count": seed_count,
        "stars_stats": []
    }
    with open(stats_file, "w", encoding="utf-8") as f:
        json.dump(existing, f)


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


# --- /convergence 端点测试 ---

def _save_stats_with_m2(storage, star_num, seed_count=10):
    """写入含 m2 字段的 stats.json（模拟 Welford 运行结果）"""
    import json
    stats_file = Path(storage.data_dir) / "stats.json"
    existing = {}
    if stats_file.exists():
        with open(stats_file, "r", encoding="utf-8") as f:
            existing = json.load(f)
    stars_stats = []
    for i in range(star_num):
        stars_stats.append({
            "avg_distance": 1.0 + i * 0.1,
            "m2_distance": 0.5 + i * 0.01,
            "avg_veins_point": [10] * 14,
            "m2_veins_point": [5] * 14,
            "avg_veins_amount": [100] * 14,
            "m2_veins_amount": [50] * 14,
            "avg_gas_veins": [1.0, 2.0, 3.0],
            "m2_gas_veins": [0.5, 0.5, 0.5],
        })
    existing[str(star_num)] = {
        "star_num": star_num,
        "seed_count": seed_count,
        "stars_stats": stars_stats,
    }
    with open(stats_file, "w", encoding="utf-8") as f:
        json.dump(existing, f)


def test_convergence_with_m2_returns_ci(client):
    """含 m2 字段的数据：返回完整 convergence 结构"""
    c, _, _ = client
    _save_stats_with_m2(stats_api.storage, 64, seed_count=10)
    response = c.get("/api/seed-stats/64/convergence")
    assert response.status_code == 200
    data = response.json()
    assert data["stale"] is False
    assert data["seed_count"] == 10
    assert data["confidence"] == 0.95
    assert len(data["fields"]) == 64
    pos0 = data["fields"][0]
    assert "distance" in pos0
    assert {"mean", "std", "se", "ci_half", "relative_error"} <= set(pos0["distance"].keys())
    # 相对误差 < 1（任何正均值）
    assert pos0["distance"]["relative_error"] >= 0


def test_convergence_invalid_star_num(client):
    """无效恒星数：400"""
    c, _, _ = client
    response = c.get("/api/seed-stats/10/convergence")
    assert response.status_code == 400


def test_convergence_not_found(client):
    """无数据：404"""
    c, _, _ = client
    response = c.get("/api/seed-stats/64/convergence")
    assert response.status_code == 404


def test_convergence_stale_data(client):
    """无 m2 字段的旧数据：返回 stale=true"""
    c, _, _ = client
    # 用 _save_stat 写旧格式（无 m2）
    _save_stat(stats_api.storage, 64)
    response = c.get("/api/seed-stats/64/convergence")
    assert response.status_code == 200
    data = response.json()
    assert data["stale"] is True
    assert "message" in data  # 前端可展示提示


def test_start_clears_stats_for_fresh_recompute(client):
    """开始按钮语义：从头开始必须清空 stats.json。
    否则老样本会永久绑定，新数据只是微扰，无法真正从头评估。"""
    import json
    c, mock_popen, _ = client
    # 模拟历史已有统计
    stats_file = Path(stats_api.storage.data_dir) / "stats.json"
    with open(stats_file, "w", encoding="utf-8") as f:
        json.dump({"32": {"star_num": 32, "seed_count": 100, "stars_stats": []}}, f)

    response = c.post("/api/seed-stats/start", json={
        "start_seed_id": 1, "end_seed_id": 100, "batch_size": 1,
    })
    assert response.status_code == 200

    # stats.json 已被清空
    assert not stats_file.exists(), (
        "开始按钮必须清空 stats.json，否则老样本会永久绑定在新均值上"
    )
    # 子进程被启动
    assert mock_popen.call_count == 1


def test_convergence_insufficient_samples(client):
    """seed_count < 2：返回提示"""
    c, _, _ = client
    _save_stats_with_m2(stats_api.storage, 64, seed_count=1)
    response = c.get("/api/seed-stats/64/convergence")
    assert response.status_code == 200
    data = response.json()
    assert data["stale"] is False
    assert data["seed_count"] == 1
    assert data["fields"] == []
    assert "样本数不足" in data["message"]
