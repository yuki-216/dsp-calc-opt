# 种子统计分析系统设计文档

## 概述

本设计文档描述了一个种子统计分析系统，用于计算戴森球计划游戏中所有种子的统计均值。系统采用批量计算和运行均值算法，支持中断和继续，集成到现有种子查看器界面。

## 设计目标

1. **大规模计算**：支持1亿个种子（1-99999999）的统计计算
2. **运行均值**：只保留均值数据，新数据通过加权方式影响均值
3. **批量计算**：利用CApi并发能力，提高计算效率
4. **中断继续**：支持随时中断和继续计算
5. **前端集成**：无缝集成到现有种子查看器界面
6. **验证机制**：开发阶段验证计算逻辑正确性

## 系统架构

### 整体架构
```
前端 (React) ↔ 当前项目后端 (FastAPI) ──subprocess──→ 独立计算子进程 (run_stats_calc.py)
     ↓                    ↓                                    ↓
   UI控制            文件读取/子进程管理              源项目 dsp_search_seed 并发API
                                                     (GetDataManager: GPU加速+多线程)
                                       ↑
                              进度/结果 通过文件通信
                        (progress.json / stats_*.json / runtime.json / stop.flag)
```

### 核心设计决策（新架构）
1. **计算独立化**：统计期望计算在独立子进程中运行，接入源项目 `D:\编程\种子查看器` 的
   `GetDataManager` 并发API——它基于该项目的GPU加速与多线程优化，性能远高于单线程
   `get_galaxy_data_c` 循环。子进程由当前项目后端 spawn，二者**不共享内存**。
2. **文件通信**：子进程把进度与均值结果写入 `backend/data/seed_stats/`；
   后端通过读文件 + PID 存活检测提供状态，通过写 `stop.flag` 优雅停止子进程。
3. **前端不变**：当前 React 项目仍是唯一控制/展示入口，调用后端API。

### 核心组件
1. **计算子进程入口**：`run_stats_calc.py`，由后端 subprocess 启动，执行批量计算
2. **批量计算引擎**：`batch_calculator.py`，内部对接源项目 `GetDataManager` 并发计算
3. **运行均值计算器**：`stats_calculator.py`，维护和更新统计均值（运行均值算法）
4. **状态存储器**：`stats_storage.py`，持久化进度/均值/runtime 标记（文件）
5. **API接口层**：`stats_api.py`，子进程生命周期管理 + 文件状态读取
6. **前端UI层**：集成到现有种子查看器页面（后续任务）

## 数据结构设计

### 运行均值数据结构
```python
# 每个恒星数量组的统计结果
StarNumStats:
  star_num: int                    # 恒星数量 (32-64)
  seed_count: int                  # 已计算的种子数
  current_seed_id: int             # 当前计算到的种子ID
  
  # 每个恒星位置的统计 (按距离排序)
  stars_stats: list[StarStats]     # 长度 = star_num
  
  # 星区汇总统计可以从stars_stats计算得出
  # 展示时：galaxy_avg_veins_point = sum(star.avg_veins_point for star in stars_stats)

# 单个恒星位置的统计
StarStats:
  avg_distance: float              # 平均距离 (LY)
  avg_dyson_radius: float          # 平均戴森球半径 (m)
  avg_dyson_lumino: float          # 平均亮度
  
  # 矿物统计
  avg_veins_point: list[float]     # 14种矿物的平均矿点数
  avg_veins_amount: list[float]    # 14种矿物的平均矿物数
  avg_gas_veins: list[float]       # 3种气体的平均值
  avg_liquid: list[int]            # 液体统计
```

### 恒星排序规则
- 按距离从小到大排序
- 距离最小的出生星 = 第0星
- 距离第二小的 = 第1星
- 以此类推...
- 统计均值时，第n星的均值是基于所有种子中第n星的数据计算的

### 存储文件结构
```
backend/data/seed_stats/
  ├── progress.json          # 计算进度（整批提交）
  ├── runtime.json           # 子进程运行时标记（PID/起止范围），结束即清除
  ├── stop.flag              # 停止信号（后端写入，子进程在批次间隙检测）
  ├── stats_32.json          # 32恒星的统计结果
  ├── stats_33.json          # 33恒星的统计结果
  ├── ...
  ├── stats_64.json          # 64恒星的统计结果
  └── verification/          # 验证阶段数据
      ├── simple_avg.json    # 简单平均结果
      ├── running_avg.json   # 运行均值结果
      └── comparison.json    # 对比结果
```

