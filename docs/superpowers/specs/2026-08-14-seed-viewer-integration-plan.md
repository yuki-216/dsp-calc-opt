# 种子查看器整合实施计划

> **日期**: 2026-08-14
> **状态**: 实施计划
> **基于设计文档**: `2026-08-14-seed-viewer-integration-design.md`

---

## 实施概述

本实施计划详细描述了将种子查看器整合到量化计算器项目中的具体步骤，包括环境配置、代码修改、编译构建、前端开发和测试验证。

---

## 阶段1：环境配置（1-2天）

### 任务1.1：安装Emscripten工具链

**目标**：配置Emscripten编译环境

**步骤**：
1. 下载emsdk：
   ```bash
   git clone https://github.com/emscripten-core/emsdk.git
   cd emsdk
   ```

2. 安装最新版本：
   ```bash
   ./emsdk install latest
   ./emsdk activate latest
   ```

3. 配置环境变量：
   ```bash
   # Windows
   emsdk_env.bat
   
   # Linux/macOS
   source ./emsdk_env.sh
   ```

4. 验证安装：
   ```bash
   emcc --version
   ```

**验证标准**：
- `emcc`命令可执行
- 版本号显示正常

### 任务1.2：配置项目编译环境

**目标**：准备项目编译所需的目录和文件

**步骤**：
1. 创建WebAssembly输出目录：
   ```bash
   mkdir -p src/wasm
   ```

2. 创建编译脚本目录：
   ```bash
   mkdir -p scripts
   ```

3. 创建编译脚本 `scripts/build_wasm.sh`：
   ```bash
   #!/bin/bash
   
   # 设置Emscripten环境
   if ! command -v emcc &> /dev/null; then
       echo "错误: 未找到Emscripten，请先安装emsdk"
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
   
   if [ $? -eq 0 ]; then
       echo "编译成功！"
       echo "生成文件: src/wasm/seed_viewer.js 和 src/wasm/seed_viewer.wasm"
   else
       echo "编译失败，请检查错误信息"
       exit 1
   fi
   ```

4. 创建Windows批处理脚本 `scripts/build_wasm.bat`：
   ```batch
   @echo off
   
   REM 检查Emscripten是否安装
   where emcc >nul 2>nul
   if %errorlevel% neq 0 (
       echo 错误: 未找到Emscripten，请先安装emsdk
       exit /b 1
   )
   
   REM 编译C++为WebAssembly
   emcc -O3 -s WASM=1 -s EXPORTED_FUNCTIONS="['_getSeedData', '_formatAmount', '_malloc', '_free']" -s EXPORTED_RUNTIME_METHODS="['ccall', 'cwrap']" -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s EXPORT_NAME="SeedViewerModule" -s EXTRA_EXPORTED_RUNTIME_METHODS="['UTF8ToString', 'stringToUTF8']" -I./dsp_search_seed/cpp_source_code ./dsp_search_seed/cpp_source_code/astro_class.cpp ./dsp_search_seed/cpp_source_code/check_seed.cpp ./dsp_search_seed/cpp_source_code/check_seed_util.cpp ./dsp_search_seed/cpp_source_code/static_value.cpp -o src/wasm/seed_viewer.js
   
   if %errorlevel% equ 0 (
       echo 编译成功！
       echo 生成文件: src/wasm/seed_viewer.js 和 src/wasm/seed_viewer.wasm
   ) else (
       echo 编译失败，请检查错误信息
       exit /b 1
   )
   ```

**验证标准**：
- 编译脚本创建成功
- 脚本具有可执行权限

---

## 阶段2：C++代码修改（2-3天）

### 任务2.1：创建WebAssembly导出接口

**目标**：创建WebAssembly导出函数，暴露核心算法接口

**步骤**：
1. 创建头文件 `dsp_search_seed/cpp_source_code/wasm_api.hpp`：
   ```cpp
   #ifndef WASM_API_HPP
   #define WASM_API_HPP
   
   #include <string>
   #include "data_struct.hpp"
   
   extern "C" {
       // 获取种子数据（返回JSON字符串）
       const char* getSeedData(int seedId, int starNum, int resourceIndex);
       
       // 格式化数量
       const char* formatAmount(long long number);
       
       // 初始化
       void init();
   }
   
   #endif
   ```

2. 创建实现文件 `dsp_search_seed/cpp_source_code/wasm_api.cpp`：
   ```cpp
   #include "wasm_api.hpp"
   #include "check_seed.hpp"
   #include "data_struct.hpp"
   #include "PlanetAlgorithm.hpp"
   #include "RandomTable.hpp"
   #include <string>
   #include <sstream>
   #include <vector>
   
   static std::string resultBuffer;
   
   // 初始化函数
   void init() {
       static bool isInit = false;
       if (isInit) return;
       isInit = true;
       PlanetAlgorithm::do_init();
       RandomTable::GenerateSphericNormal();
   }
   
   // 序列化行星数据为JSON
   static void serializePlanet(std::ostringstream& oss, const PlanetData& planet) {
       oss << "{"
           << "\"planetIndex\":" << planet.planetIndex
           << ",\"name\":\"" << planet.name << "\""
           << ",\"type\":\"" << planet.type << "\""
           << ",\"typeId\":" << planet.typeId
           << ",\"seed\":" << planet.seed
           << ",\"radius\":" << planet.radius
           << ",\"isGas\":" << (planet.isGas ? "true" : "false")
           << ",\"landPercent\":" << planet.landPercent
           << ",\"veinsPoint\":[";
       
       for (int i = 0; i < 14; i++) {
           if (i > 0) oss << ",";
           oss << planet.veinsPoint[i];
       }
       oss << "],\"veinsAmount\":[";
       
       for (int i = 0; i < 14; i++) {
           if (i > 0) oss << ",";
           oss << planet.veinsAmount[i];
       }
       oss << "]}";
   }
   
   // 序列化恒星数据为JSON
   static void serializeStar(std::ostringstream& oss, const StarData& star) {
       oss << "{"
           << "\"starIndex\":" << star.starIndex
           << ",\"name\":\"" << star.name << "\""
           << ",\"type\":\"" << star.type << "\""
           << ",\"typeId\":" << star.typeId
           << ",\"seed\":" << star.seed
           << ",\"dysonLumino\":" << star.dysonLumino
           << ",\"dysonRadius\":" << star.dysonRadius
           << ",\"distance\":" << star.distance
           << ",\"veinsPoint\":[";
       
       for (int i = 0; i < 14; i++) {
           if (i > 0) oss << ",";
           oss << star.veinsPoint[i];
       }
       oss << "],\"veinsAmount\":[";
       
       for (int i = 0; i < 14; i++) {
           if (i > 0) oss << ",";
           oss << star.veinsAmount[i];
       }
       oss << "],\"planets\":[";
       
       for (size_t i = 0; i < star.planets.size(); i++) {
           if (i > 0) oss << ",";
           serializePlanet(oss, star.planets[i]);
       }
       oss << "]}";
   }
   
   // 获取种子数据
   const char* getSeedData(int seedId, int starNum, int resourceIndex) {
       // 初始化
       init();
       
       // 创建种子对象
       Seed seed(seedId, starNum, resourceIndex);
       
       // 获取星系数据
       GalaxyData galaxyData = getGalaxyData(seed, false);
       
       // 序列化为JSON
       std::ostringstream oss;
       oss << "{"
           << "\"seedId\":" << galaxyData.seedId
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
       
       for (size_t i = 0; i < galaxyData.stars.size(); i++) {
           if (i > 0) oss << ",";
           serializeStar(oss, galaxyData.stars[i]);
       }
       oss << "]}";
       
       resultBuffer = oss.str();
       return resultBuffer.c_str();
   }
   
   // 格式化数量
   const char* formatAmount(long long number) {
       if (number >= 1000000000) {
           double value = number / 1000000000.0;
           char buffer[32];
           snprintf(buffer, sizeof(buffer), "%.2fB", value);
           resultBuffer = buffer;
       } else if (number >= 1000000) {
           double value = number / 1000000.0;
           char buffer[32];
           snprintf(buffer, sizeof(buffer), "%.2fM", value);
           resultBuffer = buffer;
       } else if (number >= 1000) {
           double value = number / 1000.0;
           char buffer[32];
           snprintf(buffer, sizeof(buffer), "%.2fK", value);
           resultBuffer = buffer;
       } else {
           resultBuffer = std::to_string(number);
       }
       return resultBuffer.c_str();
   }
   ```

