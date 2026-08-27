/**
 * 生成 allowed_recipes_<数据源>.json
 * 存储每个物品可选择的配方在 recipe_data 中的索引
 * 前端 RecipeSelect 根据此文件过滤可选配方
 *
 * 运行: node scripts/generate_allowed_recipes.js [数据文件=Vanilla.json] [输出文件=allowed_recipes.json]
 *   例: node scripts/generate_allowed_recipes.cjs GenesisBook.json allowed_recipes_GenesisBook.json
 *
 * ⚠ 注意: data/allowed_recipes_Vanilla.json 含手工调整(如硅石默认"直接获取"优先、精炼油排除部分配方),
 *   切勿用本脚本重新生成原版版本覆盖它;如需重新生成请先备份手工调整。
 */
const fs = require('fs');
const path = require('path');

const dataFileName = process.argv[2] || 'Vanilla.json';
const outFileName = process.argv[3] || 'allowed_recipes.json';
let raw = fs.readFileSync(path.join(__dirname, '../data', dataFileName), 'utf8');
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
const data = JSON.parse(raw);

const allowed = {};

data.recipes.forEach((recipe, recipeIndex) => {
    recipe.Results.forEach(resultID => {
        const item = data.items.find(i => i.ID === resultID);
        if (!item) return;
        if (!(item.Name in allowed)) {
            allowed[item.Name] = [];
        }
        allowed[item.Name].push(recipeIndex);
    });
});

// 无中生有配方(空输入→直接获取)优先:init_scheme_data 默认选 allowed 首个配方,
// 若默认选中"需原料的合成配方"且其原料链形成闭环/断点(如创世之书氧↔水互需),LP 会无可行解。
// 对齐原版手工调整思路(硅石默认"直接获取"而非石矿配方):有"直接获取"优先直接获取。
for (const itemName of Object.keys(allowed)) {
    allowed[itemName].sort((a, b) => {
        const aFree = data.recipes[a].Items.length === 0 ? 0 : 1;
        const bFree = data.recipes[b].Items.length === 0 ? 0 : 1;
        return (aFree - bFree) || (a - b); // a-b 保持原始(recipes 序)相对顺序
    });
}

const outPath = path.join(__dirname, '../data', outFileName);
fs.writeFileSync(outPath, JSON.stringify(allowed, null, 2), 'utf8');
console.log(`已生成 ${outPath}`);
console.log(`共 ${Object.keys(allowed).length} 个物品`);