### 进度文件结构
```python
{
  "completed_seed_id": 1234500,  # 最后一个完整批次的结束种子ID
  "seed_count": 1234500,         # 已计算种子数（必须是batch_size的倍数）
  "batch_size": 100,             # 批次大小
  "start_seed_id": 1,            # 起始种子ID
  "end_seed_id": 99999999,       # 结束种子ID
  "stats_files": {               # 各恒星数量的统计文件路径
    "32": "data/seed_stats/stats_32.json",
    "33": "data/seed_stats/stats_33.json",
    ...
    "64": "data/seed_stats/stats_64.json"
  }
}
```

## 计算逻辑设计

### 批量计算流程（核心：GetDataManager 并发）
```python
def process_batch(batch_start, batch_end):
    """一批内：全部任务 add_task 进 GetDataManager，轮询 get_results() 排空缓冲。"""
    manager = GetDataManager(max_thread, False, 128)   # quick=False 精确矿脉；位置参数
    for seed_id in range(batch_start, batch_end + 1):
        for star_num in range(32, 65):                 # 32-64，共33种
            manager.add_task(Seed(seed_id, star_num, 4))  # 资源索引4 = 1倍
    finished = 0
    total = (batch_end - batch_start + 1) * 33
    while finished < total:
        if should_stop():          # stop标志 或 stop.flag 文件
            return False           # 中途停止：本批丢弃，不提交
        results = manager.get_results()
        if not results:
            time.sleep(0.05)       # 工作线程仍计算中，避免忙等
            continue
        for galaxy in results:
            process_galaxy(galaxy) # 完整 GalaxyData，含 star_num=32..64
            finished += 1
    manager.shutdown()             # 必须：join 工作线程
    return True                    # 整批完成才允许提交

# 外层批次循环
for batch_start in range(start, end + 1, batch_size):
    if should_stop():
        break
    if not process_batch(batch_start, batch_end):
        break                      # 停止/异常：不提交部分数据
    save_progress(completed=batch_end)   # 整批成功才覆盖进度
    save_all_stats()
```

**注意（源项目绑定契约）**：
- `GetDataManager(max_thread, quick, max_cache)` 只接受**位置参数**（pybind11 不解析关键字）
- `add_task` 只收 **1 个 `Seed` 对象**（不是3个int）
- `max_cache=128` 是背压上限：必须定期 `get_results()` 排空，否则工作线程阻塞
- `do_init_c()` 须在构造 manager 前调用（`BatchCalculator.__init__` 已做）

### 计算量说明
- 每个种子需要计算33种恒星数量（32-64）
- 批量大小100个种子 = 3300次计算/批次
- 总计算量：1亿种子 × 33种恒星 = 33亿次计算
- 并行加速：`GetDataManager` 以 max_thread 个线程并发，源项目 GUI 采用 cpu_count()-1
  （内部 clamp 到 [1,128]）；每线程独立生成一个种子的一个 star_num 的完整 galaxy——
  相比单线程预估约380天的量级被显著压缩，具体取决于机器核数与GPU加速效果

### 处理单个星系数据
```python
def process_galaxy(galaxy, star_num):
    """处理单个星系数据，更新运行均值"""
    stats = get_stats(star_num)
    
    # 1. 按距离排序恒星
    sorted_stars = sorted(galaxy.stars, key=lambda s: s.distance)
    
    # 2. 更新每个恒星位置的统计
    for i, star in enumerate(sorted_stars):
        update_star_stats(stats.stars_stats[i], star, stats.seed_count)
    
    # 3. 更新种子计数
    stats.seed_count += 1
```

### 运行均值更新公式
```python
def update_average(current_avg, new_value, count):
    """更新运行均值"""
    return current_avg + (new_value - current_avg) / count
```

## API接口设计

### 计算控制API
```python
# 开始计算（spawn 子进程 run_stats_calc.py --start --end --batch）
POST /api/seed-stats/start
Request:
  start_seed_id: int = 1          # 起始种子ID
  end_seed_id: int = 99999999     # 结束种子ID
  batch_size: int = 100           # 批次大小

Response:
  task_id: str                    # 任务ID
  message: str                    # 提示信息

# 停止计算（写 stop.flag 优雅停止子进程，等待退出，超时强制 kill）
POST /api/seed-stats/stop
Response:
  message: str

# 继续计算（spawn 子进程不传 --start，自动从 progress 的 completed+1 恢复）
POST /api/seed-stats/resume
Response:
  message: str

# 获取计算状态（读 progress.json + runtime.json，PID存活检测判定是否运行中）
GET /api/seed-stats/status
Response:
  is_running: bool
  current_seed_id: int
  total_seeds: int
  progress_percent: float
  elapsed_time: str
  estimated_remaining: str
```

