import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { POLICY_FX } from '../config/components';

function activate(sim: Simulation, kind: Parameters<Simulation['policy']['has']>[0]): void {
  sim.policy.current = { kind, endClock: sim.clock + 3 * 24 };
}

function setup(): Simulation {
  const sim = new Simulation();
  sim.forcedOutages = false;
  const g = sim.grid;
  const coal = g.addPlant('coal', 0, 0).bus;
  const sub = g.addSubstation(2, 0);
  const load = g.addLoad(4, 0, 'industrial', 40, '厂', 0).bus;
  g.addLine(coal.id, sub.id);
  g.addLine(sub.id, load.id);
  return sim;
}

describe('政策事件', () => {
  it('绿色补贴窗口抬升绿证价', () => {
    const sim = setup();
    const base = sim.recPrice;
    activate(sim, 'subsidy');
    expect(sim.recPrice).toBeCloseTo(base * POLICY_FX.subsidyRecMult);
  });

  it('环保督查限产燃煤并抬升碳价', () => {
    const sim = setup();
    const carbonBase = sim.carbonPrice;
    activate(sim, 'inspection');
    expect(sim.carbonPrice).toBeCloseTo(carbonBase * POLICY_FX.inspectionCarbonMult);
    for (let i = 0; i < 200; i++) sim.tick(0.05, 600);
    const coal = [...sim.grid.gens.values()][0];
    expect(coal.availability).toBeCloseTo(POLICY_FX.inspectionCoalCap);
    expect(coal.output).toBeLessThanOrEqual(coal.capacity * POLICY_FX.inspectionCoalCap + 0.01);
  });

  it('信贷紧缩压缩信用额度并抬升利率', () => {
    const sim = setup();
    const limitBase = sim.creditLimit;
    const rateBase = sim.loanDailyRate;
    activate(sim, 'creditCrunch');
    expect(sim.creditLimit).toBeCloseTo(limitBase * POLICY_FX.crunchCreditFactor);
    expect(sim.loanDailyRate).toBeCloseTo(rateBase + POLICY_FX.crunchRateAdder, 5);
  });

  it('邻区短缺压缩进口容量', () => {
    const sim = setup();
    const capBase = sim.effImportCapacity;
    activate(sim, 'neighborShortage');
    expect(sim.effImportCapacity).toBeCloseTo(capBase * POLICY_FX.shortageImportCapFactor);
  });

  it('政策到期自动恢复常态', () => {
    const sim = setup();
    activate(sim, 'rateHike');
    const rateHigh = sim.loanDailyRate;
    sim.policy.nextAt = Infinity; // 不再排新政策，单测到期行为
    for (let i = 0; i < 120; i++) sim.tick(0.05, 60_000); // 快进 > 3 天（每 tick≈0.83 小时）
    expect(sim.policy.current).toBeNull();
    expect(sim.loanDailyRate).toBeLessThan(rateHigh);
  });

  it('政策随存档往返', () => {
    const sim = setup();
    activate(sim, 'subsidy');
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.policy.has('subsidy')).toBe(true);
    expect(sim2.recPrice).toBeCloseTo(sim.recPrice);
  });

  it('高杠杆显著提高信贷紧缩概率（统计性）', () => {
    // 直接检验 roll 的权重逻辑：通过多次采样比较频率
    const lowLev = setup();
    const highLev = setup();
    highLev.borrow(highLev.creditLimit * 0.9);
    expect(highLev.debtRatio).toBeGreaterThan(0.7);
    let lowCount = 0, highCount = 0;
    const rollOf = (s: Simulation) => (s.policy as unknown as { roll(sim: Simulation): string }).roll(s);
    for (let i = 0; i < 800; i++) {
      if (rollOf(lowLev) === 'creditCrunch') lowCount++;
      if (rollOf(highLev) === 'creditCrunch') highCount++;
    }
    expect(highCount).toBeGreaterThan(lowCount * 1.8);
  });
});
