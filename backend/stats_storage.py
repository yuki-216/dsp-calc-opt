"""
统计数据存储
用于保存和加载统计结果和进度

新版存储格式（合并为单文件 + Welford M2）：
  - progress.json   : 进度（每 batch_size 个种子提交一次）
  - stats.json      : 所有 star_num (32-64) 的运行均值 + M2 + 收敛标记
                      key 为 star_num 字符串，value 含 stars_stats 列表
  - runtime.json    : 运行标记（PID/起止范围），结束或停止时清除
  - stop.flag       : 停止信号（主服务写入，本进程在批次间隙检查）
  - verification/   : verify_stats.py 验证数据

升级路径：
  - 旧版 stats_*.json（每 star_num 一个文件）→ 自动合并到 stats.json，
    因不含 m2_* 字段，全部加 stale=true，前端提示"无方差，需重跑"
  - 当前 progress.json 默认 batch_size=1（旧默认 100/1000 视作历史遗留）
"""

import glob
import json
import os
from typing import Optional, Dict, Any, List

from stats_calculator import EXCLUDED_VEIN_INDICES, RunningAverageCalculator, StarNumStats, StarStats


STATS_FILENAME = "stats.json"

# m2_* 字段集合：用于检测旧版 stats 文件（没有 m2 字段）并标记为 stale
_M2_FIELDS = (
    "m2_distance",
    "m2_veins_point", "m2_veins_amount",
)


def _star_stats_to_dict(stats: StarNumStats) -> Dict[str, Any]:
    """将StarNumStats转换为字典（含 m2_* 字段，供 Welford 后续恢复方差）"""
    def clean_values(values):
        result = list(values)
        for index in EXCLUDED_VEIN_INDICES:
            if index < len(result):
                result[index] = 0.0
        return result

    return {
        "star_num": stats.star_num,
        "seed_count": stats.seed_count,
        "stars_stats": [
            {
                "avg_distance": star.avg_distance,
                "m2_distance": star.m2_distance,
                # dyson_radius / dyson_lumino 已删除（与种子距离强相关，留给单种子查询）
                "avg_veins_point": clean_values(star.avg_veins_point),
                "m2_veins_point": clean_values(star.m2_veins_point),
                "avg_veins_amount": clean_values(star.avg_veins_amount),
                "m2_veins_amount": clean_values(star.m2_veins_amount),
                # liquid / gas_veins 已删除：统计无意义
            }
            for star in stats.stars_stats
        ],
        # 星区汇总（每个种子 Σ across positions）的 Welford——真实测得，不依赖独立性假设
        "summary_avg": {k: clean_values(v) for k, v in stats.summary_avg.items()},
        "summary_m2": {k: clean_values(v) for k, v in stats.summary_m2.items()},
    }


def _has_m2_fields(star_data: Dict[str, Any]) -> bool:
    """检测 star_data 是否含 m2_* 字段（区分新旧格式）"""
    stars_stats = star_data.get("stars_stats", [])
    if not stars_stats:
        return False
    return all(m2_field in stars_stats[0] for m2_field in _M2_FIELDS)


