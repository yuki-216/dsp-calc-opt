/*
    GameData数据内容说明:
        recipe_data：配方表
            记录配方数据的数组，数组中每一个元素即是一个配方的数据，以字典形式存储，其中各个键值对意义为：
                原料：完成一趟此配方需要的物品类型及相应数目
                产物：完成一趟此配方将产出的物品类型及相应数目
                设施：可以用于完成此配方的工厂类型
                时间：完成一趟此配方所需要的时间。其中，较为特殊的是：
                    采矿设备的时间规定为1s，即小矿机在矿物利用等级为0级时开采2簇矿物时的单位矿物产出时间
                    采集器的时间定规为1s，是矿物利用等级为0级时采集器在面板为0.125/s的巨星上采集的算入供电消耗前的单位矿物产出时间
                    抽水设备的时间规定为1.2s，是矿物利用等级为0级时单个抽水机的单位产出时间
                    抽油设备的时间规定为1s,是矿物利用等级为0级时单个萃取站在面板为1/s的油井上的单位产出时间
                    分馏塔的时间规定为100s，是让氢以1/s速度过带时的期望单位产出时间
                    蓄电器（满）的时间定为300s，是直接接入电网时充满电的时间（直接接入电网，设备倍率为1，使用能量枢纽，则设备倍率为50）
                增产：此配方的可增产情况，可以看做是2位2进制数所表示的一个值，第一位代表是否能加速，第二位代表是否能增产，比如0代表此配方既不能增产也不能加速，
                    2代表可以加速但不能增产，3代表既可以加速也可以增产等...其中，存在一个特例，当使用射线接受站接受光子时用上引力透镜，则引力透镜加速时可以让
                    产出翻倍，但不增加引力透镜消耗速度，**用4表示这种只能加速但不加倍原料消耗的配方

        proliferator_data：增产剂效果字典
            记录增产剂效能的数组，数组中第i个元素即为第i级增产剂的数据，以字典形式存储，其中各个键值对的意义为：
                名称：增产剂在游戏中的名字，其中，0级增产剂名为"不使用增产剂
                增产效果：使用此增产剂在额外产出模式时的产出倍率，如3级增产剂的增产效果为1.25
                加速效果：使用此增产剂在生产加速模式时的产出倍率，如3级增产剂的加速效果为2
                耗电倍率：使用此增产剂时工厂的耗电倍率，如3级增产剂的耗电倍率为2.5
                喷涂次数：增产剂在未被喷涂的情况下的面板喷涂次数，如3级增产剂的喷涂次数为60

        factory_data:建筑参数表
            记录各种工厂数值的字典，字典的键名为设施种类，如"制造台"、"冶炼设备"等，建值为属于这一设备种类的设备参数，以字典形式储存，字典中的键名为建筑名字，
            建值则是代表这一建筑参数的字典，字典中各个键值对的意义为：
                耗能：工厂的额定工作功率，单位为MW，如制造台 Mk.III的耗能为1.08
                倍率：工厂的额定工作速度，即实际生产速度与配方面板速度的比值，如制造台 Mk.III的倍率为1.5
                占地：目前定义为工厂建筑的占地面积，因为工厂的实际占地面积计算较为复杂。当前的想法是这个表的数据仅用作记录工厂建筑本身的占地面积，占地的单位
                    面积定义为游戏中一纬线间隔的平方（即游戏内的约1.256637m），之后通过其他数据结构来给涉及物品数目不同的相同建筑通过算法将进出货物时的分拣
                    器与传送带的占地也考虑上，届时会有不同的铺设模式对应不同的分拣器传送带占地。建筑占地本身也会因是否使用建筑偏移而有所改动。
*/

/**
 * 燃料数据定义（不含增产剂，增产剂从游戏数据动态获取）
 * 每个燃料包含：name(名称), heatValue(热值MJ), device(设备类型), restrict(增产限制)
 */
