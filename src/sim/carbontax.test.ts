import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

function carbonOf(market: boolean): { carbon: number; imp: number } {
  const sim = new Simulation();
  sim.forcedOutages = false;
  sim.events.nextAt = Infinity;
  sim.marketEnabled = market;
  const g = sim.grid;
  const coal = g.addPlant('coal', 0, 0); // 60MW
  const sub = g.addSubstation(2, 0);
  const load = g.addLoad(4, 0, 'industrial', 130, '厂', 0); // 缺口 → 触发购电
  g.addLine(coal.bus.id, sub.id);
  g.addLine(sub.id, load.bus.id);
  for (let i = 0; i < 150; i++) sim.tick(0.05, 600);
  return { carbon: sim.finance.carbon, imp: sim.marketImportMW };
}

describe('碳关税（碳边境调节）', () => {
  it('进口电力承担碳关税，抬高碳成本', () => {
    const on = carbonOf(true);
    const off = carbonOf(false);
    expect(on.imp).toBeGreaterThan(0); // 确有进口
    expect(off.imp).toBe(0);
    expect(on.carbon).toBeGreaterThan(off.carbon); // 进口者碳成本更高（含碳关税）
  });

  it('不进口则无碳关税分量', () => {
    // 容量充裕、无需进口 → 即便接入市场也无碳关税
    const sim = new Simulation();
    sim.forcedOutages = false;
    sim.events.nextAt = Infinity;
    sim.marketEnabled = true;
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0);
    const sub = g.addSubstation(2, 0);
    const load = g.addLoad(4, 0, 'industrial', 20, '厂', 0); // 容量充裕
    g.addLine(coal.bus.id, sub.id);
    g.addLine(sub.id, load.bus.id);
    for (let i = 0; i < 100; i++) sim.tick(0.05, 600);
    expect(sim.marketImportMW).toBe(0);
  });
});
