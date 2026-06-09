import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('建设工期', () => {
  it('在建电厂不发电，投运后才供电', () => {
    const sim = new Simulation();
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0);
    coal.bus.underConstruction = true;
    coal.bus.commissionAt = 0.3; // 0.3 仿真小时后投运
    const sub = g.addSubstation(2, 0);
    const load = g.addLoad(4, 0, 'industrial', 30, '厂', 0);
    g.addLine(coal.bus.id, sub.id);
    g.addLine(sub.id, load.bus.id);

    for (let i = 0; i < 3; i++) sim.tick(0.05, 600); // clock ≈ 0.025h < 0.3
    expect(coal.bus.underConstruction).toBe(true);
    expect(coal.gen.output).toBe(0);
    expect(load.bus.blackout).toBe(true);

    for (let i = 0; i < 60; i++) sim.tick(0.05, 600); // clock ≈ 0.5h > 0.3
    expect(coal.bus.underConstruction).toBe(false); // 已投运
    expect(coal.gen.output).toBeGreaterThan(0);
    expect(load.bus.blackout).toBe(false);
  });

  it('已投运资产持续产生运维成本', () => {
    const sim = new Simulation();
    sim.grid.addPlant('coal', 0, 0); // 已投运，但无负荷无收入
    const m0 = sim.money;
    for (let i = 0; i < 120; i++) sim.tick(0.05, 600);
    expect(sim.money).toBeLessThan(m0); // 仅运维成本即可拉低资金
  });

  it('存档保留在建状态与投运时刻', () => {
    const sim = new Simulation();
    const p = sim.grid.addPlant('gas', 0, 0);
    p.bus.underConstruction = true;
    p.bus.commissionAt = 99;
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    const b2 = [...sim2.grid.buses.values()][0];
    expect(b2.underConstruction).toBe(true);
    expect(b2.commissionAt).toBe(99);
  });
});
