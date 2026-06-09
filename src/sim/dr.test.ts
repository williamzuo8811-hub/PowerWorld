import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

function run(dr: boolean) {
  const sim = new Simulation();
  sim.forcedOutages = false;
  sim.events.nextAt = Infinity;
  sim.demandResponse = dr;
  const g = sim.grid;
  const coal = g.addPlant('coal', 0, 0); // 60MW
  const sub = g.addSubstation(2, 0);
  const load = g.addLoad(4, 0, 'industrial', 200, '厂', 0); // 远超容量 → 高价
  g.addLine(coal.bus.id, sub.id);
  g.addLine(sub.id, load.bus.id);
  for (let i = 0; i < 120; i++) sim.tick(0.05, 600);
  return sim;
}

describe('需求响应（可中断负荷）', () => {
  it('高价时段削减需求并支付激励', () => {
    const on = run(true);
    const off = run(false);
    expect(on.spotPrice).toBeGreaterThan(110); // 确处于高价区
    expect(on.drCurtailedMW).toBeGreaterThan(0); // 有削减
    expect(on.snapshot().totalDemand).toBeLessThan(off.snapshot().totalDemand); // 需求被削减
    expect(on.finance.dr).toBeLessThan(0); // 支付激励（成本）
  });

  it('未启用时不削减', () => {
    const off = run(false);
    expect(off.drCurtailedMW).toBe(0);
    expect(off.finance.dr).toBe(0);
  });

  it('低价时段即使启用也不触发', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    sim.events.nextAt = Infinity;
    sim.demandResponse = true;
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0); // 60MW
    const sub = g.addSubstation(2, 0);
    const load = g.addLoad(4, 0, 'industrial', 20, '厂', 0); // 容量充裕 → 低价
    g.addLine(coal.bus.id, sub.id);
    g.addLine(sub.id, load.bus.id);
    for (let i = 0; i < 100; i++) sim.tick(0.05, 600);
    expect(sim.spotPrice).toBeLessThan(110);
    expect(sim.drCurtailedMW).toBe(0);
  });

  it('存档保留需求响应开关', () => {
    const sim = new Simulation();
    sim.demandResponse = true;
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.demandResponse).toBe(true);
  });
});
