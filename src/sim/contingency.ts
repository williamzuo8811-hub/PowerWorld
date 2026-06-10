// N-1 冗余校核（Contingency Analysis）——电力系统的"硬核"可靠性工具。
//
// 逐一假设每条线路 / 每台变压器单独停运，用当前运行点重新做一次静态直流潮流，
// 检查是否会造成：①失负荷（某片区域失去电源）②线路过载 ③变压器过载。
// 全程只读、不改任何仿真数据（在局部 Map 中计算），可安全反复调用。
import type { Grid } from './grid';
import type { Line } from './types';
import { solveDC } from './powerflow';

export interface Violation {
  name: string;
  loadingPct: number; // 过载元件的负载率（>100%）
}

export interface Contingency {
  kind: 'line' | 'transformer';
  id: number; // 线路 id 或变电站母线 id
  name: string;
  lostLoadMW: number; // 该故障导致的失负荷
  overloads: Violation[]; // 该故障导致的过载元件
  secure: boolean; // 该单一故障下是否安全
}

export interface N1Report {
  secure: boolean; // 是否满足 N-1（任一单一故障都安全）
  checked: number; // 校核的元件数
  contingencies: Contingency[]; // 不安全的故障列表
  vulnerableLineIds: Set<number>; // 失去后会出问题的线路
  vulnerableSubIds: Set<number>; // 失去后会出问题的变电站
}

const EPS = 0.5; // MW 容差

/** 评估单个孤岛在给定在运判据下的静态结果（不修改任何实体） */
function evalIsland(grid: Grid, busIds: number[], isActive: (ln: Line) => boolean): { lostLoad: number; overloads: Violation[] } {
  const set = new Set(busIds);
  const gens = [...grid.gens.values()].filter((g) => set.has(g.busId));
  const loads = [...grid.loads.values()].filter((l) => set.has(l.busId));
  const bats = [...grid.batteries.values()].filter((b) => set.has(b.busId));
  const demand = loads.reduce((s, l) => s + l.demand, 0);
  if (demand < EPS) return { lostLoad: 0, overloads: [] };

  // 可用供给能力（容量口径）：可调机组按额定、新能源按当前可用、储能按功率（有电时）
  const renewAvail = gens.filter((g) => !g.dispatchable).reduce((s, g) => s + g.capacity * g.availability, 0);
  const dispCap = gens.filter((g) => g.dispatchable).reduce((s, g) => s + g.capacity, 0);
  const batAvail = bats.filter((b) => b.soc > 1).reduce((s, b) => s + b.powerRating, 0);
  const supplyCap = renewAvail + dispCap + batAvail;
  const served = Math.min(demand, supplyCap);
  const lostLoad = Math.max(0, demand - served);

  // 为潮流构造一个能供出 served 的注入向量（按"新能源→可调→储能"顺序分配）
  const genOut = new Map<number, number>();
  const add = (busId: number, mw: number) => genOut.set(busId, (genOut.get(busId) ?? 0) + mw);
  let remaining = served;
  const renewUse = Math.min(renewAvail, remaining);
  const renewScale = renewAvail > 0 ? renewUse / renewAvail : 0;
  for (const g of gens) if (!g.dispatchable) add(g.busId, g.capacity * g.availability * renewScale);
  remaining -= renewUse;
  for (const g of gens) {
    if (!g.dispatchable) continue;
    const give = Math.max(0, Math.min(remaining, g.capacity));
    add(g.busId, give);
    remaining -= give;
  }
  for (const b of bats) {
    if (b.soc <= 1) continue;
    const give = Math.max(0, Math.min(remaining, b.powerRating));
    add(b.busId, give);
    remaining -= give;
  }

  const ratio = demand > 0 ? served / demand : 1;
  const inj = new Map<number, number>();
  for (const id of busIds) inj.set(id, genOut.get(id) ?? 0);
  for (const l of loads) inj.set(l.busId, (inj.get(l.busId) ?? 0) - l.demand * ratio);

  const lines = [...grid.lines.values()].filter((ln) => isActive(ln) && set.has(ln.from) && set.has(ln.to));
  const { flows } = solveDC(busIds, lines, inj);

  const overloads: Violation[] = [];
  const subTp = new Map<number, number>();
  for (const ln of lines) {
    const f = flows.get(ln.id) ?? 0;
    if (Math.abs(f) > ln.capacity + EPS) {
      overloads.push({ name: lineName(grid, ln), loadingPct: (Math.abs(f) / ln.capacity) * 100 });
    }
    if (ln.voltage === 'MV') {
      const sub = grid.substationOf(ln);
      if (sub) subTp.set(sub.id, (subTp.get(sub.id) ?? 0) + Math.abs(f));
    }
  }
  for (const [subId, tp] of subTp) {
    const sub = grid.buses.get(subId);
    if (sub?.rating && tp > sub.rating + EPS) {
      overloads.push({ name: `${sub.name} 变压器`, loadingPct: (tp / sub.rating) * 100 });
    }
  }
  return { lostLoad, overloads };
}

