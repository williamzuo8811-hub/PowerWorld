// 客户域（从 simulation.ts 拆分）：招商竞争力/限时机会/反向挖角/长约/自备应急电源。
// 全部为操作 Simulation 状态的纯函数；Simulation 保留同名薄委托，外部 API 不变。
import type { Simulation } from './simulation';
import type { LoadProfile } from './types';
import {
  KEY_ACCOUNTS, ACQ_STANDING_MIN, ACQ_FACTOR_BASE, ACQ_FACTOR_SPAN, ACQ_FACTOR_MIN, ACQ_FACTOR_MAX,
  ACQ_COMP_K, ACQ_COMP_MAX, LEAD_INTERVAL_DAYS, LEAD_WINDOW_DAYS, LEAD_DISCOUNT,
  POACH_WIN_STANDING, POACH_WIN_CHANCE, POACH_WIN_MIN_COMP, POACH_WIN_FRACTION,
  COMPETITOR_CAP_MIN_FRAC, COMPETITOR_CAP_MAX_FRAC, COMP_LEAD_SNATCH_CHANCE, COMP_LEAD_SNATCH_FRACTION,
  CONTRACT_DAYS, CONTRACT_DISCOUNT, BACKUP_CAPEX, BACKUP_FRACTION,
} from '../config/components';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 与大客户签订长约：合约期内不被挖角，但电价折让；返回是否成功 */
export function signKeyAccountContractOf(sim: Simulation, busId: number, days: number = CONTRACT_DAYS): boolean {
  const bus = sim.grid.buses.get(busId);
  if (!bus || bus.kind !== 'load' || bus.underConstruction) return false;
  const l = sim.grid.loadsAtBus(busId)[0];
  if (!l || !KEY_ACCOUNTS[l.profile]) return false; // 仅大客户
  if (l.contractEndClock && sim.clock < l.contractEndClock) return false; // 已有有效长约
  l.contractEndClock = sim.clock + days * 24;
  sim.log('good', `📜 与「${bus.name}」签订 ${days} 天长约：锁定忠诚（不被挖角），电价折让 ${(CONTRACT_DISCOUNT * 100).toFixed(0)}%`);
  return true;
}

/** 给大客户加装自备应急电源（UPS/柴发）：停电时兜底部分负荷，护住满意度、防流失 */
export function addBackupOf(sim: Simulation, busId: number): boolean {
  const bus = sim.grid.buses.get(busId);
  if (!bus || bus.kind !== 'load' || bus.underConstruction) return false;
  const l = sim.grid.loadsAtBus(busId)[0];
  if (!l || l.backup || !KEY_ACCOUNTS[l.profile]) return false; // 仅大客户、未加装
  if (sim.money < BACKUP_CAPEX) return false;
  sim.money -= BACKUP_CAPEX;
  l.backup = true;
  sim.log('good', `🔋 ${bus.name} 加装自备应急电源（¥${BACKUP_CAPEX.toLocaleString('en-US')}）：停电时兜底 ${(BACKUP_FRACTION * 100).toFixed(0)}% 负荷`);
  return true;
}

/** 公司招商竞争力 0..1：口碑 + 可靠性 + 大客户满意度的综合（决定赢得大客户的能力/代价） */
export function companyStandingOf(sim: Simulation): number {
  return clamp(0.4 * (sim.reputation / 100) + 0.35 * clamp(sim.reliability, 0, 1) + 0.25 * clamp(sim.customerSatisfaction, 0, 1), 0, 1);
}

/** 市场招商激烈度 0..1：你在区域装机中份额越低，竞争对手抢客越激烈 */
export function marketContestationOf(sim: Simulation): number {
  return clamp(1 - sim.playerNameplate / Math.max(sim.regionNameplate, 1), 0, 1);
}

/** 招商赢得某大客户所需的接入代价；竞争力越高越便宜、竞争越激烈越贵；过低则被拒(返回 -1) */
export function keyAccountAcquireCostOf(sim: Simulation, profile: LoadProfile): number {
  const spec = KEY_ACCOUNTS[profile];
  if (!spec) return -1;
  if (sim.companyStanding < ACQ_STANDING_MIN) return -1; // 大客户拒绝入驻
  const factor = clamp(ACQ_FACTOR_BASE - sim.companyStanding * ACQ_FACTOR_SPAN, ACQ_FACTOR_MIN, ACQ_FACTOR_MAX);
  const compFactor = clamp(1 + ACQ_COMP_K * sim.marketContestation, 1, ACQ_COMP_MAX);
  const leadDiscount = sim.keyAccountLeadActive(profile) ? LEAD_DISCOUNT : 1; // 限时招商机会折扣
  return Math.round(spec.connectionCapex * factor * compFactor * leadDiscount);
}

