# 燃料计算功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为戴森球计划量化计算器添加燃料计算功能，用户可选择燃料，系统自动计算燃料生产需求和发电设备数量

**Architecture:** 在 game_data.jsx 中添加燃料数据和配方生成逻辑，在 scheme_data.jsx 中添加燃料选择状态，在 settings.jsx 中添加燃料选择UI，在 result.jsx 中添加电力行显示。燃料配方初始化后复用现有计算逻辑。

**Tech Stack:** React, JSX, 现有项目架构

## Global Constraints

- 默认选择"无"，不进行燃料计算
- 燃料配方使用现有二进制编码格式（2=只能增产，1=只能加速）
- 电力行使用 `icon/Vanilla/电力.png` 图标
- 配方列不显示下拉选择，在设置页面用图标切换

---

### Task 1: 数据层 - 添加燃料数据和配方生成

**Files:**
- Modify: `src/game_data.jsx`

**Interfaces:**
- Produces: `FUEL_DATA`, `DEVICE_POWER_CONSUMPTION`, `getFuelRecipe()`, `isFuelRecipe()`, `getFuelRecipes()`

- [ ] **Step 1: 添加燃料数据常量**

在 `src/game_data.jsx` 文件顶部（`uniq` 函数之前）添加燃料数据常量：

```javascript
/**
 * 燃料数据定义
 * 每个燃料包含：name(名称), heatValue(热值MJ), device(设备类型), restrict(增产限制)
 */
export const FUEL_DATA = [
  { name: "无", heatValue: 0, device: "", restrict: "" },
  { name: "煤矿", heatValue: 2.16, device: "火力发电厂", restrict: "只能增产" },
  { name: "高能石墨", heatValue: 5.4, device: "火力发电厂", restrict: "只能增产" },
  { name: "原油", heatValue: 3.24, device: "火力发电厂", restrict: "只能增产" },
  { name: "精炼油", heatValue: 3.6, device: "火力发电厂", restrict: "只能增产" },
  { name: "氢", heatValue: 7.2, device: "火力发电厂", restrict: "只能增产" },
  { name: "液氢燃料棒", heatValue: 43.2, device: "火力发电厂", restrict: "只能增产" },
  { name: "氘核燃料棒", heatValue: 600, device: "微型聚变发电站", restrict: "只能增产" },
  { name: "反物质燃料", heatValue: 7200, device: "人造恒星", restrict: "只能加速" },
  { name: "奇异湮灭燃料棒", heatValue: 720000, device: "人造恒星", restrict: "只能加速" },
  { name: "可燃冰", heatValue: 3.84, device: "火力发电厂", restrict: "只能增产" },
  { name: "蓄电池", heatValue: 540, device: "能量枢纽", restrict: "只能加速" },
  { name: "增产剂Mk.I", heatValue: 2.592, device: "火力发电厂", restrict: "只能增产" },
  { name: "增产剂Mk.2", heatValue: 7.08, device: "火力发电厂", restrict: "只能增产" },
  { name: "增产剂Mk.III", heatValue: 16.96, device: "火力发电厂", restrict: "只能增产" }
];

/**
 * 设备消耗速度（MW）
 */
export const DEVICE_POWER_CONSUMPTION = {
  "火力发电厂": 2.16,
  "微型聚变发电站": 15,
  "人造恒星": 72,
  "能量枢纽": 540
};
```

- [ ] **Step 2: 添加燃料配方生成辅助函数**

在 `FUEL_DATA` 常量之后添加辅助函数：

```javascript
/**
 * 获取燃料配方的增产限制（二进制编码）
 * @param {string} restrict - 限制描述
 * @returns {number} 增产编码：2=只能增产，1=只能加速
 */
function getFuelProliferatorCode(restrict) {
  return restrict === "只能增产" ? 2 : 1;
}

/**
 * 获取设施在 factory_data 中的索引
 * @param {Object} data - game_data 对象
 * @param {string} deviceName - 设备名称
 * @returns {number} 设施索引
 */
function getFactoryIndex(data, deviceName) {
  for (let i = 0; i < data.factory_data.length; i++) {
    if (data.factory_data[i].some(f => f["名称"] === deviceName)) {
      return i;
    }
  }
  return -1;
}
```