**验证标准**：
- 头文件和实现文件创建成功
- 代码语法正确

### 任务2.2：修改现有C++代码

**目标**：移除不兼容的代码，适配WebAssembly编译

**步骤**：
1. 修改 `dsp_search_seed/cpp_source_code/python_api.cpp`：
   - 移除pybind11相关代码
   - 移除OpenCL初始化代码
   - 保留核心算法函数

2. 修改 `dsp_search_seed/cpp_source_code/gpu_benchmark.hpp`：
   - 禁用GPU基准测试功能
   - 添加WebAssembly兼容性宏

3. 修改 `dsp_search_seed/cpp_source_code/check_batch.hpp`：
   - 移除GPU加速代码
   - 保留CPU版本的批量检查功能

4. 修改 `dsp_search_seed/cpp_source_code/check_seed.cpp`：
   - 确保所有函数都支持WebAssembly编译
   - 移除平台特定的代码

**验证标准**：
- 代码修改完成
- 没有语法错误
- 核心算法功能保留

### 任务2.3：测试C++代码编译

**目标**：验证C++代码可以成功编译为WebAssembly

**步骤**：
1. 运行编译脚本：
   ```bash
   # Linux/macOS
   chmod +x scripts/build_wasm.sh
   ./scripts/build_wasm.sh
   
   # Windows
   scripts\build_wasm.bat
   ```

2. 检查生成文件：
   ```bash
   ls -la src/wasm/
   ```

3. 验证文件大小：
   ```bash
   # WebAssembly文件应该在1-5MB之间
   du -h src/wasm/seed_viewer.wasm
   ```

**验证标准**：
- 编译成功，没有错误
- 生成 `seed_viewer.js` 和 `seed_viewer.wasm` 文件
- 文件大小合理

---

## 阶段3：JavaScript绑定（1-2天）

### 任务3.1：创建JavaScript绑定模块

**目标**：封装WebAssembly模块，提供友好的JavaScript接口

**步骤**：
1. 创建绑定文件 `src/wasm/seed_viewer_binding.js`：
   ```javascript
   /**
    * 种子查看器WebAssembly绑定模块
    */
   
   let wasmModule = null;
   let isInitialized = false;
   
   /**
    * 初始化WebAssembly模块
    * @returns {Promise<boolean>} 初始化是否成功
    */
   export async function initSeedViewer() {
       if (isInitialized) {
           return true;
       }
       
       try {
           // 动态加载WebAssembly模块
           const response = await fetch('/wasm/seed_viewer.wasm');
           const wasmBuffer = await response.arrayBuffer();
           
           // 初始化模块
           const module = await WebAssembly.instantiate(wasmBuffer, {
               env: {
                   memory: new WebAssembly.Memory({ initial: 256, maximum: 65536 })
               }
           });
           
           wasmModule = module.instance.exports;
           isInitialized = true;
           
           // 调用初始化函数
           if (wasmModule.init) {
               wasmModule.init();
           }
           
           return true;
       } catch (error) {
           console.error('WebAssembly模块初始化失败:', error);
           return false;
       }
   }
   
   /**
    * 查询种子数据
    * @param {number} seedId - 种子ID
    * @param {number} starNum - 恒星数量
    * @param {number} resourceIndex - 资源倍率索引
    * @returns {Object|null} 种子数据对象，失败返回null
    */
   export function getSeedData(seedId, starNum, resourceIndex) {
       if (!isInitialized || !wasmModule) {
           console.error('WebAssembly模块未初始化');
           return null;
       }
       
       try {
           // 调用WebAssembly函数
           const resultPtr = wasmModule.getSeedData(seedId, starNum, resourceIndex);
           
           // 读取结果字符串
           const resultStr = readStringFromMemory(resultPtr);
           
           // 解析JSON
           return JSON.parse(resultStr);
       } catch (error) {
           console.error('查询种子数据失败:', error);
           return null;
       }
   }
   
   /**
    * 格式化数量
    * @param {number} number - 数量
    * @returns {string} 格式化后的字符串
    */
   export function formatAmount(number) {
       if (!isInitialized || !wasmModule) {
           console.error('WebAssembly模块未初始化');
           return String(number);
       }
       
       try {
           const resultPtr = wasmModule.formatAmount(number);
           return readStringFromMemory(resultPtr);
       } catch (error) {
           console.error('格式化数量失败:', error);
           return String(number);
       }
   }
   
   /**
    * 从WebAssembly内存中读取字符串
    * @param {number} ptr - 字符串指针
    * @returns {string} 读取的字符串
    */
   function readStringFromMemory(ptr) {
       const memory = wasmModule.memory;
       const bytes = new Uint8Array(memory.buffer);
       
       let str = '';
       let i = ptr;
       while (bytes[i] !== 0) {
           str += String.fromCharCode(bytes[i]);
           i++;
       }
       
       return str;
   }
   
   /**
    * 检查WebAssembly模块是否已初始化
    * @returns {boolean} 是否已初始化
    */
   export function isSeedViewerReady() {
       return isInitialized;
   }
   ```

