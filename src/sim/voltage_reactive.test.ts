import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

/** 紧凑健康电网：电厂紧邻变电站与负荷，无功充裕。 */
function healthy(): Simulation {
  const sim = new Simulation();
  sim.forcedOutages = false;
  sim.events.nextAt = Infinity;
  sim.sandbox = true;
  const g = sim.grid;
  const coal = g.addPlant('coal', 5, 5);
  const sub = g.addSubstation(6, 5);
  const load = g.addLoad(7, 5, 'industrial', 30, '厂', 0);
  g.addLine(coal.bus.id, sub.id);
  g.addLine(sub.id, load.bus.id);
  return sim;
}

/** 无功受压电网：负荷经一条很长的高压线远距离供电（长重线 → 无功消耗大 → 压降）。
 *  localGen=true 时在远端枢纽再接一台机组，提供本地无功支撑。 */
function stressed(localGen: boolean): Simulation {
  const sim = new Simulation();
  sim.forcedOutages = false;
  sim.events.nextAt = Infinity;
  sim.sandbox = true;
  const g = sim.grid;
  const coal = g.addPlant('coal', 0, 0);
  const sub = g.addSubstation(60, 0); // 远离电厂 → 很长的高压线
  const load = g.addLoad(61, 0, 'industrial', 55, '远端负荷', 0);
  g.addLine(coal.bus.id, sub.id); // 长 HV 线（无功消耗大）
  g.addLine(sub.id, load.bus.id);
  if (localGen) {
    const c2 = g.addPlant('coal', 59, 0); // 紧邻枢纽的本地机组（本地无功支撑）
    g.addLine(c2.bus.id, sub.id);
  }
  return sim;
}

describe('无功功率与电压', () => {
  it('健康电网电压保持额定 (≈1.0 pu)', () => {
    const sim = healthy();
    for (let i = 0; i < 20; i++) sim.tick(0.05, 600);
    expect(sim.voltage).toBeGreaterThan(0.98);
  });

  it('长重线远距离供电造成欠压 (<0.95 pu)', () => {
    const sim = stressed(false);
    for (let i = 0; i < 40; i++) sim.tick(0.05, 600);
    expect(sim.voltage).toBeLessThan(0.95);
  });

  it('增加本地无功能力（更多机组）抬升电压', () => {
    const sim = stressed(false);
    for (let i = 0; i < 40; i++) sim.tick(0.05, 600);
    const vLow = sim.voltage;
    const sim2 = stressed(true); // 在远端枢纽再加一台机组 → 本地无功支撑
    for (let i = 0; i < 40; i++) sim2.tick(0.05, 600);
    expect(sim2.voltage).toBeGreaterThan(vLow);
  });

  it('电压进入快照与母线', () => {
    const sim = healthy();
    sim.tick(0.05, 600);
    const snap = sim.snapshot();
    expect(snap.voltage).toBeGreaterThan(0.9);
    const loadBus = [...sim.grid.buses.values()].find((b) => b.kind === 'load')!;
    expect(loadBus.voltage).toBeGreaterThan(0.9);
  });
});