- [ ] **Step 3: 在 get_game_data() 中添加燃料配方生成**

在 `get_game_data()` 函数的 `return data;` 之前添加燃料配方生成逻辑：

```javascript
  // 添加燃料配方
  FUEL_DATA.forEach(fuel => {
    if (fuel.name === "无") return;
    
    const devicePower = DEVICE_POWER_CONSUMPTION[fuel.device];
    if (!devicePower) return;
    
    const factoryIndex = getFactoryIndex(data, fuel.device);
    if (factoryIndex === -1) return;
    
    const recipe = {
      Type: 3,
      原料: { [fuel.name]: 1 },
      产物: { "电力": fuel.heatValue / devicePower },
      设施: factoryIndex,
      时间: 1,
      增产: getFuelProliferatorCode(fuel.restrict),
      isFuelRecipe: true,
      fuelName: fuel.name
    };
    data.recipe_data.push(recipe);
  });
```

- [ ] **Step 4: 添加燃料配方查询辅助函数**

在 `get_game_data()` 函数之后添加：

```javascript
/**
 * 获取指定燃料的配方
 * @param {string} fuelName - 燃料名称
 * @returns {Object|null} 燃料配方对象，未找到返回 null
 */
export function getFuelRecipe(fuelName) {
  if (!fuelName || fuelName === "无") return null;
  return default_game_data.recipe_data.find(r => r.isFuelRecipe && r.fuelName === fuelName) || null;
}

/**
 * 判断配方是否为燃料配方
 * @param {number} recipeIndex - 配方索引
 * @returns {boolean}
 */
export function isFuelRecipe(recipeIndex) {
  return default_game_data.recipe_data[recipeIndex]?.isFuelRecipe === true;
}

/**
 * 获取所有燃料配方
 * @returns {Array} 燃料配方数组
 */
export function getFuelRecipes() {
  return default_game_data.recipe_data.filter(r => r.isFuelRecipe);
}
```

- [ ] **Step 5: 验证燃料配方生成**

在浏览器中打开应用，检查控制台输出，确认燃料配方已正确生成。

- [ ] **Step 6: 提交代码**

```bash
git add src/game_data.jsx
git commit -m "feat: 添加燃料数据定义和配方生成逻辑"
```

---

### Task 2: 状态层 - 添加燃料选择状态

**Files:**
- Modify: `src/scheme_data.jsx`

**Interfaces:**
- Consumes: `FUEL_DATA` from Task 1
- Produces: `selected_fuel` field in scheme_data

- [ ] **Step 1: 添加燃料选择状态字段**

在 `src/scheme_data.jsx` 的 `DEFAULT_SCHEME_DATA` 中添加 `selected_fuel` 字段：

```javascript
const DEFAULT_SCHEME_DATA = {
  "item_recipe_choices": {"氢": 1},
  "scheme_for_recipe": [{"建筑": 0, "增产剂等级": 0, "增产模式": 0}],
  "selected_fuel": "无",
  // ... 其他字段保持不变
};
```

- [ ] **Step 2: 修改 init_scheme_data 函数**

在 `init_scheme_data()` 函数中初始化 `selected_fuel` 字段：

```javascript
export function init_scheme_data(game_data) {
  let scheme_data = structuredClone(DEFAULT_SCHEME_DATA);
  let item_data = get_item_data(game_data);
  scheme_data.item_recipe_choices = {};
  scheme_data.scheme_for_recipe = [];
  scheme_data.selected_fuel = "无";  // 默认不选择燃料
  // ... 其余代码保持不变
}
```

- [ ] **Step 3: 验证状态初始化**

刷新页面，检查 localStorage 中的 scheme_data 是否包含 `selected_fuel` 字段。

- [ ] **Step 4: 提交代码**

```bash
git add src/scheme_data.jsx
git commit -m "feat: 添加燃料选择状态字段"
```

---

### Task 3: 上下文层 - 添加燃料相关上下文

**Files:**
- Modify: `src/contexts.jsx`

**Interfaces:**
- Consumes: `FUEL_DATA`, `getFuelRecipe()` from Task 1
- Produces: `FuelContext`, `FuelSetterContext`

- [ ] **Step 1: 添加燃料上下文**

