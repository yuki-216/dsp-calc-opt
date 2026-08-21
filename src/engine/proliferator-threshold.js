const EPSILON = 1e-12;

export function getThresholdMetric(result) {
    return result?.objectiveValue ?? 0;
}

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

export function relativeThresholdImprovement(baseline, candidate) {
    return relativeObjectiveImprovement(baseline, candidate);
}

/**
 * 判断增产剂候选是否达到"无增产剂加权"阈值。
 */
export function shouldAcceptProliferator({baseline, candidate, threshold = 0.005}) {
    return relativeThresholdImprovement(baseline, candidate) >= Math.max(0, threshold);
}
