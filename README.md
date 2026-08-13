# 戴森球计划量化计算器 v0.9.2

基于 [dsp-calc](https://github.com/DSPCalculator/dsp-calc) 开源项目进行功能修剪和新增。

🔗 **在线使用**：https://yuki-216.github.io/dsp-calc-opt/

## 功能特性

- **依赖关系图** — 可视化物品依赖关系，支持 SCC 循环组展示、重心法布局、拖拽交互、引线绕行
- **增产剂自动优化** — 按 SCC 顺序优化，支持最小电力/最小原矿/最小净热值/最小占地四种目标
- **燃料计算** — 自动计算燃料生产需求和发电设备数量，直接将电力需求准确的降维到矿物，不用再纠结电力与矿物的取舍
- **占地计算** — 各建筑类型占地面积估算
- **核心计算引擎** — BFS 构建依赖图 + Tarjan SCC 检测 + 矩阵求逆
- **在新窗口计算** — 输出表物品旁点击按钮，原页面视为原矿，新标签页独立计算该物品生产链
- **负数需求（外部供给）** — 输入负数表示外部供给，减少实际生产量

## 技术栈

- **React 19** - UI框架
- **Vite 8** - 构建工具
- **Bootstrap 5** - UI组件库
- **Tarjan SCC + 矩阵求逆** - 核心计算引擎

## 本地开发（修改代码）

```bash
# 克隆仓库
git clone https://github.com/yuki-216/dsp-calc-opt.git
cd dsp-calc-opt

# 安装依赖
npm install

# 启动开发服务器（支持热更新）
npm run dev
```

访问 `http://localhost:5173`，修改代码后页面会自动刷新。

## 本地使用（仅运行，不修改代码）

**方式一：下载预构建版本**
1. 访问 [GitHub Actions](https://github.com/yuki-216/dsp-calc-opt/actions) 页面
2. 点击最新的 workflow run
3. 在 "Artifacts" 区域下载 `github-pages` 压缩包
4. 解压得到 `artifact` 文件夹
5. 在 `artifact` 文件夹内打开终端，运行：
   ```bash
   npx serve .
   ```
6. 浏览器访问终端显示的地址（通常是 `http://localhost:3000`）

**方式二：克隆仓库后构建**
```bash
git clone https://github.com/yuki-216/dsp-calc-opt.git
cd dsp-calc-opt
npm install
npm run build
npx serve dist
```

> `npx` 是 Node.js 自带的工具，安装 [Node.js](https://nodejs.org/) 后即可使用。

## 文档

- [代码分析文档](docs/code-analysis.md)
- [依赖图模块文档](docs/dependency_graph.md)
- [增产策略优化算法详解](docs/增产策略优化算法详解.md)

## 联系方式

- QQ: 1610241445
- QQ群: 暂无

如果计算器对你有帮助，请给本项目加个star吧，感谢。

## 参考资源

- [DSPCalculator/dsp-calc](https://github.com/DSPCalculator/dsp-calc) - 原始项目
- [戴森球计划Wiki](https://wiki.biligame.com/dsp/) - 游戏数据参考

## 许可证

[木兰宽松许可证, 第2版](LICENSE)
