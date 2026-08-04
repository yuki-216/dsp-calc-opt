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

export const vanilla_game_version = "0.10.31.24710";
export const default_game_data = get_game_data();

export function get_game_data() {
    let data = {};
    let json_data = data_indices["Vanilla"];
    //将json转换为需要的数据结构
    data.game_name = "Vanilla";
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
        data.recipe_data.push({
            "Type": recipe.Type,
            "原料": material,
            "产物": product,
            "设施": factory,
            "时间": time,
            "增产": proliferator,
        });
    })
    //data.factory_data
    for (let i = 0; i < FactoriesArr.length; i++) {
        let factories = [];
        for (let j = 0; j < FactoriesArr[i].length; j++) {
            let factory = {};
            let item = get_item_by_id(FactoriesArr[i][j]);
            factory["名称"] = item["Name"];
            factory["耗能"] = item["WorkEnergyPerTick"] * 0.00006;
            factory["倍率"] = item["Speed"];
            factory["占地"] = item["Space"];
            factories.push(factory);
        }
        data.factory_data.push(factories);
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
    // 从JSON数据中读取增产剂名称（避免硬编码空格字符差异）
    const pro_items = json_data.items.filter(i => i.ID >= 1141 && i.ID <= 1143);
    const pro_mk1 = pro_items.find(i => i.ID === 1141);
    const pro_mk2 = pro_items.find(i => i.ID === 1142);
    const pro_mk3 = pro_items.find(i => i.ID === 1143);
    //data.proliferator_data - 使用等级索引（0/1/2/3）
    data.proliferator_data = [
        {
            "名称": "不使用增产剂",
            "增产剂": 0,
            "喷涂次数": 1,
            "等级": 0,
            "增产效果": proliferator_effect[0].增产效果,
            "加速效果": proliferator_effect[0].加速效果,
            "耗电倍率": proliferator_effect[0].耗电倍率,
        },
        {
            "名称": pro_mk1.Name,
            "增产剂": pro_mk1.Name,
            "喷涂次数": 12,
            "等级": 1,
            "增产效果": proliferator_effect[1].增产效果,
            "加速效果": proliferator_effect[1].加速效果,
            "耗电倍率": proliferator_effect[1].耗电倍率,
        },
        {
            "名称": pro_mk2.Name,
            "增产剂": pro_mk2.Name,
            "喷涂次数": 24,
            "等级": 2,
            "增产效果": proliferator_effect[2].增产效果,
            "加速效果": proliferator_effect[2].加速效果,
            "耗电倍率": proliferator_effect[2].耗电倍率,
        },
        {
            "名称": pro_mk3.Name,
            "增产剂": pro_mk3.Name,
            "喷涂次数": 60,
            "等级": 3,
            "增产效果": proliferator_effect[3].增产效果,
            "加速效果": proliferator_effect[3].加速效果,
            "耗电倍率": proliferator_effect[3].耗电倍率,
        }
    ]

    return data;
}

export function get_icon_by_item(item) {
    return default_game_data.item_icon_name[item];
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
        let item_data = {};
        let recipe_data = this.game_data.recipe_data;
        var i = 0;
        for (var num = 0; num < recipe_data.length; num++) {
            for (var item in recipe_data[num].产物) {
                if (!(item in item_data)) {
                    item_data[item] = [i];
                    i++;
                }
                item_data[item].push(num);
            }
        }
        this.item_data = item_data;
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

/**
 * 根据建筑类型应用相应的倍率
 * @param {number} output_num - 当前产量
 * @param {string} building_name - 建筑名称
 * @param {string} item - 目标物品
 * @param {object} settings - 设置对象
 * @returns {number} 应用倍率后的产量
 */
export function ApplyBuildingMultiplier(output_num, building_name, item, settings) {
    if (building_name === "采矿机") {
        output_num *= settings.mining_speed_multiple * settings.covered_veins_small;
    } else if (building_name === "大型采矿机") {
        output_num *= settings.mining_speed_multiple * settings.covered_veins_large * settings.mining_efficiency_large;
    } else if (building_name === "原油萃取站") {
        output_num *= settings.mining_speed_multiple * settings.mining_speed_oil;
    } else if (building_name === "抽水站") {
        output_num *= settings.mining_speed_multiple;
    } else if (building_name === "轨道采集器") {
        output_num *= settings.mining_speed_multiple;
        if (item === "氢") {
            output_num *= settings.mining_speed_hydrogen;
        } else if (item === "重氢") {
            output_num *= settings.mining_speed_deuterium;
        } else if (item === "可燃冰") {
            output_num *= settings.mining_speed_gas_hydrate;
        }
    } else if (building_name.endsWith("分馏塔")) {
        output_num *= settings.fractionating_speed;
    }
    return output_num;
}
