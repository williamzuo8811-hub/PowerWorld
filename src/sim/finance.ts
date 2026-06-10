// 财务域（从 simulation.ts 拆分）：资产估值/信用评级/ESG/利率/保险/套保/期权/FTR/远期容量/借还款。
// 全部为操作 Simulation 状态的纯函数；Simulation 保留同名薄委托，外部 API 不变。
import type { Simulation } from './simulation';
import {
  PLANTS, STORAGE, SUBSTATION_CAPEX, VOLTAGE,
  LOAN_BASE_CREDIT, LOAN_CREDIT_ASSET_FRAC, LOAN_BASE_DAILY_RATE, RATING_RATE_SPAN,
  RATING_REF_NETWORTH, RATING_REF_PROFIT, ESG_RATE_DISCOUNT,
  INSURANCE_RATE_PER_DAY, INSURANCE_COVERAGE, HEDGE_FEE_PER_MW_DAY, OPTION_PREMIUM_RATE,
  FTR_MARKUP, FORWARD_CAP_PREMIUM,
} from '../config/components';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 已建资产的账面价值（按 capex 估值），用于净资产与信用额度 */
export function assetValueOf(sim: Simulation): number {
  let v = 0;
  for (const g of sim.grid.gens.values()) v += PLANTS[g.type].capex;
  for (const b of sim.grid.batteries.values()) v += STORAGE[b.type].capex;
  for (const bus of sim.grid.buses.values()) if (bus.kind === 'substation') v += SUBSTATION_CAPEX;
  for (const ln of sim.grid.lines.values()) v += ln.length * VOLTAGE[ln.voltage].costPerTile;
  return v;
}

/** 杠杆率（以资产+基础额度为基数，避免与信用额度循环依赖） */
export function leverageOf(sim: Simulation): number {
  return sim.debt / Math.max(sim.assetValue + LOAN_BASE_CREDIT, 1);
}

/** 信用评分 0..100：净资产/杠杆/可靠性/盈利综合 */
export function creditScoreOf(sim: Simulation): number {
  const leverageScore = 1 - clamp(sim.leverage, 0, 1);
  const netWorthScore = clamp(0.5 + sim.netWorth / (2 * RATING_REF_NETWORTH), 0, 1);
  const reliabScore = clamp(sim.reliability, 0, 1);
  const profitScore = clamp(0.5 + sim.finance.net / (2 * RATING_REF_PROFIT), 0, 1);
  return (0.3 * leverageScore + 0.3 * netWorthScore + 0.2 * reliabScore + 0.2 * profitScore) * 100;
}

/** 信用评级字母 */
export function creditRatingOf(sim: Simulation): string {
  const s = sim.creditScore;
  if (s >= 90) return 'AAA';
  if (s >= 80) return 'AA';
  if (s >= 70) return 'A';
  if (s >= 60) return 'BBB';
  if (s >= 50) return 'BB';
  if (s >= 40) return 'B';
  if (s >= 25) return 'CCC';
  return 'D';
}

/** 信用额度 = (基础额度 + 资产抵押) × 评级系数(0.5~1.5) × 信贷环境（紧缩时压缩） */
export function creditLimitOf(sim: Simulation): number {
  return (LOAN_BASE_CREDIT + sim.assetValue * LOAN_CREDIT_ASSET_FRAC) * (0.5 + sim.creditScore / 100) * sim.policy.creditLimitFactor;
}

export function debtRatioOf(sim: Simulation): number {
  return sim.creditLimit > 0 ? sim.debt / sim.creditLimit : 0;
}

/** ESG 评分 0..100（环境/社会/治理三维平均） */
export function esgScoreOf(sim: Simulation): number {
  const intensity = sim.co2Rate / Math.max(sim.totalServed, 1);
  const e = clamp(sim.renewableShare * 0.6 + (1 - clamp(intensity / 0.9, 0, 1)) * 0.4, 0, 1); // 环境
  const s = clamp(sim.reliability * 0.5 + (sim.reputation / 100) * 0.5, 0, 1); // 社会
  const gov = clamp(sim.creditScore / 100, 0, 1); // 治理
  return ((e + s + gov) / 3) * 100;
}

/** ESG 评级字母 */
export function esgRatingOf(sim: Simulation): string {
  const s = sim.esgScore;
  if (s >= 85) return 'A+';
  if (s >= 70) return 'A';
  if (s >= 55) return 'B';
  if (s >= 40) return 'C';
  return 'D';
}

/** 日利率：基础 + 评级风险溢价 + 政策加息/紧缩 − ESG 绿色折扣 − 风险管理科技折扣 */
export function loanDailyRateOf(sim: Simulation): number {
  const base = LOAN_BASE_DAILY_RATE + (1 - sim.creditScore / 100) * RATING_RATE_SPAN + sim.policy.loanRateAdder;
  return Math.max(0.001, base - (sim.esgScore / 100) * ESG_RATE_DISCOUNT - sim.tech.loanRateDiscount);
}

