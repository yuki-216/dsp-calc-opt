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
    """测试保存统计结果（单文件 stats.json）"""
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
    
        class MockGalaxy:
            def __init__(self, star_num):
                self.star_num = star_num
                self.stars = [MockStar(float(i)) for i in range(star_num)]

        calculator.process_galaxy(MockGalaxy(32))
        calculator.process_galaxy(MockGalaxy(64))

        # 保存统计结果
        storage.save_stats(calculator)

        # 单一文件 stats.json 替代 33 个 stats_*.json
        assert os.path.exists(os.path.join(tmpdir, "stats.json"))
        with open(os.path.join(tmpdir, "stats.json"), "r", encoding="utf-8") as f:
            saved = json.load(f)
        saved_star = saved["32"]["stars_stats"][0]
        assert "avg_gas_veins" not in saved_star
        assert "m2_gas_veins" not in saved_star
        assert "gas_veins" not in saved["32"]["summary_avg"]
        # 不再产生旧的 stats_*.json
        assert not os.path.exists(os.path.join(tmpdir, "stats_32.json"))
        assert not os.path.exists(os.path.join(tmpdir, "stats_64.json"))


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
        assert "avg_gas_veins" not in loaded_stats["stars_stats"][0]


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
    """测试保存统计结果时跳过无数据的组（单文件中按 key 区分）"""
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
    
        class MockGalaxy:
            def __init__(self, star_num):
                self.star_num = star_num
                self.stars = [MockStar(float(i)) for i in range(star_num)]

        calculator.process_galaxy(MockGalaxy(32))

        # 保存统计结果
        storage.save_stats(calculator)

        # 单一 stats.json 中：32 有数据，33 无数据被跳过
        with open(os.path.join(tmpdir, "stats.json"), "r", encoding="utf-8") as f:
            data = json.load(f)
        assert "32" in data
        assert "33" not in data


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


def test_save_stats_writes_only_one_file():
    """优化验证：所有 star_num 的均值合并到单一 stats.json，
    杜绝每 batch 33 次 open/write/close 的 I/O 开销。"""
    import glob
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)
        calculator = RunningAverageCalculator()

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

        # 处理 33 个 star_num 中的若干
        for n in (32, 33, 50, 64):
            calculator.process_galaxy(MockGalaxy(n))

        storage.save_stats(calculator)

        # 数据目录下不应存在旧的 stats_*.json（progress.json 除外）
        legacy = glob.glob(os.path.join(tmpdir, "stats_*.json"))
        assert legacy == [], (
            f"不应再有 stats_*.json 遗留，实际: {legacy}"
        )
        # stats.json 必须存在
        assert os.path.exists(os.path.join(tmpdir, "stats.json"))


def test_old_per_star_files_are_migrated_on_init():
    """迁移测试：旧版本遗留的 stats_*.json 应在初始化时被合并到 stats.json，
    避免历史统计因升级而丢失。"""
    import glob
    with tempfile.TemporaryDirectory() as tmpdir:
        # 预先写入旧格式文件（模拟上一版本的产物）
        old_32 = {"star_num": 32, "seed_count": 100, "stars_stats": [{"avg_distance": 1.0}]}
        old_64 = {"star_num": 64, "seed_count": 50, "stars_stats": [{"avg_distance": 2.0}]}
        with open(os.path.join(tmpdir, "stats_32.json"), "w", encoding="utf-8") as f:
            json.dump(old_32, f)
        with open(os.path.join(tmpdir, "stats_64.json"), "w", encoding="utf-8") as f:
            json.dump(old_64, f)

        # 触发迁移
        storage = StatsStorage(data_dir=tmpdir)

        # 旧文件已清理
        assert glob.glob(os.path.join(tmpdir, "stats_*.json")) == []
        # 新文件已生成，且包含旧数据
        assert os.path.exists(os.path.join(tmpdir, "stats.json"))
        with open(os.path.join(tmpdir, "stats.json"), "r", encoding="utf-8") as f:
            data = json.load(f)
        assert data["32"]["seed_count"] == 100
        assert data["64"]["seed_count"] == 50


def test_load_all_stats_after_migration_restores_calculator():
    """迁移 + 加载协同：load_all_stats 应能正确恢复由旧文件迁移来的均值。"""
    import glob
    with tempfile.TemporaryDirectory() as tmpdir:
        old = {
            "star_num": 32, "seed_count": 7,
            "stars_stats": [{
                "avg_distance": 1.5,
                "avg_veins_point": [10] * 14, "avg_veins_amount": [100] * 14,
                "avg_gas_veins": [0.1, 0.2, 0.3],
            }],
        }
        with open(os.path.join(tmpdir, "stats_32.json"), "w", encoding="utf-8") as f:
            json.dump(old, f)

        storage = StatsStorage(data_dir=tmpdir)
        calc = storage.load_all_stats()

        # 旧文件已被迁移清理
        assert glob.glob(os.path.join(tmpdir, "stats_*.json")) == []
        # 数据被正确恢复
        s32 = calc.stats[32]
        assert s32.seed_count == 7
        assert s32.stars_stats[0].avg_distance == 1.5
        # dyson_radius 已删除，不再断言
