# 核心计算引擎 LP 重构设计

日期: 2026-08-24
状态: 已与用户逐节确认

## 一、背景与问题定位

### 1.1 事故现象

需求"信息/能量/结构/电磁矩阵 ×60 + 氘核燃料棒"场景下,核心计算产生明显违背事实的结果:

- 精炼油已被过滤列表标记为多余(应视为外部原矿,不再生产),却在阶段2展开链中被赋予 `$精炼油` 执行次数——"宣布不生产它的同时又建厂生产了它";
- 迭代2 中大循环组 SCC(34 物品)矩阵求逆一次性产生 **16 个负系数物品**(齿轮/电动机/煤矿/原油/重氢/磁铁等),阶段2 进入十几轮"逆生产→变号→再展开→再抵消"的拉锯,精炼油系数反复正负翻转(+4.24 → +0.003 → +5.2 → …),过程混沌且结果不可信;
- 代表选择机制静默退化:两个候选代表测量结果均 invalid 时回退 `items[0]`(SCC 插入顺序,任意),与修复前行为一致。

### 1.2 根因判断

问题不是某个 if 写错,而是范式的固有缺陷:

1. **物品本位符号成本 + 矩阵求逆**:线性求逆的解不保证物理可行(非负执行次数),负系数需要事后"逆生产"修正,而修正方向不唯一,形成递归修正链;
2. **联产物拆分为独立物品成本**:同一配方的多个产物被强行拆开(合并代表+ratio 折算),生产量与副产品之间的绑定关系丢失,归因错误由此而生;
3. **过滤迭代与逆生产互相打架**:过滤列表语义("视为原矿")在阶段2展开时未被尊重。

结论:继续修补是在给范式打补丁,更换为 LP 配平范式。此前 2026-08-11 "配方变量重构"评估的放弃结论前提是"不用 LP 则阶段2无法消除";LP 使阶段2整个消失,该评估不适用本次。

## 二、已确认的决策

| 决策点 | 结论 |
|---|---|
| 构模范围 | **整网 LP**:所有可达配方为变量,不分简单/复杂 SCC(docx 的混合方案被否——巨环吞掉全图,切分区无意义) |
| 矩阵求逆 | **不保留**。solveSCCByMatrix/buildMergeMap/coproductRepMap/代表检测(3倍测量)/阶段2逆生产/过滤迭代全部删除 |
| 成本结构 | 无双轨转换层。删符号成本机器;dag.js 建图层与输出聚合层保留改造 |
| LP 变量 | **配方执行次数**(非图节点)。主物品/副产物概念消失,"代表/合并/ratio 折算"全部不需要 |
| 归一化 | **删除**净产出归一。构模直接用配方原始产物表/原料表 × 增产倍率;自消耗由守恒方程自然表达 |
| 目标函数 | `min Σx`,固定内置。策略目标(最小电力/占地/原矿权重)留在优化器层,v1 不进引擎 |
| 求解器 | **HiGHS WASM**(`highs` npm 包)。若遇黑盒调试问题再回退手写两阶段单纯形(接口留插槽) |
| 多配方混用 | v1 不做;二部图结构天然支持,留作 v2 增强 |
| MILP 做增产优化 | 不做(建模难度大);优化器保持拓扑序枚举+环内坐标下降 |
| vite legacy | 删除(structuredClone 已把真实底线抬到 Chrome 98+,legacy 包是死代码路径) |
| 电力记账 | `$__miner_power__`/`$__factory_power__` 双轨合并,电力=普通物品;"不计挖矿电"按钮=采矿机类配方的电力消耗系数置 0 |
| 依赖图 | 只显示浅层关系(不含电力/增产剂边),天然无环,SCC 包围盒布局删除 |
| calculate 签名 | 出参形状不变(resourceUsage/surplusByproducts/recipeExecutions 等);函数本身因 HiGHS 初始化变 async(唯一签名涟漪) |

## 三、总体架构

