import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('燃料市场', () => {
  it('燃料价格随时间波动但保持在合理区间', () => {
    const sim = new Simulation();
    let moved = false;
    for (let i = 0; i < 2000; i++) {
      sim.tick(0.05, 600);
      for (const k of ['coal', 'gas', 'uranium'] as const) {
        expect(sim.fuelPrice[k]).toBeGreaterThanOrEqual(0.45);
        expect(sim.fuelPrice[k]).toBeLessThanOrEqual(2.6);
        if (Math.abs(sim.fuelPrice[k] - 1) > 0.02) moved = true;
      }
    }
    expect(moved).toBe(true); // 确有波动
  });

  it('有效边际成本随燃料价格放大；新能源不受影响', () => {
    const sim = new Simulation();
    const gas = sim.grid.addPlant('gas', 0, 0).gen;
    const wind = sim.grid.addPlant('wind', 0, 2).gen;
    const base = sim.effMarginalCost(gas);
    sim.fuelPrice.gas = 2;
    expect(sim.effMarginalCost(gas)).toBeCloseTo(base * 2, 6);
    expect(sim.effMarginalCost(wind)).toBe(0); // 零燃料
  });

  it('存档保留燃料价格', () => {
    const sim = new Simulation();
    sim.fuelPrice = { coal: 1.3, gas: 0.8, uranium: 1.1 };
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.fuelPrice.coal).toBeCloseTo(1.3, 6);
    expect(sim2.fuelPrice.gas).toBeCloseTo(0.8, 6);
  });
});
