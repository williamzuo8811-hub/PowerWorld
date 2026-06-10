// 长期规划与组合分析（纯分析模块）：IRP 压力测试 / 扩容建议 / 多年规划轨迹 / 能源品类组合。
// 全部是只读函数：不改动任何仿真状态。从 simulation.ts 拆出，Simulation 留薄委托保持兼容。
import type { Simulation } from './simulation';
import type { LoadProfile } from './types';
import { demandMultiplier } from './profiles';
import {
  PLANTS, STORAGE, CAPACITY_CREDIT, TARIFF, TARIFF_CLASS, KEY_ACCOUNTS, UNSERVED_PENALTY,
  IRP_LOAD_FACTOR, IRP_SUMMER_PEAK, IRP_SOLAR_PEAK_CREDIT, IRP_WIND_PEAK_CREDIT, IRP_RENEW_CF,
  IRP_TIGHT_MARGIN, IRP_SCENARIOS, SEASON_YEAR_DAYS, type StressScenarioSpec,
} from '../config/components';

/** 多年规划轨迹的逐年采样（IRP） */
export interface YearPlan {
  year: number; // 距今第几年（0=当前）
  peakDemand: number; // 该年夏季晚峰需求 (MW)
  firmSupply: number; // 当前可信容量（"不新建"基线，保持不变）
  reserveMargin: number;
  verdict: 'adequate' | 'tight' | 'shortfall';
}

/** 扩容投资建议（IRP） */
export interface ExpansionAdvice {
  gapMW: number; // 约束情景下需补充的可信容量 (MW)，≤0 表示充裕
  bindingScenario: string; // 约束情景（备用率最低者）名称
  deficitDay: number; // 基准增长下备用率跌破 0 的日（Infinity=短期不发生）
  curDay: number; // 当前日（便于 UI 计算剩余天数）
  option: { // 推荐的最低成本补强方案（按"每可信 MW 造价"择优）
    label: string;
    units: number; // 需新建的机组/储能数量
    firmPerUnit: number; // 单台可信容量贡献 (MW)
    capex: number; // 总投资 (¥)
    buildDays: number; // 工期（天）
    startByDay: number; // 建议开工日（赤字日 − 工期）
  } | null;
}

/** 压力测试单情景结果（IRP） */
export interface StressResult {
  id: string;
  name: string;
  peakDemand: number; // 夏季晚峰需求 (MW)
  firmSupply: number; // 可信容量（可调+储能+新能源信用）(MW)
  reserveMargin: number; // firmSupply/peakDemand − 1
  verdict: 'adequate' | 'tight' | 'shortfall';
  dailyNet: number; // 该情景下粗估日净现金流 (¥/天)
}

/** 能源品类统计的一行（资产组合面板，呼应"能源品类"筛选器） */
export interface PortfolioCategory {
  key: string;
  icon: string;
  label: string;
  count: number; // 该品类资产数量
  value: string; // 规模/明细（MW、满意度等）
  share: number; // 占比 0..1（发电类=发电出力占比；负荷类=负荷占比；其余=0）
  co2Rate: number; // 该品类当前碳排速率 (t/h)（仅发电类）
  revenueRate: number; // 该品类当前售电收入速率 (¥/h)（仅负荷类）
  color: number;
}

/** 某类负荷的日内峰值乘子（采样日曲线取最大） */
function dayPeakMultiplier(profile: LoadProfile): number {
  let mx = 0;
  for (let h = 0; h < 24; h++) mx = Math.max(mx, demandMultiplier(h, profile));
  return mx;
}

/** 本公司可信容量（可调机组 + 储能信用 + 新能源极低尖峰信用）MW */
export function ownFirmCapacity(sim: Simulation): number {
  let firm = 0;
  for (const g of sim.grid.gens.values()) {
    if (sim.genOffline(g)) continue;
    const credit = g.dispatchable ? CAPACITY_CREDIT[g.type] : (g.type === 'solar' ? IRP_SOLAR_PEAK_CREDIT : IRP_WIND_PEAK_CREDIT);
    firm += g.capacity * credit;
  }
  for (const b of sim.grid.batteries.values()) {
    const bus = sim.grid.buses.get(b.busId);
    if (bus && !bus.underConstruction) firm += b.powerRating * STORAGE[b.type].capacityCredit * sim.tech.storageCreditFactor;
  }
  return firm;
}

