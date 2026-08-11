/**
 * 稀疏矩阵求逆模块
 * 职责：小规模稀疏矩阵的求逆和线性方程组求解
 * 使用高斯消元法（LU分解），支持 2-25 维矩阵
 */

/**
 * 高斯消元法求解线性方程组 Ax = b
 * 奇异矩阵时抛出异常（存在死循环依赖）
 * @param {number[][]} A - n×n 系数矩阵（二维数组）
 * @param {number[]} b - n 维常数向量
 * @returns {number[]} n 维解向量
 * @throws {Error} 矩阵不可逆时抛出
 */
function solveLinearSystem(A, b) {
  const n = A.length;
  // 构造增广矩阵 [A|b]
  let aug = A.map((row, i) => [...row, b[i]]);

  // 记录每列的主元所在行
  const pivotRow = new Array(n).fill(-1);

  // 前向消元（部分主元选择）
  let curRow = 0;
  for (let col = 0; col < n && curRow < n; col++) {
    // 找主元（绝对值最大的行）
    let maxVal = Math.abs(aug[curRow][col]);
    let maxRow = curRow;
    for (let row = curRow + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }

    if (maxVal < 1e-12) {
      continue; // 此列无主元，跳过
    }

    // 交换行
    if (maxRow !== curRow) {
      [aug[curRow], aug[maxRow]] = [aug[maxRow], aug[curRow]];
    }

    pivotRow[col] = curRow; // 记录主元位置

    // 消元
    const pivot = aug[curRow][col];
    for (let row = curRow + 1; row < n; row++) {
      const factor = aug[row][col] / pivot;
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[curRow][j];
      }
    }
    curRow++;
  }

  // 检查是否奇异：存在无主元的列 → 矩阵不可逆
  for (let col = 0; col < n; col++) {
    if (pivotRow[col] === -1) {
      throw new Error('SINGULAR_MATRIX');
    }
  }

  // 回代
  const x = new Array(n).fill(0);
  for (let col = n - 1; col >= 0; col--) {
    const row = pivotRow[col];
    let sum = aug[row][n];
    for (let j = col + 1; j < n; j++) {
      sum -= aug[row][j] * x[j];
    }
    x[col] = sum / aug[row][col];
  }

  return x;
}

/**
 * 矩阵求逆
 * @param {number[][]} A - n×n 矩阵
 * @returns {number[][]} A 的逆矩阵
 */
export function invertMatrix(A) {
  const n = A.length;
  const inv = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let col = 0; col < n; col++) {
    const e = new Array(n).fill(0);
    e[col] = 1;
    const x = solveLinearSystem(A, e);
    for (let row = 0; row < n; row++) {
      inv[row][col] = x[row];
    }
  }

  return inv;
}
