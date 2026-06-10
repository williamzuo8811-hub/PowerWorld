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
    sim.recommendExpansion();
    expect(sim.money).toBe(moneyBefore);
    expect(sim.clock).toBe(clockBefore);
  });

  it('充裕机队无补强缺口', () => {
    const sim = withLoad();
    for (let k = 0; k < 8; k++) sim.grid.addPlant('coal', k, 1); // 大量可调容量
    const adv = sim.recommendExpansion();
    expect(adv.gapMW).toBe(0);
    expect(adv.option).toBeNull();
  });

  it('容量不足时推荐每可信MW最省的方案（燃气）并给出工期与开工时点', () => {
    const sim = withLoad();
    sim.grid.addPlant('gas', 0, 1); // 仅少量可调容量 → 约束情景缺口
    const adv = sim.recommendExpansion();
    expect(adv.gapMW).toBeGreaterThan(0);
    expect(adv.option).not.toBeNull();
    expect(adv.option!.label).toBe('燃气'); // 每可信 MW 造价最低
    expect(adv.option!.units).toBeGreaterThanOrEqual(1);
    expect(adv.option!.capex).toBeGreaterThan(0);
    expect(adv.option!.buildDays).toBeGreaterThan(0);
    // 补强容量应足以覆盖缺口
    expect(adv.option!.units * adv.option!.firmPerUnit).toBeGreaterThanOrEqual(adv.gapMW);
  });

  it('多年轨迹：正增长下备用率逐年下降并最终出现缺口', () => {
    const sim = new Simulation();
    sim.grid.addLoad(0, 0, 'residential', 100, '城区', 0.003); // 正增长
    for (let k = 0; k < 4; k++) sim.grid.addPlant('coal', k, 1); // 当前充裕
    const traj = sim.planningTrajectory(8);
    expect(traj.length).toBe(9); // year 0..8
    expect(traj[0].year).toBe(0);
    // 备用率单调不增
    for (let i = 1; i < traj.length; i++) {
      expect(traj[i].reserveMargin).toBeLessThanOrEqual(traj[i - 1].reserveMargin + 1e-9);
    }
    // 第 0 年充裕、末年出现缺口
    expect(traj[0].verdict).not.toBe('shortfall');
    expect(traj[traj.length - 1].verdict).toBe('shortfall');
  });

  it('多年轨迹：零增长下备用率保持不变', () => {
    const sim = new Simulation();
    sim.grid.addLoad(0, 0, 'residential', 100, '城区', 0); // 零增长
    for (let k = 0; k < 4; k++) sim.grid.addPlant('coal', k, 1);
    const traj = sim.planningTrajectory(5);
    for (let i = 1; i < traj.length; i++) {
      expect(traj[i].reserveMargin).toBeCloseTo(traj[0].reserveMargin, 6);
    }
  });

  it('正增长负荷给出有限赤字日，零增长则不发生', () => {
    const grow = new Simulation();
    grow.grid.addLoad(0, 0, 'residential', 100, '城区', 0.002); // 正增长
    for (let k = 0; k < 5; k++) grow.grid.addPlant('coal', k, 1); // 当前充裕
    const a1 = grow.recommendExpansion();
    expect(Number.isFinite(a1.deficitDay)).toBe(true);
    expect(a1.deficitDay).toBeGreaterThan(grow.day);

    const flat = new Simulation();
    flat.grid.addLoad(0, 0, 'residential', 100, '城区', 0); // 零增长
    for (let k = 0; k < 5; k++) flat.grid.addPlant('coal', k, 1);
    const a2 = flat.recommendExpansion();
    expect(Number.isFinite(a2.deficitDay)).toBe(false);
  });
});
