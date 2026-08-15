# backend/test_stats_calculator.py
import pytest
from stats_calculator import StarStats, StarNumStats, RunningAverageCalculator


def test_star_stats_initialization():
    """测试StarStats初始化"""
    stats = StarStats()
    assert stats.avg_distance == 0.0
    assert stats.avg_dyson_radius == 0.0
    assert stats.avg_dyson_lumino == 0.0
    assert len(stats.avg_veins_point) == 14
    assert len(stats.avg_veins_amount) == 14
    assert len(stats.avg_gas_veins) == 3


def test_star_stats_update():
    """测试StarStats更新"""
    stats = StarStats()

    # 模拟恒星数据
    class MockStar:
        distance = 2.5
        dyson_radius = 1000.0
        dyson_lumino = 1.2
        veins_point = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140]
        veins_amount = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400]
        gas_veins = [1.0, 2.0, 3.0]
        liquid = [1, 2]

    star = MockStar()
    stats.update(star, count=1)

    assert stats.avg_distance == 2.5
    assert stats.avg_dyson_radius == 1000.0
    assert stats.avg_dyson_lumino == 1.2
    assert stats.avg_veins_point[0] == 10
    assert stats.avg_veins_amount[0] == 100
    assert stats.avg_gas_veins[0] == 1.0


def test_star_stats_multiple_updates():
    """测试StarStats多次更新"""
    stats = StarStats()

    class MockStar1:
        distance = 2.0
        dyson_radius = 1000.0
        dyson_lumino = 1.0
        veins_point = [10] * 14
        veins_amount = [100] * 14
        gas_veins = [1.0, 2.0, 3.0]
        liquid = [1, 2]

    class MockStar2:
        distance = 4.0
        dyson_radius = 2000.0
        dyson_lumino = 2.0
        veins_point = [20] * 14
        veins_amount = [200] * 14
        gas_veins = [2.0, 4.0, 6.0]
        liquid = [2, 4]

    stats.update(MockStar1(), count=1)
    stats.update(MockStar2(), count=2)

    # 运行均值: 2.0 + (4.0 - 2.0) / 2 = 3.0
    assert stats.avg_distance == 3.0
    # 运行均值: 1000.0 + (2000.0 - 1000.0) / 2 = 1500.0
    assert stats.avg_dyson_radius == 1500.0
    # 运行均值: 10 + (20 - 10) / 2 = 15
    assert stats.avg_veins_point[0] == 15


def test_star_num_stats_initialization():
    """测试StarNumStats初始化"""
    stats = StarNumStats(star_num=64)
    assert stats.star_num == 64
    assert stats.seed_count == 0
    assert len(stats.stars_stats) == 64


def test_star_num_stats_process_galaxy():
    """测试StarNumStats处理星系数据"""
    stats = StarNumStats(star_num=3)

    class MockStar:
        def __init__(self, distance):
            self.distance = distance
            self.dyson_radius = 1000.0
            self.dyson_lumino = 1.0
            self.veins_point = [10] * 14
            self.veins_amount = [100] * 14
            self.gas_veins = [1.0, 2.0, 3.0]
            self.liquid = [1, 2]

    class MockGalaxy:
        stars = [MockStar(3.0), MockStar(1.0), MockStar(2.0)]

    stats.process_galaxy(MockGalaxy())

    # 按距离排序后: 1.0, 2.0, 3.0
    assert stats.stars_stats[0].avg_distance == 1.0
    assert stats.stars_stats[1].avg_distance == 2.0
    assert stats.stars_stats[2].avg_distance == 3.0
    assert stats.seed_count == 1


def test_running_average_calculator_initialization():
    """测试RunningAverageCalculator初始化"""
    calc = RunningAverageCalculator()
    assert len(calc.stats) == 33  # 32-64
    assert 32 in calc.stats
    assert 64 in calc.stats


def test_running_average_calculator_process_galaxy():
    """测试RunningAverageCalculator处理星系数据"""
    calc = RunningAverageCalculator()

    class MockStar:
        def __init__(self, distance):
            self.distance = distance
            self.dyson_radius = 1000.0
            self.dyson_lumino = 1.0
            self.veins_point = [10] * 14
            self.veins_amount = [100] * 14
            self.gas_veins = [1.0, 2.0, 3.0]
            self.liquid = [1, 2]

    class MockGalaxy:
        def __init__(self, star_num):
            self.star_num = star_num
            self.stars = [MockStar(float(i)) for i in range(star_num)]

    # 处理32恒星的星系
    calc.process_galaxy(MockGalaxy(32))
    assert calc.stats[32].seed_count == 1

    # 处理64恒星的星系
    calc.process_galaxy(MockGalaxy(64))
    assert calc.stats[64].seed_count == 1


