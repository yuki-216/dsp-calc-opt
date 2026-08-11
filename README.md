# 戴森球计划量化计算器 v1.0.0

基于 [dsp-calc](https://github.com/DSPCalculator/dsp-calc) 开源项目进行功能修剪和新增。

## 项目目标

- 保留原有核心计算功能
- 添加燃料计算模块
- 实现增产剂自动优化
- 支持占地计算与优化

## 技术栈

- **React 19** - UI框架
- **Vite 8** - 构建工具
- **Bootstrap 5** - UI组件库
- **javascript-lp-solver** - 线性规划求解器

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 访问地址
http://localhost:5173
```

## 项目阶段

| 阶段 | 目标 | 状态 |
|------|------|------|
| 阶段1 | 项目理解与裁剪 | ✅ 已完成 |
| 阶段2 | 燃料计算模块 | ✅ 已完成 |
| 阶段3 | 增产剂自动优化 | ✅ 已完成 |
| 阶段4 | 占地模块与完善优化 | ✅ 已完成 |

## 文档

- [设计规格文档](docs/design-spec.md)
- [核心算法文档](docs/core-algorithm.md)
- [依赖图模块文档](docs/dependency_graph.md)
- [增产策略优化算法详解](docs/增产策略优化算法详解.md)

## 联系方式

- QQ: 1610241445
- QQ群: 暂无

## 参考资源

- [DSPCalculator/dsp-calc](https://github.com/DSPCalculator/dsp-calc) - 原始项目
- [戴森球计划Wiki](https://wiki.biligame.com/dsp/) - 游戏数据参考

## 许可证

MIT License
