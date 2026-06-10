import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('碳捕集（CCS）改造', () => {
  it('改造降低排放强度、提高边际成本、扣改造费', () => {
    const sim = new Simulation();
    const coal = sim.grid.addPlant('coal', 0, 0);
    const co2Before = sim.effCo2(coal.gen);
    const mcBefore = sim.effMarginalCost(coal.gen);
    const m0 = sim.money;

    expect(sim.retrofitCCS(coal.bus.id)).toBe(true);
    expect(coal.gen.ccs).toBe(true);
    expect(sim.money).toBeLessThan(m0); // 改造费
    expect(sim.effCo2(coal.gen)).toBeLessThan(co2Before * 0.2); // 捕集后大幅下降
    expect(sim.effMarginalCost(coal.gen)).toBeGreaterThan(mcBefore); // 能耗惩罚
  });

  it('新能源不能改造，已改造不能重复', () => {
    const sim = new Simulation();
    const wind = sim.grid.addPlant('wind', 0, 0);
    expect(sim.retrofitCCS(wind.bus.id)).toBe(false);
    const coal = sim.grid.addPlant('coal', 2, 0);
    expect(sim.retrofitCCS(coal.bus.id)).toBe(true);
    expect(sim.retrofitCCS(coal.bus.id)).toBe(false); // 已改造
  });

  it('改造后整网碳排显著下降', () => {
    function co2Of(ccs: boolean): number {
      const sim = new Simulation();
      sim.forcedOutages = false;
      const g = sim.grid;
      const coal = g.addPlant('coal', 0, 0);
      const sub = g.addSubstation(2, 0);
      const load = g.addLoad(4, 0, 'industrial', 30, '厂', 0);
      g.addLine(coal.bus.id, sub.id);
      g.addLine(sub.id, load.bus.id);
      if (ccs) sim.retrofitCCS(coal.bus.id);
      for (let i = 0; i < 100; i++) sim.tick(0.05, 600);
      return sim.snapshot().co2;
    }
    expect(co2Of(true)).toBeLessThan(co2Of(false) * 0.3);
  });

  it('存档保留 CCS 状态', () => {
    const sim = new Simulation();
    const coal = sim.grid.addPlant('coal', 0, 0);
    sim.retrofitCCS(coal.bus.id);
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect([...sim2.grid.gens.values()][0].ccs).toBe(true);
  });
});