2. 创建TypeScript类型定义 `src/wasm/seed_viewer.d.ts`：
   ```typescript
   /**
    * 种子查看器WebAssembly模块类型定义
    */
   
   export interface PlanetData {
       planetIndex: number;
       name: string;
       type: string;
       typeId: number;
       seed: number;
       radius: number;
       isGas: boolean;
       landPercent: number;
       veinsPoint: number[];
       veinsAmount: number[];
   }
   
   export interface StarData {
       starIndex: number;
       name: string;
       type: string;
       typeId: number;
       seed: number;
       dysonLumino: number;
       dysonRadius: number;
       distance: number;
       veinsPoint: number[];
       veinsAmount: number[];
       planets: PlanetData[];
   }
   
   export interface SeedData {
       seedId: number;
       starNum: number;
       resourceIndex: number;
       resourceRate: number;
       veinsPoint: number[];
       veinsAmount: number[];
       stars: StarData[];
   }
   
   /**
    * 初始化WebAssembly模块
    * @returns Promise<boolean> 初始化是否成功
    */
   export function initSeedViewer(): Promise<boolean>;
   
   /**
    * 查询种子数据
    * @param seedId 种子ID
    * @param starNum 恒星数量
    * @param resourceIndex 资源倍率索引
    * @returns 种子数据对象，失败返回null
    */
   export function getSeedData(seedId: number, starNum: number, resourceIndex: number): SeedData | null;
   
   /**
    * 格式化数量
    * @param number 数量
    * @returns 格式化后的字符串
    */
   export function formatAmount(number: number): string;
   
   /**
    * 检查WebAssembly模块是否已初始化
    * @returns 是否已初始化
    */
   export function isSeedViewerReady(): boolean;
   ```

**验证标准**：
- JavaScript绑定文件创建成功
- TypeScript类型定义文件创建成功
- 代码语法正确

### 任务3.2：创建数据转换工具

**目标**：创建数据转换和格式化工具函数

**步骤**：
1. 创建工具文件 `src/wasm/seed_viewer_utils.js`：
   ```javascript
   /**
    * 种子查看器工具函数
    */
   
   /**
    * 矿脉类型名称映射
    */
   export const VEIN_NAMES = [
       '铁', '铜', '硅', '钛', '石', '煤', '油',
       '可燃冰', '金伯利', '分形硅', '有机晶体',
       '光栅石', '刺笋结晶', '单极磁石'
   ];
   
   /**
    * 资源倍率映射
    */
   export const RESOURCE_RATES = [
       { index: 0, rate: 0.1, label: '0.1x (极少)' },
       { index: 1, rate: 0.3, label: '0.3x' },
       { index: 2, rate: 0.5, label: '0.5x' },
       { index: 3, rate: 0.8, label: '0.8x' },
       { index: 4, rate: 1.0, label: '1.0x (标准)' },
       { index: 5, rate: 1.5, label: '1.5x' },
       { index: 6, rate: 2.0, label: '2.0x' },
       { index: 7, rate: 3.0, label: '3.0x' },
       { index: 8, rate: 5.0, label: '5.0x' },
       { index: 9, rate: 8.0, label: '8.0x' },
       { index: 10, rate: 1000.0, label: '无限' }
   ];
   
   /**
    * 恒星类型名称映射
    */
   export const STAR_TYPES = {
       0: '红巨星',
       1: '黄巨星',
       2: '蓝巨星',
       3: '白巨星',
       4: '白矮星',
       5: '中子星',
       6: '黑洞',
       7: 'A型恒星',
       8: 'B型恒星',
       9: 'F型恒星',
       10: 'G型恒星',
       11: 'K型恒星',
       12: 'M型恒星',
       13: 'O型恒星'
   };
   
   /**
    * 行星类型名称映射
    */
   export const PLANET_TYPES = {
       0: '地中海',
       1: '冰巨星',
       2: '干旱荒漠',
       3: '灰烬冻土',
       4: '海洋丛林',
       5: '熔岩',
       6: '冰原冻土',
       7: '贫瘠荒漠',
       8: '戈壁',
       9: '火山灰',
       10: '红石',
       11: '草原',
       12: '水世界',
       13: '黑石盐滩',
       14: '樱林海',
       15: '飓风石林',
       16: '猩红冰湖',
       17: '热带草原',
       18: '橙晶荒漠',
       19: '极寒冻土',
       20: '潘多拉沼泽',
       21: '高产气巨',
       22: '气态巨星'
   };
   
   /**
    * 格式化数量显示
    * @param {number} number - 数量
    * @returns {string} 格式化后的字符串
    */
   export function formatNumber(number) {
       if (number >= 1e9) {
           return (number / 1e9).toFixed(2) + 'B';
       } else if (number >= 1e6) {
           return (number / 1e6).toFixed(2) + 'M';
       } else if (number >= 1e3) {
           return (number / 1e3).toFixed(2) + 'K';
       } else {
           return number.toString();
       }
   }
   
   /**
    * 获取矿脉名称
    * @param {number} index - 矿脉索引（0-13）
    * @returns {string} 矿脉名称
    */
   export function getVeinName(index) {
       return VEIN_NAMES[index] || `矿脉${index}`;
   }
   
   /**
    * 获取资源倍率标签
    * @param {number} index - 资源倍率索引（0-10）
    * @returns {string} 资源倍率标签
    */
   export function getResourceRateLabel(index) {
       const rate = RESOURCE_RATES.find(r => r.index === index);
       return rate ? rate.label : `${index}`;
   }
   
   /**
    * 获取恒星类型名称
    * @param {number} typeId - 恒星类型ID
    * @returns {string} 恒星类型名称
    */
   export function getStarTypeName(typeId) {
       return STAR_TYPES[typeId] || `类型${typeId}`;
   }
   
   /**
    * 获取行星类型名称
    * @param {number} typeId - 行星类型ID
    * @returns {string} 行星类型名称
    */
   export function getPlanetTypeName(typeId) {
       return PLANET_TYPES[typeId] || `类型${typeId}`;
   }
   
   /**
    * 验证种子ID
    * @param {number} seedId - 种子ID
    * @returns {Object} 验证结果
    */
   export function validateSeedId(seedId) {
       if (!seedId || seedId <= 0) {
           return { valid: false, error: '种子ID必须是正整数' };
       }
       if (seedId > 2147483647) {
           return { valid: false, error: '种子ID超出范围' };
       }
       return { valid: true };
   }
   
   /**
    * 验证恒星数量
    * @param {number} starNum - 恒星数量
    * @returns {Object} 验证结果
    */
   export function validateStarNum(starNum) {
       if (!starNum || starNum <= 0) {
           return { valid: false, error: '恒星数量必须是正整数' };
       }
       if (starNum > 128) {
           return { valid: false, error: '恒星数量不能超过128' };
       }
       return { valid: true };
   }
   
   /**
    * 验证资源倍率索引
    * @param {number} resourceIndex - 资源倍率索引
    * @returns {Object} 验证结果
    */
   export function validateResourceIndex(resourceIndex) {
       if (resourceIndex < 0 || resourceIndex > 10) {
           return { valid: false, error: '资源倍率索引必须在0-10之间' };
       }
       return { valid: true };
   }
   ```

