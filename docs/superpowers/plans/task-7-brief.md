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

