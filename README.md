# 戴森球计划量化计算器 v0.9.0

基于 [dsp-calc](https://github.com/DSPCalculator/dsp-calc) 开源项目进行功能修剪和新增。

## 功能特性

- **依赖关系图** — 可视化物品依赖关系，支持 SCC 循环组展示、重心法布局、拖拽交互、引线绕行
- **增产剂自动优化** — 按 SCC 顺序优化，支持最小电力/最小原矿/最小净热值/最小占地四种目标
- **燃料计算** — 自动计算燃料生产需求和发电设备数量
- **占地计算** — 各建筑类型占地面积估算
- **核心计算引擎** — BFS 构建依赖图 + Tarjan SCC 检测 + 矩阵求逆

## 技术栈

- **React 19** - UI框架
- **Vite 8** - 构建工具
- **Bootstrap 5** - UI组件库
- **Tarjan SCC + 矩阵求逆** - 核心计算引擎

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览生产版本
npm run preview
```

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
