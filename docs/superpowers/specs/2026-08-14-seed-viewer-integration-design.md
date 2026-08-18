# 种子查看器整合设计文档

> **日期**: 2026-08-14
> **状态**: 设计阶段
> **作者**: Claude

---

## 1. 概述

### 1.1 目标

将种子查看器功能整合到戴森球计划量化计算器项目中，作为一个独立的页面模块，允许用户查询指定种子的资源分布。

### 1.2 背景

- 种子查看器是一个独立的Python项目，用于查询戴森球计划游戏中的种子数据
- 量化计算器是一个纯前端React项目，需要静态部署在GitHub Pages
- 用户希望将种子查看器整合到量化计算器中，但不希望依赖服务器

### 1.3 约束条件

- 项目需要静态部署在GitHub Pages
- 不希望强求服务器支持
- 需要保持算法的正确性

---

## 2. 技术方案

### 2.1 方案选择

**选择：Emscripten编译C++源代码为WebAssembly**

**原因：**
1. 有完整的C++源代码（`dsp_search_seed/cpp_source_code/`）
2. 保持算法正确性，无需重写
3. 性能优秀，执行速度接近原生C++
4. 开发效率高，无需重写算法

### 2.2 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| C++源代码 | `dsp_search_seed/cpp_source_code/` | 种子生成算法 |
| 编译工具 | Emscripten | 将C++编译为WebAssembly |
| 前端框架 | React 19 | 与量化计算器一致 |
| 样式 | Bootstrap 5 | 与量化计算器一致 |

---

## 3. 架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    戴森球计划量化计算器                          │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  计算器页面  │  │  依赖图页面  │  │ 种子查看器页面 │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│         │                │                │                 │
│         └────────────────┼────────────────┘                 │
│                          │                                  │
│                    ┌─────▼─────┐                            │
│                    │  main.jsx │                            │
│                    │ (页面路由) │                            │
│                    └───────────┘                            │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 种子查看器页面架构

```
┌─────────────────────────────────────────────────────────────┐
│                    SeedViewerPage.jsx                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   输入面板                           │    │
│  │  - 种子ID输入                                        │    │
│  │  - 恒星数量选择                                       │    │
│  │  - 资源倍率选择                                       │    │
│  │  - 查询按钮                                          │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                  │
│                    ┌─────▼─────┐                            │
│                    │  WASM模块 │                            │
│                    │ (WebAssembly)│                         │
│                    └───────────┘                            │
│                          │                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   结果面板                           │    │
│  │  - 星区汇总（14种矿脉）                               │    │
│  │  - 恒星列表                                          │    │
│  │  - 行星详情                                          │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 组件设计

### 4.1 页面组件

**文件**: `src/SeedViewerPage.jsx`

**职责**:
- 提供用户输入界面
- 调用WebAssembly模块查询种子数据
- 展示查询结果

**Props**:
- `onNavigate`: 页面导航函数
- `isActive`: 页面是否激活

### 4.2 WebAssembly模块

**文件**: `src/wasm/seed_viewer.js`, `src/wasm/seed_viewer.wasm`

**职责**:
- 封装C++算法
- 提供JavaScript接口
- 处理数据转换

**接口**:
```javascript
// 初始化WASM模块
await initSeedViewer();

// 查询种子数据
const result = getSeedData(seedId, starNum, resourceIndex);

// 格式化数量
const formatted = formatAmount(number);
```

### 4.3 结果展示组件

**文件**: `src/SeedViewerResult.jsx`

**职责**:
- 展示星区汇总（14种矿脉）
- 展示恒星列表
- 展示行星详情

---

## 5. 数据流

### 5.1 查询流程

```
用户输入 → 验证参数 → 调用WASM模块 → 获取结果 → 展示结果
    │          │           │           │          │
    ▼          ▼           ▼           ▼          ▼
 种子ID    参数校验    C++算法执行   数据转换    UI渲染
 恒星数量   错误处理    WebAssembly  格式化      交互
 资源倍率
