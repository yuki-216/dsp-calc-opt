# backend/test_stats_calculator.py
import math
import pytest
from stats_calculator import StarStats, StarNumStats, RunningAverageCalculator


def test_star_stats_initialization():
    """测试StarStats初始化"""
    stats = StarStats()
    assert stats.avg_distance == 0.0
    assert len(stats.avg_veins_point) == 14
    assert len(stats.avg_veins_amount) == 14
    assert not hasattr(stats, "avg_gas_veins")


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

    star = MockStar()
    stats.update(star, count=1)

    assert stats.avg_distance == 2.5
    assert stats.avg_veins_point[0] == 10
    assert stats.avg_veins_amount[0] == 100
    assert not hasattr(stats, "avg_gas_veins")


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

    class MockStar2:
        distance = 4.0
        dyson_radius = 2000.0
        dyson_lumino = 2.0
        veins_point = [20] * 14
        veins_amount = [200] * 14
        gas_veins = [2.0, 4.0, 6.0]

    stats.update(MockStar1(), count=1)
    stats.update(MockStar2(), count=2)

    # 运行均值: 2.0 + (4.0 - 2.0) / 2 = 3.0
    assert stats.avg_distance == 3.0
    # 运行均值: 1000.0 + (2000.0 - 1000.0) / 2 = 1500.0
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


# === Welford online algorithm + 收敛判断 ===

class _NumericStar:
    """恒星替身，字段类型与真实一致（标量 + 列表，不含 liquid）"""
    def __init__(self, distance=1.0, radius=1000.0, lumino=1.0,
                 veins_p=None, veins_a=None, gas=None):
        self.distance = distance
        self.dyson_radius = radius
        self.dyson_lumino = lumino
        self.veins_point = veins_p if veins_p is not None else [10] * 14
        self.veins_amount = veins_a if veins_a is not None else [100] * 14
        self.gas_veins = gas if gas is not None else [1.0, 2.0, 3.0]


def test_welford_m2_zero_for_constant_stream():
    """常数值流：M2 应始终为 0（无方差）。"""
    stats = StarStats()
    for n in range(1, 11):
        stats.update(_NumericStar(distance=5.0), n)
    assert stats.avg_distance == pytest.approx(5.0)
    assert stats.m2_distance == pytest.approx(0.0, abs=1e-12)


def test_welford_variance_matches_naive():
    """Welford 在线方差应等于离线 numpy 计算（标量字段）。"""
    values = [1.0, 2.0, 5.0, 7.0, 8.0]
    expected_mean = sum(values) / len(values)
    expected_var = sum((x - expected_mean) ** 2 for x in values) / (len(values) - 1)

    stats = StarStats()
    for n, v in enumerate(values, start=1):
        stats.update(_NumericStar(distance=v), n)

    assert stats.avg_distance == pytest.approx(expected_mean)
    assert stats.m2_distance == pytest.approx(expected_var * (len(values) - 1))
    assert stats.variance_distance(n=len(values)) == pytest.approx(expected_var)


def test_welford_variance_matches_naive_for_arrays():
    """Welford 也得正确处理 veins_point / veins_amount / gas_veins（liquid 已移除）。"""
    vp_samples = [
        [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140],
        [20, 25, 35, 45, 55, 65, 75, 85, 95, 105, 115, 125, 135, 145],
        [15, 22, 32, 42, 52, 62, 72, 82, 92, 102, 112, 122, 132, 142],
    ]
    stats = StarStats()
    for n, vp in enumerate(vp_samples, start=1):
        stats.update(_NumericStar(veins_p=vp), n)

    n = len(vp_samples)
    for i in range(14):
        if i == 7:  # 可燃冰不参与统计
            assert stats.avg_veins_point[i] == 0.0
            assert stats.variance_veins_point(i, n) == 0.0
            continue
        col = [vp_samples[k][i] for k in range(n)]
        mean = sum(col) / n
        var = sum((x - mean) ** 2 for x in col) / (n - 1)
        assert stats.avg_veins_point[i] == pytest.approx(mean)
        assert stats.variance_veins_point(i, n) == pytest.approx(var)


def test_get_convergence_returns_mineral_fields_only():
    """get_convergence 应为每个 (位置 × 字段) 返回 CI 信息。"""
    calc = RunningAverageCalculator()

    class _G:
        def __init__(self, star_num, dist):
            self.star_num = star_num
            self.stars = [_NumericStar(distance=dist + i * 0.1)
                          for i in range(star_num)]

    for k in range(5):
        calc.process_galaxy(_G(64, dist=2.0 + k))

    conv = calc.get_convergence(64, confidence=0.95)
    assert conv is not None
    assert conv["seed_count"] == 5
    fields = conv["fields"]
    # 64 个恒星位置
    assert len(fields) == 64
    # 每位置只保留距离、矿点数、矿量；气体不参与统计
    pos0 = fields[0]
    assert set(pos0.keys()) == {"distance",
                                "veins_point", "veins_amount"}
    assert len(pos0["veins_point"]) == 14
    assert len(pos0["veins_amount"]) == 14
    # 标量字段含 ci_half / relative_error
    d = pos0["distance"]
    assert {"mean", "std", "se", "ci_half", "relative_error"} <= set(d.keys())