export const FUEL_DATA_BASE = [
  { name: "无", heatValue: 0, device: "", restrict: "" },
  { name: "煤矿", heatValue: 2.16, device: "火力发电厂", restrict: "只能增产" },
  { name: "高能石墨", heatValue: 5.4, device: "火力发电厂", restrict: "只能增产" },
  { name: "原油", heatValue: 3.24, device: "火力发电厂", restrict: "只能增产" },
  { name: "氢", heatValue: 7.2, device: "火力发电厂", restrict: "只能增产" },
  { name: "液氢燃料棒", heatValue: 43.2, device: "火力发电厂", restrict: "只能增产" },
  { name: "氘核燃料棒", heatValue: 600, device: "微型聚变发电站", restrict: "只能增产" },
  { name: "反物质燃料棒", heatValue: 7200, device: "人造恒星", restrict: "只能加速" },
  { name: "奇异湮灭燃料棒", heatValue: 720000, device: "人造恒星", restrict: "只能加速" },
  { name: "可燃冰", heatValue: 3.84, device: "火力发电厂", restrict: "只能增产" }
];

/**
 * 获取完整的燃料数据（直接返回常量）
 */
export const getFuelData = () => FUEL_DATA_BASE;

/**
 * 设备消耗速度（MW）
 */
export const DEVICE_POWER_CONSUMPTION = {
  "火力发电厂": 2.16,
  "微型聚变发电站": 15,
  "人造恒星": 72
};

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

/**
 * 数组去重
 * @param {Array} arr - 输入数组
 * @returns {Array} 去重后的数组
 */
function uniq(arr) {
    return Array.from(new Set(arr));
}

const data_index_modules = import.meta.glob('../data/*.json', {
    import: 'default',
    eager: true,
});
const data_indices = Object.fromEntries(
    Object.entries(data_index_modules)
        .map(([module, data]) =>
            [module.replace(/^\.\.\/data\/(.+)\.json/, "$1"), data]
        ))

/** 数据源注册表：name=数据文件basename，display=UI显示名，version=游戏/mod版本 */
export const GAME_DATA_SOURCES = {
    Vanilla:     {name: "Vanilla",     data_file: "Vanilla",     version: "0.10.31.24710", display: "原版"},
    GenesisBook: {name: "GenesisBook", data_file: "GenesisBook", version: "3.0.14",          display: "创世之书"},
};

export const vanilla_game_version = GAME_DATA_SOURCES.Vanilla.version;
export const default_game_data = get_game_data();