```

### 5.2 数据结构

**种子数据**:
```javascript
{
  seedId: number,           // 种子ID
  starNum: number,          // 恒星数量
  resourceIndex: number,    // 资源倍率索引
  resourceRate: number,     // 资源倍率
  veinsPoint: number[],     // 14种矿脉的矿簇数
  veinsAmount: number[],    // 14种矿脉的总储量
  gasVeins: number[],       // 气态矿脉
  liquid: number[],         // 液态矿脉
  stars: StarData[]         // 恒星列表
}
```

**恒星数据**:
```javascript
{
  starIndex: number,        // 恒星索引
  name: string,             // 恒星名称
  type: string,             // 恒星类型
  typeId: number,           // 恒星类型ID
  seed: number,             // 种子值
  dysonLumino: number,      // 戴森球亮度
  dysonRadius: number,      // 戴森球半径
  distance: number,         // 距离
  veinsPoint: number[],     // 矿脉矿簇数
  veinsAmount: number[],    // 矿脉储量
  planets: PlanetData[]     // 行星列表
}
```

**行星数据**:
```javascript
{
  planetIndex: number,      // 行星索引
  name: string,             // 行星名称
  type: string,             // 行星类型
  typeId: number,           // 行星类型ID
  seed: number,             // 种子值
  radius: number,           // 半径
  isGas: boolean,           // 是否气态行星
  landPercent: number,      // 陆地百分比
  veinsPoint: number[],     // 矿脉矿簇数
  veinsAmount: number[]     // 矿脉储量
}
```

---

## 6. 文件结构

```
src/
├── main.jsx                    # 应用入口（修改：添加种子查看器路由）
├── SeedViewerPage.jsx          # 种子查看器页面（新增）
├── SeedViewerResult.jsx        # 结果展示组件（新增）
├── SeedViewer.css              # 种子查看器样式（新增）
├── wasm/                       # WebAssembly模块目录（新增）
│   ├── seed_viewer.js          # JavaScript绑定
│   ├── seed_viewer.wasm        # WebAssembly模块
│   └── seed_viewer.d.ts        # TypeScript类型定义
├── ... (其他现有文件)
```

---

## 7. 编译配置

### 7.1 Emscripten编译配置

**编译脚本**: `scripts/build_wasm.sh`

```bash
#!/bin/bash

# 设置Emscripten环境（需要先安装emsdk）
# 下载地址: https://emscripten.org/docs/getting_started/downloads.html
# 安装后执行: source /path/to/emsdk/emsdk_env.sh

# 检查Emscripten是否安装
if ! command -v emcc &> /dev/null; then
    echo "错误: 未找到Emscripten，请先安装emsdk"
    echo "安装指南: https://emscripten.org/docs/getting_started/downloads.html"
    exit 1
fi

# 编译C++为WebAssembly
emcc \
  -O3 \
  -s WASM=1 \
  -s EXPORTED_FUNCTIONS='["_getSeedData", "_formatAmount", "_malloc", "_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="SeedViewerModule" \
  -s EXTRA_EXPORTED_RUNTIME_METHODS='["UTF8ToString", "stringToUTF8"]' \
  -I./dsp_search_seed/cpp_source_code \
  ./dsp_search_seed/cpp_source_code/astro_class.cpp \
  ./dsp_search_seed/cpp_source_code/check_seed.cpp \
  ./dsp_search_seed/cpp_source_code/check_seed_util.cpp \
  ./dsp_search_seed/cpp_source_code/static_value.cpp \
  -o src/wasm/seed_viewer.js

# 检查编译结果
if [ $? -eq 0 ]; then
    echo "编译成功！"
    echo "生成文件: src/wasm/seed_viewer.js 和 src/wasm/seed_viewer.wasm"
else
    echo "编译失败，请检查错误信息"
    exit 1
fi
```

### 7.2 C++代码修改

需要修改的C++代码：

**1. 移除OpenCL相关代码** - WebAssembly不支持GPU加速

需要修改的文件：
- `dsp_search_seed/cpp_source_code/python_api.cpp` - 移除OpenCL初始化和GPU相关代码
- `dsp_search_seed/cpp_source_code/gpu_benchmark.hpp` - 移除或禁用GPU基准测试
- `dsp_search_seed/cpp_source_code/check_batch.hpp` - 移除GPU加速的批量检查代码

**2. 移除Python绑定** - 使用Emscripten的JavaScript绑定

需要修改的文件：
- `dsp_search_seed/cpp_source_code/python_api.cpp` - 移除pybind11相关代码
- `dsp_search_seed/cpp_source_code/python_api.hpp` - 移除Python绑定声明

**3. 添加WebAssembly导出函数** - 暴露核心算法接口

需要创建的文件：
- `dsp_search_seed/cpp_source_code/wasm_api.cpp` - WebAssembly导出函数
- `dsp_search_seed/cpp_source_code/wasm_api.hpp` - WebAssembly导出函数声明

**WebAssembly导出函数示例：**
```cpp
// wasm_api.hpp
#ifndef WASM_API_HPP
#define WASM_API_HPP

#include <string>
#include "data_struct.hpp"

extern "C" {
    // 获取种子数据（返回JSON字符串）
    const char* getSeedData(int seedId, int starNum, int resourceIndex);
    
    // 格式化数量
    const char* formatAmount(long long number);
    
    // 初始化（WebAssembly不需要）
    void init();
}

