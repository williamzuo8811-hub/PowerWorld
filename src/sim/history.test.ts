import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { HISTORY_MAX, HISTORY_SAMPLE_HOURS } from '../config/components';

describe('历史走势采样', () => {
  it('随运行积累采样点，按间隔采样', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    sim.grid.addLoad(0, 0, 'industrial', 30, 'x', 0);
    for (let i = 0; i < 600; i++) sim.tick(0.05, 600); // 约 5 小时
    expect(sim.history.length).toBeGreaterThan(1);
    // 相邻样本时间间隔接近采样间隔
    const d = sim.history[1].clock - sim.history[0].clock;
    expect(d).toBeGreaterThan(HISTORY_SAMPLE_HOURS * 0.5);
    expect(d).toBeLessThan(HISTORY_SAMPLE_HOURS * 1.5);
  });

  it('样本数不超过上限', () => {
    const sim = new Simulation();
    sim.sandbox = true; // 无输赢，持续运行
    sim.forcedOutages = false;
    for (let i = 0; i < 6000; i++) sim.tick(0.05, 5760); // 远超容量
    expect(sim.history.length).toBeLessThanOrEqual(HISTORY_MAX);
    expect(sim.history.length).toBe(HISTORY_MAX);
  });

  it('样本含清洁占比（发电结构趋势）', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    sim.grid.addLoad(0, 0, 'industrial', 30, 'x', 0);
    for (let i = 0; i < 600; i++) sim.tick(0.05, 600);
    expect(sim.history.length).toBeGreaterThan(0);
    for (const h of sim.history) {
      expect(h.cleanShare).toBeGreaterThanOrEqual(0);
      expect(h.cleanShare).toBeLessThanOrEqual(1);
    }
  });

  it('存档保留历史', () => {
    const sim = new Simulation();
    for (let i = 0; i < 300; i++) sim.tick(0.05, 600);
    const n = sim.history.length;
    expect(n).toBeGreaterThan(0);
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.history.length).toBe(n);
  });
});
