# 种子统计分析系统实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [`) syntax for tracking.

**Goal:** 实现种子统计分析系统，计算1亿个种子的统计均值，支持中断和继续，集成到现有种子查看器界面。

**Architecture:** 后端使用FastAPI提供API接口，批量计算引擎调用CApi计算种子，运行均值算法维护统计数据，前端集成到现有种子查看器页面。

**Tech Stack:** Python, FastAPI, React, CApi (现有种子计算库)

## Global Constraints

1. 资源倍率固定为1倍
2. 恒星数量范围：32-64（33个值）
3. 种子ID范围：1-99999999
4. 计算精度：浮点数误差小于0.01%
5. 前端轮询间隔：5秒
6. 计算策略：每个种子计算所有33种恒星数量
7. 进度粒度：批量级别（batch_size=100）

---

## 文件结构

### 后端文件
- `backend/stats_calculator.py` - 运行均值计算器
- `backend/stats_storage.py` - 统计数据存储
- `backend/stats_api.py` - 统计API接口
- `backend/test_stats.py` - 测试文件

### 前端文件
- `src/SeedStatsPanel.jsx` - 统计分析面板组件
- `src/seed_stats_binding.js` - 统计API绑定

### 数据文件
- `data/seed_stats/progress.json` - 计算进度
- `data/seed_stats/stats_32.json` - 32恒星统计结果
- `data/seed_stats/stats_33.json` - 33恒星统计结果
- `...`
- `data/seed_stats/stats_64.json` - 64恒星统计结果

---

## Task 1: 创建运行均值计算器

**Files:**
- Create: `backend/stats_calculator.py`
- Test: `backend/test_stats_calculator.py`

**Interfaces:**
- Produces: `StarStats` 类, `StarNumStats` 类, `RunningAverageCalculator` 类

- [ ] **Step 1: 创建测试文件**

```python
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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend && python -m pytest test_stats_calculator.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'stats_calculator'"

- [ ] **Step 3: 实现运行均值计算器**

```python
# backend/stats_calculator.py
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
    avg_liquid: List[int] = field(default_factory=lambda: [0, 0])
    
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
            self.avg_liquid[i] += (star.liquid[i] - self.avg_liquid[i]) // count


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
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd backend && python -m pytest test_stats_calculator.py -v`
Expected: PASS

- [ ] **Step 5: 提交代码**

```bash
git add backend/stats_calculator.py backend/test_stats_calculator.py
git commit -m "feat: add running average calculator for seed statistics"
```

---

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

## Task 3: 创建批量计算引擎

**Files:**
- Create: `backend/batch_calculator.py`
- Test: `backend/test_batch_calculator.py`

**Interfaces:**
- Consumes: `RunningAverageCalculator` from Task 1, `StatsStorage` from Task 2
- Produces: `BatchCalculator` 类

- [ ] **Step 1: 创建测试文件**

```python
# backend/test_batch_calculator.py
import pytest
import threading
import time
from batch_calculator import BatchCalculator
from stats_storage import StatsStorage


def test_batch_calculator_initialization():
    """测试BatchCalculator初始化"""
    storage = StatsStorage(data_dir="/tmp/test_stats_init")
    calc = BatchCalculator(storage=storage)
    
    assert calc.storage == storage
    assert calc.is_running == False
    assert calc.should_stop == False
    assert calc.batch_size == 100


def test_batch_calculator_start_stop():
    """测试BatchCalculator启动和停止"""
    storage = StatsStorage(data_dir="/tmp/test_stats_start_stop")
    calc = BatchCalculator(storage=storage)
    
    # 启动计算（使用小范围测试）
    calc.start(start_seed_id=1, end_seed_id=10, batch_size=5)
    assert calc.is_running == True
    
    # 等待一小段时间
    time.sleep(0.1)
    
    # 停止计算
    calc.stop()
    time.sleep(0.1)
    
    assert calc.is_running == False


def test_batch_calculator_status():
    """测试BatchCalculator状态查询"""
    storage = StatsStorage(data_dir="/tmp/test_stats_status")
    calc = BatchCalculator(storage=storage)
    
    # 初始状态
    status = calc.get_status()
    assert status["is_running"] == False
    assert status["current_seed_id"] == 0
    assert status["total_seeds"] == 0


def test_batch_calculator_resume():
    """测试BatchCalculator恢复计算"""
    storage = StatsStorage(data_dir="/tmp/test_stats_resume")
    
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
    time.sleep(0.1)
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend && python -m pytest test_batch_calculator.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'batch_calculator'"

- [ ] **Step 3: 实现批量计算引擎**

