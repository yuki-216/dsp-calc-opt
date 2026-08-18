## Task 3 Report: 批量计算引擎

### 实现内容

创建了 `backend/batch_calculator.py`，包含 `BatchCalculator` 类：

- **初始化**: 接收 `StatsStorage` 实例，创建 `RunningAverageCalculator`，初始化 C 库
- **start()**: 启动后台线程执行批量计算，支持配置种子范围和批次大小
- **resume()**: 从存储的进度恢复计算
- **stop()**: 通过标志位优雅停止计算
- **get_status()**: 返回运行状态、进度百分比、已用时间、预计剩余时间
- **_calculate_loop()**: 计算主循环，遍历种子和恒星数量(32-64)，每批次保存进度和统计结果

### 测试内容

创建了 `backend/test_batch_calculator.py`，包含 7 个测试：

1. `test_batch_calculator_initialization` - 初始化状态验证
2. `test_batch_calculator_start_stop` - 启动/停止功能
3. `test_batch_calculator_status` - 初始状态查询
4. `test_batch_calculator_resume` - 从保存的进度恢复
5. `test_batch_calculator_status_while_running` - 运行中状态查询
6. `test_batch_calculator_completes_and_saves` - 完成后保存进度
7. `test_batch_calculator_calls_c_api` - C API 调用验证

测试使用 `unittest.mock.patch` mock 了 C API (do_init_c, Seed, get_galaxy_data_c)，避免依赖实际编译库。

全部 26 个后端测试通过 (7 新 + 19 已有)。

### 更改的文件

- `backend/batch_calculator.py` (新建)
- `backend/test_batch_calculator.py` (新建)

### 自我审查

1. 任务简报中的测试使用 `/tmp/` 路径，已改为 `tempfile.TemporaryDirectory()` 兼容 Windows
2. 任务简报中的测试直接调用 C API，改为 mock 方式以确保测试稳定性和速度
3. `_calculate_loop` 中增加了对 `should_stop` 的内层循环检查，确保及时响应停止信号
4. 异常处理保持了任务简报的设计：计算错误时暂停并打印提示

---

## Bug Fix: 关键问题修复

### 修复 1: resume() 丢失已累积的统计数据

**问题**: `resume()` 调用 `self.start()`，但 `self.calculator` 是 `__init__` 中创建的全新 `RunningAverageCalculator`，从未从存储加载之前的统计结果。resume 后的运行均值仅基于新处理的种子，丢失了全部历史。

**修复**:
- 在 `StatsStorage` 中新增 `load_all_stats()` 方法，从存储的 stats_{star_num}.json 文件恢复完整的 `RunningAverageCalculator`
- 在 `BatchCalculator.resume()` 中调用 `self.storage.load_all_stats()` 恢复统计后再启动

### 修复 2: progress_percent 在 resume 时计算错误

**问题**: `get_status()` 中 `progress_percent = current_seed_id / total_seeds * 100`。当 resume 从 seed 50,000,000 开始，`current_seed_id` 立即为 50,000,001，`total_seeds` 为 10,000,000，导致 `progress_percent` 显示约 500%（溢出）或在小范围时显示约 100%。

**修复**:
- 在 `BatchCalculator` 中新增 `_start_seed_id` 属性，在 `start()` 中记录
- 在 `get_status()` 中用 `processed = current_seed_id - _start_seed_id` 替代 `current_seed_id` 计算进度和剩余时间

### 修复 3: test_batch_calculator_calls_c_api 是空断言测试

**问题**: 测试只启动、sleep、stop、sleep，没有任何 assert 语句。

**修复**: 将测试改为接受 `mock_c_api` fixture 参数，添加两个断言：
- `Seed` 构造函数被调用 33 次（32-64 共 33 种恒星数）
- `get_galaxy_data_c` 被调用 33 次

### 新增回归测试

- `test_resume_restores_stats` — 验证 resume 后 calculator 已恢复存储的统计数据（seed_count >= 2，均值非零）
- `test_resume_progress_percent_is_correct` — 验证 resume 从 50,000,000 开始时 progress_percent < 10%

### 更改的文件

- `backend/stats_storage.py` — 新增 `load_all_stats()` 方法，导入 `StarStats`
- `backend/batch_calculator.py` — 新增 `_start_seed_id` 属性，修复 `resume()` 和 `get_status()`
- `backend/test_batch_calculator.py` — 修复空断言测试，新增 2 个回归测试

### 测试结果

全部 28 个后端测试通过（9 batch_calculator + 9 stats_calculator + 10 stats_storage）。
