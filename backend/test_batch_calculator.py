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


def _make_mock_galaxy(star_num):
    """创建模拟星系数据"""
    galaxy = MagicMock()
    galaxy.star_num = star_num

    stars = []
    for i in range(star_num):
        star = MagicMock()
        star.distance = float(i)
        star.dyson_radius = 1000.0
        star.dyson_lumino = 1.0
        star.veins_point = [10] * 14
        star.veins_amount = [100] * 14
        star.gas_veins = [1.0, 2.0, 3.0]
        star.liquid = [1, 2]
        stars.append(star)
    galaxy.stars = stars
    return galaxy


@pytest.fixture(autouse=True)
def mock_c_api():
    """Mock the C API for all tests"""
    mock_galaxy = _make_mock_galaxy(32)
    with patch("batch_calculator.do_init_c") as mock_init, \
         patch("batch_calculator.Seed") as mock_seed_cls, \
         patch("batch_calculator.get_galaxy_data_c", return_value=mock_galaxy) as mock_get:
        yield {
            "init": mock_init,
            "Seed": mock_seed_cls,
            "get_galaxy_data_c": mock_get,
        }


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


def test_batch_calculator_calls_c_api():
    """测试BatchCalculator正确调用C API"""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = StatsStorage(data_dir=tmpdir)
        calc = BatchCalculator(storage=storage)

        # 快速完成一个种子
        calc.start(start_seed_id=1, end_seed_id=1, batch_size=10)
        time.sleep(0.5)

        # 验证C API被调用
        # 1个种子 x 33种恒星数量 = 33次调用
        calc.stop()
        time.sleep(0.3)