```python
# backend/batch_calculator.py
"""
批量计算引擎
用于批量计算种子并更新运行均值
"""

import sys
import threading
import time
from pathlib import Path
from typing import Optional, Dict, Any

# 添加原项目的CApi路径
SEED_VIEWER_PATH = Path("D:/编程/种子查看器")
sys.path.insert(0, str(SEED_VIEWER_PATH))

# 导入原项目的C API
from dsp_search_seed.CApi.search_seed import (
    do_init_c,
    get_galaxy_data_c,
    Seed,
)

from stats_calculator import RunningAverageCalculator
from stats_storage import StatsStorage


class BatchCalculator:
    """批量计算器"""
    
    def __init__(self, storage: StatsStorage):
        self.storage = storage
        self.calculator = RunningAverageCalculator()
        self.is_running = False
        self.should_stop = False
        self.batch_size = 100
        self.current_seed_id = 0
        self.total_seeds = 0
        self.start_time = 0
        self._thread: Optional[threading.Thread] = None
        
        # 初始化C库
        do_init_c()
    
    def start(self, start_seed_id: int = 1, end_seed_id: int = 99999999, 
              batch_size: int = 100):
        """启动计算"""
        if self.is_running:
            return
        
        self.batch_size = batch_size
        self.current_seed_id = start_seed_id
        self.total_seeds = end_seed_id - start_seed_id + 1
        self.start_time = time.time()
        self.should_stop = False
        self.is_running = True
        
        # 启动计算线程
        self._thread = threading.Thread(
            target=self._calculate_loop,
            args=(start_seed_id, end_seed_id)
        )
        self._thread.start()
    
    def resume(self):
        """恢复计算"""
        progress = self.storage.load_progress()
        if progress is None:
            return
        
        start_seed_id = progress["completed_seed_id"] + 1
        end_seed_id = progress["end_seed_id"]
        batch_size = progress["batch_size"]
        
        self.start(start_seed_id, end_seed_id, batch_size)
    
    def stop(self):
        """停止计算"""
        self.should_stop = True
    
    def _calculate_loop(self, start_seed_id: int, end_seed_id: int):
        """计算主循环"""
        try:
            for batch_start in range(start_seed_id, end_seed_id + 1, self.batch_size):
                # 检查是否需要停止
                if self.should_stop:
                    break
                
                batch_end = min(batch_start + self.batch_size - 1, end_seed_id)
                
                # 对每个种子计算所有恒星数量
                for seed_id in range(batch_start, batch_end + 1):
                    for star_num in range(32, 65):  # 32-64，共33种
                        try:
                            seed = Seed(seed_id, star_num, 0)
                            galaxy = get_galaxy_data_c(seed, False)
                            self.calculator.process_galaxy(galaxy)
                        except Exception as e:
                            # 计算错误，暂停并提示
                            self.is_running = False
                            print(f"种子{seed_id}恒星数{star_num}计算失败: {str(e)}")
                            return
                
                # 更新进度
                self.current_seed_id = batch_end
                self.storage.save_progress(
                    completed_seed_id=batch_end,
                    seed_count=batch_end - start_seed_id + 1,
                    batch_size=self.batch_size,
                    start_seed_id=start_seed_id,
                    end_seed_id=end_seed_id
                )
                self.storage.save_stats(self.calculator)
                
                # 检查是否需要停止
                if self.should_stop:
                    break
            
            # 计算完成
            self.is_running = False
            print("计算完成")
            
        except Exception as e:
            self.is_running = False
            print(f"计算异常: {str(e)}")
    
    def get_status(self) -> Dict[str, Any]:
        """获取计算状态"""
        elapsed_time = 0
        if self.start_time > 0:
            elapsed_time = time.time() - self.start_time
        
        # 计算预计剩余时间
        estimated_remaining = 0
        if self.current_seed_id > 0 and elapsed_time > 0:
            seeds_per_second = self.current_seed_id / elapsed_time
            remaining_seeds = self.total_seeds - self.current_seed_id
            if seeds_per_second > 0:
                estimated_remaining = remaining_seeds / seeds_per_second
        
        return {
            "is_running": self.is_running,
            "current_seed_id": self.current_seed_id,
            "total_seeds": self.total_seeds,
            "progress_percent": (self.current_seed_id / self.total_seeds * 100) if self.total_seeds > 0 else 0,
            "elapsed_time": self._format_time(elapsed_time),
            "estimated_remaining": self._format_time(estimated_remaining)
        }
    
    def _format_time(self, seconds: float) -> str:
        """格式化时间"""
        if seconds < 60:
            return f"{seconds:.0f}秒"
        elif seconds < 3600:
            minutes = seconds / 60
            return f"{minutes:.0f}分钟"
        else:
            hours = seconds / 3600
            return f"{hours:.1f}小时"
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd backend && python -m pytest test_batch_calculator.py -v`
Expected: PASS

- [ ] **Step 5: 提交代码**

```bash
git add backend/batch_calculator.py backend/test_batch_calculator.py
git commit -m "feat: add batch calculator for seed statistics"
```

---

## Task 4: 创建统计API接口

**Files:**
- Create: `backend/stats_api.py`
- Modify: `backend/main.py`
- Test: `backend/test_stats_api.py`