def test_convergence_ci_decreases_with_more_samples():
    """增加样本量，CI 半宽应显著下降（CI ∝ 1/√n）。"""
    calc = RunningAverageCalculator()

    class _G:
        def __init__(self, star_num, base):
            self.star_num = star_num
            self.stars = [_NumericStar(distance=base + i * 0.3)
                          for i in range(star_num)]

    for k in range(10):
        calc.process_galaxy(_G(32, base=1.0 + k))

    ci5 = calc.get_convergence(32)["fields"][0]["distance"]["ci_half"]
    for k in range(10, 100):
        calc.process_galaxy(_G(32, base=1.0 + (k % 7)))  # 加噪声
    ci100 = calc.get_convergence(32)["fields"][0]["distance"]["ci_half"]
    # 100 个样本的 CI 应明显比 10 个小
    assert ci100 < ci5 / 2


def test_convergence_insufficient_samples_returns_none():
    """< 2 个样本无法估计方差，应返回 None。"""
    calc = RunningAverageCalculator()

    class _G:
        def __init__(self):
            self.star_num = 32
            self.stars = [_NumericStar(distance=1.0) for _ in range(32)]

    calc.process_galaxy(_G())
    assert calc.get_convergence(32) is None


def test_all_fields_converged_under_threshold():
    """大量低变异样本：所有指标 CI 半宽 < 5%，应判定为已收敛。"""
    calc = RunningAverageCalculator()

    class _G:
        def __init__(self, k):
            self.star_num = 64
            self.stars = [_NumericStar(distance=10.0 + (k + i) * 0.001)
                          for i in range(64)]

    for k in range(500):
        calc.process_galaxy(_G(k))

    assert calc.is_all_fields_converged(64, relative_error_threshold=0.05) is True


def test_all_fields_converged_with_high_variance_fails():
    """高变异 + 少样本：不应收敛。"""
    calc = RunningAverageCalculator()

    class _G:
        def __init__(self, k):
            self.star_num = 32
            self.stars = [_NumericStar(distance=100.0 * (k + 1))
                          for i in range(32)]

    for k in range(5):
        calc.process_galaxy(_G(k))

    # 5 个样本，mean 间差 100，CI 必然大
    assert calc.is_all_fields_converged(32, relative_error_threshold=0.01) is False


# === 星区汇总（galaxy_summary）的 Welford 跟踪 ===

def test_galaxy_summary_tracks_sum_across_positions():
    """验证 galaxy_summary 跟踪 Σ X_i 的真实 Welford（不依赖独立性假设）。"""
    calc = RunningAverageCalculator()

    class _G:
        def __init__(self, vp, va, gas):
            self.star_num = 32
            self.stars = [_NumericStar(veins_p=vp, veins_a=va, gas=gas)
                          for _ in range(32)]

    # 5 个星系，每个 veins_point[0] = 1+1+...+1（每恒星1个）
    for _ in range(5):
        calc.process_galaxy(_G(vp=[1]*14, va=[100]*14, gas=[1.0, 2.0, 3.0]))

    s = calc.stats[32]
    # 每星系 Σ veins_point[0] = 32, avg = 32
    assert s.summary_avg["veins_point"][0] == pytest.approx(32.0)
    assert s.summary_m2["veins_point"][0] == pytest.approx(0.0, abs=1e-12)
    # 每星系 Σ veins_amount[0] = 32 ×100 = 3200, avg = 3200
    assert s.summary_avg["veins_amount"][0] == pytest.approx(3200.0)
    assert "gas_veins" not in s.summary_avg
    assert "gas_veins" not in s.summary_m2


def test_galaxy_summary_variance_reflects_real_galaxy_variance():
    """汇总方差应反映"每个种子 Σ X_i 之间的真实方差"，而不是假设独立性算出的下界。
    这里每个星系 veins_point[0] 在 [10, 30] 之间变化：
      - 真实 Var(Σ) = Var of 32-星 Σ：星系间 Σ 在 [320, 960] 之间变化
      - 假设独立的"虚假下界"可能远小于此
    """
    import random
    random.seed(42)
    calc = RunningAverageCalculator()

    class _G:
        def __init__(self, k):
            # 每个星系 veins_point[0] 在 [10, 30] 之间随机（其他位置0）
            val = 10 + k * 5  # 10, 15, 20, 25, 30, 35, ...
            self.star_num = 32
            self.stars = [_NumericStar(veins_p=[val] + [0]*13,
                                       veins_a=[100]*14,
                                       gas=[1.0, 2.0, 3.0])
                          for _ in range(32)]

    for k in range(10):
        calc.process_galaxy(_G(k))

    s = calc.stats[32]
    # 每个星系 32 颗恒星，veins_point[0] = 10 + k*5
    # 10 个星系 Σ veins_point[0] = 32 * (10, 15, 20, ..., 55) = (320, 480, ..., 1760)
    sum_values = [32 * (10 + k * 5) for k in range(10)]
    expected_sum_mean = sum(sum_values) / len(sum_values)
    expected_sum_var = sum((v - expected_sum_mean) ** 2 for v in sum_values) / (len(sum_values) - 1)

    assert s.summary_avg["veins_point"][0] == pytest.approx(expected_sum_mean)
    assert s.summary_m2["veins_point"][0] == pytest.approx(expected_sum_var * (len(sum_values) - 1))


