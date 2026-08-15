import pytest
import json
import os
import tempfile
from stats_storage import StatsStorage
from stats_calculator import RunningAverageCalculator, StarNumStats, StarStats


def test_stats_storage_initialization():
    """测试StatsStorage初始化"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)
        assert storage.data_dir == tmpdir
        assert os.path.exists(os.path.join(tmpdir, "progress.json"))


def test_stats_storage_save_progress():
    """测试保存进度"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)

        storage.save_progress(
            completed_seed_id=100,
            seed_count=100,
            batch_size=10,
            start_seed_id=1,
            end_seed_id=1000
        )

        progress_file = os.path.join(tmpdir, "progress.json")
        with open(progress_file, "r", encoding="utf-8") as f:
            progress = json.load(f)

        assert progress["completed_seed_id"] == 100
        assert progress["seed_count"] == 100
        assert progress["batch_size"] == 10
        assert progress["start_seed_id"] == 1
        assert progress["end_seed_id"] == 1000


def test_stats_storage_load_progress():
    """测试加载进度"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)

        # 先保存
        storage.save_progress(
            completed_seed_id=100,
            seed_count=100,
            batch_size=10,
            start_seed_id=1,
            end_seed_id=1000
        )

        # 再加载
        progress = storage.load_progress()

        assert progress["completed_seed_id"] == 100
        assert progress["seed_count"] == 100


def test_stats_storage_load_progress_not_exists():
    """测试加载不存在的进度"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)

        # 删除进度文件
        progress_file = os.path.join(tmpdir, "progress.json")
        if os.path.exists(progress_file):
            os.remove(progress_file)

        progress = storage.load_progress()
        assert progress is None


def test_stats_storage_save_stats():
    """测试保存统计结果"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)

        # 创建测试数据
        calculator = RunningAverageCalculator()

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

        calculator.process_galaxy(MockGalaxy(32))
        calculator.process_galaxy(MockGalaxy(64))

        # 保存统计结果
        storage.save_stats(calculator)

        # 验证文件存在
        assert os.path.exists(os.path.join(tmpdir, "stats_32.json"))
        assert os.path.exists(os.path.join(tmpdir, "stats_64.json"))


def test_stats_storage_load_stats():
    """测试加载统计结果"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)

        # 创建测试数据
        calculator = RunningAverageCalculator()

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

        calculator.process_galaxy(MockGalaxy(32))

        # 保存统计结果
        storage.save_stats(calculator)

        # 加载统计结果
        loaded_stats = storage.load_stats(32)

        assert loaded_stats is not None
        assert loaded_stats["star_num"] == 32
        assert loaded_stats["seed_count"] == 1


def test_stats_storage_load_stats_not_exists():
    """测试加载不存在的统计结果"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)

        loaded_stats = storage.load_stats(32)
        assert loaded_stats is None


def test_stats_storage_save_verification_data():
    """测试保存验证数据"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)

        simple_avg = {"test": 1.0}
        running_avg = {"test": 1.0}
        comparison = {"test": "pass"}

        storage.save_verification_data(simple_avg, running_avg, comparison)

        # 验证文件存在
        verification_dir = os.path.join(tmpdir, "verification")
        assert os.path.exists(os.path.join(verification_dir, "simple_avg.json"))
        assert os.path.exists(os.path.join(verification_dir, "running_avg.json"))
        assert os.path.exists(os.path.join(verification_dir, "comparison.json"))


def test_stats_storage_save_stats_skips_empty():
    """测试保存统计结果时跳过无数据的组"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)

        # 创建测试数据，只处理32
        calculator = RunningAverageCalculator()

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

        calculator.process_galaxy(MockGalaxy(32))

        # 保存统计结果
        storage.save_stats(calculator)

        # 32有数据应存在，33无数据应不存在
        assert os.path.exists(os.path.join(tmpdir, "stats_32.json"))
        assert not os.path.exists(os.path.join(tmpdir, "stats_33.json"))


def test_stats_storage_verification_data_content():
    """测试验证数据内容正确保存"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)

        simple_avg = {"iron": 42.5, "copper": 30.0}
        running_avg = {"iron": 42.5, "copper": 30.0}
        comparison = {"iron": "pass", "copper": "pass"}

        storage.save_verification_data(simple_avg, running_avg, comparison)

        verification_dir = os.path.join(tmpdir, "verification")
        with open(os.path.join(verification_dir, "simple_avg.json"), "r", encoding="utf-8") as f:
            assert json.load(f) == simple_avg
        with open(os.path.join(verification_dir, "running_avg.json"), "r", encoding="utf-8") as f:
            assert json.load(f) == running_avg
        with open(os.path.join(verification_dir, "comparison.json"), "r", encoding="utf-8") as f:
            assert json.load(f) == comparison
