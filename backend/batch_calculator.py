"""
批量计算引擎
用于批量计算种子并更新运行均值

新架构：核心计算对接源项目 dsp_search_seed 的 GetDataManager 并发API。
源项目已做GPU加速和多线程优化，GetDataManager 以 max_thread 个线程并行处理
N 个种子（每个种子内部单线程生成完整 galaxy 数据，含矿脉/行星/卫星）。
本类保留批处理与进度管理逻辑，仅替换核心计算调用。
"""

import os
import sys
import threading
import time
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple

# 添加原项目的CApi路径
SEED_VIEWER_PATH = Path("D:/编程/种子查看器")
sys.path.insert(0, str(SEED_VIEWER_PATH))

# 导入原项目的C API
from dsp_search_seed.CApi.search_seed import (
    do_init_c,
    get_galaxy_data_c,  # 保留用于单点查询
    GetDataManager,
    Seed,
)

from stats_calculator import RunningAverageCalculator
from stats_storage import StatsStorage


class BatchCalculator:
    """批量计算器"""

    def __init__(self, storage: StatsStorage):
        self.storage = storage
        self.calculator = RunningAverageCalculator()
        self.is_running = False
        self.should_stop = False
        self.batch_size = 100
        self.current_seed_id = 0
        self.total_seeds = 0
        self.start_time = 0
        self._start_seed_id = 0
        self._thread: Optional[threading.Thread] = None
        self.stop_flag: Optional[Path] = None
        # 并发线程数：沿用源项目GUI的 cpu_count()-1 策略（clamp到[1,128]由C++内部处理）
        self.max_thread = max(1, (os.cpu_count() or 4) - 1)

        # 初始化C库
        do_init_c()

    def set_stop_flag(self, path: Optional[Path]):
        """设置停止信号文件路径（供外部子进程方式停止）"""
        self.stop_flag = path

    def _should_stop(self) -> bool:
        """检查是否需要停止：内存标志 或 停止文件"""
        if self.should_stop:
            return True
        if self.stop_flag is not None and self.stop_flag.exists():
            return True
        return False

    def start(self, start_seed_id: int = 1, end_seed_id: int = 99999999,
              batch_size: int = 100):
        """启动计算（异步线程方式；子进程入口可 join 等待完成）"""
        if self.is_running:
            return

        self.batch_size = batch_size
        self.current_seed_id = start_seed_id
        self._start_seed_id = start_seed_id
        self.total_seeds = end_seed_id - start_seed_id + 1
        self.start_time = time.time()
        self.should_stop = False
        self.is_running = True

        self._thread = threading.Thread(
            target=self._calculate_loop,
            args=(start_seed_id, end_seed_id),
            daemon=True,
        )
        self._thread.start()

    def resume(self):
        """恢复计算"""
        progress = self.storage.load_progress()
        if progress is None:
            return

        start_seed_id = progress["completed_seed_id"] + 1
        end_seed_id = progress["end_seed_id"]
        batch_size = progress["batch_size"]

        # 从存储恢复之前的统计数据
        self.calculator = self.storage.load_all_stats()

        self.start(start_seed_id, end_seed_id, batch_size)

    def stop(self):
        """停止计算（内存标志）"""
        self.should_stop = True

    def _calculate_loop(self, start_seed_id: int, end_seed_id: int):
        """计算主循环：按批次推进，批次全量完成才落盘"""
        try:
            for batch_start in range(start_seed_id, end_seed_id + 1, self.batch_size):
                # 检查是否需要停止
                if self._should_stop():
                    break

                batch_end = min(batch_start + self.batch_size - 1, end_seed_id)

                # 用 GetDataManager 并发处理这一批；仅整批完成后才提交进度
                completed = self._process_batch(batch_start, batch_end)
                if not completed:
                    # 中途停止或出错：不提交本批（部分数据丢弃，resume 时重算）
                    break

                # 整批完成才更新进度与结果
                self.current_seed_id = batch_end
                self.storage.save_progress(
                    completed_seed_id=batch_end,
                    seed_count=batch_end - start_seed_id + 1,
                    batch_size=self.batch_size,
                    start_seed_id=start_seed_id,
                    end_seed_id=end_seed_id
                )
                self.storage.save_stats(self.calculator)

                # 检查是否需要停止
                if self._should_stop():
                    break

            # 计算完成（或停止）
            self.is_running = False

        except Exception as e:
            self.is_running = False
            print(f"计算异常: {str(e)}")

    def _process_batch(self, batch_start: int, batch_end: int) -> bool:
        """
        使用 GetDataManager 并发处理一批种子。

        任务枚举：batch内每个种子 ×33种恒星数量(32-64) 全部 add_task，
        然后轮询 get_results() 排空结果缓冲（max_cache 背压机制要求定期drain）。

        返回：整批是否完成。中途停止（stop标志/停止文件）或异常返回 False，
        此时调用方不应提交该批进度——部分结果丢弃，resume 时整批重算。
        """
        # 注意：pybind11 绑定只接受位置参数 (max_thread, quick, max_cache)
        manager = GetDataManager(self.max_thread, False, 128)
        try:
            tasks: List[Tuple[int, int]] = []
            for seed_id in range(batch_start, batch_end + 1):
                for star_num in range(32, 65):  # 32-64，共33种
                    manager.add_task(Seed(seed_id, star_num, 0))
                    tasks.append((seed_id, star_num))

            total = len(tasks)
            finished = 0
            while finished < total:
                # 检查是否需要停止
                if self._should_stop():
                    return False
                results = manager.get_results()
                if not results:
                    # 工作线程仍在计算，本批尚未产出任何结果，避免忙等
                    time.sleep(0.05)
                    continue
                for galaxy in results:
                    self.calculator.process_galaxy(galaxy)
                    finished += 1

            return True

        finally:
            # 必须 shutdown：置stop标志并join所有线程
            manager.shutdown()

    def get_status(self) -> Dict[str, Any]:
        """获取计算状态"""
        elapsed_time = 0
        if self.start_time > 0:
            elapsed_time = time.time() - self.start_time

        # 计算预计剩余时间
        estimated_remaining = 0
        processed = self.current_seed_id - self._start_seed_id
        if processed > 0 and elapsed_time > 0:
            seeds_per_second = processed / elapsed_time
            remaining_seeds = self.total_seeds - processed
            if seeds_per_second > 0:
                estimated_remaining = remaining_seeds / seeds_per_second

        return {
            "is_running": self.is_running,
            "current_seed_id": self.current_seed_id,
            "total_seeds": self.total_seeds,
            "progress_percent": (processed / self.total_seeds * 100) if self.total_seeds > 0 else 0,
            "elapsed_time": self._format_time(elapsed_time),
            "estimated_remaining": self._format_time(estimated_remaining)
        }

    def _format_time(self, seconds: float) -> str:
        """格式化时间"""
        if seconds < 60:
            return f"{seconds:.0f}秒"
        elif seconds < 3600:
            minutes = seconds / 60
            return f"{minutes:.0f}分钟"
        else:
            hours = seconds / 3600
            return f"{hours:.1f}小时"