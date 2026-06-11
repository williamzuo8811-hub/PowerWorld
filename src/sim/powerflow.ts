// 直流潮流（DC Power Flow）求解器 —— 仿真的"硬核内核"。
//
// 模型：忽略电阻与电压幅值，假设各母线电压幅值=1、相角差小。
//   每条线路潮流 P_ij = (1/X_ij) * (θ_i - θ_j)
//   每个节点功率平衡：注入 P_i = Σ_j P_ij  =>  B·θ = P
// 其中 B 为节点电纳矩阵。选一个松弛节点令 θ=0，求解线性方程得到各节点相角，
// 再回代得到每条线路的潮流。
//
// 性能：电网拓扑在绝大多数 tick 之间不变，而 B 矩阵只依赖拓扑（电抗固定）。
// 因此把"O(n³) 的消元"提炼为一次性的 LU 分解（factorizeDC），每 tick 只做
// O(n²) 的前代/回代——大电网下潮流计算成本降低一个数量级。

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
 * 一座孤岛的直流潮流"预分解"：B 矩阵只依赖拓扑与电抗，
 * 拓扑不变时可跨 tick 复用，每次求解只做 O(n²) 回代。
 */
export class DCFactorization {
  private n: number;
  private idx = new Map<number, number>(); // busId -> 0..n-1
  private busIds: number[];
  private lines: Line[];
  private lineB: number[] = []; // 每条线路的电纳 1/X
  // 约简矩阵（去掉松弛节点 0 的行列）的 LU 分解（Doolittle + 部分主元）
  private m: number;
  private lu: Float64Array[] = [];
  private perm: number[] = [];

  constructor(busIds: number[], lines: Line[]) {
    this.busIds = busIds;
    this.lines = lines;
    this.n = busIds.length;
    busIds.forEach((id, i) => this.idx.set(id, i));
    this.m = Math.max(0, this.n - 1);
    if (this.m === 0) return;

    // 构建约简 B 矩阵（索引 0 为松弛节点，删去其行列 → 行/列 k 对应母线 k+1）
    const A = Array.from({ length: this.m }, () => new Float64Array(this.m));
    for (const ln of lines) {
      const i = this.idx.get(ln.from);
      const j = this.idx.get(ln.to);
      if (i === undefined || j === undefined) continue;
      const b = 1 / Math.max(ln.reactance, 1e-6);
      this.lineB.push(b);
      if (i > 0) A[i - 1][i - 1] += b;
      if (j > 0) A[j - 1][j - 1] += b;
      if (i > 0 && j > 0) {
        A[i - 1][j - 1] -= b;
        A[j - 1][i - 1] -= b;
      }
    }

    // LU 分解（部分主元）：连通岛的约简 B 矩阵正定，主元健康；仍留近奇异守护
    this.lu = A;
    this.perm = Array.from({ length: this.m }, (_, k) => k);
    for (let k = 0; k < this.m; k++) {
      let p = k;
      for (let r = k + 1; r < this.m; r++) {
        if (Math.abs(this.lu[r][k]) > Math.abs(this.lu[p][k])) p = r;
      }
      if (p !== k) {
        [this.lu[k], this.lu[p]] = [this.lu[p], this.lu[k]];
        [this.perm[k], this.perm[p]] = [this.perm[p], this.perm[k]];
      }
      const pv = this.lu[k][k];
      if (Math.abs(pv) < 1e-12) { this.lu[k][k] = 1e-12; continue; }
      for (let r = k + 1; r < this.m; r++) {
        const f = this.lu[r][k] / pv;
        if (f === 0) continue;
        this.lu[r][k] = f;
        for (let c = k + 1; c < this.m; c++) this.lu[r][c] -= f * this.lu[k][c];
      }
    }
  }

  /** 用缓存的 LU 解一次潮流：O(n²) 前代/回代 + O(L) 回填线路潮流 */
  solve(injection: Map<number, number>): DCResult {
    const angles = new Map<number, number>();
    const flows = new Map<number, number>();
    if (this.m === 0) {
      this.busIds.forEach((id) => angles.set(id, 0));
      return { angles, flows };
    }
    // 右端项（按行置换）
    const b = new Float64Array(this.m);
    for (let k = 0; k < this.m; k++) b[k] = injection.get(this.busIds[this.perm[k] + 1]) ?? 0;
    // 前代 Ly = Pb
    for (let i = 1; i < this.m; i++) {
      let s = b[i];
      const row = this.lu[i];
      for (let j = 0; j < i; j++) s -= row[j] * b[j];
      b[i] = s;
    }
    // 回代 Ux = y
    for (let i = this.m - 1; i >= 0; i--) {
      let s = b[i];
      const row = this.lu[i];
      for (let j = i + 1; j < this.m; j++) s -= row[j] * b[j];
      const pv = row[i];
      b[i] = Math.abs(pv) < 1e-12 ? 0 : s / pv;
    }

    const theta = new Array(this.n).fill(0);
    for (let k = 0; k < this.m; k++) theta[k + 1] = b[k];
    this.busIds.forEach((id, i) => angles.set(id, theta[i]));

    let li = 0;
    for (const ln of this.lines) {
      const i = this.idx.get(ln.from);
      const j = this.idx.get(ln.to);
      if (i === undefined || j === undefined) continue;
      flows.set(ln.id, this.lineB[li++] * (theta[i] - theta[j]));
    }
    return { angles, flows };
  }
}

/** 预分解一座孤岛（拓扑不变时跨 tick 复用） */
export function factorizeDC(busIds: number[], lines: Line[]): DCFactorization {
  return new DCFactorization(busIds, lines);
}

/**
 * 对一个连通"岛"求解直流潮流（一次性接口，内部走 LU 路径）。
 * @param busIds   该岛包含的母线 id 列表
 * @param lines    仅该岛内部、未跳闸的线路
 * @param injection 母线净注入功率 (MW)：发电为正、负荷为负
 */
export function solveDC(busIds: number[], lines: Line[], injection: Map<number, number>): DCResult {
  return new DCFactorization(busIds, lines).solve(injection);
}
