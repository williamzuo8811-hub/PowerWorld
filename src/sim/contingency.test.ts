import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { analyzeN1 } from './contingency';

function warm(sim: Simulation, n = 60): void {
  for (let i = 0; i < n; i++) sim.tick(0.05, 600);
}

describe('N-1 冗余校核', () => {
  it('辐射状单回路供电不满足 N-1（失去线路即停电）', () => {
    const sim = new Simulation();
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0).bus;
    const sub = g.addSubstation(2, 0);
    const load = g.addLoad(4, 0, 'industrial', 30, '厂', 0).bus;
    g.addLine(coal.id, sub.id);
    g.addLine(sub.id, load.id);
    warm(sim);

    const rep = analyzeN1(g);
    expect(rep.checked).toBeGreaterThan(0);
    expect(rep.secure).toBe(false);
    expect(rep.contingencies.length).toBeGreaterThan(0);
    expect(rep.vulnerableLineIds.size).toBeGreaterThan(0);
    // 失去任一线路都会失负荷
    expect(rep.contingencies.some((c) => c.lostLoadMW > 1)).toBe(true);
  });

  it('双电源 + 双回路供电满足 N-1', () => {
    const sim = new Simulation();
    const g = sim.grid;
    const coal1 = g.addPlant('coal', 0, 0).bus;
    const coal2 = g.addPlant('coal', 0, 6).bus;
    const subA = g.addSubstation(3, 1);
    const subB = g.addSubstation(3, 5);
    const load = g.addLoad(6, 3, 'industrial', 30, '城区', 0).bus;
    g.addLine(coal1.id, subA.id);
    g.addLine(coal2.id, subB.id);
    g.addLine(subA.id, load.id); // 两条独立配电馈线
    g.addLine(subB.id, load.id);
    warm(sim);

    const rep = analyzeN1(g);
    expect(rep.checked).toBeGreaterThan(0);
    expect(rep.secure).toBe(true);
    expect(rep.contingencies.length).toBe(0);
  });

  it('不修改任何仿真状态（只读分析）', () => {
    const sim = new Simulation();
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0).bus;
    const sub = g.addSubstation(2, 0);
    const load = g.addLoad(4, 0, 'industrial', 30, '厂', 0);
    g.addLine(coal.id, sub.id);
    g.addLine(sub.id, load.bus.id);
    warm(sim);
    const moneyBefore = sim.money;
    const demandBefore = load.load.demand;
    analyzeN1(g);
    expect(sim.money).toBe(moneyBefore);
    expect(load.load.demand).toBe(demandBefore);
  });
});
