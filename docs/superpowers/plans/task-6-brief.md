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

