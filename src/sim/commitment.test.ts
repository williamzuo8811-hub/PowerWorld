import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { PLANTS } from '../config/components';

/** 建一个 电厂→变电站→负荷 的小系统，返回各对象。 */
function rig(plant: 'coal' | 'gas' | 'nuclear', demand: number) {
  const sim = new Simulation();
  sim.forcedOutages = false;
  sim.events.nextAt = Infinity;
  sim.money = 50_000_000;
  const g = sim.grid;
  const p = g.addPlant(plant, 0, 0);
  const sub = g.addSubstation(2, 0);
  const load = g.addLoad(4, 0, 'industrial', demand, '厂', 0);
  g.addLine(p.bus.id, sub.id);
  g.addLine(sub.id, load.bus.id);
  return { sim, gen: p.gen, load: load.load };
}

describe('机组组合：启停成本与承诺状态', () => {
  it('机组并网计一次启动并扣启动成本', () => {
    const { sim, gen } = rig('coal', 40);
    expect(gen.committed).toBe(false);
    const m0 = sim.money;
    // 推进若干拍让燃煤爬坡并网
    for (let i = 0; i < 40; i++) sim.tick(0.05, 600);
    expect(gen.output).toBeGreaterThan(0.5);
    expect(gen.committed).toBe(true);
    expect(gen.startups).toBe(1); // 仅记一次启动
    expect(m0 - sim.money).toBeGreaterThan(PLANTS.coal.startupCost * 0.8); // 资金下降由启动费主导
  });

  it('稳定运行不重复计启动', () => {
    const { sim, gen } = rig('coal', 40);
    for (let i = 0; i < 40; i++) sim.tick(0.05, 600);
    expect(gen.committed).toBe(true);
    const s1 = gen.startups;
    for (let i = 0; i < 80; i++) sim.tick(0.05, 600); // 继续稳定运行
    expect(gen.startups).toBe(s1); // 不再增加
  });

  it('启停成本计入财务损益(startup 为负)', () => {
    const { sim } = rig('coal', 40);
    for (let i = 0; i < 60; i++) sim.tick(0.05, 600);
    expect(sim.finance.startup).toBeLessThan(0);
    expect(sim.startupsTotal).toBeGreaterThanOrEqual(1);
  });

  it('循环停开各计一次启动（启停惩罚循环）', () => {
    const { sim, gen, load } = rig('coal', 40);
    for (let i = 0; i < 40; i++) sim.tick(0.05, 600); // 启动 → committed
    expect(gen.startups).toBe(1);
    load.demand = 0; load.baseDemand = 0; // 需求归零 → 机组降到 0 → 解列
    for (let i = 0; i < 120; i++) sim.tick(0.05, 600);
    expect(gen.committed).toBe(false);
    load.baseDemand = 40; // 需求恢复 → 再次并网
    for (let i = 0; i < 80; i++) sim.tick(0.05, 600);
    expect(gen.startups).toBe(2); // 第二次启动
  });

  it('燃气启动成本远低于燃煤/核电', () => {
    expect(PLANTS.gas.startupCost).toBeLessThan(PLANTS.coal.startupCost);
    expect(PLANTS.coal.startupCost).toBeLessThan(PLANTS.nuclear.startupCost);
  });
});
