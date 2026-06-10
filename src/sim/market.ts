// 市场域（从 simulation.ts 拆分）：区域需求/竞价出清/竞争对手演化/并购与反垄断/跨区价差/联络线。
// 全部为操作 Simulation 状态的纯函数；Simulation 保留同名薄委托，外部 API 不变。
import type { Simulation } from './simulation';
import { demandMultiplier } from './profiles';
import {
  REGIONAL_BASE_DEMAND, INTERCONNECTOR_CAPACITY, ACQUISITION_PRICE_PER_MW,
  ANTITRUST_SOFT_SHARE, ANTITRUST_HARD_SHARE, ANTITRUST_PREMIUM_K,
  COMPETITOR_EXPAND_RATE, COMPETITOR_RETIRE_RATE, COMPETITOR_EXPAND_MARGIN,
  COMPETITOR_CAP_MIN_FRAC, COMPETITOR_CAP_MAX_FRAC,
  COMP_GREEN_EXPAND_MULT, COMP_GREEN_RETIRE_MULT, COMP_PEAKER_WAR_SHARE, COMP_PEAKER_WAR_FLOOR, COMP_PEAKER_ADJUST_RATE,
  ZONE_PERIOD_DAYS, ZONE_NORTH_OFFSET, ZONE_NORTH_AMP, ZONE_SOUTH_OFFSET, ZONE_SOUTH_AMP, SPOT,
} from '../config/components';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 北区(便宜)电价 */
export function zoneNorthPriceOf(sim: Simulation): number {
  const s = Math.sin((2 * Math.PI * sim.clock) / (ZONE_PERIOD_DAYS * 24));
  return clamp(sim.marketClearingPrice + ZONE_NORTH_OFFSET + ZONE_NORTH_AMP * s, SPOT.floor, SPOT.cap);
}

/** 南区(贵)电价 */
export function zoneSouthPriceOf(sim: Simulation): number {
  const s = Math.sin((2 * Math.PI * sim.clock) / (ZONE_PERIOD_DAYS * 24) + 2);
  return clamp(sim.marketClearingPrice + ZONE_SOUTH_OFFSET + ZONE_SOUTH_AMP * s, SPOT.floor, SPOT.cap);
}

/** 跨区价差 */
export function zoneSpreadOf(sim: Simulation): number {
  return Math.abs(sim.zoneSouthPrice - sim.zoneNorthPrice);
}

/** 区域市场总需求 (MW)：日曲线 × 景气 × 季节 */
export function regionalDemandOf(sim: Simulation): number {
  const m = (demandMultiplier(sim.hourOfDay, 'residential')
    + demandMultiplier(sim.hourOfDay, 'commercial')
    + demandMultiplier(sim.hourOfDay, 'industrial')) / 3;
  return REGIONAL_BASE_DEMAND * m * sim.cycleFactor * sim.seasonDemandFactor * sim.policy.regionalDemandMult;
}

/** 联络线有效进口容量：邻区短缺时被压缩 */
export function effImportCapacityOf(sim: Simulation): number {
  return INTERCONNECTOR_CAPACITY * sim.policy.importCapFactor;
}

/** 区域市场出清：你与竞争对手按报价排序，对区域需求出清 */
export function clearMarket(sim: Simulation): { clearingCost: number; playerDispatched: number; shortfall: number } {
  const demand = sim.regionalDemand;
  const blocks: { mw: number; cost: number; player: boolean }[] = [];
  // 火电型对手在环保督查期间同样被限产
  for (const c of sim.competitors) blocks.push({ mw: c.capacity * (c.style === 'coal' ? sim.policy.coalCap : 1), cost: c.marginalCost, player: false });
  for (const m of sim.mergedCapacity) blocks.push({ mw: m.mw, cost: m.marginalCost, player: true }); // 商船队=自有
  for (const g of sim.grid.gens.values()) {
    if (sim.genOffline(g)) continue;
    if (g.dispatchable) blocks.push({ mw: g.capacity * g.availability, cost: sim.effMarginalCost(g), player: true }); // 水电按来水折减
    else blocks.push({ mw: g.capacity * g.availability, cost: 0.5, player: true });
  }
  blocks.sort((a, b) => a.cost - b.cost);
  let cum = 0, clearingCost = 0, playerDispatched = 0;
  for (const b of blocks) {
    if (cum >= demand) break;
    const take = Math.min(b.mw, demand - cum);
    cum += take;
    clearingCost = b.cost;
    if (b.player) playerDispatched += take;
  }
  return { clearingCost, playerDispatched, shortfall: Math.max(0, demand - cum) };
}