export function get_game_data(dataSourceName = "Vanilla") {
    const src = GAME_DATA_SOURCES[dataSourceName] ?? GAME_DATA_SOURCES.Vanilla;
    let data = {};
    let json_data = structuredClone(data_indices[src.data_file]);
    // 创世之书特有:增产剂 Mk.III 改名为"增产剂"(对齐 dsp-calc:mod 中只有一种增产剂)
    if (src.name === "GenesisBook") {
        for (const item of json_data.items) {
            if (item.Name === "增产剂 Mk.III") {
                item.Name = "增产剂";
            }
        }
    }
    //将json转换为需要的数据结构
    data.game_name = src.name;
    data.game_version = src.version;
    data.item_grid = {};
    data.item_icon_name = {};
    data.recipe_data = [];
    data.factory_data = [];
    data.proliferator_data = [];
    data.proliferator_effect = [];
    //data.item_grid
    json_data.items.forEach(function (item) {
        data.item_grid[item.Name] = item["GridIndex"];
        data.item_icon_name[item.Name] = item["IconName"];
    })
    // 手动添加"电力"图标映射和网格位置（电力不在items数据中，但精灵图中有）
    data.item_icon_name["电力"] = "电力";
    data.item_grid["电力"] = 2601; // 放在空闲位置
    // 挖矿简化:统一"挖矿机"复用采矿机图标(采矿机/大型采矿机合并显示)
    data.item_icon_name["挖矿机"] = data.item_icon_name["采矿机"];

    //data.recipe_data & data.factory_data
    function get_item_by_id(itemID) {
        let ret = null;
        json_data.items.forEach(function (item) {
            if (ret !== null) {
                return;
            }
            if (item["ID"] === itemID) {
                ret = item;
            }
        })
        return ret;
    }

    let FactoriesArr = [];//存储所有可能的工厂类型
    json_data.recipes.forEach(function (recipe) {
        let material = {};
        for (let i = 0; i < recipe["Items"].length; i++) {
            let itemID = recipe.Items[i];
            let item = get_item_by_id(itemID);
            material[item.Name] = recipe.ItemCounts[i];
        }
        let product = {};
        for (let i = 0; i < recipe["Results"].length; i++) {
            let itemID = recipe.Results[i];
            let item = get_item_by_id(itemID);
            product[item.Name] = recipe.ResultCounts[i];
        }
        let factory = -1;
        for (let i = 0; i < FactoriesArr.length; i++) {
            if (FactoriesArr[i].toString() === recipe.Factories.toString()) {
                factory = i;
                break;
            }
        }
        if (factory === -1) {
            factory = FactoriesArr.length;
            FactoriesArr.push(recipe.Factories);
        }
        let time = recipe.TimeSpend / 60.0;
        let proliferator = recipe.Proliferator;
        const isPlanetaryBase = recipe.Factories && recipe.Factories.includes(1);
        const hasNonBaseFactory = recipe.Factories && recipe.Factories.some(f => f !== 1);
        data.recipe_data.push({
            "Type": recipe.Type,
            "原料": material,
            "产物": product,
            "设施": factory,
            "时间": time,
            "增产": proliferator,
            "行星基地": isPlanetaryBase,
            "可采集": hasNonBaseFactory,
        });
    })
    //data.factory_data
    for (let i = 0; i < FactoriesArr.length; i++) {
        let factories = [];
        for (let j = 0; j < FactoriesArr[i].length; j++) {
            let factory = {};
            let item = get_item_by_id(FactoriesArr[i][j]);
            factory["名称"] = item["Name"];
            // 轨道采集器为轨道设施，不接入电网，耗电恒为 0
            factory["耗能"] = item["Name"] === "轨道采集器" ? 0 : item["WorkEnergyPerTick"] * 0.00006;
            factory["倍率"] = item["Speed"];
            factory["占地"] = item["Space"];
            factories.push(factory);
        }
        data.factory_data.push(factories);
    }
    // 手动添加发电设备到 factory_data（这些设备不在配方的 Factories 数组中，但燃料配方需要引用它们）
    // 发电建筑自身不耗电（耗能=0），额定发电功率单独存于"发电功率"，仅供引擎计算发电设备数量
    // （总电力 ÷ 发电功率）。原数据 WorkEnergyPerTick 缺失，故直接使用 DEVICE_POWER_CONSUMPTION。
    const powerBuildingNames = ["火力发电厂", "微型聚变发电站", "人造恒星"];
    for (const name of powerBuildingNames) {
        const exists = data.factory_data.some(group => group.some(f => f["名称"] === name));
        if (!exists) {
            const item = json_data.items.find(i => i.Name === name);
            data.factory_data.push([{
                "名称": name,
                "耗能": 0,
                "倍率": item?.Speed || 1,
                "占地": item?.Space || 0,
                "发电功率": DEVICE_POWER_CONSUMPTION[name] || 0
            }]);
        }
    }
    //proliferator_effect - 简化为4个等级（0=不使用，1=Mk.I，2=Mk.II，3=Mk.III）
    data.proliferator_effect = [
        {
            "增产效果": 1.0,
            "加速效果": 1.0,
            "耗电倍率": 1.0
        },
        {
            "增产效果": 1.125,
            "加速效果": 1.25,
            "耗电倍率": 1.3
        },
        {
            "增产效果": 1.2,
            "加速效果": 1.5,
            "耗电倍率": 1.7
        },
        {
            "增产效果": 1.25,
            "加速效果": 2.0,
            "耗电倍率": 2.5
        }
    ]
    let proliferator_effect = data.proliferator_effect;
    //data.proliferator_data - 使用等级索引（0/1/2/3）
    data.proliferator_data = [
        {
            "增产剂": null,
            "喷涂次数": 1,
            "等级": 0,
            "增产效果": proliferator_effect[0].增产效果,
            "加速效果": proliferator_effect[0].加速效果,
            "耗电倍率": proliferator_effect[0].耗电倍率,
        },
        {
            "增产剂": "增产剂 Mk.I",
            "喷涂次数": 12,
            "等级": 1,
            "增产效果": proliferator_effect[1].增产效果,
            "加速效果": proliferator_effect[1].加速效果,
            "耗电倍率": proliferator_effect[1].耗电倍率,
        },
        {
            "增产剂": "增产剂 Mk.II",
            "喷涂次数": 24,
            "等级": 2,
            "增产效果": proliferator_effect[2].增产效果,
            "加速效果": proliferator_effect[2].加速效果,
            "耗电倍率": proliferator_effect[2].耗电倍率,
        },
        {
            "增产剂": "增产剂 Mk.III",
            "喷涂次数": 60,
            "等级": 3,
            "增产效果": proliferator_effect[3].增产效果,
            "加速效果": proliferator_effect[3].加速效果,
            "耗电倍率": proliferator_effect[3].耗电倍率,
        }
    ]
    // 创世之书特有:mod 中只有一种增产剂——Mk.III 改名"增产剂";Mk.I/Mk.II 物品不存在,
    // "增产剂"字段置 null,使 result/settings 的等级选项按 `增产剂 != null` 自动隐藏
    if (src.name === "GenesisBook") {
        data.proliferator_data[1].增产剂 = null;
        data.proliferator_data[2].增产剂 = null;
        data.proliferator_data[3].增产剂 = "增产剂";
    }

    // 添加燃料配方（使用 getFuelData 获取包含增产剂的完整列表）
    const allFuels = getFuelData(data);
    allFuels.forEach(fuel => {
        if (fuel.name === "无") return;

        const devicePower = DEVICE_POWER_CONSUMPTION[fuel.device];
        if (!devicePower) return;

        const factoryIndex = getFactoryIndex(data, fuel.device);
        if (factoryIndex === -1) return;

        const recipe = {
            Type: 3,
            原料: { [fuel.name]: 1 },
            产物: { "电力": fuel.heatValue / 60 },
            设施: factoryIndex,
            时间: 1,
            增产: getFuelProliferatorCode(fuel.restrict),
            isFuelRecipe: true,
            fuelName: fuel.name
        };
        data.recipe_data.push(recipe);
    });

    return data;
}

