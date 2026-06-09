import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('计划检修', () => {
  it('检修降低役龄、扣检修费、使机组短暂离线', () => {
    const sim = new Simulation();
    const p = sim.grid.addPlant('coal', 0, 0);
    p.gen.age = 30;
    const m0 = sim.money;
    expect(sim.scheduleMaintenance(p.bus.id)).toBe(true);
    expect(p.gen.age).toBeLessThan(30); // 役龄下降
    expect(sim.money).toBeLessThan(m0); // 扣检修费
    expect(sim.genOffline(p.gen)).toBe(true); // 检修期间离线
  });

  it('检修降低有效边际成本（磨损减小）', () => {
    const sim = new Simulation();
    const p = sim.grid.addPlant('coal', 0, 0);
    p.gen.age = 35;
    const before = sim.effMarginalCost(p.gen);
    sim.scheduleMaintenance(p.bus.id);
    expect(sim.effMarginalCost(p.gen)).toBeLessThan(before);
  });

  it('已离线/检修中的机组不能重复检修', () => {
    const sim = new Simulation();
    const p = sim.grid.addPlant('coal', 0, 0);
    expect(sim.scheduleMaintenance(p.bus.id)).toBe(true);
    expect(sim.scheduleMaintenance(p.bus.id)).toBe(false); // 已在检修
  });

  it('检修结束后机组恢复运行', () => {
    const sim = new Simulation();
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0);
    const sub = g.addSubstation(2, 0);
    const load = g.addLoad(4, 0, 'industrial', 30, '厂', 0);
    g.addLine(coal.bus.id, sub.id);
    g.addLine(sub.id, load.bus.id);
    sim.forcedOutages = false;
    sim.scheduleMaintenance(coal.bus.id); // 检修 0.5 天 = 12 小时
    for (let i = 0; i < 200; i++) sim.tick(0.05, 5760); // 推进约 16 小时，超过检修时长
    expect(sim.genOffline(coal.gen)).toBe(false);
    expect(load.bus.blackout).toBe(false);
  });
});
