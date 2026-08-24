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

function serializeToLpText(model) {
    const lines = [];
    lines.push('Minimize');
    const objTerms = model.variables
        .map(v => ({name: v.name, c: model.objective.coeffs[v.name] || 0}))
        .filter(t => t.c !== 0);
    if (objTerms.length === 0) {
        lines.push(' obj: 0 ' + model.variables.map(v => `+ 0 ${v.name}`).join(' '));
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
            terms.push(`${first ? (c < 0 ? '-' : '') : (c < 0 ? '- ' : '+ ')}${Math.abs(c)} ${v.name}`);
            first = false;
        }
        if (terms.length === 0) terms.push(`0 ${model.variables[0]?.name ?? '_zero'}`);
        lines.push(` ${con.name}: ${terms.join(' ')} ${SENSE_MAP[con.sense] ?? '>='} ${con.rhs}`);
    }

    lines.push('Bounds');
    for (const v of model.variables) {
        lines.push(` ${v.name} >= 0`);
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
        for (const v of model.variables) {
            x[v.name] = result.Columns?.[v.name]?.Primal ?? 0;
            if (!Number.isFinite(x[v.name])) {
                throw new Error(`LP 解含非有限值: ${v.name}=${x[v.name]}`);
            }
        }
    }
    return {x, status, objective: Number(result.ObjectiveValue) || 0};
}
