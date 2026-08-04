// 导出物品依赖图和物品列表（JSON格式）
const fs = require('fs');

// 读取数据
let content = fs.readFileSync('data/Vanilla.json', 'utf8');
if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
const data = JSON.parse(content);

// 构建物品ID到名称的映射
const itemMap = {};
data.items.forEach(item => {
    itemMap[item.ID] = item.Name;
});

// 构建物品到配方的映射
const itemRecipeMap = {};
data.recipes.forEach((recipe, index) => {
    const outputs = recipe.Results.map(id => itemMap[id]).filter(Boolean);
    outputs.forEach(output => {
        if (!itemRecipeMap[output]) {
            itemRecipeMap[output] = [];
        }
        itemRecipeMap[output].push(index);
    });
});

// 构建物品依赖图（使用默认配方）
const itemGraph = {};

data.items.forEach(item => {
    itemGraph[item.Name] = {
        "原料": {},
        "可生产": {},
        "产出倍率": 0,
        "副产物": {},
        "自消耗": 0,
        "配方": null,
        "配方索引": null,
        "多配方": false
    };
});

Object.entries(itemRecipeMap).forEach(([itemName, recipeIndices]) => {
    const recipeIndex = recipeIndices[0];
    const recipe = data.recipes[recipeIndex];

    const outputs = recipe.Results.map(id => itemMap[id]).filter(Boolean);
    const inputs = recipe.Items.map(id => itemMap[id]).filter(Boolean);
    const outputCounts = recipe.ResultCounts;
    const inputCounts = recipe.ItemCounts;
    const time = recipe.TimeSpend / 60.0;

    const outputIdx = outputs.indexOf(itemName);
    if (outputIdx === -1) return;

    const outputCount = outputCounts[outputIdx];

    inputs.forEach((input, inputIdx) => {
        const materialNum = inputCounts[inputIdx] / outputCount;
        itemGraph[itemName]["原料"][input] = materialNum;
    });

    itemGraph[itemName]["产出倍率"] = outputCount / time;
    itemGraph[itemName]["配方"] = recipe.Name;
    itemGraph[itemName]["配方索引"] = recipeIndex;
    itemGraph[itemName]["多配方"] = recipeIndices.length > 1;

    outputs.forEach((otherOutput, otherIdx) => {
        if (otherOutput !== itemName) {
            itemGraph[itemName]["副产物"][otherOutput] = outputCounts[otherIdx] / outputCount;
        }
    });

    inputs.forEach((input, inputIdx) => {
        if (itemGraph[input]) {
            itemGraph[input]["可生产"][itemName] = 1 / (inputCounts[inputIdx] / outputCount);
        }
    });
});

// 拓扑排序
const productGraph = JSON.parse(JSON.stringify(itemGraph));
const itemList = [];
const keyItemList = [];
let head = 0;
let tail = Object.keys(productGraph).length - 1;

function deleteItemFromGraph(name) {
    for (let item in productGraph[name]["原料"]) {
        delete productGraph[item]["可生产"][name];
    }
    for (let item in productGraph[name]["可生产"]) {
        delete productGraph[item]["原料"][name];
    }
    delete productGraph[name];
}

function findItem(name, isProduction) {
    if (!isProduction) {
        if (productGraph[name] && Object.keys(productGraph[name]["原料"]).length === 0) {
            const production = productGraph[name]["可生产"];
            deleteItemFromGraph(name);
            itemList[head] = name;
            head++;
            for (let item in production) {
                findItem(item, false);
            }
        }
    } else {
        if (productGraph[name] && Object.keys(productGraph[name]["可生产"]).length === 0) {
            const material = productGraph[name]["原料"];
            deleteItemFromGraph(name);
            itemList[tail] = name;
            tail--;
            for (let item in material) {
                findItem(item, true);
            }
        }
    }
}

while (true) {
    for (let item in productGraph) {
        if (item in productGraph) {
            if (Object.keys(productGraph[item]["原料"]).length === 0) {
                findItem(item, false);
            } else if (Object.keys(productGraph[item]["可生产"]).length === 0) {
                findItem(item, true);
            }
        }
    }
    if (Object.keys(productGraph).length <= 0) break;

    let keyItem = {name: -1, count: 1};
    let count;
    for (let item in productGraph) {
        count = Object.keys(productGraph[item]["原料"]).length + Object.keys(productGraph[item]["可生产"]).length;
        if (count > keyItem.count) {
            keyItem.name = item;
            keyItem.count = count;
        }
    }
    keyItemList.push(keyItem.name);
    itemList[head] = keyItem.name;
    head++;
    deleteItemFromGraph(keyItem.name);
}

// 过滤掉undefined
const filteredItemList = itemList.filter(item => item !== undefined);

// 输出结果
const output = {
    "物品依赖图": itemGraph,
    "物品列表": filteredItemList,
    "关键物品列表": keyItemList,
    "统计": {
        "总物品数": Object.keys(itemGraph).length,
        "有配方物品数": Object.values(itemGraph).filter(n => n["配方"]).length,
        "原始矿物数": Object.entries(itemGraph).filter(([_, n]) => Object.keys(n["原料"]).length === 0 && n["配方"]).length,
        "多配方物品数": Object.values(itemGraph).filter(n => n["多配方"]).length,
        "关键物品数": keyItemList.length
    }
};

fs.writeFileSync('graph_data.json', JSON.stringify(output, null, 2), 'utf8');
console.log("数据已导出到 graph_data.json");
console.log("\n统计信息:");
console.log(JSON.stringify(output["统计"], null, 2));
console.log("\n物品列表（前20个）:");
console.log(filteredItemList.slice(0, 20));
console.log("\n关键物品列表:");
console.log(keyItemList);
