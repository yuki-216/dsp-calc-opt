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
 * 数组去重
 * @param {Array} arr - 输入数组
 * @returns {Array} 去重后的数组
 */
function uniq(arr) {
    return Array.from(new Set(arr));
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
        let all_unused_targets = new Set(self.all_target_items);
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
