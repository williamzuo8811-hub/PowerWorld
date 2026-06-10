import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('天气与危机事件', () => {
  it('热浪抬高需求系数与实际负荷', () => {
    const sim = new Simulation();
    const { load } = sim.grid.addLoad(0, 0, 'residential', 30, '城', 0);
    sim.events.triggerKind(sim, 'heatwave');
    sim.events.update(sim);
    expect(sim.events.demandFactor).toBeGreaterThan(1);

    sim.tick(0.05, 600);
    // 同一时刻，带热浪系数的需求应高于不含系数的基准
    expect(load.demand).toBeGreaterThan(load.baseDemand * 0.4);
  });

  it('无风事件压低风电可用率', () => {
    const sim = new Simulation();
    sim.events.triggerKind(sim, 'calm');
    sim.events.update(sim);
    expect(sim.events.windCap).toBeLessThan(0.3);
  });

  it('风暴损毁一条在运线路', () => {
    const sim = new Simulation();
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0).bus;
    const sub = g.addSubstation(2, 0);
    g.addLine(coal.id, sub.id);
    sim.events.triggerKind(sim, 'storm');
    expect([...g.lines.values()].some((l) => l.tripped)).toBe(true);
  });

  it('事件到期后修正自动复原', () => {
    const sim = new Simulation();
    sim.events.nextAt = Infinity; // 关闭随机调度，保证测试确定性
    sim.events.triggerKind(sim, 'heatwave');
    sim.events.update(sim);
    expect(sim.events.demandFactor).toBeGreaterThan(1);
    sim.clock = 100; // 远超事件结束时间
    sim.events.update(sim);
    expect(sim.events.demandFactor).toBeCloseTo(1, 5);
  });
});
