function normalizeProliferatorChoice(choice = {}) {
    const level = Number(choice['增产剂等级'] || 0);
    const mode = level > 0 ? Number(choice['增产模式'] || 0) : 0;
    return mode > 0 ? {level, mode} : {level: 0, mode: 0};
}

function formatProliferatorMode(choice) {
    const normalized = normalizeProliferatorChoice(choice);
    if (!normalized.level) return '不使用';
    return normalized.mode === 2 ? '增产' : '加速';
}

export function formatProliferatorChoice(level, mode) {
    const choice = normalizeProliferatorChoice({
        '增产剂等级': level,
        '增产模式': mode,
    });
    if (!choice.level) return '不使用';
    const modeText = choice.mode === 2 ? '增产' : '加速';
    return `Mk.${choice.level} ${modeText}`;
}

export function collectProliferatorChanges(beforeScheme, afterScheme, recipes, activeRecipeIndices = null) {
    const before = beforeScheme?.scheme_for_recipe || [];
    const after = afterScheme?.scheme_for_recipe || [];
    return recipes.reduce((changes, recipe, index) => {
        if (activeRecipeIndices && !activeRecipeIndices.has(index)) return changes;

        const oldChoice = normalizeProliferatorChoice(before[index]);
        const newChoice = normalizeProliferatorChoice(after[index]);
        if (oldChoice.level === newChoice.level && oldChoice.mode === newChoice.mode) return changes;

        const items = Object.keys(recipe?.['产物'] || {});
        changes.push({
            item: items.length > 0 ? items.join(' / ') : `配方${index + 1}`,
            before: formatProliferatorChoice(oldChoice.level, oldChoice.mode),
            after: formatProliferatorChoice(newChoice.level, newChoice.mode),
        });
        return changes;
    }, []);
}

export function collectProliferatorModeChanges(beforeScheme, afterScheme, recipes, activeRecipeIndices = null) {
    const before = beforeScheme?.scheme_for_recipe || [];
    const after = afterScheme?.scheme_for_recipe || [];
    return recipes.reduce((changes, recipe, index) => {
        if (activeRecipeIndices && !activeRecipeIndices.has(index)) return changes;

        const beforeMode = formatProliferatorMode(before[index]);
        const afterMode = formatProliferatorMode(after[index]);
        if (beforeMode === afterMode) return changes;

        const items = Object.keys(recipe?.['产物'] || {});
        changes.push({
            item: items.length > 0 ? items.join(' / ') : `配方${index + 1}`,
            before: beforeMode,
            after: afterMode,
        });
        return changes;
    }, []);
}
