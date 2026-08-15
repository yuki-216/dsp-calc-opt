"""
统计数据存储
用于保存和加载统计结果和进度
"""

import json
import os
from typing import Optional, Dict, Any

from stats_calculator import RunningAverageCalculator, StarNumStats


class StatsStorage:
    """统计数据存储"""

    def __init__(self, data_dir: str = "data/seed_stats"):
        self.data_dir = data_dir
        os.makedirs(data_dir, exist_ok=True)

        # 初始化进度文件
        progress_file = os.path.join(data_dir, "progress.json")
        if not os.path.exists(progress_file):
            self._save_json(progress_file, {
                "completed_seed_id": 0,
                "seed_count": 0,
                "batch_size": 100,
                "start_seed_id": 1,
                "end_seed_id": 99999999
            })

    def _save_json(self, file_path: str, data: Any):
        """保存JSON文件"""
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _load_json(self, file_path: str) -> Optional[Any]:
        """加载JSON文件"""
        if not os.path.exists(file_path):
            return None
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def save_progress(self, completed_seed_id: int, seed_count: int,
                     batch_size: int, start_seed_id: int, end_seed_id: int):
        """保存计算进度"""
        progress = {
            "completed_seed_id": completed_seed_id,
            "seed_count": seed_count,
            "batch_size": batch_size,
            "start_seed_id": start_seed_id,
            "end_seed_id": end_seed_id
        }
        progress_file = os.path.join(self.data_dir, "progress.json")
        self._save_json(progress_file, progress)

    def load_progress(self) -> Optional[Dict[str, Any]]:
        """加载计算进度"""
        progress_file = os.path.join(self.data_dir, "progress.json")
        return self._load_json(progress_file)

    def _star_stats_to_dict(self, stats: StarNumStats) -> Dict[str, Any]:
        """将StarNumStats转换为字典"""
        return {
            "star_num": stats.star_num,
            "seed_count": stats.seed_count,
            "stars_stats": [
                {
                    "avg_distance": star.avg_distance,
                    "avg_dyson_radius": star.avg_dyson_radius,
                    "avg_dyson_lumino": star.avg_dyson_lumino,
                    "avg_veins_point": star.avg_veins_point,
                    "avg_veins_amount": star.avg_veins_amount,
                    "avg_gas_veins": star.avg_gas_veins,
                    "avg_liquid": star.avg_liquid
                }
                for star in stats.stars_stats
            ]
        }

    def save_stats(self, calculator: RunningAverageCalculator):
        """保存统计结果"""
        for star_num, stats in calculator.stats.items():
            if stats.seed_count > 0:
                stats_file = os.path.join(self.data_dir, f"stats_{star_num}.json")
                self._save_json(stats_file, self._star_stats_to_dict(stats))

    def load_stats(self, star_num: int) -> Optional[Dict[str, Any]]:
        """加载统计结果"""
        stats_file = os.path.join(self.data_dir, f"stats_{star_num}.json")
        return self._load_json(stats_file)

    def save_verification_data(self, simple_avg: Dict, running_avg: Dict,
                              comparison: Dict):
        """保存验证数据"""
        verification_dir = os.path.join(self.data_dir, "verification")
        os.makedirs(verification_dir, exist_ok=True)

        self._save_json(os.path.join(verification_dir, "simple_avg.json"), simple_avg)
        self._save_json(os.path.join(verification_dir, "running_avg.json"), running_avg)
        self._save_json(os.path.join(verification_dir, "comparison.json"), comparison)
