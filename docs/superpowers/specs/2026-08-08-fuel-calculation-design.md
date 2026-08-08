# 燃料计算功能设计文档

## 概述

为戴森球计划量化计算器添加燃料计算功能。用户可以选择不同燃料，系统自动计算燃料生产需求和发电设备数量，并在输出表中显示。

## 设计目标

1. **燃料配方自动生成**：在游戏数据初始化时，自动添加燃料配方到配方表
2. **燃料选择UI**：在设置页面提供燃料选择界面，用物品图标点击切换
3. **输出表显示**：在输出表中添加"电力"行，显示燃料生产需求和发电设备数量
4. **电力参与计算**：电力作为普通物品参与BFS建边和SCC分析，燃料原料被正确追溯

## 实现状态

✅ 已完成所有功能

## 数据结构

### 1. 燃料数据定义

```javascript
// 燃料数据
const FUEL_DATA = [
  { name: "无", heatValue: 0, device: "", restrict: "" },  // 默认选项，不进行燃料计算
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

// 设备消耗速度（MW）
// 注意：能量枢纽的消耗速度需要根据游戏数据确认
const DEVICE_POWER_CONSUMPTION = {
  "火力发电厂": 2.16,
  "微型聚变发电站": 15,
  "人造恒星": 72,
  "能量枢纽": 540  // 蓄电池热值540MJ，设备消耗速度待确认
};
```

### 2. 燃料配方生成

在 `get_game_data()` 函数中，自动添加燃料配方：

```javascript
// 添加燃料配方
FUEL_DATA.forEach(fuel => {
  if (fuel.name === "无") return;  // 跳过"无"选项
  
  const devicePower = DEVICE_POWER_CONSUMPTION[fuel.device];
  const recipe = {
    Type: 3,  // 特殊类型，标识为燃料配方
    原料: { [fuel.name]: 1 },
    产物: { "电力": fuel.heatValue / devicePower },  // 每单位燃料产出的电力
    设施: getFactoryIndex(fuel.device),
    时间: 1,  // 1秒
    增产: fuel.restrict === "只能增产" ? 2 : 1,  // 2=只能增产，1=只能加速
    isFuelRecipe: true  // 标识为燃料配方
  };
  data.recipe_data.push(recipe);
});
```

### 3. 燃料选择状态

在 `scheme_data.jsx` 中添加燃料选择状态：

```javascript
const DEFAULT_SCHEME_DATA = {
  // ... 现有字段
  "selected_fuel": "无",  // 默认选择"无"
};
```

## UI设计

### 1. 燃料选择UI

在 `settings.jsx` 的 `BatchSetting` 组件中，"清空数据缓存"按钮左边添加燃料选择：

```jsx
// 在 BatchSetting 组件中添加
<div className="d-flex align-items-center gap-2">
  <small className="fw-bold">燃料选择</small>
  <div className="d-flex gap-1">
    {FUEL_DATA.map(fuel => (
      <div
        key={fuel.name}
        className={`cursor-pointer border rounded p-1 ${
          selectedFuel === fuel.name ? 'border-primary bg-primary bg-opacity-10' : ''
        }`}
        onClick={() => setSelectedFuel(fuel.name)}
        title={fuel.name === "无" ? "不进行燃料计算" : `${fuel.name} (${fuel.heatValue}MJ)`}
      >
        <ItemIcon item={fuel.name === "无" ? null : fuel.name} size={24} />
        {fuel.name === "无" && <span className="small">无</span>}
      </div>
    ))}
  </div>
</div>
```

### 2. 输出表电力行

在 `result.jsx` 中添加电力行显示：

