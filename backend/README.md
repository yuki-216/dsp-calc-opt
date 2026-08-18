# 种子查看器后端服务

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

## 部署到 VPS

1. 安装 Python 3.10+
2. 安装依赖：`pip install -r requirements.txt`
3. 复制原项目的 `dsp_search_seed/CApi/` 目录
4. 修改 `main.py` 中的 `SEED_VIEWER_PATH` 路径
5. 使用 systemd 或 supervisor 管理进程

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
