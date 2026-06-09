import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('公众形象 / 减碳', () => {
  it('火电厂临近居民会比远离时口碑更低（局地污染）', () => {
    function run(near: boolean): number {
      const sim = new Simulation();
      const g = sim.grid;
      const coal = g.addPlant('coal', near ? 4 : 40, 0).bus; // 靠近 / 远离负荷
      const sub = g.addSubstation(2, 0);
      const load = g.addLoad(4, 0, 'industrial', 30, '厂', 0).bus;
      g.addLine(coal.id, sub.id);
      g.addLine(sub.id, load.id);
      for (let i = 0; i < 400; i++) sim.tick(0.05, 600);
      return sim.reputation;
    }
    expect(run(true)).toBeLessThan(run(false));
  });

  it('持续停电拉低口碑', () => {
    const sim = new Simulation();
    sim.grid.addLoad(0, 0, 'industrial', 30, '孤岛厂', 0); // 无电源
    for (let i = 0; i < 300; i++) sim.tick(0.05, 600);
    expect(sim.reputation).toBeLessThan(70);
  });

  it('纯火电网清洁占比趋近 0', () => {
    const sim = new Simulation();
    sim.events.nextAt = Infinity; // 关闭随机天气，避免风暴跳闸冻结 EMA
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0).bus;
    const sub = g.addSubstation(2, 0);
    const load = g.addLoad(4, 0, 'industrial', 30, '厂', 0).bus;
    g.addLine(coal.id, sub.id);
    g.addLine(sub.id, load.id);
    for (let i = 0; i < 2500; i++) sim.tick(0.05, 600); // 跑约 20 仿真小时让 EMA 收敛
    expect(sim.renewableShare).toBeLessThan(0.2);
  });

  it('口碑映射到等效电价系数 0.85~1.15', () => {
    const sim = new Simulation();
    sim.reputation = 100;
    expect(sim.reputationTariffFactor).toBeCloseTo(1.15, 5);
    sim.reputation = 0;
    expect(sim.reputationTariffFactor).toBeCloseTo(0.85, 5);
  });

  it('存档保留口碑与清洁占比', () => {
    const sim = new Simulation();
    sim.reputation = 33;
    sim.renewableShare = 0.4;
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.reputation).toBeCloseTo(33, 5);
    expect(sim2.renewableShare).toBeCloseTo(0.4, 5);
  });
});