**验证标准**：
- 工具文件创建成功
- 所有映射和函数定义正确
- 代码语法正确

---

## 阶段4：前端组件开发（2-3天）

### 任务4.1：创建种子查看器页面组件

**目标**：创建种子查看器页面主组件

**步骤**：
1. 创建页面组件 `src/SeedViewerPage.jsx`：
   ```jsx
   import { useState, useEffect, useCallback } from 'react';
   import { FaSearch, FaSpinner, FaExclamationTriangle } from 'react-icons/fa';
   import { initSeedViewer, getSeedData, isSeedViewerReady } from './wasm/seed_viewer_binding';
   import { 
       VEIN_NAMES, RESOURCE_RATES, 
       validateSeedId, validateStarNum, validateResourceIndex 
   } from './wasm/seed_viewer_utils';
   import SeedViewerResult from './SeedViewerResult';
   import './SeedViewer.css';
   
   const STORAGE_KEY = 'seed-viewer-settings';
   
   export default function SeedViewerPage({ onNavigate, isActive }) {
       // 状态管理
       const [seedId, setSeedId] = useState(() => {
           const saved = localStorage.getItem(STORAGE_KEY);
           return saved ? JSON.parse(saved).seedId || 10381977 : 10381977;
       });
       const [starNum, setStarNum] = useState(() => {
           const saved = localStorage.getItem(STORAGE_KEY);
           return saved ? JSON.parse(saved).starNum || 64 : 64;
       });
       const [resourceIndex, setResourceIndex] = useState(() => {
           const saved = localStorage.getItem(STORAGE_KEY);
           return saved ? JSON.parse(saved).resourceIndex || 4 : 4;
       });
       
       const [isLoading, setIsLoading] = useState(false);
       const [isInitializing, setIsInitializing] = useState(true);
       const [error, setError] = useState(null);
       const [result, setResult] = useState(null);
       const [wasmReady, setWasmReady] = useState(false);
   
       // 初始化WebAssembly模块
       useEffect(() => {
           async function init() {
               try {
                   setIsInitializing(true);
                   const success = await initSeedViewer();
                   setWasmReady(success);
                   if (!success) {
                       setError('WebAssembly模块初始化失败');
                   }
               } catch (err) {
                   setError('初始化错误: ' + err.message);
               } finally {
                   setIsInitializing(false);
               }
           }
           
           if (isActive) {
               init();
           }
       }, [isActive]);
   
       // 保存设置到localStorage
       useEffect(() => {
           try {
               localStorage.setItem(STORAGE_KEY, JSON.stringify({
                   seedId, starNum, resourceIndex
               }));
           } catch {}
       }, [seedId, starNum, resourceIndex]);
   
       // 查询种子数据
       const handleQuery = useCallback(async () => {
           // 验证输入
           const seedIdValid = validateSeedId(seedId);
           if (!seedIdValid.valid) {
               setError(seedIdValid.error);
               return;
           }
           
           const starNumValid = validateStarNum(starNum);
           if (!starNumValid.valid) {
               setError(starNumValid.error);
               return;
           }
           
           const resourceIndexValid = validateResourceIndex(resourceIndex);
           if (!resourceIndexValid.valid) {
               setError(resourceIndexValid.error);
               return;
           }
           
           // 检查WASM模块是否就绪
           if (!wasmReady) {
               setError('WebAssembly模块未就绪，请稍后重试');
               return;
           }
           
           setIsLoading(true);
           setError(null);
           setResult(null);
           
           try {
               // 调用WebAssembly查询
               const data = getSeedData(seedId, starNum, resourceIndex);
               
               if (data) {
                   setResult(data);
               } else {
                   setError('查询失败，请检查输入参数');
               }
           } catch (err) {
               setError('查询错误: ' + err.message);
           } finally {
               setIsLoading(false);
           }
       }, [seedId, starNum, resourceIndex, wasmReady]);
   
       // 处理键盘事件
       const handleKeyPress = useCallback((e) => {
           if (e.key === 'Enter' && !isLoading && wasmReady) {
               handleQuery();
           }
       }, [handleQuery, isLoading, wasmReady]);
   
       // 渲染加载状态
       if (isInitializing) {
           return (
               <div className="seed-viewer-page">
                   <div className="loading-container">
                       <FaSpinner className="spinner" />
                       <p>正在初始化WebAssembly模块...</p>
                   </div>
               </div>
           );
       }
   
       return (
           <div className="seed-viewer-page">
               {/* 输入面板 */}
               <div className="input-panel">
                   <h2>种子查看器</h2>
                   <p className="description">
                       查询指定种子的资源分布，查看恒星和行星详情
                   </p>
                   
                   <div className="form-group">
                       <label htmlFor="seedId">种子ID</label>
                       <input
                           id="seedId"
                           type="number"
                           value={seedId}
                           onChange={(e) => setSeedId(Number(e.target.value))}
                           onKeyPress={handleKeyPress}
                           placeholder="输入种子ID"
                           disabled={isLoading}
                       />
                   </div>
                   
                   <div className="form-group">
                       <label htmlFor="starNum">恒星数量</label>
                       <select
                           id="starNum"
                           value={starNum}
                           onChange={(e) => setStarNum(Number(e.target.value))}
                           disabled={isLoading}
                       >
                           <option value={16}>16星</option>
                           <option value={32}>32星</option>
                           <option value={48}>48星</option>
                           <option value={64}>64星</option>
                           <option value={96}>96星</option>
                           <option value={128}>128星</option>
                       </select>
                   </div>
                   
                   <div className="form-group">
                       <label htmlFor="resourceIndex">资源倍率</label>
                       <select
                           id="resourceIndex"
                           value={resourceIndex}
                           onChange={(e) => setResourceIndex(Number(e.target.value))}
                           disabled={isLoading}
                       >
                           {RESOURCE_RATES.map(rate => (
                               <option key={rate.index} value={rate.index}>
                                   {rate.label}
                               </option>
                           ))}
                       </select>
                   </div>
                   
                   <button
                       className="query-button"
                       onClick={handleQuery}
                       disabled={isLoading || !wasmReady}
                   >
                       {isLoading ? (
                           <>
                               <FaSpinner className="spinner" />
                               查询中...
                           </>
                       ) : (
                           <>
                               <FaSearch />
                               查询
                           </>
                       )}
                   </button>
                   
                   {error && (
                       <div className="error-message">
                           <FaExclamationTriangle />
                           <span>{error}</span>
                       </div>
                   )}
               </div>
               
               {/* 结果面板 */}
               {result && (
                   <SeedViewerResult data={result} />
               )}
           </div>
       );
   }
   ```