/**
 * 获取指定燃料的配方
 * @param {string} fuelName - 燃料名称
 * @returns {Object|null} 燃料配方对象，未找到返回 null
 */
export function getFuelRecipe(fuelName, game_data = default_game_data) {
    if (!fuelName || fuelName === "无") return null;
    return game_data.recipe_data.find(r => r.isFuelRecipe && r.fuelName === fuelName) || null;
}

/**
 * GameInfo - 游戏数据预处理类
 *
 * 功能：
 * 1. 加载游戏数据（配方、物品、设施）
 * 2. 构建物品->配方映射（item_data）
 * 3. 构建图标网格布局（icon_grid）
 *
 * 数据结构：
 * - game_data: 原始游戏数据
 * - item_data: 物品名->[物品ID, 配方索引1, 配方索引2, ...]
 * - all_target_items: 所有可生产的物品名列表
 * - icon_grid: 图标网格布局信息
 */

/**
 * 构建物品名到 [物品ID, 配方索引1, ...] 的映射
 * @param {Array} recipe_data - 配方数据数组
 * @returns {Object} item_data 映射
 */
export function build_item_data(recipe_data) {
    const item_data = {};
    let i = 0;
    for (let num = 0; num < recipe_data.length; num++) {
        for (const item in recipe_data[num].产物) {
            if (!(item in item_data)) {
                item_data[item] = [i];
                i++;
            }
            item_data[item].push(num);
        }
    }
    return item_data;
}

/**
 * 构建物品名到配方索引列表的映射
 * 格式: { "铁板": [null, 0, 1], "铁矿": [null] }
 * 第一个元素为空（占位），后续为配方索引，与 item_recipe_choices 的 1-based 索引兼容
 * 供 dag.js 和 proliferator-optimizer.js 使用
 * @param {Array} recipe_data - 配方数据数组
 * @returns {Object} 物品->配方索引列表映射
 */
export function buildItemRecipeIndex(recipe_data) {
    const itemData = {};
    for (let i = 0; i < recipe_data.length; i++) {
        const recipe = recipe_data[i];
        for (const item of Object.keys(recipe.产物 || {})) {
            if (!(item in itemData)) {
                itemData[item] = [null]; // 占位元素，保持 1-based 索引
            }
            itemData[item].push(i);
        }
    }
    return itemData;
}

export class GameInfo {
    game_data;        // 原始游戏数据
    item_data;        // 物品名->[物品ID, 配方索引1, ...]
    all_target_items; // 所有可生产的物品名列表
    icon_grid;        // 图标网格布局