def test_convergence_includes_galaxy_summary():
    """/convergence 应包含 galaxy_summary 段（汇总的真实 CI）。"""
    calc = RunningAverageCalculator()

    class _G:
        def __init__(self, k):
            self.star_num = 32
            self.stars = [_NumericStar(veins_p=[10]*14, veins_a=[100]*14,
                                       gas=[1.0, 2.0, 3.0])
                          for _ in range(32)]

    for k in range(10):
        calc.process_galaxy(_G(k))

    conv = calc.get_convergence(32)
    assert conv is not None
    assert "galaxy_summary" in conv
    summary = conv["galaxy_summary"]
    assert set(summary.keys()) == {"veins_point", "veins_amount"}
    assert len(summary["veins_point"]) == 14
    assert len(summary["veins_amount"]) == 14
    # 每个字段都含 ci_half / relative_error
    assert "ci_half" in summary["veins_point"][0]
    assert "relative_error" in summary["veins_point"][0]


def test_galaxy_summary_converged_low_samples_returns_false():
    """样本 < 2 时 galaxy_summary_converged 返回 False（无法估计方差）。"""
    calc = RunningAverageCalculator()
    class _G:
        def __init__(self):
            self.star_num = 32
            self.stars = [_NumericStar(veins_p=[10]*14, veins_a=[100]*14,
                                       gas=[1.0, 2.0, 3.0]) for _ in range(32)]
    calc.process_galaxy(_G())
    # 1 个样本：seed_count < 2 → False
    assert calc.is_galaxy_summary_converged(32, relative_error_threshold=0.05) is False
    assert calc.is_all_galaxy_summaries_converged(relative_error_threshold=0.05) is False


def test_galaxy_summary_converged_low_variance_passes():
    """每个种子 Σ X_i 完全相同 → M2=0 → 相对误差=0（mean≠0）→ 已收敛。"""
    calc = RunningAverageCalculator()
    class _G:
        def __init__(self):
            self.star_num = 32
            self.stars = [_NumericStar(veins_p=[10]*14, veins_a=[100]*14,
                                       gas=[1.0, 2.0, 3.0]) for _ in range(32)]
    for _ in range(5):
        calc.process_galaxy(_G())
    # 5 个样本，Σ 完美恒定 → 所有 relative_error = 0 → 已收敛
    assert calc.is_galaxy_summary_converged(32, relative_error_threshold=0.05) is True


def test_all_galaxy_summaries_converged_when_all_star_nums_processed():
    """所有 33 个 star_num 都处理过且都收敛 → 整体返回 True。"""
    calc = RunningAverageCalculator()
    class _G:
        def __init__(self, star_num):
            self.star_num = star_num
            self.stars = [_NumericStar(veins_p=[10]*14, veins_a=[100]*14,
                                       gas=[1.0, 2.0, 3.0]) for _ in range(star_num)]
    for k in range(5):
        for sn in range(32, 65):
            calc.process_galaxy(_G(sn))
    # 所有 star_num Σ 完美恒定 → 整体收敛
    assert calc.is_all_galaxy_summaries_converged(relative_error_threshold=0.05) is True


def test_galaxy_summary_converged_high_variance_fails():
    """高变异 + 少样本 → 汇总 CI 半宽 > 阈值 → 未收敛。"""
    calc = RunningAverageCalculator()
    class _G:
        def __init__(self, k):
            self.star_num = 32
            # 每星系 Σ veins_point[0] = 32 × (100 + k × 100) → 巨变
            val = 100 + k * 100
            self.stars = [_NumericStar(veins_p=[val] + [0]*13,
                                       veins_a=[100]*14,
                                       gas=[1.0, 2.0, 3.0]) for _ in range(32)]
    for k in range(3):
        calc.process_galaxy(_G(k))
    # 3 个样本，Σ 跨度 320, 6400, 12480 → std 巨大 → CI 半宽超 5%
    assert calc.is_galaxy_summary_converged(32, relative_error_threshold=0.01) is False


def test_all_galaxy_summaries_partial_converged_returns_false():
    """33 个 star_num 中只要有一个未收敛，整体判断返回 False。"""
    calc = RunningAverageCalculator()
    # 只处理 star_num=32，让其他 33 个 star_num 保持空
    class _G32:
        def __init__(self):
            self.star_num = 32
            self.stars = [_NumericStar(veins_p=[10]*14, veins_a=[100]*14,
                                       gas=[1.0, 2.0, 3.0]) for _ in range(32)]
    for _ in range(5):
        calc.process_galaxy(_G32())
    # 32 已收敛，但 33..64 都是 seed_count=0 → 整体 False
    assert calc.is_galaxy_summary_converged(32, relative_error_threshold=0.05) is True
    assert calc.is_all_galaxy_summaries_converged(relative_error_threshold=0.05) is False
