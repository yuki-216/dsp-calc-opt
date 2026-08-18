import pytest
import threading
import time
import tempfile
import sys
from unittest.mock import patch, MagicMock

# Mock the C API module before importing batch_calculator
# This is necessary because the C API is a compiled .pyd file
# and we want to test the batch calculator logic independently
_mock_search_seed = MagicMock()
sys.modules.setdefault("dsp_search_seed", MagicMock())
sys.modules.setdefault("dsp_search_seed.CApi", MagicMock())
sys.modules.setdefault("dsp_search_seed.CApi.search_seed", _mock_search_seed)

from batch_calculator import BatchCalculator
from stats_storage import StatsStorage


class _MockStar:
    """轻量恒星对象（普通属性，避免 MagicMock 的动态开销）"""
    __slots__ = ("distance", "dyson_radius", "dyson_lumino",
                 "veins_point", "veins_amount", "gas_veins", "liquid")

    def __init__(self, distance):
        self.distance = float(distance)
        self.dyson_radius = 1000.0
        self.dyson_lumino = 1.0
        self.veins_point = [10] * 14
        self.veins_amount = [100] * 14
        self.gas_veins = [1.0, 2.0, 3.0]
        self.liquid = [1, 2]


class _MockGalaxy:
    """轻量星系对象"""
    __slots__ = ("star_num", "stars")

    def __init__(self, star_num):
        self.star_num = star_num
        self.stars = [_MockStar(float(i)) for i in range(star_num)]


def _make_mock_galaxy(star_num):
    """创建模拟星系数据（轻量对象，供运行均值快速消费）"""
    return _MockGalaxy(star_num)


class FakeSeed:
    """记录实参的 Seed 替身"""
    _instances = []

    def __init__(self, seed_id, star_num, resource_index):
        self.seed_id = seed_id
        self.star_num = star_num
        self.resource_index = resource_index
        FakeSeed._instances.append(self)


class FakeManager:
    """模拟 GetDataManager 并发管理器：
    add_task 收集任务；get_results 一次性排空返回对应 mock 星系，模拟并发结果。"""
    total_added = 0
    instances = []

    def __init__(self, *args, **kwargs):
        if kwargs:
            # 模拟 pybind11 绑定：不接受关键字参数
            raise TypeError(
                "GetDataManager() only accepts positional arguments; "
                f"got unexpected keyword(s): {sorted(kwargs)}"
            )
        if len(args) != 3:
            raise TypeError(
                "GetDataManager() takes 3 positional arguments "
                f"but {len(args)} were given"
            )
        thread_num, quick, max_cache = args
        self.thread_num = thread_num
        self.quick = quick
        self.max_cache = max_cache
        self.added = 0
        self.tasks = []
        FakeManager.instances.append(self)

    def add_task(self, seed):
        self.tasks.append(seed)
        self.added += 1
        FakeManager.total_added += 1

    def get_results(self):
        # 每轮最多返回1个结果，模拟真实缓冲排空后的分批产出，
        # 使 stop 信号能在批次中途被检测到
        if not self.tasks:
            return []
        seed = self.tasks.pop(0)
        return [_make_mock_galaxy(seed.star_num)]

    def shutdown(self):
        self.shutdown_called = True


@pytest.fixture(autouse=True)
def mock_c_api():
    """Mock the C API for all tests"""
    FakeSeed._instances = []
    FakeManager.total_added = 0
    FakeManager.instances = []
    with patch("batch_calculator.do_init_c"), \
         patch("batch_calculator.Seed", FakeSeed), \
         patch("batch_calculator.GetDataManager", FakeManager):
        yield {}


def test_batch_calculator_initialization():
    """测试BatchCalculator初始化"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)
        calc = BatchCalculator(storage=storage)

        assert calc.storage == storage
        assert calc.is_running == False
        assert calc.should_stop == False
        assert calc.batch_size == 100


def test_batch_calculator_start_stop():
    """测试BatchCalculator启动和停止"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)
        calc = BatchCalculator(storage=storage)

        # 启动计算（使用小范围测试）
        calc.start(start_seed_id=1, end_seed_id=10, batch_size=5)
        assert calc.is_running == True

        # 等待一小段时间
        time.sleep(0.1)

        # 停止计算
        calc.stop()
        time.sleep(0.5)

        assert calc.is_running == False

        # 等待线程退出，避免 tempdir 清理时后台线程仍写文件
        calc._thread.join(5)


def test_batch_calculator_status():
    """测试BatchCalculator状态查询"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)
        calc = BatchCalculator(storage=storage)

        # 初始状态
        status = calc.get_status()
        assert status["is_running"] == False
        assert status["current_seed_id"] == 0
        assert status["total_seeds"] == 0


def test_batch_calculator_resume():
    """测试BatchCalculator恢复计算"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)

        # 保存初始进度
        storage.save_progress(
            completed_seed_id=5,
            seed_count=5,
            batch_size=5,
            start_seed_id=1,
            end_seed_id=10
        )

        calc = BatchCalculator(storage=storage)

        # 恢复计算
        calc.resume()
        assert calc.is_running == True

        # 停止计算
        calc.stop()
        time.sleep(0.5)

        assert calc.is_running == False
        calc._thread.join(5)


