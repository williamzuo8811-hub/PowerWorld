// 政策与剧情事件：监管/宏观层面的外生冲击，与天气事件互补。
// 事件提前 24 小时公示（"政策动向"），给玩家留出调仓窗口——奖励关注新闻的规划型玩家。
import type { Simulation } from './simulation';
import {
  POLICY_FIRST_DAY, POLICY_INTERVAL_DAYS, POLICY_ANNOUNCE_HOURS, POLICY_FX,
} from '../config/components';

export type PolicyKind = 'subsidy' | 'inspection' | 'rateHike' | 'creditCrunch' | 'neighborShortage' | 'boom';

export const POLICY_LABEL: Record<PolicyKind, string> = {
  subsidy: '🌱 绿色补贴窗口',
  inspection: '🏛 环保督查',
  rateHike: '🏦 加息周期',
  creditCrunch: '🏦 信贷紧缩',
  neighborShortage: '🔌 邻区电力短缺',
  boom: '📈 区域经济火热',
};

const ANNOUNCE_TEXT: Record<PolicyKind, string> = {
  subsidy: '议会正在审议绿色补贴加码法案——绿证价格将大幅上调，可提前布局新能源',
  inspection: '环保督查组即将进驻——燃煤机组将被限产、碳价临时上浮，备好替代电源',
  rateHike: '央行释放加息信号——贷款利率即将上调，高杠杆请提前减债',
  creditCrunch: '银根收紧迹象明显——信用额度将被压缩、利率上浮，现金流吃紧者注意',
  neighborShortage: '邻区电网预告检修缺口——外送电价将走高、进口容量受限，自备充足电源者有利可图',
  boom: '区域招商引资成果丰硕——用电需求即将上扬，电价与市场容量看涨',
};

interface ActivePolicy {
  kind: PolicyKind;
  endClock: number;
}

interface PendingPolicy {
  kind: PolicyKind;
  at: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class PolicyState {
  current: ActivePolicy | null = null;
  pending: PendingPolicy | null = null;
  nextAt = POLICY_FIRST_DAY * 24;
  announced = false;

  has(kind: PolicyKind): boolean {
    return !!this.current && this.current.kind === kind;
  }

  /** HUD 标签：进行中的政策（含剩余时间），无则 null */
  label(clock: number): string | null {
    if (!this.current) return null;
    const left = Math.max(0, this.current.endClock - clock) / 24;
    return `${POLICY_LABEL[this.current.kind]} 剩${left.toFixed(1)}天`;
  }

  // —— 效果系数（无政策时全为中性值）——
  get recMult(): number { return this.has('subsidy') ? POLICY_FX.subsidyRecMult : 1; }
  get carbonMult(): number { return this.has('inspection') ? POLICY_FX.inspectionCarbonMult : 1; }
  get coalCap(): number { return this.has('inspection') ? POLICY_FX.inspectionCoalCap : 1; }
  get loanRateAdder(): number {
    if (this.has('rateHike')) return POLICY_FX.rateHikeAdder;
    if (this.has('creditCrunch')) return POLICY_FX.crunchRateAdder;
    return 0;
  }
  get creditLimitFactor(): number { return this.has('creditCrunch') ? POLICY_FX.crunchCreditFactor : 1; }
  get exportPriceMult(): number { return this.has('neighborShortage') ? POLICY_FX.shortageExportMult : 1; }
  get importCapFactor(): number { return this.has('neighborShortage') ? POLICY_FX.shortageImportCapFactor : 1; }
  get regionalDemandMult(): number { return this.has('boom') ? POLICY_FX.boomDemandMult : 1; }

  /** 按当前局面掷出下一个政策：高杠杆显著提高信贷紧缩概率（杠杆的隐性风险） */
  private roll(sim: Simulation): PolicyKind {
    const weights: [PolicyKind, number][] = [
      ['subsidy', 1.2],
      ['inspection', 1.0],
      ['rateHike', 0.9],
      ['creditCrunch', 0.5 + (sim.debtRatio > 0.7 ? 1.6 : sim.debtRatio > 0.45 ? 0.7 : 0)],
      ['neighborShortage', 0.9],
      ['boom', 1.1],
    ];
    const total = weights.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [k, w] of weights) { r -= w; if (r <= 0) return k; }
    return 'subsidy';
  }

  update(sim: Simulation): void {
    const t = sim.clock;
    // 到期失效
    if (this.current && t >= this.current.endClock) {
      sim.log('info', `${POLICY_LABEL[this.current.kind]}结束，市场恢复常态。`);
      this.current = null;
    }
    // 安排下一个政策（提前 24h 公示）
    if (!this.pending && !this.current && t >= this.nextAt - POLICY_ANNOUNCE_HOURS) {
      this.pending = { kind: this.roll(sim), at: this.nextAt };
      this.announced = false;
    }
    if (this.pending && !this.announced) {
      sim.log('warn', `📜 政策动向：${ANNOUNCE_TEXT[this.pending.kind]}（约 ${Math.max(0, (this.pending.at - t)).toFixed(0)} 小时后生效）`);
      this.announced = true;
    }
    // 生效
    if (this.pending && t >= this.pending.at) {
      const kind = this.pending.kind;
      const days = rnd(POLICY_FX.minDays, POLICY_FX.maxDays);
      this.current = { kind, endClock: t + days * 24 };
      this.pending = null;
      this.nextAt = t + POLICY_INTERVAL_DAYS * 24 * rnd(0.8, 1.4);
      sim.log('bad', `${POLICY_LABEL[kind]}生效！（持续约 ${days.toFixed(1)} 天）`);
      if (kind === 'creditCrunch' && sim.debt > sim.creditLimit) {
        sim.log('warn', `⚠ 信用额度被压缩至 ¥${Math.round(sim.creditLimit).toLocaleString('en-US')}，当前负债已超限——利率将高企，尽快还款`);
      }
    }
  }
}
