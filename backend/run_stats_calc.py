"""
统计计算子进程入口

由后端API通过 subprocess 启动，负责执行批量统计计算。
与主服务通过文件通信：
  - progress.json  : 进度（整批提交）
  - stats_*.json   : 各组运行均值结果
  - runtime.json   : 运行标记（PID/起止范围），结束或停止时清除
  - stop.flag      : 停止信号（主服务写入，本进程在批次间隙检查）

用法：
    python run_stats_calc.py [--start N] [--end M] [--batch B]
    不传 --start 时读取 progress.json 自动恢复（resume 模式）
"""

import argparse
import os
import sys
import time
from pathlib import Path

# 切换到脚本所在目录，保证数据目录路径一致
BACKEND_DIR = Path(__file__).resolve().parent
os.chdir(BACKEND_DIR)
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from batch_calculator import BatchCalculator
from stats_storage import StatsStorage

DEFAULT_DATA_DIR = str(BACKEND_DIR / "data" / "seed_stats")


def write_runtime(storage: StatsStorage, start_seed: int, end_seed: int, batch_size: int):
    """写入运行标记，供主服务识别当前运行的子进程"""
    storage.save_runtime({
        "pid": os.getpid(),
        "start_time": time.time(),
        "start_seed_id": start_seed,
        "end_seed_id": end_seed,
        "batch_size": batch_size,
    })


def main() -> int:
    parser = argparse.ArgumentParser(description="种子统计计算子进程")
    parser.add_argument("--data-dir", default=DEFAULT_DATA_DIR,
                        help="数据目录（默认 backend/data/seed_stats）")
    parser.add_argument("--start", type=int, default=None,
                        help="起始种子ID；不传则从 progress.json 恢复")
    parser.add_argument("--end", type=int, default=99999999)
    parser.add_argument("--batch", type=int, default=100)
    args = parser.parse_args()

    data_dir = args.data_dir
    stop_flag = Path(data_dir) / "stop.flag"

    storage = StatsStorage(data_dir)

    # 清理旧的停止标志
    if stop_flag.exists():
        stop_flag.unlink()

    calc = BatchCalculator(storage)
    calc.set_stop_flag(stop_flag)

    if args.start is None:
        # resume 模式
        progress = storage.load_progress()
        if progress is None or progress.get("completed_seed_id", 0) <= 0:
            print("没有可恢复的进度，请通过 --start 指定起始种子")
            return 1
        start_seed = progress["completed_seed_id"] + 1
        end_seed = progress["end_seed_id"]
        batch_size = progress["batch_size"]
        write_runtime(storage, start_seed, end_seed, batch_size)
        calc.resume()
    else:
        if args.end < args.start or args.batch <= 0:
            print("参数无效：end >= start 且 batch > 0")
            return 1
        write_runtime(storage, args.start, args.end, args.batch)
        calc.start(args.start, args.end, args.batch)

    # 等待计算线程结束（完成或收到停止信号），然后清理运行标记
    if calc._thread is not None:
        calc._thread.join()
    storage.clear_runtime()
    return 0


if __name__ == "__main__":
    sys.exit(main())