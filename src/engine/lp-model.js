/**
 * LP 构模层
 * 职责:二部图 → 结构化 LP 模型(变量=配方执行次数;约束=物品守恒 ≥;目标=min Σx + Σslack)
 */

const SLACK_PREFIX = 'slack_';
// 不变量:配方键恒为数字串,故 'slack_' 前缀与配方键不可能碰撞;slack 变量仅服务无配方物品。

/**
 * 生成 noRecipeItems 物品的松弛变量名
 * @param {string} itemId - 物品名
 * @returns {string} 松弛变量名
 */
export function slackVar(itemId) {
    return SLACK_PREFIX + itemId;
}

/**
 * 判断变量名是否为松弛变量,是则返回物品名
 * @param {string} varName - 变量名
 * @returns {string|null} 物品名;非松弛变量返回 null
 */
export function parseSlackItem(varName) {
    return varName.startsWith(SLACK_PREFIX) ? varName.slice(SLACK_PREFIX.length) : null;
}

export function buildLPModel(graph) {
    const variables = [];
    const objectiveCoeffs = {};
    const varToRecipe = new Map();

    for (const recipeKey of graph.recipes.keys()) {
        variables.push({name: recipeKey});
        objectiveCoeffs[recipeKey] = 1;
        varToRecipe.set(recipeKey, recipeKey);
    }

    // 每物品一条守恒行
    const conRows = new Map(); // itemId -> {coeffs: Map<varName, coeff>}
    const ensureRow = (itemId) => {
        if (!conRows.has(itemId)) conRows.set(itemId, {coeffs: new Map()});
        return conRows.get(itemId);
    };

    for (const [recipeKey, r] of graph.recipes) {
        for (const [item, qty] of Object.entries(r.outputs)) {
            if (!qty) continue;
            const row = ensureRow(item);
            row.coeffs.set(recipeKey, (row.coeffs.get(recipeKey) || 0) + qty);
        }
        for (const [item, qty] of Object.entries(r.inputs)) {
            if (!qty) continue;
            const row = ensureRow(item);
            row.coeffs.set(recipeKey, (row.coeffs.get(recipeKey) || 0) - qty);
        }
    }

    // 真·无配方物品(未选燃料的电力、mineralize_list 原矿等):守恒行只有负系数会 Infeasible,
    // 加松弛列 slack_item ≥ 0 进该物品行正侧(+1),目标系数 1——
    // min 目标下 slack 只在必要时取正值,即"外部获取缺口"。
    // 注意:有采集配方的原矿(铁矿/原油/氢轨道采集器等)不在 noRecipeItems 中,
    // 走正常配方路径,绝不加 slack(否则设备表丢失采矿机)。
    for (const item of graph.noRecipeItems) {
        variables.push({name: slackVar(item)});
        objectiveCoeffs[slackVar(item)] = 1;
        const row = ensureRow(item);
        row.coeffs.set(slackVar(item), (row.coeffs.get(slackVar(item)) || 0) + 1);
    }

    const constraints = [];
    const allItems = new Set([...graph.items]);
    for (const item of allItems) {
        const row = ensureRow(item); // 无流量物品也建空行(RHS=需求)
        const coeffs = {};
        for (const [v, c] of row.coeffs) {
            if (c) coeffs[v] = c;
        }
        constraints.push({
            name: `con_${item}`,
            coeffs,
            sense: '>=',
            rhs: graph.demandByItem[item] || 0,
        });
    }

    // ===== 主配方优先:主物品吸收上限(z-分摊约束,spec §十一)=====
    // 语义:联产物照常进守恒行(被动抵消/填需允许),但禁止"为副产主动扩别人的配方"。
    // ① 分摊覆盖: Σ_{p∈M(r)} z_{r,p} ≥ x_r
    // ② 吸收上限: out(r,p)·z_{r,p} ≤ D_p + Σ_{r'} in(r',p)·x_{r'}
    // z 不进目标函数——纯记账工具,min 目标自动取最小可行值。
    const mainItemsOfRecipe = graph.mainItemsOfRecipe || new Map();
    for (const [recipeKey, mains] of mainItemsOfRecipe) {
        if (!mains || mains.size === 0) continue;
        const r = graph.recipes.get(recipeKey);
        if (!r) continue;

        // z 变量
        const zVars = [];
        for (const p of mains) {
            const zName = `z_${recipeKey}_${p}`;
            variables.push({name: zName});
            zVars.push({item: p, name: zName});
        }

        // ① 分摊覆盖:Σz - x_r ≥ 0
        const coverCoeffs = {};
        coverCoeffs[recipeKey] = -1;
        for (const z of zVars) coverCoeffs[z.name] = (coverCoeffs[z.name] || 0) + 1;
        constraints.push({
            name: `zcov_${recipeKey}`,
            coeffs: coverCoeffs,
            sense: '>=',
            rhs: 0,
        });

        // ② 吸收上限:(out−selfIn)(r,p)·z_{r,p} - Σ_{r'≠r} in(r',p)·x_{r'} ≤ D_p
        //    ★ 关键教训(四轮试错):
        //      a) 自举配方的守恒行是净额(out−selfIn 合并,如增产剂 1.25−0.05=1.2),
        //         若 zcap 用毛产出 out 记账,zcov(z≥x)+守恒(净额x≥D/净率)+zcap(毛率z≤D)
        //         三者夹逼:z∈[x, D/out] 且 x ≥ D/(out−selfIn) > D/out ⟹ 永远矛盾 → Infeasible
        //         (真实数据配方105 增产剂 Mk.III 自喷即此因);
        //      b) 因此 zcap 必须用与守恒行相同的【净贡献率】(out−selfIn) 记账——
        //         "吸收上限"约束的是有效供给,不是毛产量;
        //      c) 别人的消耗从守恒行负系数取(未合并);自身自耗已含在净率里不再单列。
        //      修复后无"为副产扩产"漏洞——扩规模仍被守恒行与 min Σx 约束。
        for (const z of zVars) {
            const gross = r.outputs[z.item] || 0;
            if (!gross) continue; // 名义主物品但产量0(数据异常):②恒真,跳过
            const netRate = gross - (r.inputs[z.item] || 0); // 净贡献率,与守恒行口径一致
            if (netRate <= 0) continue; // 净产出非正(纯转换配方):主物品无法由它净供给,跳过上限
            const capCoeffs = {};
            capCoeffs[z.name] = netRate;
            for (const [v, negIn] of conRows.get(z.item)?.coeffs ?? []) {
                if (negIn >= 0 || v === z.name || v === recipeKey) continue;
                capCoeffs[v] = (capCoeffs[v] || 0) + negIn; // 别人消耗保持负号在左侧
            }
            constraints.push({
                name: `zcap_${recipeKey}_${z.item}`,
                coeffs: capCoeffs,
                sense: '<=',
                rhs: graph.demandByItem[z.item] || 0,
            });
        }
    }

    return {
        model: {variables, objective: {coeffs: objectiveCoeffs}, constraints},
        varToRecipe,
    };
}
