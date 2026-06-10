import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { TechState } from './tech';
import { TECHS, TECH_FX } from '../config/tech';
import { HEDGE_FEE_PER_MW_DAY, TRIP_DELAY } from '../config/components';

describe('科技树（分支与前置）', () => {
  it('每个前置都指向存在的科技，且无自引用', () => {
    const ids = new Set(TECHS.map((t) => t.id));
    for (const t of TECHS) {
      for (const r of t.requires ?? []) {
        expect(ids.has(r)).toBe(true);
        expect(r).not.toBe(t.id);
      }
    }
  });

  it('前置未满足时 canUnlock 为 false，解锁前置后变 true', () => {
    const tech = new TechState();
    expect(tech.canUnlock('hvdc')).toBe(false); // 需要 ehv
    expect(tech.canUnlock('ehv')).toBe(true); // 无前置
    tech.unlocked.add('ehv');
    expect(tech.canUnlock('hvdc')).toBe(true);
  });

  it('交易室科技降低套保手续费', () => {
    const sim = new Simulation();
    sim.money = 1_000_000;
    sim.addHedge(10, 5);
    const feeBase = 1_000_000 - sim.money;
    const sim2 = new Simulation();
    sim2.money = 1_000_000;
    sim2.tech.unlocked.add('trading');
    sim2.addHedge(10, 5);
    const feeTech = 1_000_000 - sim2.money;
    expect(feeTech).toBeCloseTo(feeBase * TECH_FX.hedgeFeeFactor, 4);
    expect(feeBase).toBeCloseTo(10 * 5 * HEDGE_FEE_PER_MW_DAY, 4);
  });

  it('火电灵活性改造降低燃煤 pmin、提升爬坡', () => {
    const sim = new Simulation();
    const { gen } = sim.grid.addPlant('coal', 0, 0);
    expect(sim.effPmin(gen)).toBeCloseTo(gen.pmin);
    expect(sim.effRamp(gen)).toBeCloseTo(gen.rampRate);
    sim.tech.unlocked.add('flexCoal');
    expect(sim.effPmin(gen)).toBeCloseTo(gen.pmin * TECH_FX.coalPminFactor);
    expect(sim.effRamp(gen)).toBeCloseTo(gen.rampRate * TECH_FX.coalRampFactor);
  });

  it('功率预测 AI 减半新能源备用需求放大', () => {
    const tech = new TechState();
    expect(tech.reserveKFactor).toBe(1);
    tech.unlocked.add('forecasting');
    expect(tech.reserveKFactor).toBe(TECH_FX.forecastReserveK);
  });

  it('特高压直流提升 HV 线路有效热极限并叠加降损', () => {
    const sim = new Simulation();
    const a = sim.grid.addSubstation(0, 0);
    const b = sim.grid.addSubstation(5, 0);
    const ln = sim.grid.addLine(a.id, b.id); // HV
    const base = sim.effLineCapacity(ln);
    sim.tech.unlocked.add('ehv');
    sim.tech.unlocked.add('hvdc');
    expect(sim.effLineCapacity(ln)).toBeCloseTo(base * TECH_FX.hvdcCapacityFactor);
    expect(sim.tech.hvLossFactor).toBeCloseTo(TECH_FX.hvLossFactor * TECH_FX.hvdcLossFactor);
  });

  it('自愈 2.0 延长过载耐受时间', () => {
    const tech = new TechState();
    expect(TRIP_DELAY * tech.tripDelayFactor).toBe(TRIP_DELAY);
    tech.unlocked.add('selfHealing');
    expect(TRIP_DELAY * tech.tripDelayFactor).toBeCloseTo(TRIP_DELAY * TECH_FX.selfHealTripFactor);
    expect(tech.autoRecloseDelay).toBe(TECH_FX.selfHealRecloseDelay);
  });

  it('政策研究中心抬升绿证价与免费配额基准', () => {
    const sim = new Simulation();
    const rec0 = sim.recPrice;
    const bench0 = sim.benchmarkIntensity;
    sim.tech.unlocked.add('lobby');
    expect(sim.recPrice).toBeCloseTo(rec0 * TECH_FX.recFactor);
    expect(sim.benchmarkIntensity).toBeCloseTo(bench0 * TECH_FX.benchmarkFactor);
  });
});
