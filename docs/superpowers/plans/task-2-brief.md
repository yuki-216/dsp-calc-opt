## Task 2: 创建统计数据存储

**Files:**
- Create: `backend/stats_storage.py`
- Test: `backend/test_stats_storage.py`

**Interfaces:**
- Consumes: `RunningAverageCalculator` from Task 1
- Produces: `StatsStorage` 类

- [ ] **Step 1: 创建测试文件**

```python
# backend/test_stats_storage.py
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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend && python -m pytest test_stats_storage.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'stats_storage'"

- [ ] **Step 3: 实现统计数据存储**

```python
# backend/stats_storage.py
"""
统计数据存储
用于保存和加载统计结果和进度
"""

import json
import os
from typing import Optional, Dict, Any
from pathlib import Path

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
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd backend && python -m pytest test_stats_storage.py -v`
Expected: PASS

- [ ] **Step 5: 提交代码**

```bash
git add backend/stats_storage.py backend/test_stats_storage.py
git commit -m "feat: add stats storage for saving/loading statistics"
```

---

