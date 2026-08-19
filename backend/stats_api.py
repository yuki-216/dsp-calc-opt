"""
统计API接口
提供统计计算的控制和查询接口

新架构：计算引擎以独立子进程（run_stats_calc.py）运行，对接项目内置
dsp_search_seed.CApi 的 GetDataManager 并发API（GPU加速+多线程）。
本接口负责：
  - 启动/停止/恢复子进程（stop 通过写入 stop.flag 优雅停止）
  - 基于文件（progress.json / runtime.json / stats.json）提供状态与结果
"""

import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from stats_storage import StatsStorage

# 创建路由器
router = APIRouter(prefix="/api/seed-stats", tags=["statistics"])

# 数据目录与脚本路径（与子进程共享同一套文件）
BACKEND_DIR = Path(__file__).resolve().parent
DATA_DIR = str(BACKEND_DIR / "data" / "seed_stats")
RUN_SCRIPT = str(BACKEND_DIR / "run_stats_calc.py")
STOP_FLAG = Path(DATA_DIR) / "stop.flag"

# 初始化存储（读取文件）
storage = StatsStorage(DATA_DIR)

# 本服务启动的子进程句柄（外部也可自行启动，见 runtime.json）
_process: Optional[subprocess.Popen] = None

# 停止子进程的等待上限（秒）
STOP_WAIT_SECONDS = 15


class StartRequest(BaseModel):
    start_seed_id: int = 1
    end_seed_id: int = 99999999
    # batch_size=1：每处理完一个种子（33 个星系）就更新一次进度
    batch_size: int = 1


def _python_executable() -> str:
    """返回用于启动子进程的 Python 解释器路径"""
    return sys.executable


def _is_process_alive(pid: Optional[int]) -> bool:
    """检查操作系统进程是否存活（跨平台）"""
    if not pid or pid <= 0:
        return False
    if os.name == "nt":
        try:
            # Windows: 通过 tasklist 或 OpenProcess 探测，这里用子进程查询
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                capture_output=True, text=True, timeout=10,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            return str(pid) in result.stdout
        except Exception:
            return False
    else:
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False


def is_running() -> bool:
    """计算是否在运行：优先查 runtime.json 的 PID 存活状态"""
    global _process

    # 本服务管理的子进程句柄仍活跃
    if _process is not None:
        if _process.poll() is None:
            return True
        _process = None

    # 回退检查 runtime.json（子进程可能由外部启动或主服务重启后遗留）
    runtime = storage.load_runtime()
    if runtime is not None and _is_process_alive(runtime.get("pid")):
        return True

    return False


