export function getPowerDeviceCount({
    totalEnergy,
    devicePower,
    proliferatorEffects = [],
    proliferatorLevel = 0,
    proliferatorMode = 0,
}) {
    let outputMultiplier = 1;
    const effect = proliferatorEffects?.[proliferatorLevel];
    if (effect && proliferatorLevel > 0) {
        if (proliferatorMode === 1) outputMultiplier = effect['加速效果'] || 1;
        if (proliferatorMode === 2) outputMultiplier = effect['增产效果'] || 1;
    }

    const effectivePower = devicePower * outputMultiplier;
    return effectivePower > 0 ? totalEnergy / effectivePower : 0;
}
