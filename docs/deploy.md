# 部署指南

## 方案对比

| 维度 | GitHub Pages | VPS + Nginx |
|------|-------------|-------------|
| **费用** | 免费 | VPS 月费（已有则 0 额外成本） |
| **HTTPS** | 自动提供 | 需自己配置 certbot |
| **部署方式** | git push 自动部署（Actions） | 手动 scp/rsync 或写脚本 |
| **自定义域名** | 支持（需配 DNS + CNAME） | 完全自由 |
| **访问速度（国内）** | GitHub 线路波动，偶尔慢 | 取决于 VPS 位置，国内机房更快 |
| **访问速度（海外）** | CDN 分发，快 | 取决于 VPS 位置 |
| **PWA / 离线** | ✅ 正常 | ✅ 正常 |
| **运维负担** | 零 | 需维护 Nginx、证书续期、系统更新 |
| **灵活性** | 仅静态文件 | 未来可扩展后端 |

**推荐 GitHub Pages** — 零成本零运维，适合开源项目，push 即部署。

> 两个方案不冲突：可以先用 GitHub Pages 上线，以后有需要再迁移到 VPS。

---

## GitHub Pages 部署

### 前置条件

- 项目已推送到 GitHub 仓库
- `dist/` 构建产物已就绪（`npm run build`）

### 自动部署（GitHub Actions）

项目已包含 `.github/workflows/deploy.yml`，推送即自动部署。

**步骤：**

1. 在 GitHub 创建仓库
2. 添加远程地址并推送：
   ```bash
   git remote add origin https://github.com/用户名/仓库名.git
   git push -u origin master
   ```
3. 进入仓库 → Settings → Pages → Source 选择 **GitHub Actions**
4. 等待 1-2 分钟，访问 `https://用户名.github.io/仓库名/`

### 手动部署（gh-pages 分支）

```bash
npm run build
npm install -g gh-pages
gh-pages -d dist
```

然后 Settings → Pages → Source 选 `gh-pages` 分支。

---

## VPS + Nginx 部署

### 1. 构建并上传

```bash
npm run build
scp -r dist/ user@vps-ip:/var/www/dsp-calc/
```

### 2. Nginx 配置

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /var/www/dsp-calc;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /sw.js {
        add_header Cache-Control "no-cache";
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;
}
```

### 3. 启用 HTTPS

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## 技术说明

- **纯静态 SPA**：所有计算在浏览器端运行，无后端 API
- **相对路径**：`base: "./"` 配置，支持部署在任意子目录
- **PWA 支持**：含 Service Worker，可离线使用，需要 HTTPS
- **构建产物**：约 2.5-3 MB（JS/CSS 代码 + 游戏图标精灵图）

---

## 验证清单

- [ ] 页面正常加载
- [ ] 浏览器控制台无报错
- [ ] 计算功能正常
- [ ] PWA 安装提示出现
- [ ] Service Worker 注册成功（DevTools → Application）
- [ ] 离线访问正常（断网后刷新页面仍可使用）