def _migrate_legacy_stats(data_dir: str) -> Optional[Dict[str, Any]]:
    """
    一次性迁移旧版 stats_*.json 到新版 stats.json。

    旧版不含 m2_* 字段，无法计算方差/置信区间，故对每个迁移项打 stale=true 标记。
    前端见到 stale=true 时应提示用户："该数据无 m2，需要重跑才能看置信区间"。
    """
    stats_file = os.path.join(data_dir, STATS_FILENAME)
    if os.path.exists(stats_file):
        return None  # 已是新版，无需迁移

    legacy_pattern = os.path.join(data_dir, "stats_*.json")
    legacy_files = sorted(glob.glob(legacy_pattern))
    if not legacy_files:
        return None  # 没有旧文件，无需迁移

    merged: Dict[str, Any] = {}
    for path in legacy_files:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        star_num = data.get("star_num")
        if star_num is None:
            try:
                star_num = int(os.path.basename(path).split("_")[1].split(".")[0])
            except (IndexError, ValueError):
                continue
        # 旧版没有 m2_*，强制打 stale
        data["stale"] = True
        merged[str(star_num)] = data
        os.remove(path)

    if merged:
        with open(stats_file, "w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
        return merged
    return None


class StatsStorage:
    """统计数据存储"""

    def __init__(self, data_dir: str = "data/seed_stats"):
        self.data_dir = data_dir
        os.makedirs(data_dir, exist_ok=True)

        # 一次性迁移旧格式 stats_*.json → stats.json
        _migrate_legacy_stats(data_dir)

        # 初始化进度文件：默认 batch_size=1（每处理完一个种子就更新进度）
        progress_file = os.path.join(data_dir, "progress.json")
        if not os.path.exists(progress_file):
            self._save_json(progress_file, {
                "completed_seed_id": 0,
                "seed_count": 0,
                "batch_size": 1,
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

    def _load_all_stats_dict(self) -> Dict[str, Any]:
        """读取 stats.json 完整字典；不存在则返回空 dict。"""
        stats_file = os.path.join(self.data_dir, STATS_FILENAME)
        data = self._load_json(stats_file)
        if not isinstance(data, dict):
            return {}
        return data

    def save_stats(self, calculator: RunningAverageCalculator):
        """保存统计结果（单文件 stats.json，仅写有数据的 star_num）"""
        merged: Dict[str, Any] = {}
        for star_num, stats in calculator.stats.items():
            if stats.seed_count > 0:
                merged[str(star_num)] = _star_stats_to_dict(stats)
        stats_file = os.path.join(self.data_dir, STATS_FILENAME)
        self._save_json(stats_file, merged)

    def load_stats(self, star_num: int) -> Optional[Dict[str, Any]]:
        """加载指定恒星数量的统计结果（从单文件 stats.json 中按 key 取出）"""
        data = self._load_all_stats_dict()
        stats = data.get(str(star_num))
        if stats is None:
            return None

        # 兼容旧 stats.json：API 读取时也不再暴露已经移除的气体/液体字段。
        result = dict(stats)
        def clean_values(values):
            cleaned = list(values)
            for index in EXCLUDED_VEIN_INDICES:
                if index < len(cleaned):
                    cleaned[index] = 0.0
            return cleaned

        result["stars_stats"] = [
            {
                key: value
                for key, value in item.items()
                if key not in {
                    "avg_gas_veins", "m2_gas_veins",
                    "avg_liquid", "m2_liquid",
                }
            }
            for item in stats.get("stars_stats", [])
        ]
        for item in result["stars_stats"]:
            for key in ("avg_veins_point", "m2_veins_point", "avg_veins_amount", "m2_veins_amount"):
                if key in item:
                    item[key] = clean_values(item[key])
        for summary_key in ("summary_avg", "summary_m2"):
            result[summary_key] = {
                key: clean_values(value)
                for key, value in stats.get(summary_key, {}).items()
                if key not in {"gas_veins", "liquid"}
            }
        return result

    def load_all_stats(self) -> RunningAverageCalculator:
        """从存储加载所有统计结果，恢复一个完整的 RunningAverageCalculator。
        旧版（无 m2）数据保留均值但 m2 全为 0，配合 stale 标记让前端提示用户重跑。
        """
        calculator = RunningAverageCalculator()
        data = self._load_all_stats_dict()
        for star_num_key, star_data in data.items():
            try:
                star_num = int(star_num_key)
            except ValueError:
                continue
            if star_num not in calculator.stats:
                continue
            stats = calculator.stats[star_num]
            stats.seed_count = star_data.get("seed_count", 0)
            # 加载星区汇总 Welford（老数据无此字段 → 默认全 0，前端会提示"需重跑"）
            summary_avg_loaded = star_data.get("summary_avg", {})
            summary_m2_loaded = star_data.get("summary_m2", {})
            for name, length in [("veins_point", 14), ("veins_amount", 14)]:
                avg_list = list(summary_avg_loaded.get(name, [0.0] * length))
                m2_list = list(summary_m2_loaded.get(name, [0.0] * length))
                while len(avg_list) < length: avg_list.append(0.0)
                while len(m2_list) < length: m2_list.append(0.0)
                stats.summary_avg[name] = avg_list[:length]
                stats.summary_m2[name] = m2_list[:length]
                for index in EXCLUDED_VEIN_INDICES:
                    stats.summary_avg[name][index] = 0.0
                    stats.summary_m2[name][index] = 0.0
            has_m2 = _has_m2_fields(star_data)
            loaded_stars = star_data.get("stars_stats", [])
            for i, star_data_item in enumerate(loaded_stars):
                if i < len(stats.stars_stats):
                    s = stats.stars_stats[i]
                    s.avg_distance = star_data_item.get("avg_distance", 0.0)
                    s.m2_distance = star_data_item.get("m2_distance", 0.0) if has_m2 else 0.0
                    # dyson_radius / dyson_lumino 已删除：老 stats.json 若含此字段会被忽略
                    s.avg_veins_point = star_data_item.get("avg_veins_point", [0.0] * 14)
                    s.m2_veins_point = star_data_item.get("m2_veins_point", [0.0] * 14) if has_m2 else [0.0] * 14
                    s.avg_veins_amount = star_data_item.get("avg_veins_amount", [0.0] * 14)
                    s.m2_veins_amount = star_data_item.get("m2_veins_amount", [0.0] * 14) if has_m2 else [0.0] * 14
                    for index in EXCLUDED_VEIN_INDICES:
                        s.avg_veins_point[index] = 0.0
                        s.m2_veins_point[index] = 0.0
                        s.avg_veins_amount[index] = 0.0
                        s.m2_veins_amount[index] = 0.0
                    # liquid / gas_veins 已删除：老 stats.json 若含这些字段会被忽略
        return calculator

    def save_runtime(self, runtime: Dict[str, Any]):
        """保存运行时标记（子进程PID、起止范围等）"""
        runtime_file = os.path.join(self.data_dir, "runtime.json")
        self._save_json(runtime_file, runtime)

    def load_runtime(self) -> Optional[Dict[str, Any]]:
        """加载运行时标记"""
        runtime_file = os.path.join(self.data_dir, "runtime.json")
        return self._load_json(runtime_file)

    def clear_runtime(self):
        """清除运行时标记"""
        runtime_file = os.path.join(self.data_dir, "runtime.json")
        if os.path.exists(runtime_file):
            os.remove(runtime_file)

    def save_verification_data(self, simple_avg: Dict, running_avg: Dict,
                              comparison: Dict):
        """保存验证数据"""
        verification_dir = os.path.join(self.data_dir, "verification")
        os.makedirs(verification_dir, exist_ok=True)

        self._save_json(os.path.join(verification_dir, "simple_avg.json"), simple_avg)
        self._save_json(os.path.join(verification_dir, "running_avg.json"), running_avg)
        self._save_json(os.path.join(verification_dir, "comparison.json"), comparison)