/** 净资产 = 现金 + 资产 − 负债 */
export function netWorthOf(sim: Simulation): number {
  return sim.money + sim.assetValue - sim.debt;
}

/** 当前日保费（已投保时）；风险管理体系科技打折 */
export function insurancePremiumOf(sim: Simulation): number {
  return sim.insured ? sim.assetValue * INSURANCE_RATE_PER_DAY * sim.tech.insuranceFactor : 0;
}

/** 发生一次意外损失：已投保则保险覆盖大部分，玩家只付自付额 */
export function applyDamage(sim: Simulation, gross: number, label: string): void {
  const covered = sim.insured ? gross * INSURANCE_COVERAGE : 0;
  const net = gross - covered;
  sim.money -= net;
  sim.claimCoveredTick += covered;
  sim.log('bad', `💥 ${label} ¥${Math.round(gross).toLocaleString('en-US')}${covered > 0 ? `（保险赔付 ¥${Math.round(covered).toLocaleString('en-US')}，自付 ¥${Math.round(net).toLocaleString('en-US')}）` : ''}`);
}

/** 签订一笔远期套保合约：锁定 volume MW × days 天，锁价 = 当前远期报价(avgSpot)；收手续费 */
export function addHedgeTo(sim: Simulation, volume: number, days: number): boolean {
  if (volume <= 0 || days <= 0) return false;
  const fee = volume * days * HEDGE_FEE_PER_MW_DAY * sim.tech.hedgeFeeFactor;
  if (sim.money < fee) return false;
  sim.money -= fee;
  const strike = Math.round(sim.avgSpot);
  sim.hedges.push({ volume, strike, endClock: sim.clock + days * 24 });
  sim.log('info', `🔒 套保 ${volume}MW × ${days}天 @ ¥${strike}/MWh（手续费 ¥${Math.round(fee).toLocaleString('en-US')}）`);
  return true;
}

/** 买入电力期权：行权价=当前远期报价(avgSpot)，按量×天收权利金 */
export function addOptionTo(sim: Simulation, kind: 'put' | 'call', volume: number, days: number): boolean {
  if (volume <= 0 || days <= 0) return false;
  const premium = volume * days * OPTION_PREMIUM_RATE * sim.tech.optionPremiumFactor;
  if (sim.money < premium) return false;
  sim.money -= premium;
  const strike = Math.round(sim.avgSpot);
  sim.options.push({ kind, volume, strike, endClock: sim.clock + days * 24 });
  sim.log('info', `🎟 ${kind === 'put' ? '看跌(保底)' : '看涨(封顶)'}期权 ${volume}MW × ${days}天 @ ¥${strike}（权利金 ¥${Math.round(premium).toLocaleString('en-US')}）`);
  return true;
}

/** 买入输电权(FTR)：付当前价差×溢价的权利金，期内收取实际南北价差 */
export function addFTRTo(sim: Simulation, mw: number, days: number): boolean {
  if (mw <= 0 || days <= 0) return false;
  const premium = Math.round(sim.zoneSpread * mw * days * 24 * FTR_MARKUP);
  if (sim.money < premium) return false;
  sim.money -= premium;
  sim.ftrs.push({ mw, endClock: sim.clock + days * 24 });
  sim.log('info', `🔗 输电权 ${mw}MW × ${days}天（权利金 ¥${premium.toLocaleString('en-US')}），收取南北价差`);
  return true;
}

/** 承诺远期容量：锁定容量价×溢价 days 天（差价合约 + 交付义务） */
export function addCapacityCommitmentTo(sim: Simulation, mw: number, days: number): boolean {
  if (mw <= 0 || days <= 0) return false;
  sim.capCommitments.push({ mw, price: sim.capacityPrice * FORWARD_CAP_PREMIUM, endClock: sim.clock + days * 24 });
  sim.log('info', `📜 远期容量 ${mw}MW × ${days}天 @ ¥${(sim.capacityPrice * FORWARD_CAP_PREMIUM).toFixed(1)}/MW·天（须交付，否则罚款）`);
  return true;
}

/** 借款（受信用额度约束），成功返回 true */
export function borrowFor(sim: Simulation, amount: number): boolean {
  if (amount <= 0 || sim.debt + amount > sim.creditLimit) return false;
  sim.debt += amount;
  sim.money += amount;
  sim.log('info', `🏦 借入 ¥${Math.round(amount).toLocaleString('en-US')}（负债 ¥${Math.round(sim.debt).toLocaleString('en-US')}）`);
  return true;
}

/** 还款（不超过负债与现金），返回实际还款额 */
export function repayFor(sim: Simulation, amount: number): number {
  const x = Math.max(0, Math.min(amount, sim.debt, sim.money));
  if (x <= 0) return 0;
  sim.debt -= x;
  sim.money -= x;
  sim.log('info', `🏦 还款 ¥${Math.round(x).toLocaleString('en-US')}（负债 ¥${Math.round(sim.debt).toLocaleString('en-US')}）`);
  return x;
}
