// 直流潮流（DC Power Flow）求解器 —— 仿真的"硬核内核"。
//
// 模型：忽略电阻与电压幅值，假设各母线电压幅值=1、相角差小。
//   每条线路潮流 P_ij = (1/X_ij) * (θ_i - θ_j)
//   每个节点功率平衡：注入 P_i = Σ_j P_ij  =>  B·θ = P
// 其中 B 为节点电纳矩阵。选一个松弛节点令 θ=0，求解线性方程得到各节点相角，
// 再回代得到每条线路的潮流。计算极廉价、数值稳定，却能真实产生
// "潮流按阻抗分配 / 线路拥堵 / 连锁跳闸"等所有好玩的现象。

import type { Line } from './types';

/** 高斯消元 + 部分主元，求解 A x = b（A 为 n×n 方阵，会被复制不破坏入参） */
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]); // 增广矩阵
  for (let col = 0; col < n; col++) {
    // 选列主元（绝对值最大）
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) continue; // 近奇异列，跳过
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const pv = M[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / pv;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const pv = M[i][i];
    x[i] = Math.abs(pv) < 1e-12 ? 0 : M[i][n] / pv;
  }
  return x;
}

export interface DCResult {
  /** 母线 id -> 相角 θ */
  angles: Map<number, number>;
  /** 线路 id -> 潮流 (MW)，from→to 为正 */
  flows: Map<number, number>;
}

/**
 * 对一个连通"岛"求解直流潮流。
 * @param busIds   该岛包含的母线 id 列表
 * @param lines    仅该岛内部、未跳闸的线路
 * @param injection 母线净注入功率 (MW)：发电为正、负荷为负
 */
export function solveDC(busIds: number[], lines: Line[], injection: Map<number, number>): DCResult {
  const n = busIds.length;
  const idx = new Map<number, number>();
  busIds.forEach((id, i) => idx.set(id, i));

  const angles = new Map<number, number>();
  const flows = new Map<number, number>();
  if (n <= 1) {
    busIds.forEach((id) => angles.set(id, 0));
    return { angles, flows };
  }

  // 构建 B 矩阵
  const B: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const ln of lines) {
    const i = idx.get(ln.from);
    const j = idx.get(ln.to);
    if (i === undefined || j === undefined) continue;
    const b = 1 / Math.max(ln.reactance, 1e-6);
    B[i][i] += b;
    B[j][j] += b;
    B[i][j] -= b;
    B[j][i] -= b;
  }

  // 取索引 0 为松弛节点：删去其对应行列，解 (n-1) 维方程
  const slack = 0;
  const map: number[] = [];
  for (let k = 0; k < n; k++) if (k !== slack) map.push(k);
  const m = map.length;
  const A: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  const rhs = new Array(m).fill(0);
  for (let a = 0; a < m; a++) {
    rhs[a] = injection.get(busIds[map[a]]) ?? 0;
    for (let c = 0; c < m; c++) A[a][c] = B[map[a]][map[c]];
  }
  const sol = solveLinear(A, rhs);

  const theta = new Array(n).fill(0);
  for (let a = 0; a < m; a++) theta[map[a]] = sol[a];
  busIds.forEach((id, i) => angles.set(id, theta[i]));

  for (const ln of lines) {
    const i = idx.get(ln.from);
    const j = idx.get(ln.to);
    if (i === undefined || j === undefined) continue;
    const b = 1 / Math.max(ln.reactance, 1e-6);
    flows.set(ln.id, b * (theta[i] - theta[j]));
  }
  return { angles, flows };
}