**验证标准**：
- 页面组件创建成功
- 包含输入表单和查询按钮
- 状态管理正确
- 错误处理完善

### 任务4.2：创建结果展示组件

**目标**：创建种子数据结果展示组件

**步骤**：
1. 创建结果组件 `src/SeedViewerResult.jsx`：
   ```jsx
   import { useState } from 'react';
   import { FaChevronDown, FaChevronRight, FaStar, FaGlobe } from 'react-icons/fa';
   import { 
       VEIN_NAMES, formatNumber, 
       getStarTypeName, getPlanetTypeName 
   } from './wasm/seed_viewer_utils';
   
   export default function SeedViewerResult({ data }) {
       const [expandedStars, setExpandedStars] = useState(new Set());
   
       // 切换恒星展开状态
       const toggleStar = (starIndex) => {
           setExpandedStars(prev => {
               const next = new Set(prev);
               if (next.has(starIndex)) {
                   next.delete(starIndex);
               } else {
                   next.add(starIndex);
               }
               return next;
           });
       };
   
       // 展开所有恒星
       const expandAll = () => {
           setExpandedStars(new Set(data.stars.map(s => s.starIndex)));
       };
   
       // 收起所有恒星
       const collapseAll = () => {
           setExpandedStars(new Set());
       };
   
       return (
           <div className="result-panel">
               {/* 星区汇总 */}
               <div className="galaxy-summary">
                   <h3>星区汇总</h3>
                   <div className="vein-grid">
                       {VEIN_NAMES.map((name, index) => (
                           <div key={index} className="vein-item">
                               <span className="vein-name">{name}</span>
                               <span className="vein-value">
                                   {formatNumber(data.veinsAmount[index])}
                               </span>
                           </div>
                       ))}
                   </div>
               </div>
   
               {/* 恒星列表 */}
               <div className="star-list">
                   <div className="star-list-header">
                       <h3>恒星列表 ({data.stars.length}颗)</h3>
                       <div className="star-list-actions">
                           <button onClick={expandAll}>展开全部</button>
                           <button onClick={collapseAll}>收起全部</button>
                       </div>
                   </div>
                   
                   <div className="star-tree">
                       {data.stars.map(star => (
                           <div key={star.starIndex} className="star-item">
                               <div 
                                   className="star-header"
                                   onClick={() => toggleStar(star.starIndex)}
                               >
                                   {expandedStars.has(star.starIndex) ? (
                                       <FaChevronDown />
                                   ) : (
                                       <FaChevronRight />
                                   )}
                                   <FaStar className="star-icon" />
                                   <span className="star-name">{star.name}</span>
                                   <span className="star-type">
                                       {getStarTypeName(star.typeId)}
                                   </span>
                                   <span className="star-planets">
                                       {star.planets.length}颗行星
                                   </span>
                               </div>
                               
                               {expandedStars.has(star.starIndex) && (
                                   <div className="planet-list">
                                       {star.planets.map(planet => (
                                           <div key={planet.planetIndex} className="planet-item">
                                               <FaGlobe className="planet-icon" />
                                               <span className="planet-name">{planet.name}</span>
                                               <span className="planet-type">
                                                   {getPlanetTypeName(planet.typeId)}
                                               </span>
                                               <span className="planet-veins">
                                                   {planet.veinsPoint.filter(v => v > 0).length}种矿脉
                                               </span>
                                           </div>
                                       ))}
                                   </div>
                               )}
                           </div>
                       ))}
                   </div>
               </div>
           </div>
       );
   }
   ```

**验证标准**：
- 结果组件创建成功
- 显示星区汇总和恒星列表
- 支持展开/收起交互
- 格式化显示正确

### 任务4.3：创建样式文件

**目标**：创建种子查看器页面的CSS样式

