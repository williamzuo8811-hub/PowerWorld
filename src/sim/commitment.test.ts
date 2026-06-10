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

  it('循环停开各计一次启动（受最小开/停机时间约束）', () => {
    const { sim, gen, load } = rig('coal', 40);
    sim.tick(3600, 1); // 启动并网
    expect(gen.startups).toBe(1);
    expect(gen.committed).toBe(true);
    load.baseDemand = 0; // 需求归零；最小开机(6h)内须维持 pmin
    sim.tick(3600, 1);
    expect(gen.committed).toBe(true); // 仍在最小开机锁内
    for (let i = 0; i < 12; i++) sim.tick(3600, 1); // 过最小开机 → 解列，进入最小停机
    expect(gen.committed).toBe(false);
    load.baseDemand = 40; // 需求恢复；最小停机(4h)内不可立即重启
    for (let i = 0; i < 10; i++) sim.tick(3600, 1); // 过最小停机 → 再次并网
    expect(gen.startups).toBe(2);
  });

  it('最小开机时间内即便无需求也维持 pmin（must-run）', () => {
    const { sim, gen, load } = rig('coal', 40);
    sim.tick(3600, 1); // 启动
    load.baseDemand = 0;
    sim.tick(3600, 1); // 最小开机锁内
    expect(gen.committed).toBe(true);
    expect(gen.output).toBeGreaterThan(gen.pmin - 1); // 维持在 pmin 附近
  });

  it('燃气启动成本远低于燃煤/核电', () => {
    expect(PLANTS.gas.startupCost).toBeLessThan(PLANTS.coal.startupCost);
    expect(PLANTS.coal.startupCost).toBeLessThan(PLANTS.nuclear.startupCost);
  });

  it('快照暴露并网机组数/可调机组数/累计启动数', () => {
    const { sim, gen } = rig('coal', 40);
    let snap = sim.snapshot();
    expect(snap.dispatchableUnits).toBe(1);
    expect(snap.committedUnits).toBe(0); // 尚未并网
    for (let i = 0; i < 40; i++) sim.tick(0.05, 600);
    snap = sim.snapshot();
    expect(gen.committed).toBe(true);
    expect(snap.committedUnits).toBe(1);
    expect(snap.startupsTotal).toBeGreaterThanOrEqual(1);
  });
});