### 数据查询API
```python
# 获取指定恒星数的统计结果
GET /api/seed-stats/{star_num}
Response:
  star_num: int
  seed_count: int
  stars_stats: list[StarStats]

# 获取所有恒星数的统计概览
# 注意：该路由定义在 /{star_num} 之前，避免 star_num 误匹配 "overview"
GET /api/seed-stats/overview
Response:
  stats: list[{ star_num, seed_count }]
```

## 前端UI设计

### 集成到现有页面布局
```
┌─────────────────────────────────────────────────┐
│  [现有种子查看器界面]                            │
│                                                 │
│  种子ID: [________] 恒星数: [64] 资源倍率: [1倍] │
│  [查询]                                         │
│                                                 │
│  ┌─ 统计分析 ─────────────────────────────────┐ │
│  │  [开始计算] [停止计算] [继续计算]           │ │
│  │                                             │ │
│  │  进度: ████████░░░░░░░░░░░░ 12.3%          │ │
│  │  当前: 1,234,567 / 99,999,999              │ │
│  │  已用: 2小时30分  剩余: 8天12小时           │ │
│  │                                             │ │
│  │  查看统计: [选择恒星数: 64] [查看结果]      │ │
│  └─────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ 星球树 ─────┐  ┌─ 信息展示 ──────────────┐ │
│  │  (统计结果    │  │  (统计结果详情)         │ │
│  │   复用现有    │  │  星区汇总:              │ │
│  │   星球树组件) │  │  铁:100矿点(1000M)     │ │
│  │              │  │  铜:50矿点(500M)       │ │
│  │  第0星       │  │  ...                    │ │
│  │  第1星       │  │                         │ │
│  │  ...         │  │  恒星详情:              │ │
│  │              │  │  第0星: 距离2.5LY ...   │ │
│  └──────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### 设计要点
1. **简化控制**：只保留开始/停止/继续按钮
2. **复用导出**：统计结果直接使用现有的复制和导出功能
3. **复用展示**：统计结果通过现有的星球树和信息面板展示
4. **无缝体验**：查看统计结果和查看单个种子结果的操作方式一致

## 错误处理与进度管理

### 简化后的进度管理
- 只记录一个变量：`completed_seed_id`
- 下次计算（resume）从`completed_seed_id + 1`开始
- **只有整批全部成功才更新进度**；批次中途停止/异常 → 该批丢弃，resume 时整批重算
- 每批完成后原子写入 progress.json + 33个 stats 文件

### 错误处理流程
```python
def process_batch(batch_start, batch_end) -> bool:
    manager = GetDataManager(max_thread, False, 128)
    try:
        # ... add_task 全部任务，轮询 get_results() 逐个消费 ...
        return True          # 整批完成
    except Exception as e:
        # 任一 galaxy 处理出错 → 抛给上层，暂停计算并提示
        pause_calculation()
        show_error_popup(f"批次[{batch_start}-{batch_end}]计算失败: {str(e)}")
        return False
    finally:
        manager.shutdown()   # 必须 join 线程
    # 上层：return False → 不 save_progress / save_stats，退出
