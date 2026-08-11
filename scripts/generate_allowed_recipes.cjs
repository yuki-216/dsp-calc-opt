/**
 * 生成 allowed_recipes.json
 * 存储每个物品可选择的配方在 recipe_data 中的索引
 * 前端 RecipeSelect 根据此文件过滤可选配方
 *
 * 运行: node scripts/generate_allowed_recipes.js
 */
const fs = require('fs');
const path = require('path');

let raw = fs.readFileSync(path.join(__dirname, '../data/Vanilla.json'), 'utf8');
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

const outPath = path.join(__dirname, '../data/allowed_recipes.json');
fs.writeFileSync(outPath, JSON.stringify(allowed, null, 2), 'utf8');
console.log(`已生成 ${outPath}`);
console.log(`共 ${Object.keys(allowed).length} 个物品`);
