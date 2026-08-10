/**
 * 单位成本计算模块（系数表版本）
 * 职责：用系数表实现符号化成本追踪，按 SCC 顺序代入展开
 * 成本表示：{ "$item": 1, "input1": ratio, "byproduct": -ratio, ... }
 *   - $ 前缀：配方执行次数
 *   - 无前缀：物品总成本符号
 */

import { invertMatrix } from './matrix.js';

// 浮点精度控制：四舍五入和截断统一使用此精度
const PRECISION = 7;                           // 小数位数
const ROUND_FACTOR = Math.pow(10, PRECISION);  // 1e7
const TRUNCATE_EPSILON = 1 / ROUND_FACTOR;     // 1e-7


/**
 * 按 SCC 逆拓扑序展开物品成本到 solution
 * 从顶层（最终产物）开始，逐层将物品成本代入 solution，保持每个物品的成本公式简约
 *
 * @param {string} solutionId - solution 节点 ID
 * @param {Map} costs - 物品系数表映射 {itemId: costMap}（会被修改）
 * @param {Map} graph - 物品图
 * @param {Array<Set<string>>} sccs - SCC分组（逆拓扑序：顶层在前，底层在后）
 * @param {Map<string,Set>} byproductMap - 副产物映射
 */
export function expandInSCCOrder(solutionId, costs, graph, sccs, byproductMap = new Map()) {
  // 计时统计（已禁用）
  // const timings = {
  //   matrixInverse: 0,  // 矩阵求逆耗时
  //   substitute: 0,     // 代入展开耗时
  //   other: 0,          // 其他开销（循环控制、Set操作等）
  //   total: 0
  // };

  // const totalStart = performance.now();
  // let otherStart = totalStart;

  // 负需求物品集合（用于迭代过滤）
  const negativeDemandItems = new Set();

  const solutionCost = costs.get(solutionId);
  if (!solutionCost) {
    // timings.total = performance.now() - totalStart;
    return {};
  }

  // 两个列表
  const expansionList = new Set();
  const reverseProductionList = new Set();

  // 直接引用，substitute 内部会读取
  const solution = solutionCost;

  /**
   * 代入函数：将 key 对应的 source 代入 solution，同时维护两个列表
   * @param {string} key - 要代入的物品 key
   * @param {Object} source - 源物品的系数表
   * @param {number} multiplier - 乘数（默认使用 solution[key]，逆生产时传入 -cancelAmount）
   */
  function substitute(key, source, multiplier = null) {
    // 从待展开列表删除当前 key（因为要展开了）
    expansionList.delete(key);

    const coeff = solution[key];
    delete solution[key];

    const m = multiplier ?? coeff;  // 默认使用 coeff，逆生产时传入 -cancelAmount
    const isReverse = multiplier !== null;

    for (const [k, v] of Object.entries(source)) {
      const A = solution[k] || 0;    // 加和前的值
      const addend = m * v;          // 待加的值
      const C = A + addend;          // 加和后的值

      // 处理执行次数（$前缀）
      if (k.startsWith('$')) {
        // 负数执行次数转换为负数需求
        if (C <= 0) {
          const itemName = k.substring(1); // 去掉$前缀
          if (C < 0) {
            solution[itemName] = (solution[itemName] || 0) + C; // C是负数，加到需求中
          }
          delete solution[k]; // 删除执行次数（包括0和负数）
        } else {
          solution[k] = C;
        }
        continue;
      }

      // 设置值（精确计算，不截断）
      if (C === 0) {
        delete solution[k];
        // 从列表中移除
        reverseProductionList.delete(k);
        expansionList.delete(k);
      } else {
        solution[k] = C;
      }

      // 判断符号是否变化（AC > 0 表示同号，跳过）
      if (A * C > 0) continue;

      // 符号变化了
      // C < 0：x 转为多余 → 待逆生产列表加入 x
      // C > 0：x 转为需求 → 待展开列表加入 x
      if (C < 0) {
        reverseProductionList.add(k);
      } else if (C > 0) {
        expansionList.add(k);
      }

      // A < 0：x 由多余转变 → 待逆生产列表删除 x
      // A > 0：x 由需求转变 → 待展开列表删除 x
      if (A < 0) {
        reverseProductionList.delete(k);
      } else if (A > 0) {
        expansionList.delete(k);
      }
    }

    // 调试输出：展开/逆生产后的solution
    // const action = isReverse ? '逆生产' : '展开';
    // console.log(`[substitute-${action}] "${key}" 后 solution:`, JSON.stringify(solution));
  }

  // ====== 阶段1：SCC展开（逆拓扑序，从顶层开始） ======
  console.log('[展开] SCC总数:', sccs.length, '顺序:');
  for (let i = 0; i < sccs.length; i++) {
    console.log(`  SCC[${i}]:`, [...sccs[i]].join(', '));
  }
  console.log('[展开] 初始 solution:', JSON.stringify(solution));

  for (let i = 0; i < sccs.length; i++) {
    const scc = sccs[i];

    if (scc.size === 1) {
      // 单节点 SCC
      const itemId = scc.values().next().value;
      const coeff = solution[itemId] || 0;
      if (coeff > 0) {
        const itemCost = costs.get(itemId);
        if (itemCost) {
          console.log(`[阶段1] SCC[${i}] 代入 "${itemId}" (系数=${coeff.toFixed(6)})`, JSON.stringify(itemCost));
          substitute(itemId, itemCost);
          console.log(`[阶段1] 代入后 solution:`, JSON.stringify(solution));
        }
      }
    } else {
      // 多节点 SCC（循环组）：矩阵求逆一次性解出全部物品
                
      solveSCCByMatrix(scc, costs);
      // 打印求解后的 cost
      for (const itemId of scc) {
        const cost = costs.get(itemId);
        if (cost) console.log(`  ${itemId} 解:`, JSON.stringify(cost));
      }

      // 优化2：先检查solution有没有正需求，再展开常数项
      for (const itemId of scc) {
        const coeff = solution[itemId] || 0;
        if (coeff > 0) {
          const itemCost = costs.get(itemId);
          if (itemCost) {
            console.log(`[阶段1] SCC[${i}] 代入 "${itemId}" (系数=${coeff.toFixed(6)})`, JSON.stringify(itemCost));
            substitute(itemId, itemCost);
            console.log(`[阶段1] 代入后 solution:`, JSON.stringify(solution));
          }
        }
      }

      // 循环组求解后，将solution中负系数的物品加入待逆生产列表
      for (const [key, val] of Object.entries(solution)) {
        if (key.startsWith('$')) continue;
        if (val < 0 && !reverseProductionList.has(key)) {
          console.log(`[阶段1] SCC[${i}] 循环组求解后，"${key}" 有负系数=${val.toFixed(6)}，加入待逆生产列表`);
          reverseProductionList.add(key);
        }
      }

    }
  }

  // ====== 阶段2：处理两个列表（循环直到都为空） ======
  // 执行顺序：每次循环先执行完待展开，再执行一个待逆生产
  // 截断阈值：系数小于 1e-5 时截断为0，避免无限循环
  const PHASE2_TRUNCATE_EPSILON = 1e-5;
  let loopCount = 0;
  const maxLoops = 1000;

  console.log('[阶段2] 开始, expansionList:', [...expansionList], 'reverseProductionList:', [...reverseProductionList]);

  while ((reverseProductionList.size > 0 || expansionList.size > 0) && loopCount < maxLoops) {
    loopCount++;

    // 先处理待展开列表（全部执行完）
    while (expansionList.size > 0 && loopCount < maxLoops) {
      loopCount++;
      const itemId = expansionList.values().next().value;
      const coeff = solution[itemId] || 0;

      if (Math.abs(coeff) < PHASE2_TRUNCATE_EPSILON) {
        expansionList.delete(itemId);
        delete solution[itemId];
        continue;
      }

      const itemCost = costs.get(itemId);
      if (itemCost) {
        console.log(`[阶段2-展开] "${itemId}" (系数=${coeff.toFixed(6)})`, JSON.stringify(itemCost));
        substitute(itemId, itemCost);
        console.log(`[阶段2-展开后] solution:`, JSON.stringify(solution));
      }
    }

    // 再处理待逆生产列表（执行一个）
    if (reverseProductionList.size > 0 && loopCount < maxLoops) {
      loopCount++;
      const itemId = reverseProductionList.values().next().value;
      reverseProductionList.delete(itemId);

      const v = solution[itemId] || 0;

      if (Math.abs(v) < PHASE2_TRUNCATE_EPSILON) {
        delete solution[itemId];
        continue;
      }

      console.log(`[阶段2-逆生产] "${itemId}" (系数=${v.toFixed(6)})`);


      const itemSelfKey = `$${itemId}`;
      const production = solution[itemSelfKey] || 0;
      const itemCost = costs.get(itemId);

      if (itemCost && production > 0) {
        const selfCoeffInCost = itemCost[itemSelfKey] || 1;
        const netProduction = production / selfCoeffInCost;
        const cancelAmount = Math.min(Math.abs(v), netProduction);

        // 截断：抵消量太小，跳过
        if (cancelAmount < PHASE2_TRUNCATE_EPSILON) {
          // console.log(`[阶段2-逆生产] "${itemId}" 可抵消=${cancelAmount.toFixed(6)} < ${PHASE2_TRUNCATE_EPSILON}, 截断`);
          continue;
        }

        if (cancelAmount > 0) {
          console.log(`[阶段2-逆生产] "${itemId}" 多余=${v.toFixed(6)}, 可抵消=${cancelAmount.toFixed(6)}`);
          console.log(`[阶段2-逆生产] "${itemId}" 成本:`, JSON.stringify(itemCost));
          // 打印乘以系数后的量
          const scaledCost = {};
          for (const [key, val] of Object.entries(itemCost)) {
            scaledCost[key] = val * (-cancelAmount);
          }
          console.log(`[阶段2-逆生产] "${itemId}" 乘以系数(${(-cancelAmount).toFixed(6)}):`, JSON.stringify(scaledCost));
          substitute(itemId, itemCost, -cancelAmount);  // 负号表示抵消

          // 恢复抵消后的系数（substitute 内部会删除 solution[itemId]）
          const newV = v + cancelAmount;
          if (newV !== 0) {
            solution[itemId] = newV;
            if (newV < 0) {
              console.log(`[阶段2-逆生产] "${itemId}" 还有剩余=${newV.toFixed(6)}, 重新加入待逆生产列表`);
              reverseProductionList.add(itemId);  // 还有剩余，重新加入
            }
          }
          console.log(`[阶段2-逆生产后] solution:`, JSON.stringify(solution));
        }
      }
    }
  }

  // timings.other += performance.now() - otherStart;
  // timings.total = performance.now() - totalStart;

  // console.log('[expandSCC] 最终 solution 成本:', JSON.stringify(solution));

  // 阶段2完成后，只检查循环组（多节点SCC）中的物品是否有负需求
  for (const scc of sccs) {
    if (scc.size <= 1) continue; // 跳过单节点SCC
    for (const itemId of scc) {
      const netDemand = solution[itemId] || 0;
      if (netDemand < 0) {
        negativeDemandItems.add(itemId);
      }
    }
  }

  // 输出计时结果（已禁用）
  // console.log('[SCC展开计时]', {
  //   '矩阵求逆': timings.matrixInverse.toFixed(2) + ' ms',
  //   '代入展开': timings.substitute.toFixed(2) + ' ms',
  //   '其他开销': timings.other.toFixed(2) + ' ms',
  //   '总计': timings.total.toFixed(2) + ' ms'
  // });

  return { negativeDemandItems };
}