**步骤**：
1. 创建样式文件 `src/SeedViewer.css`：
   ```css
   /* 种子查看器页面样式 */
   .seed-viewer-page {
       display: flex;
       gap: 20px;
       padding: 20px;
       height: calc(100vh - 60px);
       background: var(--bs-body-bg);
   }
   
   /* 输入面板 */
   .input-panel {
       width: 300px;
       background: var(--bs-card-bg);
       border-radius: 8px;
       padding: 20px;
       box-shadow: 0 2px 8px rgba(0,0,0,0.1);
       display: flex;
       flex-direction: column;
       gap: 16px;
   }
   
   .input-panel h2 {
       margin: 0;
       color: var(--bs-body-color);
       font-size: 1.5rem;
   }
   
   .input-panel .description {
       margin: 0;
       color: var(--bs-secondary-color);
       font-size: 0.9rem;
   }
   
   .form-group {
       display: flex;
       flex-direction: column;
       gap: 6px;
   }
   
   .form-group label {
       font-size: 0.9rem;
       color: var(--bs-secondary-color);
       font-weight: 500;
   }
   
   .form-group input,
   .form-group select {
       padding: 10px 12px;
       border: 1px solid var(--bs-border-color);
       border-radius: 6px;
       background: var(--bs-body-bg);
       color: var(--bs-body-color);
       font-size: 1rem;
   }
   
   .form-group input:focus,
   .form-group select:focus {
       outline: none;
       border-color: var(--bs-primary);
       box-shadow: 0 0 0 3px rgba(var(--bs-primary-rgb), 0.25);
   }
   
   .query-button {
       display: flex;
       align-items: center;
       justify-content: center;
       gap: 8px;
       padding: 12px;
       background: var(--bs-primary);
       color: white;
       border: none;
       border-radius: 6px;
       font-size: 1rem;
       font-weight: 500;
       cursor: pointer;
       transition: background 0.2s;
   }
   
   .query-button:hover:not(:disabled) {
       background: var(--bs-primary-hover);
   }
   
   .query-button:disabled {
       opacity: 0.6;
       cursor: not-allowed;
   }
   
   .spinner {
       animation: spin 1s linear infinite;
   }
   
   @keyframes spin {
       from { transform: rotate(0deg); }
       to { transform: rotate(360deg); }
   }
   
   .error-message {
       display: flex;
       align-items: center;
       gap: 8px;
       padding: 12px;
       background: var(--bs-danger-bg-subtle);
       color: var(--bs-danger-text-emphasis);
       border-radius: 6px;
       font-size: 0.9rem;
   }
   
   /* 结果面板 */
   .result-panel {
       flex: 1;
       display: flex;
       flex-direction: column;
       gap: 20px;
       overflow-y: auto;
   }
   
   /* 星区汇总 */
   .galaxy-summary {
       background: var(--bs-card-bg);
       border-radius: 8px;
       padding: 20px;
       box-shadow: 0 2px 8px rgba(0,0,0,0.1);
   }
   
   .galaxy-summary h3 {
       margin: 0 0 16px 0;
       color: var(--bs-body-color);
       font-size: 1.2rem;
   }
   
   .vein-grid {
       display: grid;
       grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
       gap: 12px;
   }
   
   .vein-item {
       display: flex;
       justify-content: space-between;
       align-items: center;
       padding: 10px 12px;
       background: var(--bs-body-bg);
       border-radius: 6px;
       border: 1px solid var(--bs-border-color);
   }
   
   .vein-name {
       color: var(--bs-secondary-color);
       font-size: 0.9rem;
   }
   
   .vein-value {
       font-weight: 600;
       color: var(--bs-body-color);
       font-size: 1rem;
   }
   
   /* 恒星列表 */
   .star-list {
       background: var(--bs-card-bg);
       border-radius: 8px;
       padding: 20px;
       box-shadow: 0 2px 8px rgba(0,0,0,0.1);
   }
   
   .star-list-header {
       display: flex;
       justify-content: space-between;
       align-items: center;
       margin-bottom: 16px;
   }
   
   .star-list-header h3 {
       margin: 0;
       color: var(--bs-body-color);
       font-size: 1.2rem;
   }
   
   .star-list-actions {
       display: flex;
       gap: 8px;
   }
   
   .star-list-actions button {
       padding: 6px 12px;
       background: var(--bs-secondary-bg);
       color: var(--bs-body-color);
       border: 1px solid var(--bs-border-color);
       border-radius: 4px;
       font-size: 0.85rem;
       cursor: pointer;
       transition: background 0.2s;
   }
   
   .star-list-actions button:hover {
       background: var(--bs-tertiary-bg);
   }
   
   .star-tree {
       display: flex;
       flex-direction: column;
       gap: 8px;
   }
   
   .star-item {
       border: 1px solid var(--bs-border-color);
       border-radius: 6px;
       overflow: hidden;
   }
   
   .star-header {
       display: flex;
       align-items: center;
       gap: 10px;
       padding: 12px 16px;
       background: var(--bs-body-bg);
       cursor: pointer;
       transition: background 0.2s;
   }
   
   .star-header:hover {
       background: var(--bs-tertiary-bg);
   }
   
   .star-icon {
       color: var(--bs-warning);
       font-size: 1.1rem;
   }
   
   .star-name {
       font-weight: 600;
       color: var(--bs-body-color);
   }
   
   .star-type {
       color: var(--bs-secondary-color);
       font-size: 0.9rem;
   }
   
   .star-planets {
       margin-left: auto;
       color: var(--bs-secondary-color);
       font-size: 0.85rem;
   }
   
   .planet-list {
       padding: 8px 16px 16px 40px;
       display: flex;
       flex-direction: column;
       gap: 6px;
   }
   
   .planet-item {
       display: flex;
       align-items: center;
       gap: 10px;
       padding: 8px 12px;
       background: var(--bs-body-bg);
       border-radius: 4px;
       border: 1px solid var(--bs-border-color);
   }
   
   .planet-icon {
       color: var(--bs-success);
       font-size: 0.9rem;
   }
   
   .planet-name {
       font-weight: 500;
       color: var(--bs-body-color);
   }
   
   .planet-type {
       color: var(--bs-secondary-color);
       font-size: 0.85rem;
   }
   
   .planet-veins {
       margin-left: auto;
       color: var(--bs-secondary-color);
       font-size: 0.8rem;
   }
   
   /* 加载状态 */
   .loading-container {
       display: flex;
       flex-direction: column;
       align-items: center;
       justify-content: center;
       height: 100%;
       gap: 16px;
       color: var(--bs-secondary-color);
   }
   
   .loading-container .spinner {
       font-size: 2rem;
       color: var(--bs-primary);
   }
   
   /* 响应式设计 */
   @media (max-width: 768px) {
       .seed-viewer-page {
           flex-direction: column;
           height: auto;
       }
       
       .input-panel {
           width: 100%;
       }
       
       .vein-grid {
           grid-template-columns: repeat(2, 1fr);
       }
   }
   ```

**验证标准**：
- 样式文件创建成功
- 支持深色/浅色主题
- 响应式设计正确
- 与现有项目风格一致

### 任务4.4：修改主入口文件

**目标**：在主入口文件中添加种子查看器页面路由