/** 当前是否有针对该品类的限时招商机会 */
export function keyAccountLeadActiveOf(sim: Simulation, profile: LoadProfile): boolean {
  return !!sim.keyAccountLead && sim.keyAccountLead.profile === profile && sim.clock < sim.keyAccountLead.endClock;
}

/** 大客户接入成功后调用：消费当前匹配机会；若为竞品客户则削弱最强对手（反向挖角） */
export function onKeyAccountAcquiredOf(sim: Simulation, profile: LoadProfile): void {
  const lead = sim.keyAccountLead;
  if (!lead || lead.profile !== profile || sim.clock >= lead.endClock) return;
  if (lead.poach && sim.competitors.length > 0) {
    const top = sim.competitors.reduce((a, b) => (b.capacity > a.capacity ? b : a));
    const shrink = (KEY_ACCOUNTS[profile]?.baseDemand ?? 0) * POACH_WIN_FRACTION;
    top.capacity = Math.max(top.base * COMPETITOR_CAP_MIN_FRAC, top.capacity - shrink);
    sim.log('good', `🏆 从对手「${top.name}」赢得${KEY_ACCOUNTS[profile].label}！对手容量 −${shrink.toFixed(0)}MW`);
  }
  sim.keyAccountLead = null; // 机会已用掉
}

/** 限时招商机会调度：到点出现、过期清除（过期未签的选址客户可能被最强对手抢走） */
export function checkKeyAccountLeadOf(sim: Simulation): void {
  if (sim.keyAccountLead && sim.clock >= sim.keyAccountLead.endClock) {
    const lead = sim.keyAccountLead;
    sim.keyAccountLead = null;
    if (!lead.poach && sim.competitors.length > 0 && Math.random() < COMP_LEAD_SNATCH_CHANCE) {
      const top = sim.competitors.reduce((a, b) => (b.capacity > a.capacity ? b : a));
      const spec = KEY_ACCOUNTS[lead.profile];
      if (spec) {
        top.capacity = Math.min(top.base * COMPETITOR_CAP_MAX_FRAC, top.capacity + spec.baseDemand * COMP_LEAD_SNATCH_FRACTION);
        sim.log('warn', `🏷 ${spec.icon}${spec.label}选址花落对手「${top.name}」（窗口期未签约），对手容量 +${(spec.baseDemand * COMP_LEAD_SNATCH_FRACTION).toFixed(0)}MW`);
      }
    }
  }
  if (sim.clock >= sim.nextLeadAt) {
    const profiles: LoadProfile[] = ['datacenter', 'transport', 'petrochem', 'mining'];
    const p = profiles[Math.floor(Math.random() * profiles.length)];
    // 反向挖角：竞争力高且有较强对手时，机会可能是"竞品客户"（接入即从对手赢得）
    const topComp = sim.competitors.length ? Math.max(...sim.competitors.map((c) => c.capacity)) : 0;
    const poach = sim.companyStanding > POACH_WIN_STANDING && topComp > POACH_WIN_MIN_COMP && Math.random() < POACH_WIN_CHANCE;
    sim.keyAccountLead = { profile: p, endClock: sim.clock + LEAD_WINDOW_DAYS * 24, poach };
    // 竞争力越高，招商机会越频繁（奖励优质运营商）
    const intervalFactor = clamp(1.6 - sim.companyStanding, 0.7, 1.6);
    sim.nextLeadAt = sim.clock + LEAD_INTERVAL_DAYS * 24 * intervalFactor + Math.random() * 48;
    const spec = KEY_ACCOUNTS[p];
    sim.log('good', poach
      ? `🎯 竞品客户机会：${spec.icon}${spec.label}对现服务商不满，${LEAD_WINDOW_DAYS}天内接入可从对手赢得（并削弱对手）！`
      : `🎯 招商机会：${spec.icon}${spec.label}正在选址，${LEAD_WINDOW_DAYS}天内接入享 ${(LEAD_DISCOUNT * 10).toFixed(0)}折接入费！`);
  }
}