def _spawn(args: list):
    """启动计算子进程，不阻塞主线程"""
    global _process
    _process = subprocess.Popen(
        [_python_executable(), RUN_SCRIPT] + args,
        cwd=BACKEND_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


@router.post("/start")
async def start_calculation(request: StartRequest):
    """启动统计计算（从头开始：清空进度 + 清空已有均值）

    "开始"按钮语义：从零重新计算，旧样本不能保留——否则 Welford 运行均值会被
    老的几个种子永久绑定（高权重），新数据无法"真正从头"评估。
    若要保留均值继续累加，请用"恢复"按钮。
    """
    if is_running():
        return {"task_id": "existing", "message": "计算已在运行中"}

    # 校验范围
    if request.start_seed_id < 0 or request.end_seed_id > 99999999:
        raise HTTPException(status_code=400, detail="种子范围必须在0-99999999")
    if request.end_seed_id < request.start_seed_id:
        raise HTTPException(status_code=400, detail="结束种子必须不小于起始种子")
    if request.batch_size <= 0:
        raise HTTPException(status_code=400, detail="批次必须为正数")

    # 清理旧停止标志，避免新计算立即被停止
    if STOP_FLAG.exists():
        STOP_FLAG.unlink()

    # 清空 stats.json（连同已计算的运行均值一起丢弃）
    # 不清空的话，老样本会永久绑定在新均值上，新数据只能微扰
    stats_file = Path(DATA_DIR) / "stats.json"
    if stats_file.exists():
        stats_file.unlink()

    # 重置 progress.json
    storage.save_progress(
        completed_seed_id=0,
        seed_count=0,
        batch_size=request.batch_size,
        start_seed_id=request.start_seed_id,
        end_seed_id=request.end_seed_id,
    )

    _spawn([
        "--start", str(request.start_seed_id),
        "--end", str(request.end_seed_id),
        "--batch", str(request.batch_size),
    ])
    return {"task_id": "new", "message": "计算已从头开始"}


@router.post("/stop")
async def stop_calculation():
    """停止统计计算（写入 stop.flag 优雅停止子进程）"""
    if not is_running():
        return {"message": "计算未在运行"}

    # 写入停止标志，子进程在批次间隙检测
    STOP_FLAG.write_text("1", encoding="utf-8")

    # 等待子进程优雅退出，超时再强制终止
    if _process is not None:
        try:
            _process.wait(timeout=STOP_WAIT_SECONDS)
        except subprocess.TimeoutExpired:
            try:
                _process.terminate()
                _process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _process.kill()
                _process.wait(timeout=2)

    # 清理停止标志与运行时标记
    if STOP_FLAG.exists():
        STOP_FLAG.unlink()
    storage.clear_runtime()
    return {"message": "计算已停止"}


@router.post("/resume")
async def resume_calculation():
    """恢复统计计算（从 progress.json 的 completed_seed_id 继续）"""
    if is_running():
        return {"message": "计算已在运行中"}

    progress = storage.load_progress()
    if progress is None or progress.get("completed_seed_id", 0) <= 0:
        return {"message": "没有可恢复的进度"}

    if STOP_FLAG.exists():
        STOP_FLAG.unlink()

    _spawn([])  # 不传 --start，子进程自动从 progress 恢复
    return {"message": "计算已恢复"}


@router.get("/status")
async def get_status():
    """获取计算状态（基于文件 + 子进程存活检测）"""
    progress = storage.load_progress() or {}
    runtime = storage.load_runtime()

    running = is_running()
    start_seed_id = runtime.get("start_seed_id", 1) if runtime else 1
    end_seed_id = progress.get("end_seed_id", 99999999)
    completed_seed_id = progress.get("completed_seed_id", 0)

    total_seeds = end_seed_id - start_seed_id + 1
    processed = max(0, completed_seed_id - start_seed_id + 1)
    elapsed_time = 0.0
    if runtime and running:
        elapsed_time = time.time() - runtime.get("start_time", 0)

    return {
        "is_running": running,
        "current_seed_id": completed_seed_id,
        "total_seeds": total_seeds,
        "seed_count": progress.get("seed_count", 0),
        "batch_size": progress.get("batch_size", 100),
        "start_seed_id": start_seed_id,
        "end_seed_id": end_seed_id,
        "progress_percent": (processed / total_seeds * 100) if total_seeds > 0 else 0,
        "elapsed_time": _format_time(elapsed_time)
    }


@router.get("/{star_num}/convergence")
async def get_convergence(star_num: int):
    """获取指定恒星数量的收敛信息（基于 Welford M2 计算的 CI）。

    返回结构：get_convergence() 的标准输出 + stale 标记。
    - stale=true 表示该数据来自旧版（无 m2 字段），无法计算置信区间
    - seed_count<2 时 fields 为空
    """
    if star_num < 32 or star_num > 64:
        raise HTTPException(status_code=400, detail="恒星数量必须在32-64之间")

    stats_data = storage.load_stats(star_num)
    if stats_data is None:
        raise HTTPException(status_code=404, detail=f"没有{star_num}恒星的统计数据")

    # 检测旧版数据（无 m2 字段）：明确告知前端需重跑
    stars_stats = stats_data.get("stars_stats", [])
    has_m2 = bool(stars_stats) and all(
        "m2_distance" in s for s in stars_stats
    )

    if not has_m2:
        return {
            "stale": True,
            "seed_count": stats_data.get("seed_count", 0),
            "fields": [],
            "message": "数据无 m2 字段（来自旧版本），无法计算置信区间，请重新运行统计",
        }

    # 复用 load_all_stats 的字段映射构造 RunningAverageCalculator，
    # 然后调用 get_convergence() 计算 CI
    calc = storage.load_all_stats()
    conv = calc.get_convergence(star_num, confidence=0.95)
    if conv is None:
        # seed_count < 2 时 get_convergence 返回 None
        return {
            "stale": False,
            "seed_count": stats_data.get("seed_count", 0),
            "fields": [],
            "message": "样本数不足（<2），无法估计方差",
        }
    conv["stale"] = False
    return conv


@router.get("/overview")
async def get_overview():
    """获取所有恒星数量的统计概览（定义在 /{star_num} 之前避免路由冲突）"""
    stats = []
    for star_num in range(32, 65):
        star_stats = storage.load_stats(star_num)
        if star_stats is not None:
            stats.append({
                "star_num": star_num,
                "seed_count": star_stats.get("seed_count", 0)
            })

    return {"stats": stats}


@router.get("/{star_num}")
async def get_stats(star_num: int):
    """获取指定恒星数量的统计结果"""
    if star_num < 32 or star_num > 64:
        raise HTTPException(status_code=400, detail="恒星数量必须在32-64之间")

    stats = storage.load_stats(star_num)
    if stats is None:
        raise HTTPException(status_code=404, detail=f"没有{star_num}恒星的统计数据")

    return stats


def _format_time(seconds: float) -> str:
    """格式化时间"""
    if seconds < 60:
        return f"{seconds:.0f}秒"
    elif seconds < 3600:
        minutes = seconds / 60
        return f"{minutes:.0f}分钟"
    else:
        hours = seconds / 3600
        return f"{hours:.1f}小时"