**步骤**：
1. 修改 `src/main.jsx`：
   ```jsx
   import React, {useState, useEffect} from 'react';
   import ReactDOM from 'react-dom/client';
   import App from './App.jsx';
   import {Header, IconStyles, ThemeProvider} from './ui_components.jsx';
   import {ContextProvider} from './contexts.jsx';
   import {DependencyGraphPage} from './DependencyGraphPage.jsx';
   import {SeedViewerPage} from './SeedViewerPage.jsx';  // 新增导入
   
   // Not using 'bootstrap/dist/js/bootstrap.min.js' here, because it breaks dropdown-list
   import 'bootstrap';
   
   import 'bootstrap/scss/bootstrap.scss';
   // app-specific CSS
   import '../css/App.css';
   
   ReactDOM.createRoot(document.getElementById('icon-styles')).render(
       <IconStyles/>
   )
   
   // 隐藏原始 header div，使用 RootApp 内的 header
   document.getElementById('header').style.display = 'none';
   
   /**
    * 根应用组件，包含页面切换逻辑
    * ContextProvider 和 Header 在此组件内渲染，确保切换页面时 context 不丢失
    * needs_list 状态提升到此处，确保切换页面时需求列表不丢失
    */
   const STORAGE_KEY_NEEDS = 'dsp-calc-needs-list';
   
   function RootApp() {
       const [page, setPage] = useState('calculator'); // 'calculator' | 'dependency-graph' | 'seed-viewer'
       const [newTabData, setNewTabData] = useState(null);
       const [needs_list, set_needs_list] = useState(() => {
           try {
               // 检查是否有新标签页数据
               const saved = localStorage.getItem('dsp-calc-new-tab-data');
               if (saved) {
                   const data = JSON.parse(saved);
                   localStorage.removeItem('dsp-calc-new-tab-data');
                   // 延迟设置newTabData，避免在useState initializer中调用setState
                   setTimeout(() => setNewTabData(data), 0);
                   // 返回包含新物品的需求表
                   return { [data.item]: data.count };
               }
           } catch {}
           try {
               const saved = localStorage.getItem(STORAGE_KEY_NEEDS);
               if (saved) return JSON.parse(saved);
           } catch {}
           return {};
       });
   
       // 需求表变更时持久化
       useEffect(() => {
           try { localStorage.setItem(STORAGE_KEY_NEEDS, JSON.stringify(needs_list)); } catch {}
       }, [needs_list]);
   
       // 使用 CSS display 切换而非条件渲染，避免切换页面时卸载/重挂组件导致 useMemo 重复计算
       // display: contents 让子组件像直接子元素一样布局，display: none 保持挂载但隐藏
       return <ThemeProvider>
           <ContextProvider>
               <Header onNavigate={setPage} currentPage={page}/>
               <div style={{display: page === 'calculator' ? 'contents' : 'none'}}>
                   <App needs_list={needs_list} set_needs_list={set_needs_list} newTabData={newTabData}/>
               </div>
               <div style={{display: page === 'dependency-graph' ? 'contents' : 'none'}}>
                   <DependencyGraphPage onBack={() => setPage('calculator')} needs_list={needs_list} isActive={page === 'dependency-graph'}/>
               </div>
               {/* 新增种子查看器页面 */}
               <div style={{display: page === 'seed-viewer' ? 'contents' : 'none'}}>
                   <SeedViewerPage onNavigate={setPage} isActive={page === 'seed-viewer'}/>
               </div>
           </ContextProvider>
       </ThemeProvider>;
   }
   
   ReactDOM.createRoot(document.getElementById('root')).render(
       <RootApp/>
   )
   
   // PWA registration requires Service Worker support — skip entirely on legacy
   // browsers (e.g. IE11) so the rest of the app still renders.
   if ('serviceWorker' in navigator) {
       import('./ui_components.jsx').then(({ReloadPrompt}) => {
           ReactDOM.createRoot(document.getElementById('pwa-prompt')).render(
               <ThemeProvider>
                   <ReloadPrompt/>
               </ThemeProvider>
           )
       }).catch(e => {
           console.warn('PWA registration unavailable:', e);
       });
   }
   ```

2. 修改 `src/ui_components.jsx` 中的Header组件：
   ```jsx
   // 在Header组件中添加种子查看器导航链接
   export function Header({onNavigate, currentPage}) {
       const version = import.meta.env.VITE_APP_VERSION;
       const {theme, toggleTheme} = useTheme();
       const renderTooltip = (props) => (
           <Tooltip id="qq-tooltip" {...props}>
               QQ:1610241445<br/>
               QQ群:暂无
           </Tooltip>
       );
   
       function handle_dependency_graph(e) {
           e.preventDefault();
           if (onNavigate) {
               onNavigate(currentPage === 'dependency-graph' ? 'calculator' : 'dependency-graph');
           }
       }
   
       function handle_seed_viewer(e) {
           e.preventDefault();
           if (onNavigate) {
               onNavigate(currentPage === 'seed-viewer' ? 'calculator' : 'seed-viewer');
           }
       }
   
       return (
           <Navbar className="px-3 text-nowrap" bg="body-tertiary" expand="lg">
               <Navbar.Brand href="#" className="d-inline-flex align-items-baseline"
                             onClick={(e) => { e.preventDefault(); onNavigate && onNavigate('calculator'); }}>
                   <FaReact className="me-2 align-self-center"/>
                   <span className="me-1">戴森球计划量化计算器</span>
                   <span className="text-muted ssmall">v{version}</span>
               </Navbar.Brand>
               <Navbar.Toggle aria-controls="navbarNav"/>
               <Navbar.Collapse id="navbarNav">
                   <Nav>
                       <Nav.Link
                           href="#"
                           className={`d-inline-flex align-items-center gap-1 ${currentPage === 'dependency-graph' ? 'active' : ''}`}
                           onClick={handle_dependency_graph}
                           title="查看依赖关系图"
                       >
                           <FaProjectDiagram/>
                           <span>依赖图</span>
                       </Nav.Link>
                       {/* 新增种子查看器导航链接 */}
                       <Nav.Link
                           href="#"
                           className={`d-inline-flex align-items-center gap-1 ${currentPage === 'seed-viewer' ? 'active' : ''}`}
                           onClick={handle_seed_viewer}
                           title="查看种子资源分布"
                       >
                           <FaSearch/>
                           <span>种子查看器</span>
                       </Nav.Link>
                       <Nav.Link href="https://github.com/yuki-216/dsp-calc-opt" target="_blank">开源仓库</Nav.Link>
                       {/* <Nav.Link href="https://www.bilibili.com/read/readlist/rl630834" target="_blank">逻辑原理</Nav.Link> */}
                       {/* <Nav.Link href="https://space.bilibili.com/16051534">联系作者</Nav.Link> */}
                   </Nav>
                   <Nav>
                       <OverlayTrigger
                           placement="bottom"
                           delay={{show: 250, hide: 400}}
                           overlay={renderTooltip}
                       >
                           <Nav.Link href="#" className="d-flex align-items-center">
                               <FaQq className="mr-1"/> QQ
                           </Nav.Link>
                       </OverlayTrigger>
                   </Nav>
   
                   <span className="navbar-text ms-auto small me-3">
                       游戏版本 v{vanilla_game_version}
                   </span>
                   <Nav>
                       <Nav.Link
                           href="#"
                           className="d-flex align-items-center"
                           onClick={toggleTheme}
                           title={theme === 'light' ? '切换到深色主题' : '切换到浅色主题'}
                       >
                           {theme === 'light' ? <FaMoon/> : <FaSun/>}
                       </Nav.Link>
                   </Nav>
               </Navbar.Collapse>
           </Navbar>
       );
   }
   ```