```
┌─ async calculate(needs, recipes, filterList?, measurementMode?, onLog?)   ← 出参冻结
│
│  1. buildItemGraph (dag.js 改造)
│     BFS 可达性(从需求出发)+ 每配方的增产修正系数 + 设备信息 + isMiner 标记
│     删除: directCost/归一化/$前缀/副产负系数
│     数据结构: 二部图(配方节点+物品节点)
│
│  2.【新】buildLPModel (lp-model.js)
│     变量: x_r ≥ 0 = 配方 r 执行次数
│     约束: 每物品一条守恒不等式
│     目标: min Σx
│
│  3.【新】solveLP (lp-solver.js, 封装 highs 单例)
│     异步初始化一次,之后同步 solve
│     返回 { x_r, status };不可行时给出无来源物品诊断
│
│  4. 结果映射 (index.js 重写聚合段)
│     x_r → recipeExecutions;松弛量 → surplusByproducts;
│     外部缺口 → resourceUsage 正值;设备数/功耗沿用 singleExecBuildNumber 公式
│
└─ 删除: unit-cost.js 全部、matrix.js、过滤迭代 while、虚拟解 __solution__、
         共生产品代表检测、阶段2逆生产、$__miner_power__/$_factory_power__ 双轨
```

- tarjanSCC 从核心计算职责中移除;优化器基于 edges 自算(见第六节);
- `measurementMode`/`initialFilterList` 参数保留为 no-op 向后兼容位,内部逻辑删除;
- 消费方现状:`calculate()` 仅被 contexts.jsx 与 proliferator-optimizer.js 调用;后端种子统计走源项目 C++ 引擎,零耦合。

## 四、LP 构模细节

### 4.1 二部图数据结构

```
两类节点:
  配方节点 R = { recipeId, 增产修正后的 {产物表, 原料表}, 设备信息(singleExecBuildNumber/unitPowerCost), isMiner }
  物品节点 I = { itemId, 需求量 D_j(若在需求表), 是否原矿/外部(无配方节点) }

两类边(有向):
  R → I : 产物边,权重 out(r,j) = 原始产出 × 增产倍率
  I → R : 原料边,权重 in(r,j) = 原始消耗(+增产剂投入量)

BFS 可达性:从需求物品沿 I→R→I 反向遍历
LP 构模:遍历 R 生成变量;遍历 R 邻接边累加进物品守恒行 —— 直译,零换算
```

收益:构模正确性一目了然可审计;v2 多配方时同物品挂多条入边,构模零改动;消除 directCost 缓存与配方表双真相漂移。

