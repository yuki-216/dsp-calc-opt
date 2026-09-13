const EPSILON = 1e-12;

/**
 * 计算候选目标相对于无增产剂目标的相对改善比例。
 * 目标函数均为越小越好，因此正数表示候选方案更优。
 */
export function relativeObjectiveImprovement(baseline, candidate) {
    if (Math.abs(baseline) <= EPSILON) {
        return candidate < baseline ? Number.POSITIVE_INFINITY : 0;
    }
    return (baseline - candidate) / Math.abs(baseline);
}

/** 判断增产剂候选是否达到"无增产剂加权"阈值 */
export function shouldAcceptProliferator({baseline, candidate, threshold = 0.005}) {
    return relativeObjectiveImprovement(baseline, candidate) >= Math.max(0, threshold);
}

/** 按优化策略取出用于比较的目标值 */
function getObjectiveValue(result, strategy) {
    if (strategy === 'min_rare_weight') return result.rareWeightObjective ?? 0;
    if (strategy === 'min_net_heat') return result.netOreHeat ?? 0;
    if (strategy === 'min_footprint') return result.totalFootprint ?? 0;
    return result.totalEnergyCost ?? 0;
}

function isProliferatorEnabled(recipeScheme) {
    return Number(recipeScheme?.['增产剂等级'] || 0) > 0
        || Number(recipeScheme?.['增产模式'] || 0) > 0;
}

function clearProliferator(recipeScheme) {
    recipeScheme['增产剂等级'] = 0;
    recipeScheme['增产模式'] = 0;
}

/**
 * 在完整优化完成后，按 SCC 正序验证每个增产剂的最终边际改善。
 * 后续 SCC 的变化可能影响前面 SCC，因此发生撤销后重新从第一个 SCC 开始。
 */
export async function validateFinalProliferatorChoices({
    gameData,
    settings,
    needs,
    sccs,
    scheme,
    itemToRecipe,
    strategy,
    threshold,
    calculateResult,
    onLog,
}) {
    let currentScheme = structuredClone(scheme);
    let currentResult = await calculateResult(gameData, currentScheme, settings, needs);
    const revertedItems = [];
    let changed = true;
    onLog?.(`最终边际验证开始（阈值：${(threshold * 100).toFixed(2)}%）`);

    while (changed) {
        changed = false;
        for (const scc of sccs) {
            for (const itemId of scc) {
                const recipeIndex = itemToRecipe.get(itemId);
                const recipeScheme = recipeIndex === undefined
                    ? null
                    : currentScheme.scheme_for_recipe?.[recipeIndex];
                if (!recipeScheme || !isProliferatorEnabled(recipeScheme)) continue;

                const candidateMetric = getObjectiveValue(currentResult, strategy);
                const noProScheme = structuredClone(currentScheme);
                clearProliferator(noProScheme.scheme_for_recipe[recipeIndex]);
                const noProResult = await calculateResult(gameData, noProScheme, settings, needs);
                const noProMetric = getObjectiveValue(noProResult, strategy);
                const accepted = shouldAcceptProliferator({
                    baseline: noProMetric,
                    candidate: candidateMetric,
                    threshold,
                });
                const improvement = relativeObjectiveImprovement(noProMetric, candidateMetric) * 100;
                const improvementText = Number.isFinite(improvement) ? improvement.toFixed(2) : '∞';

                if (!accepted) {
                    onLog?.(`${itemId}：撤销（改善 ${improvementText}%，未达阈值）`);
                    currentScheme = noProScheme;
                    currentResult = noProResult;
                    if (!revertedItems.includes(itemId)) revertedItems.push(itemId);
                    changed = true;
                }
            }
        }
    }

    return {scheme: currentScheme, result: currentResult, revertedItems};
}