**Interfaces:**
- Consumes: `BatchCalculator` from Task 3, `StatsStorage` from Task 2
- Produces: API endpoints for statistics

- [ ] **Step 1: 创建测试文件**

```python
# backend/test_stats_api.py
import pytest
from fastapi.testclient import TestClient
from main import app
from stats_storage import StatsStorage

client = TestClient(app)


def test_start_stats_calculation():
    """测试启动统计计算"""
    response = client.post("/api/seed-stats/start", json={
        "start_seed_id": 1,
        "end_seed_id": 10,
        "batch_size": 5
    })
    assert response.status_code == 200
    data = response.json()
    assert "task_id" in data
    assert "message" in data


def test_stop_stats_calculation():
    """测试停止统计计算"""
    # 先启动计算
    client.post("/api/seed-stats/start", json={
        "start_seed_id": 1,
        "end_seed_id": 10,
        "batch_size": 5
    })
    
    # 停止计算
    response = client.post("/api/seed-stats/stop")
    assert response.status_code == 200
    data = response.json()
    assert "message" in data


def test_get_stats_status():
    """测试获取统计状态"""
    response = client.get("/api/seed-stats/status")
    assert response.status_code == 200
    data = response.json()
    assert "is_running" in data
    assert "current_seed_id" in data
    assert "total_seeds" in data
    assert "progress_percent" in data
    assert "elapsed_time" in data
    assert "estimated_remaining" in data


def test_get_stats_result():
    """测试获取统计结果"""
    response = client.get("/api/seed-stats/64")
    # 可能返回404（没有数据）或200（有数据）
    assert response.status_code in [200, 404]


def test_get_stats_overview():
    """测试获取统计概览"""
    response = client.get("/api/seed-stats/overview")
    assert response.status_code == 200
    data = response.json()
    assert "stats" in data
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend && python -m pytest test_stats_api.py -v`
Expected: FAIL with "404 Not Found" (API endpoints not implemented)

- [ ] **Step 3: 创建统计API模块**

```python
# backend/stats_api.py
"""
统计API接口
提供统计计算的控制和查询接口
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from stats_storage import StatsStorage
from batch_calculator import BatchCalculator


# 创建路由器
router = APIRouter(prefix="/api/seed-stats", tags=["statistics"])

# 初始化存储和计算器
storage = StatsStorage()
calculator = BatchCalculator(storage=storage)


class StartRequest(BaseModel):
    start_seed_id: int = 1
    end_seed_id: int = 99999999
    batch_size: int = 100


@router.post("/start")
async def start_calculation(request: StartRequest):
    """启动统计计算"""
    if calculator.is_running:
        return {"task_id": "existing", "message": "计算已在运行中"}
    
    calculator.start(
        start_seed_id=request.start_seed_id,
        end_seed_id=request.end_seed_id,
        batch_size=request.batch_size
    )
    
    return {"task_id": "new", "message": "计算已启动"}


@router.post("/stop")
async def stop_calculation():
    """停止统计计算"""
    if not calculator.is_running:
        return {"message": "计算未在运行"}
    
    calculator.stop()
    return {"message": "计算已停止"}


@router.post("/resume")
async def resume_calculation():
    """恢复统计计算"""
    if calculator.is_running:
        return {"message": "计算已在运行中"}
    
    calculator.resume()
    return {"message": "计算已恢复"}


@router.get("/status")
async def get_status():
    """获取计算状态"""
    return calculator.get_status()


@router.get("/{star_num}")
async def get_stats(star_num: int):
    """获取指定恒星数量的统计结果"""
    if star_num < 32 or star_num > 64:
        raise HTTPException(status_code=400, detail="恒星数量必须在32-64之间")
    
    stats = storage.load_stats(star_num)
    if stats is None:
        raise HTTPException(status_code=404, detail=f"没有{star_num}恒星的统计数据")
    
    return stats


@router.get("/overview")
async def get_overview():
    """获取所有恒星数量的统计概览"""
    stats = []
    for star_num in range(32, 65):
        star_stats = storage.load_stats(star_num)
        if star_stats is not None:
            stats.append({
                "star_num": star_num,
                "seed_count": star_stats["seed_count"]
            })
    
    return {"stats": stats}
```

- [ ] **Step 4: 修改main.py集成统计API**

```python
# backend/main.py (添加以下内容)
from stats_api import router as stats_router

# 在app创建后添加
app.include_router(stats_router)
```

- [ ] **Step 5: 运行测试验证通过**

Run: `cd backend && python -m pytest test_stats_api.py -v`
Expected: PASS

- [ ] **Step 6: 提交代码**

```bash
git add backend/stats_api.py backend/test_stats_api.py backend/main.py
git commit -m "feat: add statistics API endpoints"
```

---

## Task 5: 创建前端统计面板组件

