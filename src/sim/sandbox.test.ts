import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { scenarioById } from '../game/scenarios';

describe('沙盒模式', () => {
  it('沙盒不会破产、不会触发输赢', () => {
    const sim = new Simulation();
    sim.sandbox = true;
    sim.money = -100000; // 即便资金为负
    sim.grid.addLoad(0, 0, 'industrial', 30, '孤岛', 0); // 持续停电
    for (let i = 0; i < 200; i++) sim.tick(0.05, 600);
    expect(sim.gameOver).toBe(false);
    expect(sim.win).toBe(false);
  });

  it('沙盒关卡可建立且标记为 sandbox', () => {
    const sim = new Simulation();
    const sc = scenarioById('sandbox')!;
    expect(sc).toBeTruthy();
    sc.setup(sim);
    expect(sim.sandbox).toBe(true);
    expect(sim.money).toBeGreaterThan(1_000_000);
    expect(sim.grid.loads.size).toBeGreaterThan(0);
    sim.tick(0.05, 600);
    expect(sim.snapshot().sandbox).toBe(true);
  });

  it('reset 后沙盒标记复位', () => {
    const sim = new Simulation();
    sim.sandbox = true;
    sim.reset();
    expect(sim.sandbox).toBe(false);
  });
});
