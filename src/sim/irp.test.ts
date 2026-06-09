import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

/** 建一个带负荷的小系统：返回 sim */
function withLoad(): Simulation {
  const sim = new Simulation();
  sim.grid.addLoad(0, 0, 'residential', 100, '城区', 0);
  return sim;
}

describe('长期规划压力测试（IRP）', () => {
  it('返回全部内置情景', () => {
    const sim = withLoad();
    const res = sim.stressTest();
    expect(res.length).toBe(6);
    expect(res.map((r) => r.id)).toContain('drought');
    expect(res.map((r) => r.id)).toContain('extreme');
  });

  it('增加可调容量提升各情景备用率', () => {
    const a = withLoad();
    const baseMargin = a.stressTest().find((r) => r.id === 'base')!.reserveMargin;
    const b = withLoad();
    for (let k = 0; k < 4; k++) b.grid.addPlant('coal', k, 1); // 大量火电
    const moreMargin = b.stressTest().find((r) => r.id === 'base')!.reserveMargin;
    expect(moreMargin).toBeGreaterThan(baseMargin);
  });

  it('容量不足时高增长情景判为缺口', () => {
    const sim = withLoad();
    sim.grid.addPlant('gas', 0, 1); // 仅少量可调容量
    const growth = sim.stressTest().find((r) => r.id === 'growth')!;
    expect(growth.verdict).toBe('shortfall');
    expect(growth.reserveMargin).toBeLessThan(0);
  });

  it('新能源枯竭情景下高新能源系统备用率显著下降', () => {
    const sim = withLoad();
    for (let k = 0; k < 6; k++) sim.grid.addPlant('solar', k, 2); // 高比例光伏
    const res = sim.stressTest();
    const base = res.find((r) => r.id === 'base')!;
    const drought = res.find((r) => r.id === 'drought')!;
    expect(drought.reserveMargin).toBeLessThan(base.reserveMargin);
  });

  it('燃料飙升与碳价收紧侵蚀经济韧性', () => {
    const sim = withLoad();
    for (let k = 0; k < 3; k++) sim.grid.addPlant('coal', k, 1);
    const res = sim.stressTest();
    const base = res.find((r) => r.id === 'base')!.dailyNet;
    const fuel = res.find((r) => r.id === 'fuel')!.dailyNet;
    const carbon = res.find((r) => r.id === 'carbon')!.dailyNet;
    expect(fuel).toBeLessThan(base);
    expect(carbon).toBeLessThan(base);
  });

  it('不改动仿真状态（纯分析）', () => {
    const sim = withLoad();
    sim.grid.addPlant('coal', 0, 1);
    const moneyBefore = sim.money;
    const clockBefore = sim.clock;
    sim.stressTest();
    expect(sim.money).toBe(moneyBefore);
    expect(sim.clock).toBe(clockBefore);
  });
});