```jsx
// 在 result_table_rows 开头添加电力行
if (selectedFuel !== "无" && (energyCost > 0 || minerEnergyCost > 0)) {
  const totalEnergy = energyCost + minerEnergyCost;
  const fuelRecipe = getFuelRecipe(selectedFuel);  // 获取当前燃料配方
  const deviceCount = totalEnergy / DEVICE_POWER_CONSUMPTION[fuelRecipe.device];
  
  result_table_rows.unshift(
    <tr key="__power__" className="table-info">
      {/* 操作 */}
      <td></td>
      {/* 目标物品 */}
      <td>
        <div className="d-flex align-items-center text-nowrap">
          <ItemIcon item="电力" size={mob_icon} />
          <small className="ms-1 item-name-text">电力</small>
        </div>
      </td>
      {/* 产能 */}
      <td className="text-center">
        <RatioAdjustInput value={totalEnergy} />
      </td>
      {/* 工厂 */}
      <td className="text-nowrap">
        <div className="d-inline-flex align-items-center gap-1">
          <ItemIcon item={fuelRecipe.device} size={is_mobile ? 18 : 30} />
          <RatioAdjustInput value={deviceCount} />
        </div>
      </td>
      {/* 配方 */}
      <td>
        <Recipe recipe={fuelRecipe} compact={compact_mode} />
      </td>
      {/* 增产模式 */}
      <td>
        <ProModeSelect recipe_id={fuelRecipe.id} onChange={changeFuelProMode}
                       choice={schemeData.fuel_pro_mode} />
      </td>
      {/* 增产剂 */}
      <td>
        <ProNumSelect recipe_id={fuelRecipe.id} onChange={changeFuelProNum}
                      choice={schemeData.fuel_pro_num} icon_size={mob_btn_icon} />
      </td>
      {/* 工厂类型 */}
      <td>
        <FactorySelect recipe_id={fuelRecipe.id} onChange={changeFuelFactory}
                       choice={schemeData.fuel_factory} icon_size={mob_btn_icon} />
      </td>
    </tr>
  );
}
```

## 计算逻辑

燃料配方初始化后，完全复用现有计算逻辑，不需要单独写计算函数。

### 增产剂影响

使用现有的增产剂效果数据：

```javascript
// 增产剂效果（从 game_data.jsx 中获取）
const PROLIFERATOR_EFFECTS = [
  { 增产效果: 1.0, 加速效果: 1.0, 耗电倍率: 1.0 },  // 0级
  { 增产效果: 1.125, 加速效果: 1.25, 耗电倍率: 1.3 },  // 1级
  { 增产效果: 1.2, 加速效果: 1.5, 耗电倍率: 1.7 },  // 2级
  { 增产效果: 1.25, 加速效果: 2.0, 耗电倍率: 2.5 }   // 3级
];
```

- **加速模式**：设备消耗速度变快，设备数量减少
- **增产模式**：单位燃料产出更多电力，燃料需求量减少

## 文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `src/game_data.jsx` | 添加燃料数据常量、燃料配方生成逻辑、辅助函数 |
| `src/scheme_data.jsx` | 添加燃料选择状态字段、修改 `init_scheme_data` 函数 |
| `src/settings.jsx` | 添加燃料选择UI组件、在 BatchSetting 中集成 |
| `src/result.jsx` | 添加电力行显示逻辑、处理燃料配方的特殊显示 |
| `src/contexts.jsx` | 可能需要添加燃料相关上下文（如果需要跨组件共享状态） |

## 实现顺序

1. **第1步：数据层** (`game_data.jsx`)
   - 添加燃料数据常量
   - 添加燃料配方生成逻辑
   - 添加辅助函数

2. **第2步：状态层** (`scheme_data.jsx`)
   - 添加燃料选择状态字段
   - 修改 `init_scheme_data` 函数

3. **第3步：UI层** (`settings.jsx`)
   - 添加燃料选择组件
   - 在 BatchSetting 中集成

4. **第4步：显示层** (`result.jsx`)
   - 添加电力行显示逻辑
   - 处理燃料配方的特殊显示

5. **第5步：上下文层**（可选）(`contexts.jsx`)
   - 如果需要跨组件共享状态，添加燃料上下文

## 注意事项

1. **默认选择"无"**：燃料选择默认为"无"，不进行燃料计算
2. **配方统一处理**：燃料配方初始化后，和普通配方一样处理
3. **增产限制**：使用现有的二进制编码格式（2=只能增产，1=只能加速）
4. **图标显示**：电力行使用 `icon/Vanilla/电力.png` 图标（手动添加到item_icon_name映射）
5. **配方展示**：显示燃料图标、数量1、热值(MJ)、消耗时间(s)

## 电力计算集成

### 核心改动

1. **dag.js** - 电力成本处理：
   - 保持 `$__factory_power__` 和 `$__miner_power__` 区分生产/挖矿电力
   - 同时添加对"电力"物品的依赖，让电力参与BFS建边

2. **dag.js** - 电力配方选择：
   - 当BFS遇到"电力"物品时，使用用户选择的燃料配方
   - 从 `schemeData.selected_fuel` 获取选中的燃料
   - 自动追溯燃料原料（如煤矿、氢等）

### 计算流程

1. 生产/挖矿设备计算电力消耗
2. 电力消耗作为"电力"物品的依赖
3. "电力"物品使用燃料配方（如火力发电厂+煤矿→电力）
4. 燃料原料被BFS追溯，纳入正常SCC分析
