// src/engine/lp-solver.js
/**
 * LP 求解器封装(hiGHS WASM)
 * 职责:单例加载 HiGHS;结构化模型 ↔ CPLEX LP 文本转换;解析求解结果
 */

import loadHighs from 'highs';

let highsPromise = null;

/**
 * 获取 HiGHS 实例(应用生命周期内只初始化一次)
 * @returns {Promise<Object>} HiGHS 实例
 */
export function getHighs() {
    if (!highsPromise) {
        highsPromise = loadHighs();
    }
    return highsPromise;
}

const SENSE_MAP = {'>=': '>=', '<=': '<='};

// CPLEX LP 格式标识符不允许以数字开头(配方索引作变量名时形如 "15" 会导致 HiGHS 解析崩溃),
// 且不允许含空格(约束名 con_增产剂 Mk.IIII 中的空格会截断行导致解析失败),
// 序列化时统一映射为 v0..vn 别名(变量)/c0..cn 别名(约束),解析结果再映射回原名。
function serializeToLpText(model) {
    const alias = new Map(model.variables.map((v, i) => [v.name, `v${i}`]));
    const conAlias = new Map(model.constraints.map((c, i) => [c.name, `c${i}`]));
    const lines = [];
    lines.push('Minimize');
    const objTerms = model.variables
        .map(v => ({name: alias.get(v.name), c: model.objective.coeffs[v.name] || 0}))
        .filter(t => t.c !== 0);
    if (objTerms.length === 0) {
        lines.push(' obj: 0 ' + model.variables.map(v => `+ 0 ${alias.get(v.name)}`).join(' '));
    } else {
        lines.push(' obj: ' + objTerms.map((t, i) => `${i === 0 ? '' : '+ '}${t.c} ${t.name}`).join(' '));
    }

    lines.push('Subject To');
    for (const con of model.constraints) {
        const terms = [];
        let first = true;
        for (const v of model.variables) {
            const c = con.coeffs[v.name];
            if (!c) continue;
            terms.push(`${first ? (c < 0 ? '-' : '') : (c < 0 ? '- ' : '+ ')}${Math.abs(c)} ${alias.get(v.name)}`);
            first = false;
        }
        if (terms.length === 0) terms.push(`0 ${model.variables[0] ? alias.get(model.variables[0].name) : '_zero'}`);
        lines.push(` ${conAlias.get(con.name)}: ${terms.join(' ')} ${SENSE_MAP[con.sense] ?? '>='} ${con.rhs}`);
    }

    lines.push('Bounds');
    for (const v of model.variables) {
        lines.push(` ${alias.get(v.name)} >= 0`);
    }
    lines.push('End');
    return lines.join('\n');
}

/**
 * 求解 LP 模型
 * @param {Object} model - {variables:[{name}], objective:{coeffs}, constraints:[{name, coeffs, sense, rhs}]}
 * @returns {Promise<{x: Object, status: string, objective: number}>}
 */
export async function solveLP(model) {
    const highs = await getHighs();
    const lpText = serializeToLpText(model);
    const result = highs.solve(lpText, {output_flag: false});

    const statusMap = {
        'Optimal': 'Optimal',
        'Infeasible': 'Infeasible',
        'Unbounded': 'Unbounded',
    };
    const status = statusMap[result.Status] ?? 'Error';

    const x = {};
    if (status === 'Optimal') {
        for (const [origName, i] of model.variables.map((v, i) => [v.name, i])) {
            const primal = result.Columns?.[`v${i}`]?.Primal;
            if (primal === undefined) {
                // 序列化用 v{i} 别名,HiGHS 返回列必须一一对应;缺失说明名字映射断裂,禁止静默归零
                throw new Error(`LP 解缺失变量列: ${origName}(别名 v${i})`);
            }
            if (!Number.isFinite(primal)) {
                throw new Error(`LP 解含非有限值: ${origName}=${primal}`);
            }
            x[origName] = primal;
        }
    }
    return {x, status, objective: Number(result.ObjectiveValue) || 0};
}
