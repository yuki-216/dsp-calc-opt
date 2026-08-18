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

