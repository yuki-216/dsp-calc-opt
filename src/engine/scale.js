/**
 * 按需求量缩放模块
 * 职责：根据需求量计算最终资源消耗
 * 注意：单位成本已经按DAG顺序累加了上游成本（包含自身）
 */

/**
 * 汇总资源消耗
 * @param {Map<string, Object>} results - 计算结果映射
 * @returns {Object} 汇总结果
 */
export function aggregateResourceUsage(results) {
  const totalUsage = {};
  let totalPower = 0;
  let totalBuildings = 0;
  let totalFootprint = 0;

  for (const [itemId, result] of results) {
    // 累加资源消耗（基础物品）
    for (const [resourceId, amount] of Object.entries(result.resourceUsage)) {
      totalUsage[resourceId] = (totalUsage[resourceId] || 0) + amount;
    }

    // 累加电力、建筑、占地
    totalPower += result.power;
    totalBuildings += result.buildings;
    totalFootprint += result.footprint;
  }

  return {
    resourceUsage: totalUsage,
    power: totalPower,
    buildings: totalBuildings,
    footprint: totalFootprint
  };
}