现有 `edges` 数组(`{from,to}`)语义改为二部图边或保留物品投影(I→I'),实现计划中确定;依赖图页只消费物品投影。

### 4.2 变量

每个入选配方一个变量 `x_r ≥ 0`,单位"跑一次该配方",产出按配方原始比例(含联产物同时入各自守恒行)。

原矿/水/原油等无配方物品没有变量,在约束 RHS 出现。

电力 = 普通物品节点:发电配方(选定燃料)产电力列;所有设备耗电作为对电力的消耗系数进入各配方原料边;"不计挖矿电"= 采矿机类(isMiner)配方电力消耗置 0。

### 4.3 约束

每物品 j 一条不等式:

```
Σ_{r∈产j} out(r,j)·x_r − Σ_{r∈耗j} in(r,j)·x_r ≥ D_j        对所有物品 j;x_r ≥ 0
```

- D_j 为最终需求(非需求物品 D=0);
- 无配方物品:左边无正贡献项,缺口即 resourceUsage 正值(需外部获取);
- **副产品 = 松弛量**:左边超出右边(消耗+需求)的部分,无需显式剩余变量、无需逆生产;
- 用 ≥ 而非 =:允许"多产后弃置",数学上必要(否则共生场景可能不可行);经济上由 min Σx 自动抑制(浪费增大目标值,最优解不含无贡献流量);
- 自消耗配方(消耗自身产物):同一物品既有正项又有负项,自然表达,无特殊处理;
- 游戏数据不存在"自我满足式空转"环,不设防御约束(仅在测试清单留回归确认:min Σx 最优解不含无贡献正流量)。

### 4.4 目标函数

```
min Σ_r x_r        (固定内置)
```

单配方前提下自由度只来自联产/循环欠定,min Σx 自动选择"副产品优先被消耗完才多生产"的最小生产不动点(用户手算验证过的 R=100 稳定解)。v2 多配方时目标函数参数化(权重由策略层注入),接口预留。

### 4.5 数据流映射(解 → 输出)

```
x_r > 0              → recipeExecutions:键为该配方的"主产物"(产物表中排序第一个物品,与现 itemData 索引约定一致),值为执行次数——保持现有消费方(buildingDetails/result.jsx 表格)按物品键遍历的兼容性;v2 多配方时同一物品键聚合多条配方的次数
松弛量 s_j > 0 且 j 有配方 → surplusByproducts[j]
无配方物品缺口        → resourceUsage[j] 正值(外部获取量)
设备数                → x_r × singleExecBuildNumber(现有公式,dag.js 保留计算)
总耗电               → 发电配方变量直接读出(getPowerDeviceCount 衔接,燃料增产倍率照乘)
selfConsumption 字段  → 从配方原始数据重导出(UI 毛产量显示不变)
```

resourceUsage/surplusByproducts 语义收紧:**前者只含外部获取正值,后者只含真正多余副产品**——docx 第九节要求的拆分。result.jsx 显示端已分开读,改动极小。

## 五、HiGHS 接入与异步边界

### 5.1 加载模型(src/engine/lp-solver.js)

```js
import loadHighs from 'highs';
let highsPromise = null;
export function getHighs() {
  if (!highsPromise) {
    highsPromise = loadHighs({ locateFile: (f) => f });  // 路径解析实现计划中按 vite 静态资产机制确定
  }
  return highsPromise;   // 单例 Promise:应用生命周期只初始化一次
}
export async function solveLP(model) { /* 结构化模型 → LP 文本 → highs.solve → {x_r, status} */ }
```

- 初始化一次、处处同步:loadHighs 是唯一异步点(首次计算时数百 ms);之后 solve 全同步,优化器循环内零 await 开销;
- vite manualChunks 给 highs 单独分 chunk(懒加载);PWA workbox 预缓存清单加入 highs.wasm 保证离线;
- GitHub Pages 静态部署无障碍(.wasm MIME 正确映射;base:'./' 相对路径由 locateFile 处理);
- locateFile 具体路径写法属实现细节(vite 静态资产机制),实现计划中确定。

### 5.2 calculate 变 async 的涟漪(全项目唯一签名变化)

```
contexts.jsx   : engineCalculate 内 await engine.calculate(...)   (1 处)
优化器         : calculatePower/calculateOreHeat/calculateRareWeight 变 async,
                 坐标下降调用点加 await(~10 处机械改动)
repro 脚本     : 顶层 await,无碍
```

不用 Web Worker 保持同步——worker 通信复杂度远大于改 async。UI 卡顿:单次 solve 微秒级,坐标下降已有 setTimeout(0) 让出,维持现状。

### 5.3 模型传输格式

构模层产出结构化模型(变量表+稀疏约束行)→ 序列化为 CPLEX LP 文本 → highs.solve。选文本格式理由:可直接 dump `.lp` 文件人肉检查模型正确性(本次事故最缺的能力);几十变量的序列化开销可忽略。将来若解析开销成瓶颈,接口不变内部切换建模 API。

### 5.4 失败诊断

- status = Infeasible → 构模层反向定位:哪个 D_j 物品在图中无任何入边配方 → 报错直接给物品名,替代现在的静默错误/矩阵异常;
- 解含 NaN → 防御校验 + 明确报错,不允许静默输出脏结果。

## 六、优化器适配(proliferator-optimizer.js)

保留"分组精确优化"框架,sccs 生产者从核心计算挪到优化器内部:

- 优化器自调 graph-utils 的 tarjanSCC(edges) 得分组(它已持有 graph/edges);
- 单节点 SCC:按 Tarjan 逆拓扑序逐个穷举持久化——无环贪心=全局最优的性质保留(理论依据:每个物品决策时全部下游影响已固定);
- 多节点 SCC:组内独立坐标下降(optimizeCycleGroupPhase 原样保留)——环内耦合由坐标下降近似,环下游挂件是单节点 SCC 仍在精确区,环定稿后扫到它们时贪心依然严格最优;
- 最终边际验证(validateFinalProliferatorChoices):遍历容器从 engine.sccs 改为自算 SCC 列表;
- 包装函数 async 化(见 5.2);
- 不考虑 MILP 做增产优化(建模难度大,启发式质量靠拓扑序保证)。

坐标下降总耗时不承诺变快;但每次 calculate 耗时可预测有上界,不再出现病态慢路径,目标函数值不再被内部混沌污染——这是对优化器的真实收益(可信度,而非速度)。

## 七、其他改动

### 7.1 去 vite legacy

删除 @vitejs/plugin-legacy 及配置。依据:structuredClone(Chrome 98+/Safari 15.4+)早已把真实支持底线抬到 2022 年浏览器,index.html 亦有"切换 Chrome/Edge"提示;WASM 兼容底线(2017)远低于实际底线,无兼容损失。

### 7.2 电力合一

- `$__miner_power__`/`$__factory_power__` 双轨删除,电力=普通物品(见 4.2);
- UI 电力行只显示总数(不再拆生产/挖矿);energyCost/minerEnergyCost 合并为单值(从发电配方变量读出);
- 新增"不计挖矿电"开关:采矿机类配方电力消耗系数置 0(isMiner 标记已有);
- 优化器读 totalEnergyCost 本就是总数,不受影响。

### 7.3 依赖图浅层化

- 依赖图不再添加电力/增产剂依赖边(它们仅作为需求表条目出现),天然无环;
- SCC 包围盒布局/推挤逻辑删除,布局退化为纯 DAG 分层;
- graph-utils.js 保留(优化器自算 SCC 是其唯一消费方)。

## 八、测试与验收

| 层 | 内容 |
|---|---|
| lp-solver 单测 | 已知小 LP 手算对照;不可行/退化/空模型边界 |
| 构模单测 | 小型配方集手工构模对照;守恒性断言(解代入每条约束行,差值 < 1e-6) |
| 引擎回归 | repro_engine.mjs 等 4 脚本改造后运行:**氢为多余副产品、精炼油恰好满足**为核心验收标准(旧算法错误解为精炼油多余+氢短缺);现有 tests/ 全通过(sccs 断言按新语义更新) |
| 优化器回归 | 四种策略(min_power/min_rare_weight/min_net_heat/min_footprint)各跑真实方案,对比重构前目标值(允许因旧算法错误导致的小差异,方向应一致或更优) |
| UI 冒烟 | 主视图数值、副产品展示增减箭头、依赖图(无 SCC 包围盒)、电力行合并、"不计挖矿电"按钮 |

性能记录:记录重构前后 repro_engine.mjs 单次耗时对比(预期正常场景相当,病态场景大幅改善且稳定)。

## 九、交付切分(实现计划骨架)

1. lp-solver.js + 单测(独立可验)
2. dag.js 改造:二部图 + 配方修正系数(删 directCost/归一化)
3. index.js 重写:构模→求解→映射(删过滤迭代/代表检测/虚拟解),calculate 变 async
4. 优化器适配:自算 tarjanSCC + async 化
5. result.jsx/UI:电力合一、不计挖矿电按钮、去 legacy、副产品展示核对
6. 清理:unit-cost.js/matrix.js 删除;graph-utils.js 保留(优化器自算 SCC 消费);依赖图页删除 SCC 布局代码

## 十、范围外(明确不做)

- MILP 增产优化(建模难度大,将来可选,HiGHS 能力已在);
- 多配方混用/自动切换(v2;构模天然支持,输出表多配方展示另行设计);
- 目标函数参数化注入(v2 多配方时随策略层一起做);
- 后端种子统计系统(独立 C++ 引擎,零耦合)。
