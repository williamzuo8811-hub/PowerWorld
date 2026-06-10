import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

/** 建电厂→变电站→负荷；可选加一台燃气作黑启动种子。返回 sim 与负荷母线。 */
function rig(blackStart: boolean) {
  const sim = new Simulation();
  sim.forcedOutages = false;
  sim.events.nextAt = Infinity;
  sim.sandbox = true;
  const g = sim.grid;
  const coal = g.addPlant('coal', 0, 0);
  const sub = g.addSubstation(2, 0);
  const load = g.addLoad(4, 0, 'industrial', 40, '厂', 0);
  g.addLine(coal.bus.id, sub.id);
  g.addLine(sub.id, load.bus.id);
  if (blackStart) {
    const gas = g.addPlant('gas', 0, 1);
    g.addLine(gas.bus.id, sub.id);
  }
  return { sim, g, load };
}

/** 正常运行→全黑→恢复 1 小时后，返回负荷母线能量化程度。 */
function energizedAfterRestore(blackStart: boolean): number {
  const { sim, g, load } = rig(blackStart);
  for (let i = 0; i < 5; i++) sim.tick(3600, 1); // 正常供电 → energized=1
  for (const ge of g.gens.values()) ge.outageUntil = sim.clock + 1000; // 全部停运 → 全黑
  for (let i = 0; i < 3; i++) sim.tick(3600, 1); // energized→0
  for (const ge of g.gens.values()) ge.outageUntil = undefined; // 恢复供电
  sim.tick(3600, 1); // 恢复 1 小时
  return load.bus.energized ?? 1;
}

describe('黑启动与停电恢复', () => {
  it('正常运行能量化保持满（=1）', () => {
    const { sim, load } = rig(false);
    for (let i = 0; i < 5; i++) sim.tick(3600, 1);
    expect(load.bus.energized).toBeCloseTo(1, 3);
  });

  it('全黑使能量化骤降至 0', () => {
    const { sim, g, load } = rig(false);
    for (let i = 0; i < 5; i++) sim.tick(3600, 1);
    for (const ge of g.gens.values()) ge.outageUntil = sim.clock + 1000;
    sim.tick(3600, 1);
    expect(load.bus.energized).toBeCloseTo(0, 3);
    expect(load.bus.blackout).toBe(true);
  });

  it('黑启动资源（燃气）使恢复更快', () => {
    const withBS = energizedAfterRestore(true);
    const noBS = energizedAfterRestore(false);
    expect(withBS).toBeGreaterThan(noBS);
    expect(withBS).toBeCloseTo(1, 2); // 黑启动 1 小时内基本全恢复
    expect(noBS).toBeLessThan(0.9); // 无黑启动恢复缓慢
  });

  it('储能(有电量)也可作黑启动种子', () => {
    const sim = new Simulation();
    sim.forcedOutages = false; sim.events.nextAt = Infinity; sim.sandbox = true;
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0);
    const sub = g.addSubstation(2, 0);
    const load = g.addLoad(4, 0, 'industrial', 40, '厂', 0);
    const bat = g.addBattery(0, 1, 'battery');
    g.addLine(coal.bus.id, sub.id);
    g.addLine(sub.id, load.bus.id);
    g.addLine(bat.bus.id, sub.id);
    for (let i = 0; i < 5; i++) sim.tick(3600, 1);
    for (const ge of g.gens.values()) ge.outageUntil = sim.clock + 1000;
    for (let i = 0; i < 3; i++) sim.tick(3600, 1);
    for (const ge of g.gens.values()) ge.outageUntil = undefined;
    sim.tick(3600, 1);
    expect(load.bus.energized).toBeCloseTo(1, 2); // 储能种子 → 快速恢复
  });

  it('能量化进入存档', () => {
    const { sim, g, load } = rig(false);
    for (let i = 0; i < 5; i++) sim.tick(3600, 1);
    for (const ge of g.gens.values()) ge.outageUntil = sim.clock + 1000;
    sim.tick(3600, 1); // energized≈0
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    const lb2 = sim2.grid.buses.get(load.bus.id)!;
    expect(lb2.energized).toBeCloseTo(load.bus.energized ?? 1, 4);
  });
});