/** 当前季节下，本公司可信容量对自有峰值负荷的充裕度 */
export function seasonalPeakAdequacy(sim: Simulation): { firm: number; peak: number; margin: number } {
  const firm = ownFirmCapacity(sim);
  let peak = 0;
  for (const load of sim.grid.loads.values()) peak += load.baseDemand * dayPeakMultiplier(load.profile);
  peak *= sim.seasonDemandFactor; // 当前季节峰
  const margin = peak > 0 ? firm / peak - 1 : (firm > 0 ? 1 : 0);
  return { firm, peak, margin };
}

/** IRP 压力测试：在当前机队上跑一组 what-if 情景，评估容量充裕度与经济韧性 */
export function runStressTest(sim: Simulation, scenarios: StressScenarioSpec[] = IRP_SCENARIOS): StressResult[] {
  // 基础夏季晚峰需求（剔除当前季节/景气，取纯峰）
  let basePeak = 0;
  for (const load of sim.grid.loads.values()) basePeak += load.baseDemand * dayPeakMultiplier(load.profile);
  basePeak *= IRP_SUMMER_PEAK;

  const gens = [...sim.grid.gens.values()];
  const disp = gens.filter((g) => g.dispatchable);
  const renew = gens.filter((g) => !g.dispatchable);
  const dispFirm = disp.reduce((s, g) => s + g.capacity * CAPACITY_CREDIT[g.type], 0);
  const storageFirm = [...sim.grid.batteries.values()].reduce((s, b) => s + b.powerRating * STORAGE[b.type].capacityCredit, 0);
  const dispOrder = disp.slice().sort((a, b) => sim.effMarginalCost(a) - sim.effMarginalCost(b));

  return scenarios.map((sc) => {
    const peak = basePeak * sc.demandGrowth;
    const renewFirm = renew.reduce((s, g) => {
      const credit = g.type === 'solar' ? IRP_SOLAR_PEAK_CREDIT : IRP_WIND_PEAK_CREDIT;
      return s + g.capacity * credit * sc.renewDerate;
    }, 0);
    const firm = dispFirm + storageFirm + renewFirm;
    const margin = peak > 0 ? firm / peak - 1 : (firm > 0 ? 1 : 0);
    const verdict: StressResult['verdict'] = margin < 0 ? 'shortfall' : margin < IRP_TIGHT_MARGIN ? 'tight' : 'adequate';

    // —— 经济韧性（粗估）——
    const potentialAvg = peak * IRP_LOAD_FACTOR; // 期望平均负荷
    // 新能源先供（按平均容量因子 × 折减）
    const renewAvg = renew.reduce((s, g) => s + g.capacity * IRP_RENEW_CF * sc.renewDerate, 0);
    const renewServed = Math.min(potentialAvg, renewAvg);
    let residual = Math.max(0, potentialAvg - renewServed);
    let fuelCost = 0, carbonCost = 0, dispServed = 0;
    for (const g of dispOrder) {
      if (residual <= 1e-9) break;
      const take = Math.min(g.capacity, residual);
      residual -= take;
      dispServed += take;
      fuelCost += take * 24 * sim.effMarginalCost(g) * sc.fuelMult;
      carbonCost += take * 24 * sim.effCo2(g) * sim.carbonPrice * sc.carbonMult;
    }
    const served = renewServed + dispServed;
    const unserved = Math.max(0, potentialAvg - served);
    const revenue = served * 24 * TARIFF; // 用固定电价保持情景间可比
    const penalty = unserved * 24 * UNSERVED_PENALTY;
    const dailyNet = revenue - fuelCost - carbonCost - penalty;

    return { id: sc.id, name: sc.name, peakDemand: peak, firmSupply: firm, reserveMargin: margin, verdict, dailyNet };
  });
}

