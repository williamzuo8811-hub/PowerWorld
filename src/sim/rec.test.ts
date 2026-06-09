import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('绿证交易', () => {
  it('绿证价随政策退坡', () => {
    const sim = new Simulation();
    const p0 = sim.recPrice;
    sim.clock = 24 * 20; // 第 20 天
    expect(sim.recPrice).toBeLessThan(p0);
    sim.clock = 24 * 999; // 远期 → 触及下限
    expect(sim.recPrice).toBeGreaterThanOrEqual(4);
  });

  it('新能源发电获得绿证收入', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    const g = sim.grid;
    const wind = g.addPlant('wind', 0, 0);
    const sub = g.addSubstation(2, 0);
    const load = g.addLoad(4, 0, 'industrial', 25, '厂', 0);
    g.addLine(wind.bus.id, sub.id);
    g.addLine(sub.id, load.bus.id);
    for (let i = 0; i < 300; i++) sim.tick(0.05, 600);
    expect(sim.finance.rec).toBeGreaterThan(0);
  });

  it('纯火电网无绿证收入', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0);
    const sub = g.addSubstation(2, 0);
    const load = g.addLoad(4, 0, 'industrial', 25, '厂', 0);
    g.addLine(coal.bus.id, sub.id);
    g.addLine(sub.id, load.bus.id);
    for (let i = 0; i < 200; i++) sim.tick(0.05, 600);
    expect(sim.finance.rec).toBe(0);
  });
});
