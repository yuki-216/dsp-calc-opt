"""
运行均值计算器（含 Welford online algorithm 计算方差与置信区间）

Welford 算法：边算均值边算方差，每样本 O(1) 更新，无需保留历史。
均值公式:  M_n = M_{n-1} + (x_n - M_{n-1}) / n
M2  公式:  S_n = S_{n-1} + (x_n - M_{n-1}) × (x_n - M_n)
样本方差:  var = S_n / (n - 1)
标准误:    SE = √var / √n
CI 半宽:    z × SE  （z=1.96 对应 95%）
相对误差:   CI 半宽 / |mean|
"""

import math
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any


# 双侧置信度对应的 z 值
_Z_SCORES = {
    0.90: 1.645,
    0.95: 1.96,
    0.99: 2.576,
}

# 源项目 veins_* 始终是 14 项数组；可燃冰索引 7 不参与统计。
EXCLUDED_VEIN_INDICES = frozenset({7})


def _welford_update(old_avg: float, old_m2: float, new_val: float, count: int):
    """单标量 Welford 更新。返回 (new_avg, new_m2)。"""
    new_avg = old_avg + (new_val - old_avg) / count
    new_m2 = old_m2 + (new_val - old_avg) * (new_val - new_avg)
    return new_avg, new_m2


def _welford_update_list(old_avgs, old_m2s, new_vals, count):
    """向量 Welford 更新：每个元素独立计算。"""
    new_avgs = []
    new_m2s = []
    for i in range(len(new_vals)):
        if i in EXCLUDED_VEIN_INDICES:
            new_avgs.append(0.0)
            new_m2s.append(0.0)
            continue
        na, nm2 = _welford_update(old_avgs[i], old_m2s[i], new_vals[i], count)
        new_avgs.append(na)
        new_m2s.append(nm2)
    return new_avgs, new_m2s


def _ci_info(mean: float, m2: float, n: int, z: float) -> Dict[str, Any]:
    """单标量的置信区间信息。

    返回 JSON 友好的字段：mean ≈ 0 时 relative_error 用 None（前端展示 N/A），
    避免 JSON 序列化时 inf 报错。
    边界处理：
      - n < 2: 样本不足 → relative_error=None
      - m2 ≤ 0: 无变异 → 若 mean=0 给 None，否则给 0.0（完美收敛）
      - 否则: 标准计算
    """
    if n < 2:
        return {
            "mean": float(mean),
            "std": 0.0,
            "se": 0.0,
            "ci_half": 0.0,
            "relative_error": None,
        }
    if m2 <= 0:
        # 无变异：相对误差无意义（mean=0）或为 0（完美收敛）
        rel_err: Any = None if mean == 0 else 0.0
        return {
            "mean": float(mean),
            "std": 0.0,
            "se": 0.0,
            "ci_half": 0.0,
            "relative_error": rel_err,
        }
    var = m2 / (n - 1)
    std = math.sqrt(var)
    se = std / math.sqrt(n)
    ci_half = z * se
    # mean ≈ 0 时相对误差无意义（除以 0），用 None 表示
    if mean == 0:
        rel_err = None
    else:
        rel_err = ci_half / abs(mean)
    return {
        "mean": float(mean),
        "std": std,
        "se": se,
        "ci_half": ci_half,
        "relative_error": rel_err,
    }


@dataclass
class StarStats:
    """单个恒星位置的统计（均值 + M2）。"""

    # 1 个标量字段（dyson_radius / dyson_lumino 已删除：与种子距离强相关，留给单种子查询）
    avg_distance: float = 0.0
    m2_distance: float = 0.0

    # 14 个 veins_point
    avg_veins_point: List[float] = field(default_factory=lambda: [0.0] * 14)
    m2_veins_point: List[float] = field(default_factory=lambda: [0.0] * 14)

    # 14 个 veins_amount
    avg_veins_amount: List[float] = field(default_factory=lambda: [0.0] * 14)
    m2_veins_amount: List[float] = field(default_factory=lambda: [0.0] * 14)

    # liquid 和 gas_veins 已删除：无限资源/气体不参与统计

    def update(self, star, count: int):
        """Welford online 更新：均值与 M2 同步滚动。"""
        if count <= 0:
            return

        # 标量字段（dyson_radius / dyson_lumino 已删除）
        self.avg_distance, self.m2_distance = _welford_update(
            self.avg_distance, self.m2_distance, star.distance, count
        )

        # 数组字段（已移除 liquid）
        self.avg_veins_point, self.m2_veins_point = _welford_update_list(
            self.avg_veins_point, self.m2_veins_point, star.veins_point, count
        )
        self.avg_veins_amount, self.m2_veins_amount = _welford_update_list(
            self.avg_veins_amount, self.m2_veins_amount, star.veins_amount, count
        )

    # 各字段方差便捷访问（避免外部代码直接读 m2_*）
    def variance_distance(self, n: int) -> float:
        return self.m2_distance / (n - 1) if n > 1 else 0.0

    def variance_veins_point(self, i: int, n: int) -> float:
        return self.m2_veins_point[i] / (n - 1) if n > 1 else 0.0

    def variance_veins_amount(self, i: int, n: int) -> float:
        return self.m2_veins_amount[i] / (n - 1) if n > 1 else 0.0

