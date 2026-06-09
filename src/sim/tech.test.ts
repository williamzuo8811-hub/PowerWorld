import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { SCENARIOS } from '../game/scenarios';

describe('研发 / 科技树', () => {
  it('持续供电积累研发点', () => {
    const sim = new Simulation();
    SCENARIOS[0].setup(sim); // 起步已连通居民区，有供电
    for (let i = 0; i < 100; i++) sim.tick(0.05, 600);
    expect(sim.tech.points).toBeGreaterThan(0);
  });

  it('需求响应科技降低用电需求', () => {
    const a = new Simulation(); SCENARIOS[0].setup(a);
    const b = new Simulation(); SCENARIOS[0].setup(b);
    b.tech.unlocked.add('demandResponse');
    let sumA = 0, sumB = 0;
    for (let i = 0; i < 200; i++) {
      a.tick(0.05, 600); b.tick(0.05, 600);
      sumA += [...a.grid.loads.values()].reduce((s, l) => s + l.demand, 0);
      sumB += [...b.grid.loads.values()].reduce((s, l) => s + l.demand, 0);
    }
    expect(sumB).toBeLessThan(sumA * 0.96); // 约 −8%
  });

  it('超高压科技降低高压线损', () => {
    function totalLossOver(ehv: boolean): number {
      const sim = new Simulation();
      const g = sim.grid;
      const coal = g.addPlant('coal', 0, 0).bus;
      const sub = g.addSubstation(8, 0); // 较长的 HV 输电线
      const load = g.addLoad(10, 0, 'industrial', 40, '厂', 0).bus;
      g.addLine(coal.id, sub.id); // HV
      g.addLine(sub.id, load.id); // MV
      if (ehv) sim.tech.unlocked.add('ehv');
      let sum = 0;
      for (let i = 0; i < 80; i++) { sim.tick(0.05, 600); sum += sim.snapshot().totalLoss; }
      return sum;
    }
    expect(totalLossOver(true)).toBeLessThan(totalLossOver(false));
  });

  it('存档保留已解锁科技与研发点', () => {
    const sim = new Simulation();
    SCENARIOS[0].setup(sim);
    sim.tech.unlocked.add('efficient');
    sim.tech.points = 42;
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.tech.unlocked.has('efficient')).toBe(true);
    expect(sim2.tech.points).toBeCloseTo(42, 3);
  });
});