**Files:**
- Create: `src/SeedStatsPanel.jsx`
- Create: `src/seed_stats_binding.js`
- Modify: `src/SeedViewerPage.jsx`

**Interfaces:**
- Consumes: Statistics API endpoints from Task 4
- Produces: SeedStatsPanel component, seed_stats_binding functions

- [ ] **Step 1: 创建API绑定文件**

```javascript
// src/seed_stats_binding.js
/**
 * 统计API绑定
 * 提供前端调用统计API的函数
 */

const API_BASE = 'http://localhost:8000/api/seed-stats';

/**
 * 启动统计计算
 */
export async function startStatsCalculation(startSeedId = 1, endSeedId = 99999999, batchSize = 100) {
    const response = await fetch(`${API_BASE}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            start_seed_id: startSeedId,
            end_seed_id: endSeedId,
            batch_size: batchSize
        })
    });
    
    if (!response.ok) {
        throw new Error(`启动计算失败: ${response.statusText}`);
    }
    
    return response.json();
}

/**
 * 停止统计计算
 */
export async function stopStatsCalculation() {
    const response = await fetch(`${API_BASE}/stop`, {
        method: 'POST'
    });
    
    if (!response.ok) {
        throw new Error(`停止计算失败: ${response.statusText}`);
    }
    
    return response.json();
}

/**
 * 恢复统计计算
 */
export async function resumeStatsCalculation() {
    const response = await fetch(`${API_BASE}/resume`, {
        method: 'POST'
    });
    
    if (!response.ok) {
        throw new Error(`恢复计算失败: ${response.statusText}`);
    }
    
    return response.json();
}

/**
 * 获取计算状态
 */
export async function getStatsStatus() {
    const response = await fetch(`${API_BASE}/status`);
    
    if (!response.ok) {
        throw new Error(`获取状态失败: ${response.statusText}`);
    }
    
    return response.json();
}

/**
 * 获取指定恒星数量的统计结果
 */
export async function getStatsResult(starNum) {
    const response = await fetch(`${API_BASE}/${starNum}`);
    
    if (!response.ok) {
        if (response.status === 404) {
            return null;
        }
        throw new Error(`获取统计结果失败: ${response.statusText}`);
    }
    
    return response.json();
}

/**
 * 获取统计概览
 */
export async function getStatsOverview() {
    const response = await fetch(`${API_BASE}/overview`);
    
    if (!response.ok) {
        throw new Error(`获取统计概览失败: ${response.statusText}`);
    }
    
    return response.json();
}
```

- [ ] **Step 2: 创建统计面板组件**

```jsx
// src/SeedStatsPanel.jsx
import { useState, useEffect, useCallback } from 'react';
import { FaPlay, FaStop, FaSync, FaSpinner } from 'react-icons/fa';
import {
    startStatsCalculation,
    stopStatsCalculation,
    resumeStatsCalculation,
    getStatsStatus,
    getStatsResult,
    getStatsOverview
} from './seed_stats_binding';