/** 扩容投资建议：补强约束情景缺口的最低成本方案 + 赤字日/建议开工日 */
export function buildExpansionAdvice(sim: Simulation, scenarios: StressScenarioSpec[] = IRP_SCENARIOS): ExpansionAdvice {
  const results = runStressTest(sim, scenarios);
  const binding = results.reduce((a, b) => (b.reserveMargin < a.reserveMargin ? b : a));
  const gap = binding.reserveMargin < 0 ? -binding.reserveMargin * binding.peakDemand : 0;

  // 候选补强：可调机组 + 储能，按"每可信 MW 造价"择优
  type Cand = { label: string; firmPerUnit: number; capexPerUnit: number; buildDays: number };
  const cands: Cand[] = [];
  for (const [t, s] of Object.entries(PLANTS)) {
    if (!s.dispatchable) continue;
    const firm = s.capacity * (CAPACITY_CREDIT as Record<string, number>)[t];
    if (firm > 0) cands.push({ label: s.label, firmPerUnit: firm, capexPerUnit: s.capex, buildDays: s.buildDays });
  }
  for (const s of Object.values(STORAGE)) {
    const firm = s.powerRating * s.capacityCredit;
    if (firm > 0) cands.push({ label: s.label, firmPerUnit: firm, capexPerUnit: s.capex, buildDays: s.buildDays });
  }
  cands.sort((a, b) => a.capexPerUnit / a.firmPerUnit - b.capexPerUnit / b.firmPerUnit);
  const best = cands[0];

  // 基准增长下备用率跌破 0 的赤字日
  let wsum = 0, gsum = 0;
  for (const load of sim.grid.loads.values()) { wsum += load.baseDemand; gsum += load.baseDemand * load.growthPerHour; }
  const ghHour = wsum > 0 ? gsum / wsum : 0;
  const dgDay = Math.pow(1 + ghHour, 24) - 1;
  const base = results.find((r) => r.id === 'base')!;
  let deficitDay = Infinity;
  if (base.peakDemand > 0 && base.firmSupply <= base.peakDemand) deficitDay = sim.day;
  else if (base.peakDemand > 0 && dgDay > 1e-9) deficitDay = sim.day + Math.log(base.firmSupply / base.peakDemand) / Math.log(1 + dgDay);

  let option: ExpansionAdvice['option'] = null;
  if (gap > 0 && best) {
    const units = Math.ceil(gap / best.firmPerUnit);
    const anchor = Number.isFinite(deficitDay) ? deficitDay : sim.day;
    option = {
      label: best.label,
      units,
      firmPerUnit: best.firmPerUnit,
      capex: units * best.capexPerUnit,
      buildDays: best.buildDays,
      startByDay: anchor - best.buildDays,
    };
  }
  return { gapMW: gap, bindingScenario: binding.name, deficitDay, curDay: sim.day, option };
}

/** 多年滚动规划轨迹：在"不新建"基线下逐年推算夏季晚峰与备用率 */
export function buildPlanningTrajectory(sim: Simulation, years = 6, scenarioId = 'base'): YearPlan[] {
  const results = runStressTest(sim);
  const sc = results.find((r) => r.id === scenarioId) ?? results[0];
  const firm = sc.firmSupply;
  const peak0 = sc.peakDemand;
  let wsum = 0, gsum = 0;
  for (const load of sim.grid.loads.values()) { wsum += load.baseDemand; gsum += load.baseDemand * load.growthPerHour; }
  const ghHour = wsum > 0 ? gsum / wsum : 0;
  const yearFactor = Math.pow(1 + ghHour, 24 * SEASON_YEAR_DAYS); // 一年的复合增长
  const plans: YearPlan[] = [];
  for (let y = 0; y <= years; y++) {
    const peak = peak0 * Math.pow(yearFactor, y);
    const margin = peak > 0 ? firm / peak - 1 : (firm > 0 ? 1 : 0);
    const verdict: YearPlan['verdict'] = margin < 0 ? 'shortfall' : margin < IRP_TIGHT_MARGIN ? 'tight' : 'adequate';
    plans.push({ year: y, peakDemand: peak, firmSupply: firm, reserveMargin: margin, verdict });
  }
  return plans;
}