#endif

// wasm_api.cpp
#include "wasm_api.hpp"
#include "check_seed.hpp"
#include "data_struct.hpp"
#include <string>
#include <sstream>

static std::string resultBuffer;

const char* getSeedData(int seedId, int starNum, int resourceIndex) {
    // 调用现有的种子生成算法
    Seed seed(seedId, starNum, resourceIndex);
    GalaxyData galaxyData = getGalaxyData(seed, false);
    
    // 转换为JSON字符串
    std::ostringstream oss;
    oss << "{\"seedId\":" << galaxyData.seedId
        << ",\"starNum\":" << galaxyData.starNum
        << ",\"resourceIndex\":" << galaxyData.resourceIndex
        << ",\"resourceRate\":" << galaxyData.resourceRate
        << ",\"veinsPoint\":[";
    
    for (int i = 0; i < 14; i++) {
        if (i > 0) oss << ",";
        oss << galaxyData.veinsPoint[i];
    }
    oss << "],\"veinsAmount\":[";
    
    for (int i = 0; i < 14; i++) {
        if (i > 0) oss << ",";
        oss << galaxyData.veinsAmount[i];
    }
    oss << "],\"stars\":[";
    
    // 添加恒星数据...
    // （完整实现需要包含恒星和行星数据的序列化）
    
    oss << "]}";
    resultBuffer = oss.str();
    return resultBuffer.c_str();
}

const char* formatAmount(long long number) {
    if (number >= 1000000000) {
        resultBuffer = std::to_string(number / 1000000000.0) + "B";
    } else if (number >= 1000000) {
        resultBuffer = std::to_string(number / 1000000.0) + "M";
    } else if (number >= 1000) {
        resultBuffer = std::to_string(number / 1000.0) + "K";
    } else {
        resultBuffer = std::to_string(number);
    }
    return resultBuffer.c_str();
}
```

### 7.3 JavaScript绑定

**文件**: `src/wasm/seed_viewer.js`

```javascript
// 初始化WASM模块
export async function initSeedViewer() {
  const module = await SeedViewerModule();
  return module;
}

// 查询种子数据
export function getSeedData(module, seedId, starNum, resourceIndex) {
  // 调用WASM函数
  const result = module.ccall('getSeedData', 'string', 
    ['number', 'number', 'number'], 
    [seedId, starNum, resourceIndex]);
  return JSON.parse(result);
}
```

---

## 8. 错误处理

### 8.1 输入验证

- 种子ID：必须是正整数
- 恒星数量：必须在有效范围内（1-128）
- 资源倍率索引：必须在0-10之间

### 8.2 WASM错误处理

- 初始化失败：显示错误信息，提供重试按钮
- 计算超时：显示加载动画，提供取消按钮
- 内存不足：显示警告信息，建议减少恒星数量

### 8.3 数据格式错误

- JSON解析失败：显示原始数据，提供错误详情
- 数据结构异常：显示部分结果，标记异常数据

---

## 9. 测试策略

### 9.1 单元测试

**WebAssembly模块测试：**
- 测试模块初始化是否成功
- 测试`getSeedData`函数返回正确的数据结构
- 测试`formatAmount`函数格式化正确
- 测试边界条件（最小种子ID、最大恒星数量等）

**测试用例示例：**
```javascript
// 测试种子数据查询
test('getSeedData returns correct data structure', async () => {
  const module = await initSeedViewer();
  const result = getSeedData(module, 10381977, 43, 4);
  
  expect(result).toHaveProperty('seedId', 10381977);
  expect(result).toHaveProperty('starNum', 43);
  expect(result).toHaveProperty('resourceIndex', 4);
  expect(result).toHaveProperty('veinsPoint');
  expect(result).toHaveProperty('veinsAmount');
  expect(result).toHaveProperty('stars');
  expect(result.veinsPoint).toHaveLength(14);
  expect(result.veinsAmount).toHaveLength(14);
});

// 测试数据格式化
test('formatAmount formats numbers correctly', async () => {
  const module = await initSeedViewer();
  
  expect(formatAmount(module, 1000000000)).toBe('1.00B');
  expect(formatAmount(module, 1000000)).toBe('1.00M');
  expect(formatAmount(module, 1000)).toBe('1.00K');
  expect(formatAmount(module, 500)).toBe('500');
});
```

### 9.2 集成测试

**页面路由测试：**
- 测试从计算器页面切换到种子查看器页面
- 测试从种子查看器页面切换回计算器页面
- 测试页面状态保持

**组件交互测试：**
- 测试输入参数验证
- 测试查询按钮点击事件
- 测试结果面板显示

**测试用例示例：**
```javascript
// 测试页面路由
test('navigates to seed viewer page', async () => {
  render(<RootApp />);
  
  // 点击种子查看器导航链接
  fireEvent.click(screen.getByText('种子查看器'));
  
  // 验证页面切换
  expect(screen.getByText('种子ID')).toBeInTheDocument();
  expect(screen.getByText('恒星数量')).toBeInTheDocument();
});

