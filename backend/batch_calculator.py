"""
批量计算引擎
用于批量计算种子并更新运行均值
"""

import sys
import threading
import time
from pathlib import Path
from typing import Optional, Dict, Any

# 添加原项目的CApi路径
SEED_VIEWER_PATH = Path("D:/编程/种子查看器")
sys.path.insert(0, str(SEED_VIEWER_PATH))

# 导入原项目的C API
from dsp_search_seed.CApi.search_seed import (
    do_init_c,
    get_galaxy_data_c,
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

        # 初始化C库
        do_init_c()

    def start(self, start_seed_id: int = 1, end_seed_id: int = 99999999,
              batch_size: int = 100):
        """启动计算"""
        if self.is_running:
            return

        self.batch_size = batch_size
        self.current_seed_id = start_seed_id
        self._start_seed_id = start_seed_id
        self.total_seeds = end_seed_id - start_seed_id + 1
        self.start_time = time.time()
        self.should_stop = False
        self.is_running = True

        # 启动计算线程
        self._thread = threading.Thread(
            target=self._calculate_loop,
            args=(start_seed_id, end_seed_id)
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
        """停止计算"""
        self.should_stop = True

    def _calculate_loop(self, start_seed_id: int, end_seed_id: int):
        """计算主循环"""
        try:
            for batch_start in range(start_seed_id, end_seed_id + 1, self.batch_size):
                # 检查是否需要停止
                if self.should_stop:
                    break

                batch_end = min(batch_start + self.batch_size - 1, end_seed_id)

                # 对每个种子计算所有恒星数量
                for seed_id in range(batch_start, batch_end + 1):
                    if self.should_stop:
                        break
                    for star_num in range(32, 65):  # 32-64，共33种
                        try:
                            seed = Seed(seed_id, star_num, 0)
                            galaxy = get_galaxy_data_c(seed, False)
                            self.calculator.process_galaxy(galaxy)
                        except Exception as e:
                            # 计算错误，暂停并提示
                            self.is_running = False
                            print(f"种子{seed_id}恒星数{star_num}计算失败: {str(e)}")
                            return

                # 更新进度
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
                if self.should_stop:
                    break

            # 计算完成
            self.is_running = False

        except Exception as e:
            self.is_running = False
            print(f"计算异常: {str(e)}")

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