    /**
     * 构造函数
     * @param {Object} game_data - 游戏数据对象
     */
    constructor(game_data) {
        this.game_data = game_data;
        this.init_item_data();
        this.all_target_items = uniq(this.game_data.recipe_data.flatMap(recipe => Object.keys(recipe["产物"])));
        this.init_icon_layout();
    }

    /**
     * 初始化图标网格布局
     * 功能：根据物品的GridIndex构建CSS网格布局，用于物品选择器显示
     */
    init_icon_layout() {
        let loc_item = {};
        for (let [item, loc] of Object.entries(this.game_data.item_grid)) {
            // 移除特殊物品（沙土、伊卡洛斯、行星基地、巨构星际组装厂）
            if (item === "沙土" || item === "伊卡洛斯" || item === "行星基地" || item === "巨构星际组装厂") {
                continue;
            }
            let x = loc % 100;        // 列位置
            let y = (loc - x) / 100;  // 行位置
            loc_item[[x, y]] = {item: item, x: x, y: y};
        }

        // 计算网格边界
        let xs = Object.values(loc_item).map(({x}) => x);
        let ys = Object.values(loc_item).map(({y}) => y);
        let minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
        let minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);

        // 构建图标列表
        let icons = [];
        let all_unused_targets = new Set(this.all_target_items);
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                let item = loc_item[[x, y]]?.item;
                if (item) {
                    // CSS grid starts from index 1
                    icons.push({col: x - minX + 1, row: y - minY + 1, item: item});
                    all_unused_targets.delete(item);
                }
            }
        }

        if (all_unused_targets.size > 0) {
            console.warn("如下产物未能在物品选择器中显示", all_unused_targets);
        }

        this.icon_grid = {nrow: maxY - minY + 1, ncol: maxX - minX + 1, icons: icons};
    }

    /**
     * 初始化物品数据
     * 功能：构建物品名->[物品ID, 配方索引1, 配方索引2, ...]的映射
     *
     * 数据结构示例：
     * item_data = {
     *     "铁板": [0, 0, 1],      // 物品ID=0，配方索引0和1都生产铁板
     *     "铁矿": [1],            // 物品ID=1，没有配方生产铁矿（原始矿物）
     *     ...
     * }
     */
    init_item_data() {
        this.item_data = build_item_data(this.game_data.recipe_data);
    }
}

/**
 * GlobalState - 核心计算引擎
 *
 * 功能：
 * 预计算增产剂喷涂成本（sprayCosts），供引擎使用
 *
 * 注：物品依赖图和计算已移至新引擎 CoreEngine 处理
 */
export class GlobalState {
    game_data;        // 游戏数据
    item_data;        // 物品->配方映射
    scheme_data;      // 配方方案（用户选择）
    settings;         // 设置参数

    sprayCosts;       // 增产剂喷涂成本 [null, cost1, cost2, cost3]

    /**
     * 构造函数
     * @param {GameInfo} game_info - 游戏信息对象
     * @param {Object} scheme_data - 配方方案数据
     * @param {Object} settings - 设置参数
     */
    constructor(game_info, scheme_data, settings) {
        this.game_data = game_info.game_data;
        this.item_data = game_info.item_data;
        this.scheme_data = structuredClone(scheme_data);
        this.settings = settings;

        // 预计算增产剂喷涂成本（计算过程中不变，避免重复计算）
        const proliferate_itself = settings.proliferate_itself;
        this.sprayCosts = [
            null,  // 等级0：不使用
            1/12,  // Mk.I 固定
            proliferate_itself ? 1/27 : 1/24,  // Mk.II
            proliferate_itself ? 1/74 : 1/60,  // Mk.III
        ];
    }
}

// ---- 轨道采集器自耗(官方机制) ----
// 净采 = 毛采 × (1 − 工作能量/采集能量)。工作能量 30MW = WorkEnergyPerTick 500000 × 0.00006(Vanilla.json:6327);
// 采集能量 = Σ 接口速率 × 倍率(8) × 采集速度 × 官方原始能量(氢/重氢 9MJ、可燃冰 4.8MJ)。
const ORBITAL_SPEED = 8;                       // Speed, Vanilla.json:6328
const ORBITAL_WORK_ENERGY = 30;                // MW
const GAS_ENERGY = {氢: 9, 重氢: 9, 可燃冰: 4.8}; // MJ/单位(官方原始能量,非燃烧热值)

