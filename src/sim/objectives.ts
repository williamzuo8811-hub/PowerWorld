// 关卡附加目标机制：让胜利条件不再只有"撑 X 天 + 可靠性 ≥Y%"。
// 目标是纯数据（可序列化进存档、可被自定义关卡 JSON 定义），评估是纯函数。
//
// 两类语义：
//   deadline 型（byDay）——到期未达成 = 立即判负（剧本压力，如"第 8 天前必须签下数据中心"）；
//   atWin 型——作为通关的额外门槛（到达通关日时一并校验，如"通关时清洁占比 ≥60%"）。
import type { Simulation } from './simulation';
import type { LoadProfile } from './types';
import { KEY_ACCOUNTS } from '../config/components';

export type ObjectiveSpec =
  | { kind: 'keyAccountByDay'; profile: LoadProfile; byDay: number } // 第 N 天前签下某类大客户（deadline）
  | { kind: 'n1ByDay'; byDay: number } // 第 N 天前通过 N-1 校核（deadline）
  | { kind: 'cleanShareAtWin'; share: number } // 通关时清洁占比 ≥（atWin）
  | { kind: 'netWorthAtWin'; amount: number } // 通关时净资产 ≥（atWin）
  | { kind: 'reputationAtWin'; min: number }; // 通关时口碑 ≥（atWin）

export interface ObjectiveStatus {
  spec: ObjectiveSpec;
  label: string; // 给 HUD/日志的人话描述
  done: boolean; // 已达成
  failed: boolean; // deadline 型：已过期未达成（判负）
  progress: string; // 进度短文本
}

/** 某目标当前是否已达成 */
export function objectiveDone(sim: Simulation, o: ObjectiveSpec): boolean {
  switch (o.kind) {
    case 'keyAccountByDay': {
      for (const l of sim.grid.loads.values()) {
        if (l.profile === o.profile && !sim.grid.buses.get(l.busId)?.underConstruction) return true;
      }
      return false;
    }
    case 'n1ByDay':
      return sim.n1Secure;
    case 'cleanShareAtWin':
      return sim.renewableShare >= o.share;
    case 'netWorthAtWin':
      return sim.netWorth >= o.amount;
    case 'reputationAtWin':
      return sim.reputation >= o.min;
  }
}

/** 目标的人话描述 */
export function objectiveLabel(o: ObjectiveSpec): string {
  switch (o.kind) {
    case 'keyAccountByDay':
      return `第 ${o.byDay} 天前签下「${KEY_ACCOUNTS[o.profile]?.label ?? o.profile}」`;
    case 'n1ByDay':
      return `第 ${o.byDay} 天前通过 N-1 冗余校核`;
    case 'cleanShareAtWin':
      return `通关时清洁占比 ≥ ${(o.share * 100).toFixed(0)}%`;
    case 'netWorthAtWin':
      return `通关时净资产 ≥ ¥${o.amount.toLocaleString('en-US')}`;
    case 'reputationAtWin':
      return `通关时口碑 ≥ ${o.min}`;
  }
}

/** deadline 型目标的截止天；atWin 型返回 null */
export function objectiveDeadline(o: ObjectiveSpec): number | null {
  return 'byDay' in o ? o.byDay : null;
}

/** 评估全部目标的状态（HUD 目标追踪/结束判定共用） */
export function evaluateObjectives(sim: Simulation): ObjectiveStatus[] {
  return sim.objectives.map((o) => {
    const done = objectiveDone(sim, o);
    const deadline = objectiveDeadline(o);
    const failed = !done && deadline != null && sim.day >= deadline;
    let progress: string;
    if (done) progress = '✅';
    else if (deadline != null) progress = `剩 ${Math.max(0, deadline - sim.day)} 天`;
    else if (o.kind === 'cleanShareAtWin') progress = `${(sim.renewableShare * 100).toFixed(0)}/${(o.share * 100).toFixed(0)}%`;
    else if (o.kind === 'netWorthAtWin') progress = `${Math.round((sim.netWorth / o.amount) * 100)}%`;
    else if (o.kind === 'reputationAtWin') progress = `${sim.reputation.toFixed(0)}/${o.min}`;
    else progress = '…';
    return { spec: o, label: objectiveLabel(o), done, failed, progress };
  });
}

/** 校验目标数据是否合法（自定义关卡导入用）；合法返回 null，否则返回错误描述 */
export function validateObjective(o: unknown): string | null {
  const v = o as Partial<ObjectiveSpec> & Record<string, unknown>;
  if (!v || typeof v !== 'object' || typeof v.kind !== 'string') return '目标缺少 kind';
  switch (v.kind) {
    case 'keyAccountByDay':
      if (!v.profile || !KEY_ACCOUNTS[v.profile as string]) return 'keyAccountByDay 的 profile 非法';
      if (typeof v.byDay !== 'number' || v.byDay <= 0) return 'keyAccountByDay 的 byDay 非法';
      return null;
    case 'n1ByDay':
      if (typeof v.byDay !== 'number' || v.byDay <= 0) return 'n1ByDay 的 byDay 非法';
      return null;
    case 'cleanShareAtWin':
      if (typeof v.share !== 'number' || v.share <= 0 || v.share > 1) return 'cleanShareAtWin 的 share 非法';
      return null;
    case 'netWorthAtWin':
      if (typeof v.amount !== 'number' || v.amount <= 0) return 'netWorthAtWin 的 amount 非法';
      return null;
    case 'reputationAtWin':
      if (typeof v.min !== 'number' || v.min <= 0 || v.min > 100) return 'reputationAtWin 的 min 非法';
      return null;
    default:
      return `未知目标类型：${v.kind}`;
  }
}
