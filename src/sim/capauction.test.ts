import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

function capPrice(totalCompCap: number): number {
  const sim = new Simulation();
  sim.forcedOutages = false;
  sim.competitors.forEach((c) => { c.capacity = totalCompCap / sim.competitors.length; c.base = c.capacity; });
  sim.tick(0.05, 600);
  return sim.capacityPrice;
}

describe('容量拍卖', () => {
  it('容量紧张时容量价高于充裕时', () => {
    expect(capPrice(120)).toBeGreaterThan(capPrice(1200)); // 紧张 vs 过剩
  });

  it('充裕度随总容量上升', () => {
    const sim = new Simulation();
    sim.competitors.forEach((c) => { c.capacity = 50; });
    sim.tick(0.05, 600);
    const lowAdeq = sim.capacityAdequacy;
    const sim2 = new Simulation();
    sim2.competitors.forEach((c) => { c.capacity = 400; });
    sim2.tick(0.05, 600);
    expect(sim2.capacityAdequacy).toBeGreaterThan(lowAdeq);
  });

  it('容量价落在配置上下限内', () => {
    const sim = new Simulation();
    for (let i = 0; i < 100; i++) sim.tick(0.05, 600);
    expect(sim.capacityPrice).toBeGreaterThanOrEqual(4 * 0.3 - 1e-6);
    expect(sim.capacityPrice).toBeLessThanOrEqual(4 * 2.2 + 1e-6);
  });
});
