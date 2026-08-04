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