/** 玩家自有装机（自有机组 + 已并购商船队）MW —— 反垄断口径 */
export function playerNameplateOf(sim: Simulation): number {
  let cap = 0;
  for (const g of sim.grid.gens.values()) cap += g.capacity;
  for (const m of sim.mergedCapacity) cap += m.mw;
  return cap;
}

/** 全区域装机（玩家 + 所有竞争对手）MW */
export function regionNameplateOf(sim: Simulation): number {
  let cap = sim.playerNameplate;
  for (const c of sim.competitors) cap += c.capacity;
  return cap;
}

/**
 * 并购报价（含反垄断审查）：返回基础估值、补救费、合计、并购后市占与是否被否决。
 * 监管按全网装机口径衡量集中度：市占越高，补救费越贵；超过硬上限直接否决。
 */
export function quoteAcquisition(sim: Simulation, index: number): { base: number; remedy: number; total: number; postShare: number; blocked: boolean } | null {
  const c = sim.competitors[index];
  if (!c) return null;
  const region = Math.max(sim.regionNameplate, 1);
  const postShare = (sim.playerNameplate + c.capacity) / region;
  const base = Math.round(c.capacity * ACQUISITION_PRICE_PER_MW);
  const blocked = postShare > ANTITRUST_HARD_SHARE;
  const over = clamp((postShare - ANTITRUST_SOFT_SHARE) / (ANTITRUST_HARD_SHARE - ANTITRUST_SOFT_SHARE), 0, 1);
  const remedy = blocked ? 0 : Math.round(base * ANTITRUST_PREMIUM_K * over);
  return { base, remedy, total: base + remedy, postShare, blocked };
}

/** 并购一家竞争对手：过审后付估值(+补救费)，吸收为商船队（市场出清中作自有，捕获其市场利润） */
export function doAcquireCompetitor(sim: Simulation, index: number): boolean {
  const c = sim.competitors[index];
  const q = sim.acquisitionQuote(index);
  if (!c || !q) return false;
  if (q.blocked) {
    sim.log('warn', `🚫 反垄断否决：并购「${c.name}」后市占将达 ${(q.postShare * 100).toFixed(0)}%，超过 ${(ANTITRUST_HARD_SHARE * 100).toFixed(0)}% 上限`);
    return false;
  }
  if (sim.money < q.total) return false;
  sim.money -= q.total;
  sim.mergedCapacity.push({ mw: c.capacity, marginalCost: c.marginalCost });
  sim.competitors.splice(index, 1);
  const remedyNote = q.remedy > 0 ? `（含反垄断补救费 ¥${q.remedy.toLocaleString('en-US')}）` : '';
  sim.log('good', `🤝 并购「${c.name}」${c.capacity.toFixed(0)}MW（¥${q.total.toLocaleString('en-US')}）${remedyNote}：吸收为自有商船队`);
  return true;
}

/** 竞争对手演化：盈利扩张/亏损退役 + 性格化行为（清洁型猛扩张、激进型打价格战） */
export function evolveCompetitorsOf(sim: Simulation, dtDays: number): void {
  for (const c of sim.competitors) {
    const margin = sim.marketClearingPrice - c.marginalCost;
    const expandMult = c.style === 'green' ? COMP_GREEN_EXPAND_MULT : 1;
    const retireMult = c.style === 'green' ? COMP_GREEN_RETIRE_MULT : 1;
    if (margin > COMPETITOR_EXPAND_MARGIN) c.capacity *= 1 + COMPETITOR_EXPAND_RATE * expandMult * dtDays;
    else if (margin < 0) c.capacity *= 1 - COMPETITOR_RETIRE_RATE * retireMult * dtDays;
    c.capacity = clamp(c.capacity, c.base * COMPETITOR_CAP_MIN_FRAC, c.base * COMPETITOR_CAP_MAX_FRAC);
    // 激进调峰型：玩家市占过高时压价抢量（价格战），威胁解除后回归基准报价
    if (c.style === 'peaker') {
      const target = sim.marketShare > COMP_PEAKER_WAR_SHARE ? c.mcBase * COMP_PEAKER_WAR_FLOOR : c.mcBase;
      const before = c.marginalCost;
      c.marginalCost += (target - c.marginalCost) * clamp(COMP_PEAKER_ADJUST_RATE * dtDays, 0, 1);
      if (before > target + 1 && c.marginalCost <= target + 1) {
        sim.log('warn', `⚔ 「${c.name}」发动价格战：报价压至 ¥${c.marginalCost.toFixed(0)}/MWh 抢夺市场份额`);
      }
    }
  }
}
