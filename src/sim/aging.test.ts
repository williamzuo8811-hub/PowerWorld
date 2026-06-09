import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('机组老化与退役', () => {
  it('投运后役龄随时间增长', () => {
    const sim = new Simulation();
    const p = sim.grid.addPlant('coal', 0, 0);
    sim.forcedOutages = false;
    expect(p.gen.age).toBe(0);
    for (let i = 0; i < 50; i++) sim.tick(0.05, 5760);
    expect(p.gen.age).toBeGreaterThan(0);
  });

  it('磨损抬高有效边际成本', () => {
    const sim = new Simulation();
    const p = sim.grid.addPlant('coal', 0, 0);
    const fresh = sim.effMarginalCost(p.gen);
    p.gen.age = 40; // 满磨损
    expect(sim.effMarginalCost(p.gen)).toBeGreaterThan(fresh);
  });

  it('强迫停运使机组离线、出力清零、下游停电', () => {
    const sim = new Simulation();
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0);
    const sub = g.addSubstation(2, 0);
    const load = g.addLoad(4, 0, 'industrial', 30, '厂', 0);
    g.addLine(coal.bus.id, sub.id);
    g.addLine(sub.id, load.bus.id);
    sim.forcedOutages = false;
    for (let i = 0; i < 20; i++) sim.tick(0.05, 600);
    expect(load.bus.blackout).toBe(false);

    coal.gen.outageUntil = sim.clock + 24; // 强制检修一天
    for (let i = 0; i < 5; i++) sim.tick(0.05, 600);
    expect(sim.genOffline(coal.gen)).toBe(true);
    expect(coal.gen.output).toBe(0);
    expect(load.bus.blackout).toBe(true);
  });

  it('退役残值随役龄折旧，越老越低', () => {
    const sim = new Simulation();
    const p = sim.grid.addPlant('coal', 0, 0);
    const sNew = sim.salvageValue(p.bus.id);
    p.gen.age = 50;
    const sOld = sim.salvageValue(p.bus.id);
    expect(sNew).toBeGreaterThan(0);
    expect(sNew).toBeGreaterThan(sOld);
  });

  it('存档保留役龄', () => {
    const sim = new Simulation();
    const p = sim.grid.addPlant('gas', 0, 0);
    p.gen.age = 12.5;
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect([...sim2.grid.gens.values()][0].age).toBeCloseTo(12.5, 3);
  });
});