**验证标准**：
- 主入口文件修改成功
- Header组件添加种子查看器导航链接
- 页面路由切换正常

---

## 阶段5：测试和优化（1-2天）

### 任务5.1：功能测试

**目标**：验证所有功能正常工作

**测试用例**：
1. **页面路由测试**
   - 测试从计算器页面切换到种子查看器页面
   - 测试从种子查看器页面切换回计算器页面
   - 测试页面状态保持

2. **输入验证测试**
   - 测试种子ID输入验证
   - 测试恒星数量选择
   - 测试资源倍率选择

3. **查询功能测试**
   - 测试正常种子查询
   - 测试边界条件查询
   - 测试错误处理

4. **结果显示测试**
   - 测试星区汇总显示
   - 测试恒星列表显示
   - 测试行星详情显示

**验证标准**：
- 所有测试用例通过
- 没有JavaScript错误
- 用户体验流畅

### 任务5.2：性能测试

**目标**：验证性能符合要求

**测试项目**：
1. **WebAssembly模块加载时间**
   - 首次加载时间（目标：<2秒）
   - 缓存后加载时间（目标：<100ms）

2. **种子查询响应时间**
   - 单个种子查询时间（目标：<500ms）
   - 连续查询多个种子的性能

3. **内存使用情况**
   - WebAssembly模块内存占用
   - 查询过程中的内存增长

**验证标准**：
- 性能指标达到目标
- 没有内存泄漏
- 用户体验流畅

### 任务5.3：兼容性测试

**目标**：验证在不同浏览器和设备上的兼容性

**测试环境**：
1. **桌面浏览器**
   - Chrome（最新版本）
   - Firefox（最新版本）
   - Safari（最新版本）
   - Edge（最新版本）

2. **移动设备**
   - iOS Safari
   - Android Chrome

3. **不同屏幕尺寸**
   - 桌面（1920x1080）
   - 平板（1024x768）
   - 手机（375x667）

**验证标准**：
- 在所有测试环境中正常工作
- 响应式设计正确
- 没有布局问题

### 任务5.4：优化和调整

**目标**：根据测试结果进行优化

**优化项目**：
1. **性能优化**
   - 优化WebAssembly模块加载
   - 优化查询响应时间
   - 优化内存使用

2. **用户体验优化**
   - 优化加载状态显示
   - 优化错误提示信息
   - 优化交互响应

3. **代码优化**
   - 优化组件结构
   - 优化样式代码
   - 优化错误处理

**验证标准**：
- 性能指标达到目标
- 用户体验良好
- 代码质量高

---

## 阶段6：部署和发布（1天）

### 任务6.1：构建项目

**目标**：构建生产版本

**步骤**：
1. 运行构建命令：
   ```bash
   npm run build
   ```

2. 检查构建输出：
   ```bash
   ls -la dist/
   ```

3. 验证构建文件：
   - 检查JavaScript文件
   - 检查CSS文件
   - 检查WebAssembly文件
   - 检查静态资源

**验证标准**：
- 构建成功，没有错误
- 所有文件正确生成
- 文件大小合理

### 任务6.2：本地测试

**目标**：在本地测试生产版本

**步骤**：
1. 启动本地服务器：
   ```bash
   npx serve dist
   ```

2. 访问测试页面：
   - 测试计算器页面
   - 测试依赖图页面
   - 测试种子查看器页面

3. 验证功能：
   - 测试所有功能
   - 测试性能
   - 测试兼容性

**验证标准**：
- 所有功能正常
- 性能符合要求
- 兼容性良好

### 任务6.3：部署到GitHub Pages

**目标**：将项目部署到GitHub Pages

**步骤**：
1. 提交代码：
   ```bash
   git add .
   git commit -m "feat: 添加种子查看器功能"
   ```

2. 推送到GitHub：
   ```bash
   git push origin main
   ```

3. 配置GitHub Pages：
   - 进入仓库设置
   - 选择GitHub Pages
   - 选择部署分支和目录
   - 保存配置

4. 验证部署：
   - 访问GitHub Pages URL
   - 测试所有功能
   - 检查控制台错误

**验证标准**：
- 部署成功
- 所有功能正常
- 没有控制台错误

---

## 时间安排

| 阶段 | 任务 | 预计时间 | 依赖关系 |
|------|------|----------|----------|
| 阶段1 | 环境配置 | 1-2天 | 无 |
| 阶段2 | C++代码修改 | 2-3天 | 阶段1 |
| 阶段3 | JavaScript绑定 | 1-2天 | 阶段2 |
| 阶段4 | 前端组件开发 | 2-3天 | 阶段3 |
| 阶段5 | 测试和优化 | 1-2天 | 阶段4 |
| 阶段6 | 部署和发布 | 1天 | 阶段5 |
| **总计** | | **8-13天** | |

---

## 风险和应对措施

### 技术风险

| 风险 | 影响 | 概率 | 应对措施 |
|------|------|------|----------|
| Emscripten编译失败 | 高 | 中 | 准备备选方案（Python转JavaScript） |
| WebAssembly性能问题 | 中 | 低 | 优化算法，减少内存分配 |
| 浏览器兼容性问题 | 中 | 低 | 测试主流浏览器，提供降级方案 |

### 开发风险

| 风险 | 影响 | 概率 | 应对措施 |
|------|------|------|----------|
| 开发时间超期 | 中 | 中 | 分阶段实施，优先核心功能 |
| 算法准确性问题 | 高 | 低 | 充分测试，与Python版本对比 |
| 维护成本高 | 中 | 中 | 编写详细文档，自动化测试 |

---

## 后续扩展

### 功能扩展

1. **期望值平均种子查询** - 支持查询期望值平均种子数据
2. **种子筛选和对比** - 支持筛选和对比多个种子
3. **导出查询结果** - 支持导出查询结果为JSON或CSV格式

### 性能优化

1. **WebAssembly模块懒加载** - 延迟加载WebAssembly模块
2. **查询结果缓存** - 缓存查询结果，提高响应速度
3. **大数据量优化** - 优化大数据量的处理和显示

### 用户体验

1. **查询历史记录** - 保存查询历史，方便快速查询
2. **收藏常用种子** - 支持收藏常用种子
3. **可视化图表** - 提供可视化图表展示

---

## 总结

本实施计划详细描述了将种子查看器整合到量化计算器项目中的具体步骤。通过分阶段实施，我们可以：

1. 保持算法的正确性和性能
2. 实现纯前端部署，无需服务器支持
3. 与现有项目技术栈保持一致
4. 提供良好的用户体验

预计总开发时间为8-13天，可以根据实际情况进行调整。