在 `src/contexts.jsx` 中添加燃料相关的上下文：

```javascript
export const FuelContext = createContext(null);
export const FuelSetterContext = createContext(null);
```

- [ ] **Step 2: 在 ContextProvider 中添加燃料状态管理**

在 `ContextProvider` 组件中添加燃料状态：

```javascript
export function ContextProvider({children}) {
  // ... 现有状态定义
  
  // 燃料选择状态（从 scheme_data 中读取）
  const selected_fuel = scheme_data.selected_fuel || "无";
  
  // 燃料选择 setter
  const set_selected_fuel = useCallback((fuelName) => {
    set_scheme_data(old => ({
      ...old,
      selected_fuel: fuelName
    }));
  }, [set_scheme_data]);
  
  // ... 其余代码保持不变
}
```

- [ ] **Step 3: 在 Provider 中添加燃料上下文**

在 `ContextProvider` 的 return 语句中添加燃料上下文 Provider：

```javascript
return <CompactModeContext.Provider value={compact_mode}>
  <GameInfoContext.Provider value={game_info}>
    <GlobalStateContext.Provider value={global_state}>
      <EngineCalculateContext.Provider value={engineCalculate}>
        <ValidationContext.Provider value={validationContext}>
          <EngineGraphDataContext.Provider value={engineGraphData}>
            <GameInfoSetterContext.Provider value={set_game_data}>
              <SchemeDataSetterContext.Provider value={set_scheme_data}>
                <SettingsSetterContext.Provider value={set_settings}>
                  <SettingsContext.Provider value={settings}>
                    <FuelContext.Provider value={selected_fuel}>
                      <FuelSetterContext.Provider value={set_selected_fuel}>
                        {children}
                      </FuelSetterContext.Provider>
                    </FuelContext.Provider>
                  </SettingsContext.Provider>
                </SettingsSetterContext.Provider>
              </SchemeDataSetterContext.Provider>
            </GameInfoSetterContext.Provider>
          </EngineGraphDataContext.Provider>
        </ValidationContext.Provider>
      </EngineCalculateContext.Provider>
    </GlobalStateContext.Provider>
  </GameInfoContext.Provider>
</CompactModeContext.Provider>;
```

- [ ] **Step 4: 验证上下文**

刷新页面，检查控制台是否有错误，确认上下文正常工作。

- [ ] **Step 5: 提交代码**

```bash
git add src/contexts.jsx
git commit -m "feat: 添加燃料选择上下文"
```

---

### Task 4: UI层 - 添加燃料选择UI

**Files:**
- Modify: `src/settings.jsx`

**Interfaces:**
- Consumes: `FUEL_DATA` from Task 1, `FuelContext`, `FuelSetterContext` from Task 3
- Produces: 燃料选择 UI 组件

- [ ] **Step 1: 添加燃料选择组件**

在 `src/settings.jsx` 中添加 `FuelSelect` 组件：