/** 按"能源品类"汇总当前资产组合（发电/电网/储能/各类大客户），供品类统计面板展示 */
export function buildPortfolio(sim: Simulation): PortfolioCategory[] {
  const gens = [...sim.grid.gens.values()];
  const bats = [...sim.grid.batteries.values()];
  const loads = [...sim.grid.loads.values()];
  const cap = (arr: { capacity: number }[]) => arr.reduce((s, g) => s + g.capacity, 0);
  const dem = (arr: { baseDemand: number }[]) => arr.reduce((s, l) => s + l.baseDemand, 0);
  const renew = gens.filter((g) => g.type === 'wind' || g.type === 'solar' || g.type === 'hydro' || g.type === 'biomass');
  const thermal = gens.filter((g) => g.type === 'coal' || g.type === 'gas');
  const nuke = gens.filter((g) => g.type === 'nuclear');
  const subs = [...sim.grid.buses.values()].filter((b) => b.kind === 'substation');
  const lineCount = sim.grid.lines.size;
  const ci = loads.filter((l) => l.profile === 'residential' || l.profile === 'commercial' || l.profile === 'industrial');
  const totalOut = gens.reduce((s, g) => s + g.output, 0);
  const totalDem = loads.reduce((s, l) => s + l.demand, 0);
  const outShare = (arr: { output: number }[]) => totalOut > 0.1 ? arr.reduce((s, g) => s + g.output, 0) / totalOut : 0;
  const demShare = (arr: { demand: number }[]) => totalDem > 0.1 ? arr.reduce((s, l) => s + l.demand, 0) / totalDem : 0;
  const spot = sim.spotPrice;
  const co2Of = (arr: typeof gens) => arr.reduce((s, g) => s + g.output * sim.effCo2(g), 0); // t/h
  const revOf = (arr: typeof loads) => arr.reduce((s, l) => s + l.served * TARIFF_CLASS[l.profile] * spot, 0); // ¥/h
  const out: PortfolioCategory[] = [
    { key: 'renewable', icon: '☀️', label: '可再生能源发电', count: renew.length, value: `${cap(renew).toFixed(0)} MW · 发电占比 ${(outShare(renew) * 100).toFixed(0)}%`, share: outShare(renew), co2Rate: co2Of(renew), revenueRate: 0, color: 0x4ade80 },
    { key: 'nuclear', icon: '⚛️', label: '核电', count: nuke.length, value: `${cap(nuke).toFixed(0)} MW · 发电占比 ${(outShare(nuke) * 100).toFixed(0)}%`, share: outShare(nuke), co2Rate: co2Of(nuke), revenueRate: 0, color: 0xa78bfa },
    { key: 'thermal', icon: '🔥', label: '火电(煤/气)', count: thermal.length, value: `${cap(thermal).toFixed(0)} MW · 发电占比 ${(outShare(thermal) * 100).toFixed(0)}%`, share: outShare(thermal), co2Rate: co2Of(thermal), revenueRate: 0, color: 0xf2994a },
    { key: 'grid', icon: '⚡', label: '输变电·电网', count: subs.length + lineCount, value: `${subs.length} 变电站 · ${lineCount} 线路`, share: 0, co2Rate: 0, revenueRate: 0, color: 0x60a5fa },
    { key: 'storage', icon: '🔋', label: '储能', count: bats.length, value: `${bats.reduce((s, b) => s + b.powerRating, 0).toFixed(0)} MW / ${bats.reduce((s, b) => s + b.energyCapacity, 0).toFixed(0)} MWh`, share: 0, co2Rate: 0, revenueRate: 0, color: 0x38bdf8 },
    { key: 'ci', icon: '🏭', label: '工商业·配网大客户', count: ci.length, value: `${dem(ci).toFixed(0)} MW · 负荷占比 ${(demShare(ci) * 100).toFixed(0)}%`, share: demShare(ci), co2Rate: 0, revenueRate: revOf(ci), color: 0xc98b6b },
  ];
  for (const [p, icon, label] of [['datacenter', '💻', '数据中心'], ['transport', '🚄', '大交通·枢纽'], ['petrochem', '🛢', '石油化工·LNG'], ['mining', '⛏', '矿业']] as const) {
    const arr = loads.filter((l) => l.profile === p);
    const avgSat = arr.length ? arr.reduce((s, l) => s + (l.satisfaction ?? 1), 0) / arr.length : 1;
    out.push({ key: p, icon, label, count: arr.length, value: arr.length ? `${dem(arr).toFixed(0)} MW · 负荷占比 ${(demShare(arr) * 100).toFixed(0)}% · 满意 ${(avgSat * 100).toFixed(0)}%` : '—', share: demShare(arr), co2Rate: 0, revenueRate: revOf(arr), color: KEY_ACCOUNTS[p].color });
  }
  return out;
}