export default function SeedStatsPanel({ onViewResult }) {
    const [status, setStatus] = useState(null);
    const [overview, setOverview] = useState(null);
    const [selectedStarNum, setSelectedStarNum] = useState(64);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    // 获取状态
    const fetchStatus = useCallback(async () => {
        try {
            const data = await getStatsStatus();
            setStatus(data);
        } catch (err) {
            console.error('获取状态失败:', err);
        }
    }, []);

    // 获取概览
    const fetchOverview = useCallback(async () => {
        try {
            const data = await getStatsOverview();
            setOverview(data);
        } catch (err) {
            console.error('获取概览失败:', err);
        }
    }, []);

    // 定时轮询状态
    useEffect(() => {
        fetchStatus();
        fetchOverview();

        const interval = setInterval(() => {
            fetchStatus();
            fetchOverview();
        }, 5000);

        return () => clearInterval(interval);
    }, [fetchStatus, fetchOverview]);

    // 启动计算
    const handleStart = async () => {
        try {
            setIsLoading(true);
            setError(null);
            await startStatsCalculation();
            await fetchStatus();
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    // 停止计算
    const handleStop = async () => {
        try {
            setIsLoading(true);
            setError(null);
            await stopStatsCalculation();
            await fetchStatus();
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    // 恢复计算
    const handleResume = async () => {
        try {
            setIsLoading(true);
            setError(null);
            await resumeStatsCalculation();
            await fetchStatus();
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    // 查看统计结果
    const handleViewResult = async () => {
        try {
            setIsLoading(true);
            setError(null);
            const result = await getStatsResult(selectedStarNum);
            if (result) {
                onViewResult(result);
            } else {
                setError(`没有${selectedStarNum}恒星的统计数据`);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    // 格式化进度条
    const formatProgress = (percent) => {
        const filled = Math.round(percent / 5);
        const empty = 20 - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
    };

    return (
        <div className="seed-stats-panel">
            <h3>统计分析</h3>
            
            {/* 控制按钮 */}
            <div className="stats-controls">
                {!status?.is_running ? (
                    <>
                        <button onClick={handleStart} disabled={isLoading}>
                            <FaPlay /> 开始计算
                        </button>
                        <button onClick={handleResume} disabled={isLoading}>
                            <FaSync /> 继续计算
                        </button>
                    </>
                ) : (
                    <button onClick={handleStop} disabled={isLoading}>
                        <FaStop /> 停止计算
                    </button>
                )}
            </div>

            {/* 错误提示 */}
            {error && (
                <div className="stats-error">
                    {error}
                </div>
            )}

            {/* 进度显示 */}
            {status && (
                <div className="stats-progress">
                    <div className="progress-bar">
                        {formatProgress(status.progress_percent)} {status.progress_percent.toFixed(1)}%
                    </div>
                    <div className="progress-info">
                        当前: {status.current_seed_id.toLocaleString()} / {status.total_seeds.toLocaleString()}
                    </div>
                    <div className="progress-time">
                        已用: {status.elapsed_time}  剩余: {status.estimated_remaining}
                    </div>
                </div>
            )}

            {/* 统计概览 */}
            {overview && overview.stats.length > 0 && (
                <div className="stats-overview">
                    <h4>已统计的恒星数量</h4>
                    <div className="overview-list">
                        {overview.stats.map(item => (
                            <div key={item.star_num} className="overview-item">
                                {item.star_num}恒星: {item.seed_count.toLocaleString()}个种子
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 查看统计结果 */}
            <div className="stats-view">
                <h4>查看统计结果</h4>
                <div className="view-controls">
                    <select
                        value={selectedStarNum}
                        onChange={(e) => setSelectedStarNum(Number(e.target.value))}
                    >
                        {Array.from({ length: 33 }, (_, i) => i + 32).map(num => (
                            <option key={num} value={num}>{num}恒星</option>
                        ))}
                    </select>
                    <button onClick={handleViewResult} disabled={isLoading}>
                        {isLoading ? <FaSpinner className="spinner" /> : null}
                        查看结果
                    </button>
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 3: 修改SeedViewerPage集成统计面板**

```jsx
// src/SeedViewerPage.jsx (添加以下导入和状态)
import SeedStatsPanel from './SeedStatsPanel';

// 在组件内部添加状态
const [statsResult, setStatsResult] = useState(null);

// 在return语句中添加统计面板
<SeedStatsPanel onViewResult={setStatsResult} />

// 如果有statsResult，显示统计结果
{statsResult && (
    <SeedViewerResult data={statsResult} />
)}
```

- [ ] **Step 4: 添加CSS样式**

```css
/* src/SeedViewer.css (添加以下样式) */
.seed-stats-panel {
    background: #f5f5f5;
    border-radius: 8px;
    padding: 16px;
    margin: 16px 0;
}

.seed-stats-panel h3 {
    margin-top: 0;
    margin-bottom: 12px;
    color: #333;
}

.seed-stats-panel h4 {
    margin-top: 12px;
    margin-bottom: 8px;
    color: #555;
}

.stats-controls {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
}

.stats-controls button {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    background: #007bff;
    color: white;
    cursor: pointer;
    font-size: 14px;
}

.stats-controls button:hover {
    background: #0056b3;
}

.stats-controls button:disabled {
    background: #ccc;
    cursor: not-allowed;
}

.stats-error {
    background: #f8d7da;
    color: #721c24;
    padding: 8px 12px;
    border-radius: 4px;
    margin-bottom: 12px;
}

.stats-progress {
    background: white;
    padding: 12px;
    border-radius: 4px;
    margin-bottom: 12px;
}

.progress-bar {
    font-family: monospace;
    font-size: 14px;
    margin-bottom: 8px;
    color: #007bff;
}

.progress-info {
    font-size: 13px;
    color: #666;
    margin-bottom: 4px;
}

.progress-time {
    font-size: 13px;
    color: #666;
}

.stats-overview {
    background: white;
    padding: 12px;
    border-radius: 4px;
    margin-bottom: 12px;
}

.overview-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.overview-item {
    background: #e9ecef;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 13px;
}

.stats-view {
    background: white;
    padding: 12px;
    border-radius: 4px;
}

.view-controls {
    display: flex;
    gap: 8px;
    align-items: center;
}

.view-controls select {
    padding: 8px;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 14px;
}

.view-controls button {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    background: #28a745;
    color: white;
    cursor: pointer;
    font-size: 14px;
}

.view-controls button:hover {
    background: #218838;
}

.view-controls button:disabled {
    background: #ccc;
    cursor: not-allowed;
}

.spinner {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
```

- [ ] **Step 5: 提交代码**

```bash
git add src/SeedStatsPanel.jsx src/seed_stats_binding.js src/SeedViewerPage.jsx src/SeedViewer.css
git commit -m "feat: add statistics panel to seed viewer"
```

---

## Task 6: 验证运行均值算法正确性

**Files:**
- Create: `backend/verify_stats.py`
- Test: `backend/test_verify_stats.py`

**Interfaces:**
- Consumes: `RunningAverageCalculator` from Task 1, `StatsStorage` from Task 2
- Produces: Verification results

- [ ] **Step 1: 创建测试文件**

```python
# backend/test_verify_stats.py
import pytest
from verify_stats import verify_running_average


def test_verify_running_average():
    """验证运行均值算法正确性"""
    # 这个测试需要实际调用CApi，可能比较慢
    # 在实际环境中运行
    result = verify_running_average(seed_range=10)  # 只测试10个种子
    
    assert result["passed"] == True
    assert result["max_error"] < 0.0001  # 误差小于0.01%
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend && python -m pytest test_verify_stats.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'verify_stats'"

- [ ] **Step 3: 实现验证脚本**

```python
# backend/verify_stats.py
"""
验证运行均值算法正确性
对比简单平均和运行均值的结果
"""

import sys
from pathlib import Path

# 添加原项目的CApi路径
SEED_VIEWER_PATH = Path("D:/编程/种子查看器")
sys.path.insert(0, str(SEED_VIEWER_PATH))

# 导入原项目的C API
from dsp_search_seed.CApi.search_seed import (
    do_init_c,
    get_galaxy_data_c,
    Seed,
)

from stats_calculator import RunningAverageCalculator


def calculate_simple_average(galaxies):
    """计算简单平均"""
    if not galaxies:
        return None
    
    # 初始化结果
    result = {
        "star_num": galaxies[0].star_num,
        "seed_count": len(galaxies),
        "stars_stats": []
    }
    
    # 初始化每个恒星的统计
    for i in range(galaxies[0].star_num):
        result["stars_stats"].append({
            "avg_distance": 0.0,
            "avg_dyson_radius": 0.0,
            "avg_dyson_lumino": 0.0,
            "avg_veins_point": [0.0] * 14,
            "avg_veins_amount": [0.0] * 14,
            "avg_gas_veins": [0.0] * 3,
            "avg_liquid": [0, 0]
        })
    
    # 累加所有星系的数据
    for galaxy in galaxies:
        sorted_stars = sorted(galaxy.stars, key=lambda s: s.distance)
        
        for i, star in enumerate(sorted_stars):
            result["stars_stats"][i]["avg_distance"] += star.distance
            result["stars_stats"][i]["avg_dyson_radius"] += star.dyson_radius
            result["stars_stats"][i]["avg_dyson_lumino"] += star.dyson_lumino
            
            for j in range(14):
                result["stars_stats"][i]["avg_veins_point"][j] += star.veins_point[j]
                result["stars_stats"][i]["avg_veins_amount"][j] += star.veins_amount[j]
            
            for j in range(3):
                result["stars_stats"][i]["avg_gas_veins"][j] += star.gas_veins[j]
            
            for j in range(2):
                result["stars_stats"][i]["avg_liquid"][j] += star.liquid[j]
    
    # 计算平均值
    count = len(galaxies)
    for i in range(galaxies[0].star_num):
        result["stars_stats"][i]["avg_distance"] /= count
        result["stars_stats"][i]["avg_dyson_radius"] /= count
        result["stars_stats"][i]["avg_dyson_lumino"] /= count
        
        for j in range(14):
            result["stars_stats"][i]["avg_veins_point"][j] /= count
            result["stars_stats"][i]["avg_veins_amount"][j] /= count
        
        for j in range(3):
            result["stars_stats"][i]["avg_gas_veins"][j] /= count
        
        for j in range(2):
            result["stars_stats"][i]["avg_liquid"][j] //= count
    
    return result


def compare_results(simple_avg, running_avg, star_num):
    """对比两种方法的结果"""
    if simple_avg is None or running_avg is None:
        return {"passed": False, "error": "结果为空"}
    
    max_error = 0.0
    errors = []
    
    # 对比每个恒星的统计
    for i in range(star_num):
        simple_star = simple_avg["stars_stats"][i]
        running_star = running_avg["stars_stats"][i]
        
        # 对比距离
        error = abs(simple_star["avg_distance"] - running_star["avg_distance"])
        max_error = max(max_error, error)
        if error > 0.0001:
            errors.append(f"恒星{i}距离误差: {error}")
        
        # 对比戴森球半径
        error = abs(simple_star["avg_dyson_radius"] - running_star["avg_dyson_radius"])
        max_error = max(max_error, error)
        if error > 0.0001:
            errors.append(f"恒星{i}戴森球半径误差: {error}")
        
        # 对比亮度
        error = abs(simple_star["avg_dyson_lumino"] - running_star["avg_dyson_lumino"])
        max_error = max(max_error, error)
        if error > 0.0001:
            errors.append(f"恒星{i}亮度误差: {error}")
        
        # 对比矿点数
        for j in range(14):
            error = abs(simple_star["avg_veins_point"][j] - running_star["avg_veins_point"][j])
            max_error = max(max_error, error)
            if error > 0.0001:
                errors.append(f"恒星{i}矿点{j}误差: {error}")
    
    return {
        "passed": len(errors) == 0,
        "max_error": max_error,
        "errors": errors
    }


def verify_running_average(seed_range: int = 100, star_num: int = 64):
    """验证运行均值算法正确性"""
    # 初始化C库
    do_init_c()
    
    # 方法A：简单平均（保留所有数据）
    all_galaxies = []
    for seed_id in range(1, seed_range + 1):
        try:
            seed = Seed(seed_id, star_num, 0)
            galaxy = get_galaxy_data_c(seed, False)
            all_galaxies.append(galaxy)
        except Exception as e:
            print(f"种子{seed_id}计算失败: {str(e)}")
            return {"passed": False, "error": f"种子{seed_id}计算失败: {str(e)}"}
    
    simple_avg = calculate_simple_average(all_galaxies)
    
    # 方法B：运行均值（只保留均值）
    calculator = RunningAverageCalculator()
    for seed_id in range(1, seed_range + 1):
        try:
            seed = Seed(seed_id, star_num, 0)
            galaxy = get_galaxy_data_c(seed, False)
            calculator.process_galaxy(galaxy)
        except Exception as e:
            print(f"种子{seed_id}计算失败: {str(e)}")
            return {"passed": False, "error": f"种子{seed_id}计算失败: {str(e)}"}
    
    running_avg_stats = calculator.get_stats(star_num)
    running_avg = {
        "star_num": star_num,
        "seed_count": running_avg_stats.seed_count,
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
            for star in running_avg_stats.stars_stats
        ]
    }
    
    # 对比两种方法的结果
    result = compare_results(simple_avg, running_avg, star_num)
    
    return result


if __name__ == "__main__":
    # 运行验证
    print("开始验证运行均值算法...")
    result = verify_running_average(seed_range=10, star_num=64)
    
    if result["passed"]:
        print("✓ 验证通过！运行均值算法正确。")
        print(f"  最大误差: {result['max_error']:.6f}")
    else:
        print("✗ 验证失败！")
        print(f"  最大误差: {result['max_error']:.6f}")
        for error in result.get("errors", []):
            print(f"  - {error}")
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd backend && python -m pytest test_verify_stats.py -v`
Expected: PASS

- [ ] **Step 5: 运行实际验证**

Run: `cd backend && python verify_stats.py`
Expected: "✓ 验证通过！运行均值算法正确。"

- [ ] **Step 6: 提交代码**

```bash
git add backend/verify_stats.py backend/test_verify_stats.py
git commit -m "feat: add verification script for running average algorithm"
```

---

## Task 7: 集成测试和端到端验证

**Files:**
- Create: `backend/test_integration.py`

**Interfaces:**
- Consumes: All previous components
- Produces: Integration test results

- [ ] **Step 1: 创建集成测试文件**

```python
# backend/test_integration.py
import pytest
import time
import threading
from main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def test_full_workflow():
    """测试完整工作流程"""
    # 1. 启动计算
    response = client.post("/api/seed-stats/start", json={
        "start_seed_id": 1,
        "end_seed_id": 10,
        "batch_size": 5
    })
    assert response.status_code == 200
    
    # 2. 等待计算完成
    for _ in range(20):  # 最多等待10秒
        time.sleep(0.5)
        response = client.get("/api/seed-stats/status")
        status = response.json()
        if not status["is_running"]:
            break
    
    # 3. 检查计算状态
    assert status["is_running"] == False
    assert status["current_seed_id"] == 10
    
    # 4. 获取统计结果
    response = client.get("/api/seed-stats/64")
    # 可能返回200或404（取决于是否有64恒星的种子）
    if response.status_code == 200:
        stats = response.json()
        assert stats["star_num"] == 64
        assert stats["seed_count"] > 0
    
    # 5. 获取统计概览
    response = client.get("/api/seed-stats/overview")
    assert response.status_code == 200
    overview = response.json()
    assert "stats" in overview


def test_interrupt_resume():
    """测试中断和恢复"""
    # 1. 启动计算
    response = client.post("/api/seed-stats/start", json={
        "start_seed_id": 1,
        "end_seed_id": 100,
        "batch_size": 10
    })
    assert response.status_code == 200
    
    # 2. 等待一小段时间
    time.sleep(1)
    
    # 3. 停止计算
    response = client.post("/api/seed-stats/stop")
    assert response.status_code == 200
    
    # 4. 等待计算停止
    time.sleep(0.5)
    
    # 5. 检查状态
    response = client.get("/api/seed-stats/status")
    status = response.json()
    assert status["is_running"] == False
    
    # 6. 恢复计算
    response = client.post("/api/seed-stats/resume")
    assert response.status_code == 200
    
    # 7. 等待计算完成
    for _ in range(30):  # 最多等待15秒
        time.sleep(0.5)
        response = client.get("/api/seed-stats/status")
        status = response.json()
        if not status["is_running"]:
            break
    
    # 8. 检查最终状态
    assert status["is_running"] == False
    assert status["current_seed_id"] == 100


def test_error_handling():
    """测试错误处理"""
    # 尝试获取不存在的统计结果
    response = client.get("/api/seed-stats/100")  # 100不在32-64范围内
    assert response.status_code == 400
    
    response = client.get("/api/seed-stats/32")  # 可能没有数据
    assert response.status_code in [200, 404]
```

- [ ] **Step 2: 运行集成测试**

Run: `cd backend && python -m pytest test_integration.py -v`
Expected: PASS

- [ ] **Step 3: 提交代码**

```bash
git add backend/test_integration.py
git commit -m "test: add integration tests for seed statistics"
```

---

## Task 8: 文档和清理

**Files:**
- Modify: `backend/README.md`
- Create: `docs/seed-stats-guide.md`

- [ ] **Step 1: 更新后端README**

```markdown
# backend/README.md (添加以下内容)

## 种子统计分析功能

### 功能说明
- 计算1亿个种子的统计均值
- 支持33种恒星数量（32-64）
- 支持中断和继续计算
- 集成到现有种子查看器界面

### API接口

#### 计算控制
- `POST /api/seed-stats/start` - 启动计算
- `POST /api/seed-stats/stop` - 停止计算
- `POST /api/seed-stats/resume` - 恢复计算

#### 数据查询
- `GET /api/seed-stats/status` - 获取计算状态
- `GET /api/seed-stats/{star_num}` - 获取指定恒星数量的统计结果
- `GET /api/seed-stats/overview` - 获取统计概览

### 使用示例

#### 启动计算
```bash
curl -X POST http://localhost:8000/api/seed-stats/start \
  -H "Content-Type: application/json" \
  -d '{"start_seed_id": 1, "end_seed_id": 1000, "batch_size": 100}'
```

#### 获取状态
```bash
curl http://localhost:8000/api/seed-stats/status
```

#### 获取统计结果
```bash
curl http://localhost:8000/api/seed-stats/64
```
```

- [ ] **Step 2: 创建用户指南**

```markdown
# docs/seed-stats-guide.md

# 种子统计分析使用指南

## 功能介绍

种子统计分析功能可以计算戴森球计划游戏中所有种子的统计均值，帮助玩家了解不同恒星数量下的平均资源分布。

## 使用方法

### 1. 启动后端服务

```bash
cd backend
python main.py
```

### 2. 打开种子查看器

在浏览器中访问种子查看器页面。

### 3. 使用统计功能

1. 在统计分析面板中点击"开始计算"
2. 等待计算完成（可以随时停止和继续）
3. 选择恒星数量，点击"查看结果"
4. 查看统计结果，可以使用现有的复制和导出功能

## 注意事项

- 计算时间较长，建议分段计算
- 计算过程中可以随时停止和继续
- 统计结果会自动保存，下次启动时可以继续计算
- 资源倍率固定为1倍

## 技术细节

- 计算策略：每个种子计算所有33种恒星数量（32-64）
- 进度管理：批量级别，每100个种子为一个批次
- 数据存储：运行均值，只保留统计数据，不保留原始数据
- 错误处理：单个种子计算失败时暂停并弹窗提示
```

- [ ] **Step 3: 提交代码**

```bash
git add backend/README.md docs/seed-stats-guide.md
git commit -m "docs: add seed statistics documentation"
```

---

## 实现计划总结

### 任务列表
1. **Task 1**: 创建运行均值计算器
2. **Task 2**: 创建统计数据存储
3. **Task 3**: 创建批量计算引擎
4. **Task 4**: 创建统计API接口
5. **Task 5**: 创建前端统计面板组件
6. **Task 6**: 验证运行均值算法正确性
7. **Task 7**: 集成测试和端到端验证
8. **Task 8**: 文档和清理

### 预计时间
- Task 1-2: 2-3小时
- Task 3-4: 2-3小时
- Task 5: 2-3小时
- Task 6-7: 1-2小时
- Task 8: 1小时
- **总计**: 8-12小时

### 依赖关系
- Task 1 无依赖
- Task 2 依赖 Task 1
- Task 3 依赖 Task 1, 2
- Task 4 依赖 Task 1, 2, 3
- Task 5 依赖 Task 4
- Task 6 依赖 Task 1, 2
- Task 7 依赖所有前序任务
- Task 8 依赖所有前序任务

### 验证方法
- 每个任务都有对应的单元测试
- Task 6 提供运行均值算法正确性验证
- Task 7 提供端到端集成测试
- 所有测试通过后即可使用