```javascript
import {FuelContext, FuelSetterContext} from './contexts.jsx';
import {FUEL_DATA} from './game_data.jsx';

function FuelSelect() {
  const selectedFuel = useContext(FuelContext);
  const setSelectedFuel = useContext(FuelSetterContext);
  const compact_mode = useContext(CompactModeContext);
  const is_mobile = compact_mode === "mobile";
  const mob_icon = is_mobile ? 22 : undefined;

  return (
    <div className="d-flex align-items-center gap-2 flex-wrap">
      <small className="fw-bold">燃料选择</small>
      <div className="d-flex gap-1 flex-wrap">
        {FUEL_DATA.map(fuel => (
          <div
            key={fuel.name}
            className={`cursor-pointer border rounded p-1 d-flex align-items-center justify-content-center ${
              selectedFuel === fuel.name 
                ? 'border-primary bg-primary bg-opacity-10' 
                : 'border-secondary'
            }`}
            onClick={() => setSelectedFuel(fuel.name)}
            style={{minWidth: '32px', minHeight: '32px'}}
            title={fuel.name === "无" ? "不进行燃料计算" : `${fuel.name} (${fuel.heatValue}MJ) - ${fuel.device}`}
          >
            {fuel.name === "无" ? (
              <span className="small text-muted">无</span>
            ) : (
              <ItemIcon item={fuel.name} size={mob_icon || 24} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 在 BatchSetting 中集成燃料选择**

在 `src/settings.jsx` 的 `BatchSetting` 组件中，在"清空数据缓存"按钮左边添加 `FuelSelect`：

```javascript
export function BatchSetting({needs_list}) {
  // ... 现有代码
  
  return <>
    <div className="mt-3 d-inline-flex flex-wrap column-gap-3 row-gap-2 align-items-center batch-setting-container">
      {/* 燃料选择 */}
      <FuelSelect />
      
      {/* 分隔线 */}
      <div className="vr d-none d-md-block" style={{height: '24px'}}></div>
      
      <small className="fw-bold">批量预设</small>
      {/* ... 其余代码保持不变 */}
    </div>
    {/* ... 其余代码保持不变 */}
  </>;
}
```

- [ ] **Step 3: 验证燃料选择UI**

刷新页面，检查：
1. 燃料选择UI是否正确显示在批量预设左边
2. 点击燃料图标是否能正确切换选中状态
3. 选中状态是否正确高亮显示
4. "无"选项是否默认选中

- [ ] **Step 4: 提交代码**

```bash
git add src/settings.jsx
git commit -m "feat: 添加燃料选择UI组件"
```

---

### Task 5: 显示层 - 添加电力行显示

**Files:**
- Modify: `src/result.jsx`

**Interfaces:**
- Consumes: `FuelContext` from Task 3, `getFuelRecipe()`, `DEVICE_POWER_CONSUMPTION` from Task 1
- Produces: 电力行显示在输出表中

- [ ] **Step 1: 添加必要的导入**

在 `src/result.jsx` 顶部添加导入：

```javascript
import {FuelContext} from './contexts.jsx';
import {getFuelRecipe, DEVICE_POWER_CONSUMPTION} from './game_data.jsx';
```

- [ ] **Step 2: 在 Result 组件中获取燃料选择状态**

在 `Result` 组件中添加燃料选择状态：

```javascript
export function Result({needs_list, set_needs_list, show_ore_popup, set_show_ore_popup, show_building_popup, set_show_building_popup}) {
  // ... 现有代码
  
  const selectedFuel = useContext(FuelContext);
  
  // ... 其余代码
}
```

- [ ] **Step 3: 添加电力行显示逻辑**

在 `result_table_rows` 定义之后，`for` 循环之前添加电力行：

```javascript
  // 添加电力行（如果选择了燃料且有电力消耗）
  if (selectedFuel && selectedFuel !== "无" && (energy_cost > 0 || miner_energy_cost > 0)) {
    const totalEnergy = energy_cost + miner_energy_cost;
    const fuelRecipe = getFuelRecipe(selectedFuel);
    
    if (fuelRecipe) {
      const deviceName = FUEL_DATA.find(f => f.name === selectedFuel)?.device;
      const devicePower = DEVICE_POWER_CONSUMPTION[deviceName];
      const deviceCount = devicePower ? totalEnergy / devicePower : 0;
      
      // 获取燃料配方的增产设置
      const fuelRecipeIndex = game_data.recipe_data.findIndex(r => r.isFuelRecipe && r.fuelName === selectedFuel);
      const fuelScheme = fuelRecipeIndex >= 0 ? scheme_data.scheme_for_recipe[fuelRecipeIndex] : null;
      
      const changeFuelProMode = (value) => {
        if (fuelRecipeIndex < 0) return;
        set_scheme_data(old => {
          let newScheme = structuredClone(old);
          newScheme.scheme_for_recipe[fuelRecipeIndex]["增产模式"] = value;
          return newScheme;
        });
      };
      
      const changeFuelProNum = (value) => {
        if (fuelRecipeIndex < 0) return;
        set_scheme_data(old => {
          let newScheme = structuredClone(old);
          newScheme.scheme_for_recipe[fuelRecipeIndex]["增产剂等级"] = value;
          return newScheme;
        });
      };
      
      const changeFuelFactory = (value) => {
        if (fuelRecipeIndex < 0) return;
        set_scheme_data(old => {
          let newScheme = structuredClone(old);
          newScheme.scheme_for_recipe[fuelRecipeIndex]["建筑"] = value;
          return newScheme;
        });
      };
      
      result_table_rows.unshift(
        <tr key="__power__" className="table-info">
          {/* 操作 */}
          <td></td>
          {/* 目标物品 */}
          <td>
            <div className="d-flex align-items-center text-nowrap">
              <ItemIcon item="电力" tooltip={is_compact} size={mob_icon} />
              <small className="ms-1 item-name-text">电力</small>
            </div>
          </td>
          {/* 产能 */}
          <td className="text-center">
            <RatioAdjustInput value={totalEnergy} />
          </td>
          {/* 工厂 */}
          <td className="text-nowrap">
            {fuelScheme && (
              <div className="d-inline-flex align-items-center gap-1">
                <ItemIcon item={deviceName} size={is_mobile ? 18 : 30} />
                <RatioAdjustInput value={deviceCount} />
              </div>
            )}
          </td>
          {/* 配方 */}
          <td>
            <Recipe recipe={fuelRecipe} compact={compact_mode} />
          </td>
          {/* 增产模式 */}
          <td>
            {fuelRecipeIndex >= 0 && (
              <ProModeSelect recipe_id={fuelRecipeIndex} onChange={changeFuelProMode}
                             choice={fuelScheme?.增产模式 || 0} />
            )}
          </td>
          {/* 增产剂 */}
          <td>
            {fuelRecipeIndex >= 0 && (
              <ProNumSelect recipe_id={fuelRecipeIndex} onChange={changeFuelProNum}
                            choice={fuelScheme?.增产剂等级 || 0} icon_size={mob_btn_icon} />
            )}
          </td>
          {/* 工厂类型 */}
          <td>
            {fuelRecipeIndex >= 0 && (
              <FactorySelect recipe_id={fuelRecipeIndex} onChange={changeFuelFactory}
                             choice={fuelScheme?.建筑 || 0} icon_size={mob_btn_icon} />
            )}
          </td>
        </tr>
      );
    }
  }
