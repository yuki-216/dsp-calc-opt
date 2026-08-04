// 分析物品依赖图（使用默认配方：每个物品的第一个配方）
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

// 构建物品到配方的映射（每个物品的所有可用配方）
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

// 构建物品依赖图（使用默认配方：第一个配方）
const itemGraph = {};

// 初始化所有物品
data.items.forEach(item => {
    itemGraph[item.Name] = {
        "原料": {},
        "可生产": {},
        "产出倍率": 0,
        "副产物": {},
        "配方": null,
        "配方索引": null,
        "多配方": false
    };
});

// 遍历所有物品，使用默认配方构建依赖关系
Object.entries(itemRecipeMap).forEach(([itemName, recipeIndices]) => {
    // 使用第一个配方（默认）
    const recipeIndex = recipeIndices[0];
    const recipe = data.recipes[recipeIndex];

    const outputs = recipe.Results.map(id => itemMap[id]).filter(Boolean);
    const inputs = recipe.Items.map(id => itemMap[id]).filter(Boolean);
    const outputCounts = recipe.ResultCounts;
    const inputCounts = recipe.ItemCounts;
    const time = recipe.TimeSpend / 60.0; // 转换为秒

    // 找到当前物品在输出中的索引
    const outputIdx = outputs.indexOf(itemName);
    if (outputIdx === -1) return;

    const outputCount = outputCounts[outputIdx];

    // 计算原料需求（相对1个产出）
    inputs.forEach((input, inputIdx) => {
        const materialNum = inputCounts[inputIdx] / outputCount;
        itemGraph[itemName]["原料"][input] = materialNum;
    });

    // 计算产出倍率（每秒产出数量）
    itemGraph[itemName]["产出倍率"] = outputCount / time;

    // 记录配方
    itemGraph[itemName]["配方"] = recipe.Name;
    itemGraph[itemName]["配方索引"] = recipeIndex;
    itemGraph[itemName]["多配方"] = recipeIndices.length > 1;

    // 处理副产物
    outputs.forEach((otherOutput, otherIdx) => {
        if (otherOutput !== itemName) {
            itemGraph[itemName]["副产物"][otherOutput] = outputCounts[otherIdx] / outputCount;
        }
    });

    // 构建可生产关系
    inputs.forEach((input, inputIdx) => {
        if (itemGraph[input]) {
            itemGraph[input]["可生产"][itemName] = 1 / (inputCounts[inputIdx] / outputCount);
        }
    });
});

// 输出依赖图
console.log("=== 物品依赖图（使用默认配方）===\n");

// 按物品名称排序
const sortedItems = Object.keys(itemGraph).sort();

sortedItems.forEach(item => {
    const node = itemGraph[item];
    const materialCount = Object.keys(node["原料"]).length;
    const productCount = Object.keys(node["可生产"]).length;

    // 只显示有配方的物品
    if (node["配方"]) {
        console.log(`【${item}】`);
        console.log(`  配方: ${node["配方"]}${node["多配方"] ? " (有多个配方)" : ""}`);
        console.log(`  产出率: ${node["产出倍率"].toFixed(4)}/秒`);

        if (materialCount > 0) {
            console.log(`  原料:`);
            Object.entries(node["原料"]).forEach(([material, amount]) => {
                console.log(`    - ${material}: ${amount.toFixed(4)}`);
            });
        }

        if (Object.keys(node["副产物"]).length > 0) {
            console.log(`  副产物:`);
            Object.entries(node["副产物"]).forEach(([byproduct, amount]) => {
                console.log(`    - ${byproduct}: ${amount.toFixed(4)}`);
            });
        }

        if (productCount > 0) {
            console.log(`  可生产:`);
            Object.entries(node["可生产"]).forEach(([product, rate]) => {
                console.log(`    - ${product}: ${rate.toFixed(4)}`);
            });
        }

        console.log("");
    }
});

// 输出统计信息
console.log("=== 统计信息 ===");
console.log(`总物品数: ${Object.keys(itemGraph).length}`);
console.log(`有配方的物品: ${Object.values(itemGraph).filter(n => n["配方"]).length}`);
console.log(`原始矿物: ${Object.entries(itemGraph).filter(([_, n]) => Object.keys(n["原料"]).length === 0 && n["配方"]).length}`);
console.log(`多来源物品: ${Object.entries(itemGraph).filter(([_, n]) => Object.keys(n["可生产"]).length > 1).length}`);
console.log(`多配方物品: ${Object.values(itemGraph).filter(n => n["多配方"]).length}`);

// 输出循环依赖检测
console.log("\n=== 循环依赖检测 ===");
const visited = new Set();
const recursionStack = new Set();
const cycles = [];

function dfs(node, path) {
    visited.add(node);
    recursionStack.add(node);

    if (itemGraph[node]) {
        for (const material in itemGraph[node]["原料"]) {
            if (!visited.has(material)) {
                dfs(material, [...path, material]);
            } else if (recursionStack.has(material)) {
                const cycleStart = path.indexOf(material);
                if (cycleStart !== -1) {
                    cycles.push(path.slice(cycleStart));
                }
            }
        }
    }

    recursionStack.delete(node);
}

for (const item in itemGraph) {
    if (!visited.has(item)) {
        dfs(item, [item]);
    }
}

if (cycles.length === 0) {
    console.log("未发现循环依赖");
} else {
    console.log("发现循环依赖:");
    cycles.forEach((cycle, idx) => {
        console.log(`  ${idx + 1}. ${cycle.join(' -> ')}`);
    });
}

// 输出多配方物品列表
console.log("\n=== 多配方物品 ===");
const multiRecipeItems = Object.entries(itemGraph).filter(([_, n]) => n["多配方"]);
if (multiRecipeItems.length === 0) {
    console.log("无多配方物品");
} else {
    multiRecipeItems.forEach(([item, node]) => {
        const recipeCount = itemRecipeMap[item].length;
        console.log(`  ${item}: ${recipeCount}个配方（使用: ${node["配方"]}）`);
    });
}