// 测试查询功能
test('queries seed data and displays results', async () => {
  render(<SeedViewerPage />);
  
  // 输入种子ID
  fireEvent.change(screen.getByLabelText('种子ID'), {
    target: { value: '10381977' }
  });
  
  // 点击查询按钮
  fireEvent.click(screen.getByText('查询'));
  
  // 等待结果显示
  await waitFor(() => {
    expect(screen.getByText('星区汇总')).toBeInTheDocument();
    expect(screen.getByText('恒星列表')).toBeInTheDocument();
  });
});
```

### 9.3 性能测试

**WebAssembly模块加载测试：**
- 测试模块首次加载时间（目标：<2秒）
- 测试模块缓存后加载时间（目标：<100ms）
- 测试不同网络环境下的加载时间

**种子查询性能测试：**
- 测试单个种子查询时间（目标：<500ms）
- 测试连续查询多个种子的性能
- 测试大恒星数量（128星）的查询时间

**内存使用测试：**
- 测试WebAssembly模块的内存占用
- 测试查询过程中的内存增长
- 测试内存泄漏检测

**测试用例示例：**
```javascript
// 性能测试
test('seed query completes within 500ms', async () => {
  const module = await initSeedViewer();
  
  const startTime = performance.now();
  getSeedData(module, 10381977, 43, 4);
  const endTime = performance.now();
  
  expect(endTime - startTime).toBeLessThan(500);
});

// 内存测试
test('no memory leak after multiple queries', async () => {
  const module = await initSeedViewer();
  const initialMemory = performance.memory?.usedJSHeapSize || 0;
  
  // 执行多次查询
  for (let i = 0; i < 100; i++) {
    getSeedData(module, 10381977 + i, 43, 4);
  }
  
  const finalMemory = performance.memory?.usedJSHeapSize || 0;
  const memoryGrowth = finalMemory - initialMemory;
  
  // 内存增长应小于10MB
  expect(memoryGrowth).toBeLessThan(10 * 1024 * 1024);
});
```

---

## 10. 实施计划

### 阶段1：环境配置（1-2天）

1. 安装Emscripten工具链
2. 配置编译环境
3. 测试C++代码编译

### 阶段2：C++代码修改（2-3天）

1. 移除OpenCL相关代码
2. 移除Python绑定
3. 添加WebAssembly导出函数
4. 测试编译结果

### 阶段3：JavaScript绑定（1-2天）

1. 编写JavaScript绑定代码
2. 实现数据转换函数
3. 测试WASM模块调用

### 阶段4：前端组件开发（2-3天）

1. 创建SeedViewerPage组件
2. 创建SeedViewerResult组件
3. 实现页面路由集成
4. 添加样式和交互

### 阶段5：测试和优化（1-2天）

1. 功能测试
2. 性能测试
3. 错误处理测试
4. 用户体验优化

---

## 11. 风险评估

### 11.1 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| Emscripten编译失败 | 高 | 中 | 准备备选方案（Python转JavaScript） |
| WebAssembly性能问题 | 中 | 低 | 优化算法，减少内存分配 |
| 浏览器兼容性问题 | 中 | 低 | 测试主流浏览器，提供降级方案 |

### 11.2 开发风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 开发时间超期 | 中 | 中 | 分阶段实施，优先核心功能 |
| 算法准确性问题 | 高 | 低 | 充分测试，与Python版本对比 |
| 维护成本高 | 中 | 中 | 编写详细文档，自动化测试 |

---

## 12. 后续扩展

### 12.1 功能扩展

- 支持期望值平均种子查询
- 支持种子筛选和对比
- 支持导出查询结果

### 12.2 性能优化

- 实现WebAssembly模块懒加载
- 添加查询结果缓存
- 优化大数据量处理

### 12.3 用户体验

- 添加查询历史记录
- 支持收藏常用种子
- 提供可视化图表展示

---

## 13. 总结

本设计文档详细描述了将种子查看器整合到量化计算器项目的技术方案。通过使用Emscripten编译C++源代码为WebAssembly，我们能够：

1. 保持算法的正确性和性能
2. 实现纯前端部署，无需服务器支持
3. 与现有项目技术栈保持一致
4. 提供良好的用户体验

该方案具有技术可行性高、开发效率好、维护成本低等优点，是整合种子查看器的最佳选择。
