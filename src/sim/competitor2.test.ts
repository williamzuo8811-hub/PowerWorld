import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('竞争对手动态策略', () => {
  it('市场高价时廉价竞争对手扩张', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    // 无玩家电源 → 区域供给偏紧 → 出清价高 → 竞争对手盈利扩张
    const greenBase = sim.competitors[0].capacity; // 绿源（最便宜）
    for (let i = 0; i < 2000; i++) sim.tick(0.05, 5760); // 约 6.7 天
    expect(sim.competitors[0].capacity).toBeGreaterThan(greenBase);
  });

  it('被廉价玩家电源挤出时昂贵竞争对手退役', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    for (let k = 0; k < 6; k++) sim.grid.addPlant('nuclear', k, 0); // 大量廉价核电压低出清价
    const peakIdx = sim.competitors.findIndex((c) => c.marginalCost > 50); // 峰谷（最贵）
    const peakBase = sim.competitors[peakIdx].capacity;
    for (let i = 0; i < 2000; i++) sim.tick(0.05, 5760);
    expect(sim.competitors[peakIdx].capacity).toBeLessThan(peakBase);
  });

  it('容量受上下限约束', () => {
    const sim = new Simulation();
    sim.sandbox = true; // 无输赢，持续演化
    sim.forcedOutages = false;
    for (let i = 0; i < 8000; i++) sim.tick(0.05, 5760); // 远期
    for (const c of sim.competitors) {
      expect(c.capacity).toBeGreaterThanOrEqual(c.base * 0.3 - 1e-6);
      expect(c.capacity).toBeLessThanOrEqual(c.base * 2.5 + 1e-6);
    }
  });
});