```

- [ ] **Step 4: 添加 FUEL_DATA 导入**

确保 `FUEL_DATA` 已导入：

```javascript
import {getFuelRecipe, DEVICE_POWER_CONSUMPTION, FUEL_DATA} from './game_data.jsx';
```

- [ ] **Step 5: 验证电力行显示**

刷新页面，测试：
1. 选择"无"时，不显示电力行
2. 选择燃料后，添加需求物品，检查电力行是否正确显示
3. 电力行的图标、文本、产能、工厂、配方、增产设置是否正确
4. 修改增产设置是否能正确保存

- [ ] **Step 6: 提交代码**

```bash
git add src/result.jsx
git commit -m "feat: 添加电力行显示逻辑"
```

---

### Task 6: 集成测试和优化

**Files:**
- Test: 所有修改的文件

- [ ] **Step 1: 完整功能测试**

测试以下场景：
1. 默认状态：选择"无"，不显示电力行
2. 选择燃料：点击燃料图标，检查选中状态
3. 添加需求：添加物品需求，检查电力行是否显示
4. 电力计算：验证电力数值是否正确
5. 设备数量：验证设备数量计算是否正确
6. 增产设置：修改增产模式和增产剂等级，检查是否生效
7. 燃料切换：切换不同燃料，检查电力行是否更新
8. 数据持久化：刷新页面，检查燃料选择是否保存

- [ ] **Step 2: 边界情况测试**

测试边界情况：
1. 电力为0时：不显示电力行
2. 燃料配方增产限制：只能增产的燃料不能选择加速模式
3. 设备类型不存在：燃料设备在 factory_data 中不存在时的处理

- [ ] **Step 3: 代码优化**

检查并优化：
1. 移除未使用的导入
2. 确保代码风格一致
3. 添加必要的注释

- [ ] **Step 4: 最终提交**

```bash
git add -A
git commit -m "feat: 燃料计算功能完成"
```

---

## 验收标准

1. 燃料选择UI正确显示在批量预设左边
2. 点击燃料图标能正确切换选中状态
3. 选择燃料后，输出表中正确显示电力行
4. 电力行显示：电力图标、文本"电力"、总电力、发电设备数量、燃料配方
5. 增产设置能正确保存和应用
6. 数据持久化正常，刷新页面后状态保持
7. 无控制台错误