def test_batch_calculator_status_while_running():
    """测试BatchCalculator运行中查询状态"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)
        calc = BatchCalculator(storage=storage)

        calc.start(start_seed_id=1, end_seed_id=100, batch_size=5)
        time.sleep(0.2)

        status = calc.get_status()
        assert status["is_running"] == True
        assert status["total_seeds"] == 100

        calc.stop()
        time.sleep(0.5)
        calc._thread.join(5)


def test_batch_calculator_completes_and_saves():
    """测试BatchCalculator完成后保存进度"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)
        calc = BatchCalculator(storage=storage)

        # 使用小范围，让它自然完成
        calc.start(start_seed_id=1, end_seed_id=2, batch_size=10)
        time.sleep(0.5)

        # 验证计算已完成
        assert calc.is_running == False

        # 验证进度已保存
        progress = storage.load_progress()
        assert progress is not None
        assert progress["completed_seed_id"] == 2
        calc._thread.join(5)


def test_batch_calculator_calls_c_api(mock_c_api):
    """测试BatchCalculator正确调用源项目 GetDataManager 并发API"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)
        calc = BatchCalculator(storage=storage)

        # 快速完成一个种子
        calc.start(start_seed_id=1, end_seed_id=1, batch_size=10)
        time.sleep(0.5)

        # 验证 C API 被调用
        # 1个种子 x 33种恒星数量 = 33个任务
        calc.stop()
        time.sleep(0.3)

        # 验证 Seed 构造了33次 (32-64 共33种恒星数)
        assert len(FakeSeed._instances) == 33

        # 验证 GetDataManager.add_task 被调用了33次（1种子×33恒星数）
        assert FakeManager.total_added == 33

        # 验证每个 Seed 携带正确的 star_num 与 resource_index=4（1倍资源）
        star_nums = sorted(s.star_num for s in FakeSeed._instances)
        assert star_nums == list(range(32, 65))
        assert all(s.resource_index == 4 for s in FakeSeed._instances), \
            "统计必须固定使用1倍资源（源项目 resource_rates 索引4），而非索引0的0.1倍"

        # 验证 manager 已 shutdown（线程资源被回收）
        assert all(getattr(m, "shutdown_called", False) for m in FakeManager.instances)
        calc._thread.join(5)


def test_resume_restores_stats():
    """测试resume从存储恢复统计到calculator (修复关键问题1)"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)

        # 模拟之前已完成的计算：创建一个calculator并保存统计
        from stats_calculator import RunningAverageCalculator

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

        prev_calc = RunningAverageCalculator()
        prev_calc.process_galaxy(MockGalaxy(32))
        prev_calc.process_galaxy(MockGalaxy(32))
        storage.save_stats(prev_calc)

        # 保存进度
        storage.save_progress(
            completed_seed_id=100,
            seed_count=100,
            batch_size=10,
            start_seed_id=1,
            end_seed_id=200
        )

        # resume 应恢复之前的统计
        calc = BatchCalculator(storage=storage)
        calc.resume()

        # 立即停止，等线程结束
        calc.stop()
        time.sleep(1.0)
        calc._thread.join(5)

        # 验证calculator已从存储恢复了之前的统计数据
        # 线程可能又处理了一些种子，所以 seed_count >= 2
        assert calc.calculator.stats[32].seed_count >= 2, \
            f"seed_count应>=2（已恢复），实际为{calc.calculator.stats[32].seed_count}"

        # 验证统计均值不是全零（说明确实从存储恢复了）
        assert calc.calculator.stats[32].stars_stats[0].avg_dyson_radius == 1000.0


def test_resume_progress_percent_is_correct():
    """测试resume时progress_percent计算正确 (修复关键问题2)"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)

        # 模拟从 seed 50,000,000 恢复到 60,000,000 的场景
        storage.save_progress(
            completed_seed_id=50000000,
            seed_count=50000000,
            batch_size=100,
            start_seed_id=1,
            end_seed_id=60000000
        )

        calc = BatchCalculator(storage=storage)
        calc.resume()

        # resume后，start_seed_id 应为 50,000,001
        # total_seeds = 60,000,000 - 50,000,001 + 1 = 10,000,000
        # 刚resume时 current_seed_id = 50,000,001
        # processed = 50,000,001 - 50,000,001 = 0
        # progress_percent 应约为 0%，而不是 100%
        time.sleep(0.2)
        status = calc.get_status()
        assert status["progress_percent"] < 10.0, \
            f"resume后progress_percent应<10%，实际为{status['progress_percent']:.1f}%"
        assert status["total_seeds"] == 10000000

        calc.stop()
        time.sleep(0.5)
        calc._thread.join(5)


def test_stop_mid_batch_does_not_commit():
    """测试批次中途停止不提交进度（修复：部分数据不得标记为整批完成）"""
    import glob
    import os
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)
        calc = BatchCalculator(storage=storage)

        # 大面积批次，确保 stop 时第一批未完成
        calc.start(start_seed_id=1, end_seed_id=1000, batch_size=100)
        time.sleep(0.05)  # 让线程启动并处理一部分，但未完成第一批
        calc.stop()
        calc._thread.join(10)

        # 中断批次不得提交：进度保持初始0，且不应有任何stats文件
        progress = storage.load_progress()
        assert progress["completed_seed_id"] == 0, \
            f"中止批次被错误提交: {progress}"
        assert glob.glob(os.path.join(tmpdir, "stats_*.json")) == [], \
            "中止批次的部分数据被错误保存"