/**
 * 用矩阵求逆解决 SCC 循环组
 *
 * 核心思想：
 * 1. 直接构建目标矩阵，对角线放$x（不一定是1）
 * 2. 将常数项另外存储（处理成单位次数的常数项），这样后续引用的就是固定的纯常数项
 * 3. 矩阵求逆后，列向量是执行次数
 * 4. 展开成本时，直接用执行次数乘以单位次数的常数项
 *
 * @param {Set<string>} scc - SCC物品ID集合
 * @param {Map} costs - 系数表映射（会被修改）
 */
function solveSCCByMatrix(scc, costs) {
  const sccArray = [...scc];
  const n = sccArray.length;
  const sccSet = scc;
  const sccIndex = new Map();
  sccArray.forEach((id, i) => sccIndex.set(id, i));

  // 直接构建目标矩阵
  // 对角线放$x，循环组内消耗放负系数
  const A = Array.from({ length: n }, () => new Array(n).fill(0));

  // 存储单位次数的常数项（排除循环组内引用）
  const constTerms = new Map();

  for (let j = 0; j < n; j++) {
    const cost = costs.get(sccArray[j]);
    if (!cost) continue;

    // 对角线放$x（成本公式中的执行次数）
    const xKey = `$${sccArray[j]}`;
    const xValue = cost[xKey] || 1; // 默认为1
    A[j][j] = xValue;

    // 提取常数项（排除循环组内引用），并处理成单位次数的常数项
    const constTerm = {};
    for (const [key, coeff] of Object.entries(cost)) {
      if (sccSet.has(key)) {
        // 循环组内引用 → 矩阵变量
        A[sccIndex.get(key)][j] = -coeff;
      } else {
        // 常数项 → 处理成单位次数的常数项（除以$x）
        constTerm[key] = coeff / xValue;
      }
    }
    constTerms.set(sccArray[j], constTerm);

    // 输出依赖项（循环组内引用）
    // const deps = {};
    // for (const [key, coeff] of Object.entries(cost)) {
    //   if (sccSet.has(key)) deps[key] = coeff;
    // }
    // console.log(`[solveSCCByMatrix] ${sccArray[j]}: 依赖项=${JSON.stringify(deps)}, 常数项=${JSON.stringify(constTerm)}`);
  }

  // 求逆矩阵
  let A_inv;
  try {
    A_inv = invertMatrix(A);
  } catch (e) {
    console.error('[solveSCCByMatrix] 矩阵奇异! SCC成员:', sccArray);
    console.error('[solveSCCByMatrix] 矩阵A:', JSON.stringify(A));
    for (const itemId of scc) {
      const cost = costs.get(itemId);
      console.error(`  ${itemId} cost:`, JSON.stringify(cost));
    }
    throw e;
  }



  // 更新 costs：每个 SCC 物品的真实成本
  // 对于配方j，其单位成本 = Σ(A_inv[i][j] * 物品i的单位次数常数项)
  for (let j = 0; j < n; j++) {
    const itemId = sccArray[j];
    const newCost = {};

    // 对于每个循环组内物品i，将其单位次数常数项 × A_inv[i][j] 累加到配方j的成本中
    for (let i = 0; i < n; i++) {
      const execCount = A_inv[i][j];
      if (execCount === 0) continue;

      if (execCount < 0) {
        // 负依赖（副产物）：不展开常数项，只记录依赖关系
        // 保留 $物品: execCount，让阶段2判断是否需要逆生产
        const itemSelfKey = `$${sccArray[i]}`;
        newCost[itemSelfKey] = (newCost[itemSelfKey] || 0) + execCount;
      } else {
        // 正依赖（原料）：展开常数项
        const constTerm = constTerms.get(sccArray[i]);
        if (!constTerm) continue;
        for (const [key, coeff] of Object.entries(constTerm)) {
          newCost[key] = (newCost[key] || 0) + coeff * execCount;
        }
      }
    }

    costs.set(itemId, newCost);
  }

  // 输出结果
  // for (let i = 0; i < n; i++) {
  //   console.log(`[solveSCCByMatrix] ${sccArray[i]}:`, costs.get(sccArray[i]));
  // }
}