@dataclass
class StarNumStats:
    """每个恒星数量组的统计结果"""

    star_num: int
    seed_count: int = 0
    stars_stats: List[StarStats] = field(default_factory=list)
    # 星区汇总：每个种子对所有恒星位置求和后的 Welford 跟踪
    # 直接测得 Σ X_i 的均值与方差，不依赖"各恒星独立"假设
    summary_avg: Dict[str, List[float]] = field(default_factory=dict)
    summary_m2: Dict[str, List[float]] = field(default_factory=dict)

    def __post_init__(self):
        if not self.stars_stats:
            self.stars_stats = [StarStats() for _ in range(self.star_num)]
        # 汇总 Welford 初始化（每字段一个列表）
        for name, length in [("veins_point", 14), ("veins_amount", 14)]:
            self.summary_avg.setdefault(name, [0.0] * length)
            self.summary_m2.setdefault(name, [0.0] * length)

    def process_galaxy(self, galaxy):
        """处理单个星系数据：更新每恒星 Welford + 同步更新星区汇总 Welford。"""
        sorted_stars = sorted(galaxy.stars, key=lambda s: s.distance)
        n = self.seed_count + 1  # 本次处理后的样本数

        for i, star in enumerate(sorted_stars):
            self.stars_stats[i].update(star, n)

        # 计算本星系汇总 Σ X_i，并更新汇总 Welford
        for name, attr in [
            ("veins_point", "veins_point"),
            ("veins_amount", "veins_amount"),
        ]:
            # 注意：必须复制列表！如果 sums = self.summary_avg[name]，后续 sums[j]=0
            # 会同时修改 self.summary_avg，破坏 Welford 历史
            length = len(self.summary_avg[name])
            sums = [0.0] * length
            for star in sorted_stars:
                vals = getattr(star, attr)
                for j in range(length):
                    sums[j] += vals[j]
            for j in range(length):
                if j in EXCLUDED_VEIN_INDICES:
                    self.summary_avg[name][j] = 0.0
                    self.summary_m2[name][j] = 0.0
                    continue
                new_avg, new_m2 = _welford_update(
                    self.summary_avg[name][j],
                    self.summary_m2[name][j],
                    sums[j], n,
                )
                self.summary_avg[name][j] = new_avg
                self.summary_m2[name][j] = new_m2

        self.seed_count += 1


