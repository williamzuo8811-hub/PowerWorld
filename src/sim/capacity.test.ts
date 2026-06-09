import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

function capIncome(setup: (s: Simulation) => void): number {
  const sim = new Simulation();
  sim.forcedOutages = false;
  setup(sim);
  for (let i = 0; i < 200; i++) sim.tick(0.05, 600);
  return sim.finance.capacity;
}

describe('容量市场', () => {
  it('可用容量带来容量补偿', () => {
    expect(capIncome((s) => s.grid.addPlant('coal', 0, 0))).toBeGreaterThan(0);
  });

  it('在建容量不计容量补偿', () => {
    const income = capIncome((s) => {
      const p = s.grid.addPlant('coal', 0, 0);
      p.bus.underConstruction = true;
      p.bus.commissionAt = 1e9; // 永不投运
    });
    expect(income).toBe(0);
  });

  it('火电容量信用高于同容量风电（每 MW）', () => {
    const coal = capIncome((s) => s.grid.addPlant('coal', 0, 0)); // 60MW @信用1.0
    const wind = capIncome((s) => s.grid.addPlant('wind', 0, 0)); // 30MW @信用0.15
    // 单位容量信用：coal 远高于 wind
    expect(coal / 60).toBeGreaterThan((wind / 30) * 3);
  });
});
