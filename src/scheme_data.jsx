import {build_item_data} from './game_data.jsx';

/** 各数据源的 allowed_recipes（物品名→recipe_data 索引数组），按数据源名取用 */
const allowed_modules = import.meta.glob('../data/allowed_recipes_*.json', {
    import: 'default',
    eager: true,
});
const allowed_by_source = Object.fromEntries(
    Object.entries(allowed_modules)
        .map(([module, data]) => [module.replace(/^.*allowed_recipes_([^.]+)\.json$/, '$1'), data])
);

/** 获取指定数据源(game_name)的 allowed_recipes 映射 */
export function getAllowedRecipes(game_name) {
    return allowed_by_source[game_name] || {};
}

const DEFAULT_SCHEME_DATA = {
    "item_recipe_choices": {"氢": 1},
    "scheme_for_recipe": [{"建筑": 0, "增产剂等级": 0, "增产模式": 0}],
    "selected_fuel": "无",
};

export function init_scheme_data(game_data) {
    let scheme_data = structuredClone(DEFAULT_SCHEME_DATA);
    let item_data = build_item_data(game_data.recipe_data);
    const allowed_recipes = getAllowedRecipes(game_data.game_name);
    scheme_data.item_recipe_choices = {};
    scheme_data.scheme_for_recipe = [];
    scheme_data.selected_fuel = "无";
    for (let item in item_data) {
        // 默认选择 allowed_recipes 中排第一的配方（顺序即偏好顺序，如硅石默认直接获取而非石矿配方）
        const allowed = allowed_recipes[item];
        let default_pos = 1;
        if (allowed && allowed.length > 0) {
            const pos = item_data[item].indexOf(allowed[0]);
            if (pos >= 1) default_pos = pos; // 位置 0 是物品 ID 占位，配方从 1 开始
        }
        scheme_data.item_recipe_choices[item] = default_pos;
    }
    for (var i = 0; i < game_data.recipe_data.length; i++) {
        scheme_data.scheme_for_recipe.push({"建筑": 0, "增产剂等级": 0, "增产模式": 0});
    }
    return scheme_data;
}
