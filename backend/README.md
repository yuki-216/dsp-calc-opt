# 本地种子查看与统计后端

公开版默认不依赖本服务：前端使用 `public/search_seed.js` 与 `public/search_seed.wasm`
在浏览器 Worker 中查询单个种子，统计结果使用公开的 `public/stats.json`。
本服务用于本地调试种子查询，以及运行统计计算任务。前端可在浏览器控制台执行
`setSeedQueryMode('backend')` 切换到本地后端。

统计计算控制 UI 默认隐藏。启动本服务后，打开前端的“种子查看器”页面，在控制台执行：

```js
setSeedQueryMode('backend')
showStatsControls()
```

这样会显示“开始 / 停止 / 恢复”等统计控制按钮；隐藏控制区但不停止后端计算：

```js
hideStatsControls()
```

如果这些函数尚未定义，先进入种子查看器页面或刷新页面。切换到 `backend` 后，
统计面板的状态、收敛信息和控制操作才会请求本地 FastAPI；默认 `browser` 模式只读取公开的 `stats.json`。

## 安装依赖

```bash
pip install -r requirements.txt
```

## 启动服务

```bash
python main.py
```

服务将在 http://localhost:8000 启动

## API 文档

启动后访问 http://localhost:8000/docs 查看 Swagger 文档

## API 端点

### 获取种子数据（完整计算）
```
POST /api/seed
Content-Type: application/json

{
  "seed_id": 10381977,
  "star_num": 64,
  "resource_index": 0
}
```

### 健康检查
```
GET /api/health
```

## 统计分析系统（统计期望）

统计期望计算以**独立子进程**运行，计算引擎使用项目内置的
`dsp_search_seed.CApi.GetDataManager` 并发API（GPU加速 + 多线程）。
当前后端只负责子进程生命周期管理和文件读写。

### 内置种子生成依赖

项目根目录的 `dsp_search_seed/CApi/` 包含当前后端实际使用的 Python 接口、
`search_seed.pyd` 以及 Windows 运行库，不再依赖项目外部的绝对路径。
当前二进制按 Windows + Python 3.13 构建；更换 Python 主次版本时需要重新编译
`search_seed.pyd` 和对应运行库。

### 架构
```
前端 → FastAPI ──subprocess──→ run_stats_calc.py ──→ 内置 GetDataManager 并发
                            数据目录 data/seed_stats/ 文件通信
                            progress.json / stats.json
                            runtime.json（运行标记,结束即删）/ stop.flag（停止信号）
```

### 统计分析 API
```
POST /api/seed-stats/start   启动计算（1-99999999，默认每批1个种子，可传 seed 范围）
POST /api/seed-stats/stop    优雅停止（写 stop.flag，批次中途停止不提交部分数据）
POST /api/seed-stats/resume  从 progress 的 completed_seed_id+1 恢复
GET  /api/seed-stats/status  状态（进度/时间/是否运行，基于文件+PID存活检测）
GET  /api/seed-stats/overview 各恒星数统计概览
GET  /api/seed-stats/{star_num} 指定恒星数(32-64)的均值结果
```

### 要点
- **资源倍率固定 1 倍**：源项目 `resource_rates[]` 索引4 = 1.0f（`batch_calculator.RESOURCE_INDEX`），
  注意索引0是0.1倍（极少），不是1倍
- **批次一致性**：整批（batch_size 个种子 × 33 恒星数）全部成功才提交进度与结果；
  中途停止/异常整批丢弃，resume 自动重算
- 源项目绑定契约：`GetDataManager` 只接受位置参数；`add_task` 只收 1 个 `Seed` 对象；
  `max_cache=128` 背压需定期 `get_results()` 排空

### 手动启动独立计算
```bash
python run_stats_calc.py --start 1 --end 99999999 --batch 100   # 新计算
python run_stats_calc.py                                        # 恢复进度
```

### 运行均值算法验证（1-100 种子）
```bash
python verify_stats.py --start 1 --end 100
```
报告写入 `data/seed_stats/verification/comparison.json`，判定标准：运行均值 vs 简单平均
最大相对误差 < 0.01%。

## 部署到 VPS

1. 安装 Python 3.10+
2. 安装依赖：`pip install -r requirements.txt`
3. 确认项目根目录的 `dsp_search_seed/CApi/` 与当前 Python 版本匹配
4. 使用 systemd 或 supervisor 管理进程

### 使用 systemd

创建 `/etc/systemd/system/seed-viewer.service`：

```ini
[Unit]
Description=Seed Viewer API
After=network.target

[Service]
User=www-data
WorkingDirectory=/path/to/backend
ExecStart=/usr/bin/python3 main.py
Restart=always

[Install]
WantedBy=multi-user.target
```

启动服务：
```bash
sudo systemctl enable seed-viewer
sudo systemctl start seed-viewer
```

### 使用 Nginx 反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        root /path/to/frontend/dist;
        try_files $uri $uri/ /index.html;
    }
}
```
