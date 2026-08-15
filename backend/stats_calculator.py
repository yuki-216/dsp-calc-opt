"""
运行均值计算器
用于计算种子统计的运行均值
"""

from typing import List, Optional
from dataclasses import dataclass, field


@dataclass
class StarStats:
    """单个恒星位置的统计"""
    avg_distance: float = 0.0
    avg_dyson_radius: float = 0.0
    avg_dyson_lumino: float = 0.0
    avg_veins_point: List[float] = field(default_factory=lambda: [0.0] * 14)
    avg_veins_amount: List[float] = field(default_factory=lambda: [0.0] * 14)
    avg_gas_veins: List[float] = field(default_factory=lambda: [0.0] * 3)
    avg_liquid: List[float] = field(default_factory=lambda: [0.0, 0.0])

    def update(self, star, count: int):
        """更新运行均值"""
        if count <= 0:
            return

        # 更新距离
        self.avg_distance += (star.distance - self.avg_distance) / count

        # 更新戴森球半径
        self.avg_dyson_radius += (star.dyson_radius - self.avg_dyson_radius) / count

        # 更新亮度
        self.avg_dyson_lumino += (star.dyson_lumino - self.avg_dyson_lumino) / count

        # 更新矿点数
        for i in range(14):
            self.avg_veins_point[i] += (star.veins_point[i] - self.avg_veins_point[i]) / count

        # 更新矿物数
        for i in range(14):
            self.avg_veins_amount[i] += (star.veins_amount[i] - self.avg_veins_amount[i]) / count

        # 更新气体
        for i in range(3):
            self.avg_gas_veins[i] += (star.gas_veins[i] - self.avg_gas_veins[i]) / count

        # 更新液体
        for i in range(2):
            self.avg_liquid[i] += (star.liquid[i] - self.avg_liquid[i]) / count


@dataclass
class StarNumStats:
    """每个恒星数量组的统计结果"""
    star_num: int
    seed_count: int = 0
    stars_stats: List[StarStats] = field(default_factory=list)

    def __post_init__(self):
        if not self.stars_stats:
            self.stars_stats = [StarStats() for _ in range(self.star_num)]

    def process_galaxy(self, galaxy):
        """处理单个星系数据，更新运行均值"""
        # 按距离排序恒星
        sorted_stars = sorted(galaxy.stars, key=lambda s: s.distance)

        # 更新每个恒星位置的统计
        for i, star in enumerate(sorted_stars):
            self.stars_stats[i].update(star, self.seed_count + 1)

        # 更新种子计数
        self.seed_count += 1


class RunningAverageCalculator:
    """运行均值计算器"""

    def __init__(self):
        # 初始化33种恒星数量的统计
        self.stats = {}
        for star_num in range(32, 65):  # 32-64
            self.stats[star_num] = StarNumStats(star_num=star_num)

    def process_galaxy(self, galaxy):
        """处理单个星系数据"""
        star_num = galaxy.star_num
        if 32 <= star_num <= 64:
            self.stats[star_num].process_galaxy(galaxy)

    def get_stats(self, star_num: int) -> Optional[StarNumStats]:
        """获取指定恒星数量的统计结果"""
        return self.stats.get(star_num)

    def get_all_stats(self) -> dict:
        """获取所有恒星数量的统计结果"""
        return self.stats.copy()