def test_running_average_calculator_multiple_galaxies():
    """测试RunningAverageCalculator处理多个星系"""
    calc = RunningAverageCalculator()

    class MockStar:
        def __init__(self, distance):
            self.distance = distance
            self.dyson_radius = 1000.0
            self.dyson_lumino = 1.0
            self.veins_point = [10] * 14
            self.veins_amount = [100] * 14
            self.gas_veins = [1.0, 2.0, 3.0]
            self.liquid = [1, 2]

    class MockGalaxy:
        def __init__(self, star_num, start_distance):
            self.star_num = star_num
            self.stars = [MockStar(float(i + start_distance)) for i in range(star_num)]

    # 处理两个32恒星的星系
    calc.process_galaxy(MockGalaxy(32, 0))
    calc.process_galaxy(MockGalaxy(32, 10))

    assert calc.stats[32].seed_count == 2
    # 第一个恒星的平均距离: (0 + 10) / 2 = 5.0
    assert calc.stats[32].stars_stats[0].avg_distance == 5.0


def test_avg_liquid_float_precision():
    """测试avg_liquid使用浮点数除法以确保精度"""
    stats = StarStats()

    class MockStar1:
        distance = 1.0
        dyson_radius = 1000.0
        dyson_lumino = 1.0
        veins_point = [10] * 14
        veins_amount = [100] * 14
        gas_veins = [1.0, 2.0, 3.0]
        liquid = [1, 2]

    class MockStar2:
        distance = 2.0
        dyson_radius = 2000.0
        dyson_lumino = 2.0
        veins_point = [20] * 14
        veins_amount = [200] * 14
        gas_veins = [2.0, 4.0, 6.0]
        liquid = [2, 4]

    class MockStar3:
        distance = 3.0
        dyson_radius = 3000.0
        dyson_lumino = 3.0
        veins_point = [30] * 14
        veins_amount = [300] * 14
        gas_veins = [3.0, 6.0, 9.0]
        liquid = [3, 6]

    # 测试液体平均值计算
    stats.update(MockStar1(), count=1)
    assert stats.avg_liquid[0] == 1.0
    assert stats.avg_liquid[1] == 2.0

    stats.update(MockStar2(), count=2)
    # 期望值: 1 + (2 - 1) / 2 = 1.5, 2 + (4 - 2) / 2 = 3.0
    assert abs(stats.avg_liquid[0] - 1.5) < 1e-10
    assert abs(stats.avg_liquid[1] - 3.0) < 1e-10

    stats.update(MockStar3(), count=3)
    # 期望值: 1.5 + (3 - 1.5) / 3 = 2.0, 3.0 + (6 - 3.0) / 3 = 4.0
    assert abs(stats.avg_liquid[0] - 2.0) < 1e-10
    assert abs(stats.avg_liquid[1] - 4.0) < 1e-10

    # 测试交替值的情况，验证不会停留在整数
    stats2 = StarStats()

    class MockStarA:
        distance = 1.0
        dyson_radius = 1000.0
        dyson_lumino = 1.0
        veins_point = [10] * 14
        veins_amount = [100] * 14
        gas_veins = [1.0, 2.0, 3.0]
        liquid = [1, 2]

    class MockStarB:
        distance = 1.0
        dyson_radius = 1000.0
        dyson_lumino = 1.0
        veins_point = [10] * 14
        veins_amount = [100] * 14
        gas_veins = [1.0, 2.0, 3.0]
        liquid = [2, 4]

    # 交替更新
    stats2.update(MockStarA(), count=1)  # avg_liquid[0] = 1.0
    stats2.update(MockStarB(), count=2)  # avg_liquid[0] = 1.5
    stats2.update(MockStarA(), count=3)  # avg_liquid[0] = 1.3333...
    stats2.update(MockStarB(), count=4)  # avg_liquid[0] = 1.5

    # 真值应为 (1 + 2 + 1 + 2) / 4 = 1.5
    assert abs(stats2.avg_liquid[0] - 1.5) < 1e-10
    # 验证不是整数
    assert stats2.avg_liquid[0] != int(stats2.avg_liquid[0])
