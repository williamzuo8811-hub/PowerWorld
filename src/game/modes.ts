// 变体玩法模式：在任意战役关卡之上叠加的全局修正，由元进度等级解锁（见 meta.ts）。
// 模式在关卡 setup() 之后应用——所以可以缩放关卡设定的资金/目标。
import type { Simulation } from '../sim/simulation';

export type ModeId = 'standard' | 'hard' | 'speedrun' | 'noloan' | 'ironman';

export interface ModeSpec {
  id: ModeId;
  name: string;
  icon: string;
  desc: string;
  unlockLevel: number; // 全局等级达此值解锁
  apply(sim: Simulation): void;
}

export const MODES: ModeSpec[] = [
  {
    id: 'standard', name: '标准', icon: '▶', unlockLevel: 1,
    desc: '关卡原始难度。',
    apply() { /* 无修正 */ },
  },
  {
    id: 'hard', name: '困难', icon: '🔥', unlockLevel: 2,
    desc: '资金 −25% · 对手装机 +30% · 天气事件 +50% 频率 · 碳价 ×1.2。',
    apply(sim) {
      sim.money = Math.round(sim.money * 0.75);
      for (const c of sim.competitors) { c.base *= 1.3; c.capacity = c.base; }
      sim.events.intensity *= 1.5;
      sim.events.schedule(sim.clock);
      sim.carbonPriceMult *= 1.2;
    },
  },
  {
    id: 'speedrun', name: '竞速 7 天', icon: '⏱', unlockLevel: 3,
    desc: '通关日压缩到 7 天内——开局多 15% 资金，但没有慢慢攒钱的余地。',
    apply(sim) {
      if (Number.isFinite(sim.goalDay)) sim.goalDay = Math.min(sim.goalDay, 7);
      sim.money = Math.round(sim.money * 1.15);
    },
  },
  {
    id: 'noloan', name: '无贷款', icon: '🏦', unlockLevel: 4,
    desc: '全程禁止贷款——只有经营现金流，没有杠杆兜底。',
    apply(sim) {
      sim.loanBan = true;
    },
  },
  {
    id: 'ironman', name: '极限 · 开局负债', icon: '☠', unlockLevel: 5,
    desc: '开局背 ¥400,000 贷款（每日计息）且资金 −15%。先活下来，再谈赢。',
    apply(sim) {
      sim.debt += 400_000;
      sim.money = Math.round(sim.money * 0.85);
    },
  },
];

export function modeById(id: ModeId): ModeSpec {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}

/** 模式是否适用于该关卡（教程/沙盒/进阶教程不叠模式） */
export function modeApplicable(scenarioId: string): boolean {
  return !/^(tutorial|sandbox|tut)/.test(scenarioId);
}