function lineName(grid: Grid, ln: Line): string {
  const a = grid.buses.get(ln.from)?.name ?? '?';
  const b = grid.buses.get(ln.to)?.name ?? '?';
  return `${a}–${b}`;
}

/** 在给定在运判据下评估整张网（所有孤岛汇总） */
function evalAll(grid: Grid, isActive: (ln: Line) => boolean): { lostLoad: number; overloads: Violation[] } {
  let lostLoad = 0;
  const overloads: Violation[] = [];
  for (const busIds of grid.islands(isActive)) {
    const r = evalIsland(grid, busIds, isActive);
    lostLoad += r.lostLoad;
    for (const o of r.overloads) overloads.push(o);
  }
  return { lostLoad, overloads };
}

/** 对当前电网做 N-1 校核 */
export function analyzeN1(grid: Grid): N1Report {
  const liveLines = [...grid.lines.values()].filter((ln) => grid.lineActive(ln));
  const contingencies: Contingency[] = [];
  const vulnerableLineIds = new Set<number>();
  const vulnerableSubIds = new Set<number>();
  let checked = 0;

  // ① 每条在运线路单独停运
  for (const ln of liveLines) {
    checked++;
    const isActive = (l: Line) => grid.lineActive(l) && l.id !== ln.id;
    const r = evalAll(grid, isActive);
    if (r.lostLoad > EPS || r.overloads.length) {
      contingencies.push({ kind: 'line', id: ln.id, name: lineName(grid, ln), lostLoadMW: r.lostLoad, overloads: r.overloads, secure: false });
      vulnerableLineIds.add(ln.id);
    }
  }

  // ② 每台在运变压器单独停运（停运 = 切除其全部 MV 配电线）
  const subs = [...grid.buses.values()].filter(
    (b) => b.kind === 'substation' && b.rating && !b.transformerTripped &&
      liveLines.some((l) => l.voltage === 'MV' && grid.substationOf(l)?.id === b.id),
  );
  for (const sub of subs) {
    checked++;
    const downIds = new Set(liveLines.filter((l) => l.voltage === 'MV' && grid.substationOf(l)?.id === sub.id).map((l) => l.id));
    const isActive = (l: Line) => grid.lineActive(l) && !downIds.has(l.id);
    const r = evalAll(grid, isActive);
    if (r.lostLoad > EPS || r.overloads.length) {
      contingencies.push({ kind: 'transformer', id: sub.id, name: `${sub.name} 变压器`, lostLoadMW: r.lostLoad, overloads: r.overloads, secure: false });
      vulnerableSubIds.add(sub.id);
    }
  }

  return {
    secure: contingencies.length === 0 && checked > 0,
    checked,
    contingencies,
    vulnerableLineIds,
    vulnerableSubIds,
  };
}
