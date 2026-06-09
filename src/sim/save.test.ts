import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { SCENARIOS } from '../game/scenarios';

describe('存档与关卡', () => {
  it('serialize/deserialize 往返保持电网与状态', () => {
    const sim = new Simulation();
    SCENARIOS[0].setup(sim);
    for (let i = 0; i < 80; i++) sim.tick(0.05, 600); // 产生潮流/经济/SoC 变化

    const blob = JSON.parse(JSON.stringify(sim.serialize())); // 模拟存盘到磁盘再读回
    const busCount = sim.grid.buses.size;
    const money = sim.money;
    const clock = sim.clock;

    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.grid.buses.size).toBe(busCount);
    expect(sim2.grid.lines.size).toBe(sim.grid.lines.size);
    expect(sim2.money).toBeCloseTo(money, 3);
    expect(sim2.clock).toBeCloseTo(clock, 6);
    expect(sim2.goalDay).toBe(sim.goalDay);

    for (let i = 0; i < 20; i++) sim2.tick(0.05, 600); // 继续推进不应崩溃
    expect(Number.isFinite(sim2.money)).toBe(true);
  });

  it('reset 清空电网与状态', () => {
    const sim = new Simulation();
    SCENARIOS[1].setup(sim);
    expect(sim.grid.buses.size).toBeGreaterThan(0);
    sim.reset();
    expect(sim.grid.buses.size).toBe(0);
    expect(sim.clock).toBe(0);
    expect(sim.money).toBeGreaterThan(0);
  });

  it('三个关卡都能正常建立并各有目标', () => {
    for (const sc of SCENARIOS) {
      const sim = new Simulation();
      sc.setup(sim);
      expect(sim.grid.loads.size).toBeGreaterThan(0);
      expect(sim.goalDay).toBeGreaterThan(0);
      sim.tick(0.05, 600); // 跑一帧不报错
      expect(Number.isFinite(sim.money)).toBe(true);
    }
  });
});
