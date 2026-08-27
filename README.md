# 戴森球计划量化计算器 v0.11.0

基于 [dsp-calc](https://github.com/DSPCalculator/dsp-calc) 开源项目进行功能修剪和新增。

🔗 **在线使用**：https://yuki-216.github.io/dsp-calc-opt/

## 功能特性

- **创世之书 mod 支持** — 顶部导航栏切换「原版 / 创世之书」数据源（选择持久化，方案/需求独立存取）；创世之书引入新机制（负熵翻倍配方、新配方类别、新发电/采集体系等），数据格式与原版一致，计算引擎无需改动
- **依赖关系图** — 可视化物品依赖关系（浅层工艺关系，不含电力/增产剂），支持重心法布局、拖拽交互、引线绕行
- **增产剂自动优化** — 按拓扑序优化（循环组坐标下降），支持最小电力/珍稀权重/最小净热值/最小占地四种目标；珍稀权重法含珍稀矿实用性修正（刺笋结晶/金伯利矿石/分形硅石按可替代普通矿折算稀缺度）；默认仅启用 Mk.III，无增产剂加权默认 0.1%
- **燃料计算** — 自动计算燃料生产需求和发电设备数量，直接将电力需求准确的降维到矿物，不用再纠结电力与矿物的取舍
- **占地计算** — 各建筑类型占地面积估算
- **核心计算引擎** — BFS 构建二部图 + 整网 LP 配平（HiGHS WASM），以配方执行次数为变量、物品守恒为约束，最小化总执行次数
- **在新窗口计算** — 输出表物品旁点击按钮，原页面视为原矿，新标签页独立计算该物品生产链
- **负数需求（外部供给）** — 输入负数表示外部供给，减少实际生产量
- **种子查看与统计** — 内置种子生成 CApi，支持 32-64 恒星查询、统计均值、置信区间和矿物可用量应用
- **整数优化建议** — 结果表新增整数优化列：混合工厂等级凑出偶数设备台数（紧凑省地/省料防浪费），纯前端提示不改 LP
- **结果表联产物独立成行** — 多产物配方各产物各自成行展示，附完整交互控件与来源标注；「主配方优先」保证需求缺口由主配方补足
- **轨道采集器面板** — 种子查看器内置轨道采集器计算：按官方自耗机制建模单采集器净产量，支持 3 类气态行星参数与采集速度科技
- **响应式精简模式** — 结果表按 6 档视口宽度逐级精简（compact×按钮/短配方 → semi 设备列下拉 → mid 增产列下拉 → slender 右列收纳 → narrow 整数建议悬浮+顶部图标化），手机统一走桌面版（viewport 固定 850px）可自由缩放
- **挖矿耗电简化** — 采矿机/大型采矿机统一为「挖矿机」，按「矿量×单位采集耗电」计电；原油萃取站固定单位耗电

## 技术栈

- **React 19** - UI框架
- **Vite 8** - 构建工具
- **Bootstrap 5** - UI组件库
- **HiGHS WASM (LP 配平)** - 核心计算引擎
- **浏览器 WASM + Python/FastAPI** - 公开版在浏览器查询种子，Python 后端保留为本地调试和统计计算

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

公开部署不需要 Python 后端：种子查看器默认使用项目内置的 WASM，统计结果从公开的 `public/stats.json` 读取。

本地调试后端时再启动 Python 服务：

```bash
cd backend
pip install -r requirements.txt
python main.py
```

后端使用项目内置的 `dsp_search_seed/CApi/`，不依赖外部种子查看器目录。

种子查看器默认是浏览器模式；个人调试时可在浏览器控制台切换：

```js
setSeedQueryMode('backend') // 使用本地 FastAPI
setSeedQueryMode('browser') // 使用浏览器 WASM
setSeedQueryMode('auto')    // 优先后端，失败后回退 WASM
resetSeedQueryMode()        // 恢复默认 browser
```

本地后端的统计计算控制区默认隐藏。启动后端并切换到 backend 后，进入“种子查看器”页面，
在浏览器控制台执行下面的代码显示“开始 / 停止 / 恢复”等统计控制 UI：

```js
setSeedQueryMode('backend')
showStatsControls()
```

隐藏统计控制 UI（不停止后端计算）：

```js
hideStatsControls()
```

`showStatsControls` 和 `hideStatsControls` 只有在种子查看器页面已经加载后才会出现；
如果刚切换查询模式，刷新页面或重新进入种子查看器即可。公开版保持默认隐藏，避免暴露个人统计计算控制。

重新编译 WASM 查询引擎需要 Emscripten 和 GLM，并通过环境变量提供路径，项目代码不依赖固定的外部绝对路径：

```bash
set GLM_ROOT=<path-to-glm>
npm run build:wasm
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

[GNU General Public License v3.0](LICENSE)
