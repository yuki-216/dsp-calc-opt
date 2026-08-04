/**
 * 稀疏矩阵求逆模块
 * 职责：小规模稀疏矩阵的求逆和线性方程组求解
 * 使用高斯消元法（LU分解），支持 2-25 维矩阵
 */

/**
 * 高斯消元法求解线性方程组 Ax = b
 * @param {number[][]} A - n×n 系数矩阵（二维数组）
 * @param {number[]} b - n 维常数向量
 * @returns {number[]} n 维解向量
 * @throws {Error} 矩阵奇异时抛出错误
 */
function solveLinearSystem(A, b) {
  const n = A.length;
  // 构造增广矩阵 [A|b]
  const aug = A.map((row, i) => [...row, b[i]]);

  // 前向消元（部分主元选择）
  for (let col = 0; col < n; col++) {
    // 找主元（绝对值最大的行）
    let maxVal = Math.abs(aug[col][col]);
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }

    if (maxVal < 1e-12) {
      throw new Error(`矩阵奇异，无法求解（主元列 ${col} 全为零）`);
    }

    // 交换行
    if (maxRow !== col) {
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    }

    // 消元
    const pivot = aug[col][col];
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / pivot;
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // 回代
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = aug[i][n];
    for (let j = i + 1; j < n; j++) {
      sum -= aug[i][j] * x[j];
    }
    x[i] = sum / aug[i][i];
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