// ---- 挖矿简化:单位采集耗电基准(kW/个,默认参数算出) ----
// 采矿机 0.42MW/180 = 2.333; 大型采矿机 2.94×3²=26.46MW/2880 = 9.19; 原油萃取站 0.84MW/150 = 5.6
export const MINING_PER_UNIT_SMALL = 2.333;
export const MINING_PER_UNIT_LARGE = 9.19;
export const OIL_PER_UNIT = 5.6;

/** 挖矿单位采集耗电(MW/(矿/min)) = 滑块线性插值 ÷ 采集速度(科技) */
export function getMiningPerUnit(settings) {
    const pct = (settings.mining_power_slider ?? 0) / 100;
    const perUnit = MINING_PER_UNIT_SMALL + pct * (MINING_PER_UNIT_LARGE - MINING_PER_UNIT_SMALL);
    const speed = settings.gas_collect_speed || 1;
    return perUnit / 1000 / speed;
}

/** 原油萃取站单位采集耗电(MW/(原油/min)) = 5.6 ÷ 采集速度(科技) */
export function getOilPerUnit(settings) {
    const speed = settings.gas_collect_speed || 1;
    return OIL_PER_UNIT / 1000 / speed;
}

/**
 * 轨道采集器自耗效率:eff = max(0, 1 − 30 / 采集能量)。
 * 采集能量 = 8 × gas_collect_speed × Σ(接口速率 × 能量)。
 */
/**
 * 按显式速率计算单个轨道采集器/单球产量(面板"计算"用,与核心接口口径一致)。
 * @param {Object} typeRates 该行星产出的 {物品: 速率/s}
 * @param {number} speed 采集速度倍率(100%=1)
 * @returns {{eff:number, perSecond:Object, perMinute:Object, perPlanet:Object}}
 */
export function computeOrbitalCollectorOutput(typeRates, speed) {
    const sp = speed || 1;
    const perSecond = {};
    let collected = 0;
    for (const [item, rate] of Object.entries(typeRates || {})) {
        const gross = (rate || 0) * ORBITAL_SPEED * sp;
        if (gross <= 0) continue;
        perSecond[item] = gross;
        collected += gross * (GAS_ENERGY[item] || 0);
    }
    const eff = collected > 0 ? Math.max(0, 1 - ORBITAL_WORK_ENERGY / collected) : 0;
    const perMinute = {};
    const perPlanet = {};
    for (const [item, gross] of Object.entries(perSecond)) {
        const net = gross * eff;
        perMinute[item] = net * 60;
        perPlanet[item] = net * 60 * 40; // 单球 = 单采集器 × 40
    }
    return {eff, perSecond, perMinute, perPlanet};
}

/**
 * 根据建筑类型应用相应的倍率
 * @param {number} output_num - 当前产量
 * @param {string} building_name - 建筑名称
 * @param {string} item - 目标物品
 * @param {object} settings - 设置对象
 * @returns {number} 应用倍率后的产量
 */
export function ApplyBuildingMultiplier(output_num, building_name, item, settings) {
    // 挖矿简化:采矿机/大型采矿机统一为"挖矿机"(设备数不展示),吞吐只影响隐藏台数;
    // 原油萃取站油井固定 2.5/s;抽水站基础产量固定 50/min
    if (building_name === "采矿机" || building_name === "大型采矿机" || building_name === "挖矿机") {
        output_num *= settings.gas_collect_speed || 1;
    } else if (building_name === "原油萃取站") {
        output_num *= 2.5 * (settings.gas_collect_speed || 1);
    } else if (building_name === "抽水站") {
        output_num *= 4 * (settings.gas_collect_speed || 1);
    } else if (building_name === "轨道采集器") {
        // mining_speed_* 即"单采集器实际产量"(净产出 /min,由面板计算)。
        // 采集器配方 时间=1s、Speed=8 → 基础 480 次/min,吞吐倍率 = 实际产量/480
        if (item === "氢") {
            output_num *= (settings.mining_speed_hydrogen || 0) / 480;
        } else if (item === "重氢") {
            output_num *= (settings.mining_speed_deuterium || 0) / 480;
        } else if (item === "可燃冰") {
            output_num *= (settings.mining_speed_gas_hydrate || 0) / 480;
        }
    } else if (building_name.endsWith("分馏塔")) {
        output_num *= settings.fractionating_speed;
    }
    return output_num;
}
