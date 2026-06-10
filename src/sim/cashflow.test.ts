import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { SCENARIOS } from '../game/scenarios';

describe('现金流报表', () => {
  it('正常运行的电网产生售电收入与燃料成本', () => {
    const sim = new Simulation();
    SCENARIOS[0].setup(sim); // 起步已连通居民区
    for (let i = 0; i < 200; i++) sim.tick(0.05, 600);
    expect(sim.finance.revenue).toBeGreaterThan(0); // 有售电收入
    expect(sim.finance.fuel).toBeGreaterThan(0); // 燃煤有燃料成本
    expect(sim.finance.om).toBeGreaterThan(0); // 有运维成本
  });

  it('负债时利息计入现金流', () => {
    const sim = new Simulation();
    SCENARIOS[0].setup(sim);
    sim.borrow(200_000);
    for (let i = 0; i < 100; i++) sim.tick(0.05, 600);
    expect(sim.finance.interest).toBeGreaterThan(0);
  });

  it('reset 清零现金流报表', () => {
    const sim = new Simulation();
    SCENARIOS[0].setup(sim);
    for (let i = 0; i < 50; i++) sim.tick(0.05, 600);
    sim.reset();
    expect(sim.finance.revenue).toBe(0);
    expect(sim.finance.net).toBe(0);
  });
});