```

### 中断保证机制
1. **非阻塞**：计算在独立**子进程**运行，API 服务（FastAPI）完全不被计算阻塞
2. **优雅停止**：后端写 `stop.flag` 文件；子进程在**批次内轮询** `get_results()` 时周期性
   检测，中途停止则该批不提交；也可在批次边界停止
3. **批次一致性**：批次中途停止/异常不更新进度与结果文件，resume 自动重算该批
4. **进程存活检测**：`runtime.json` 记录 PID，后端据此判定子进程是否仍在运行

## 前端响应性保证

### 轮询设计
```javascript
// 前端使用定时轮询，5秒间隔
useEffect(() => {
  if (!isRunning) return;
  
  const interval = setInterval(async () => {
    try {
      const res = await fetch('/api/seed-stats/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (error) {
      console.error('获取状态失败:', error);
    }
  }, 5000); // 5秒更新一次
  
  return () => clearInterval(interval);
}, [isRunning]);
```

### 关键保证
1. **计算线程独立**：不会阻塞API响应
2. **轮询频率适中**：5秒一次，不会造成性能问题
3. **状态数据精简**：只传输必要信息，减少网络开销

## 验证设计

### 验证方法
```python
# 已实现于 backend/verify_stats.py（python verify_stats.py --start 1 --end 100）
def verify_running_average():
    """验证运行均值算法正确性（两条独立路径，原理等价原设计）"""
    # 对每种恒星数量分别验证
    for star_num in range(32, 65):
        # 1. 方法A：简单平均（累加全部原始数据，最后除以N）
        acc = SimpleAverageAccumulator(star_num)   # 每恒星位置累加字段
        for seed_id in range(1, 101):
            galaxy = get_galaxy_data_c(Seed(seed_id, star_num, RESOURCE_INDEX), False)
            acc.add(galaxy)
        simple_avg = acc.finalize()   # sum / N

        # 2. 方法B：运行均值（系统实际使用的增量式 avg += (x-avg)/count）
        running_avg = None
        for seed_id in range(1, 101):
            galaxy = ...
            running_avg = update_running_average(...)

        # 3. 对比两种方法：所有字段相对误差 < 0.01%
        compare_results(simple_avg, running_avg, star_num)
```

> 实现说明：`verify_stats.py` 实际走 **GetDataManager 并发**（与生产批处理同一条计算路径），
> 运行时逐条既喂运行均值器、又喂简单平均累加器，最终逐字段比较。

### 验证数据存储
```
data/seed_stats/
  ├── verification/
  │   ├── simple_avg.json      # 简单平均结果
  │   ├── running_avg.json     # 运行均值结果
  │   └── comparison.json      # 对比结果
  └── stats_64.json            # 正式统计结果
```

### 验证通过标准
1. 运行均值与简单平均结果误差小于0.01%
2. 每个恒星位置的统计数据正确
3. 进度记录与实际计算一致

## 实现计划

### 阶段1：后端核心逻辑 ✅ 已完成
1. ✅ 实现运行均值计算器（支持33种恒星数量）— `stats_calculator.py`
2. ✅ 实现批量计算引擎（对接源项目 `GetDataManager` 并发）— `batch_calculator.py`
3. ✅ 实现进度管理（批量级别，整批成功才提交）— `stats_storage.py`
4. ✅ 实现API接口（子进程 + 文件通信）— `stats_api.py` / `run_stats_calc.py` / `main.py`
5. ✅ 端到端验证：真实调用源项目并发API完成种子计算、停止/恢复、批次一致性

### 阶段2：前端集成 ⬜ 待实现
1. 添加统计分析UI组件（集成到种子查看器查询按钮下方）
2. 实现进度监控（5秒轮询）
3. 复用现有结果展示组件（星球树 + 信息面板）
4. 集成现有导出功能

### 阶段3：验证与优化 ⬜ 待实现
1. 实现验证逻辑（验证所有33种恒星数量：简单平均 vs 运行均值）
2. 运行验证测试
3. 性能评估（确认源项目并发加速效果与预计时间）
4. 完善错误处理

## 技术约束

1. **资源倍率**：统计过程中固定为1倍（源项目 `resource_rates` **索引4** = 1.0f；
   注意索引0是0.1倍"极少"，不是1倍）
2. **恒星数量范围**：32-64（33个值）
3. **种子ID范围**：1-99999999
4. **计算精度**：浮点数误差小于0.01%
5. **前端轮询间隔**：5秒
6. **计算策略**：每个种子计算所有33种恒星数量
7. **进度粒度**：批量级别（batch_size=100），整批成功才提交

## 风险与缓解

1. **计算时间长**：预计380天（33亿次计算 × 0.01秒/次）
   - 缓解：支持中断继续，分段计算，可考虑多进程加速

2. **浮点数精度**：运行均值可能累积误差
   - 缓解：验证阶段对比简单平均，确保误差可接受

3. **系统资源**：长时间计算可能影响系统响应
   - 缓解：后台线程计算，资源监控，自动暂停

4. **数据一致性**：中断可能导致进度和统计数据不一致
   - 缓解：只有整批成功才更新进度，原子写入文件

5. **计算量巨大**：33亿次计算，单线程可能不现实
   - 缓解：考虑利用CApi的多线程能力，或分布式计算