class RunningAverageCalculator:
    """运行均值计算器（Welford 版）。"""

    def __init__(self):
        self.stats = {}
        for star_num in range(32, 65):
            self.stats[star_num] = StarNumStats(star_num=star_num)

    def process_galaxy(self, galaxy):
        star_num = galaxy.star_num
        if 32 <= star_num <= 64:
            self.stats[star_num].process_galaxy(galaxy)

    def get_stats(self, star_num: int) -> Optional[StarNumStats]:
        return self.stats.get(star_num)

    def get_all_stats(self) -> dict:
        return self.stats.copy()

    def get_convergence(self, star_num: int, confidence: float = 0.95) -> Optional[Dict[str, Any]]:
        """返回指定恒星数的所有 (位置 × 字段) 收敛信息。

        样本数 < 2 时返回 None（无法估计方差）。

        返回结构：
        {
            "seed_count": N,
            "confidence": 0.95,
            "fields": [
        {  # 位置 0
                    "distance":    {"mean":.., "std":.., "se":.., "ci_half":.., "relative_error":..},
                    "veins_point":  [{"mean":.., ...}, ...14],
                    "veins_amount": [...14],
                },
                ...位置 1..star_num-1
            ]
        }
        """
        stats = self.stats.get(star_num)
        if stats is None or stats.seed_count < 2:
            return None

        n = stats.seed_count
        z = _Z_SCORES.get(confidence, 1.96)

        result = {
            "seed_count": n,
            "confidence": confidence,
            "fields": [],
            # 星区汇总：每个种子对所有恒星位置求和的真实 Welford CI
            # 不依赖"各恒星独立"假设（避免低估真实方差）
            "galaxy_summary": {},
        }

        # 计算汇总 CI（每个矿脉类型一个 CI 信息）
        for name, length in [("veins_point", 14), ("veins_amount", 14)]:
            result["galaxy_summary"][name] = [
                _ci_info(stats.summary_avg[name][i], stats.summary_m2[name][i], n, z)
                for i in range(length)
            ]

        for pos_stat in stats.stars_stats:
            pos_info = {}

            for field_name, avg_attr, m2_attr in [
                ("distance", "avg_distance", "m2_distance"),
            ]:
                pos_info[field_name] = _ci_info(
                    getattr(pos_stat, avg_attr),
                    getattr(pos_stat, m2_attr),
                    n, z,
                )

            for field_name, avg_attr, m2_attr, length in [
                ("veins_point", "avg_veins_point", "m2_veins_point", 14),
                ("veins_amount", "avg_veins_amount", "m2_veins_amount", 14),
            ]:
                avgs = getattr(pos_stat, avg_attr)
                m2s = getattr(pos_stat, m2_attr)
                pos_info[field_name] = [
                    _ci_info(avgs[i], m2s[i], n, z)
                    if i not in EXCLUDED_VEIN_INDICES
                    else _ci_info(0.0, 0.0, n, z)
                    for i in range(length)
                ]

            result["fields"].append(pos_info)

        return result

    def is_all_fields_converged(
        self, star_num: int, relative_error_threshold: float = 0.03
    ) -> bool:
        """判断指定恒星数下所有 (位置 × 字段) 是否都满足相对 CI 半宽 < 阈值。

        仅供前端展示使用，不作为停止计算的依据——见 is_galaxy_summary_converged。

        relative_error 为 None（mean ≈ 0 时无意义）→ 视为未收敛。
        """
        conv = self.get_convergence(star_num)
        if conv is None:
            return False

        for pos_info in conv["fields"]:
            for field_name in ("distance",):
                rel_err = pos_info[field_name]["relative_error"]
                if rel_err is None or rel_err >= relative_error_threshold:
                    return False
            for field_name in ("veins_point", "veins_amount"):
                for index, item in enumerate(pos_info[field_name]):
                    if index in EXCLUDED_VEIN_INDICES:
                        continue
                    rel_err = item["relative_error"]
                    if rel_err is None or rel_err >= relative_error_threshold:
                        return False
        return True

    def is_galaxy_summary_converged(
        self, star_num: int, relative_error_threshold: float = 0.03
    ) -> bool:
        """判断指定恒星数的"星区汇总"（每个种子 Σ X_i）所有字段是否都收敛。

        这是计算自动停止的依据——只用真实测得的 galaxy_summary CI，
        不依赖"各恒星独立"假设，也不检查每个恒星位置的 CI。

        - mean ≈ 0（None）时视为未收敛
        - 任意一项 ≥ 阈值即未收敛
        """
        stats = self.stats.get(star_num)
        if stats is None or stats.seed_count < 2:
            return False

        n = stats.seed_count
        z = _Z_SCORES.get(0.95, 1.96)

        for name, length in [("veins_point", 14), ("veins_amount", 14)]:
            for i in range(length):
                if i in EXCLUDED_VEIN_INDICES:
                    continue
                info = _ci_info(stats.summary_avg[name][i], stats.summary_m2[name][i], n, z)
                if info["relative_error"] is None or info["relative_error"] >= relative_error_threshold:
                    return False
        return True

    def is_all_galaxy_summaries_converged(
        self, relative_error_threshold: float = 0.03
    ) -> bool:
        """所有 33 个 star_num 的星区汇总都收敛。

        这是计算自动停止的总体判断——任一 star_num 未收敛都返回 False。
        """
        for star_num in range(32, 65):
            if not self.is_galaxy_summary_converged(star_num, relative_error_threshold):
                return False
        return True
