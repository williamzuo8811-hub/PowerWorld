import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { seasonIntensity } from './profiles';
import { SEASON_YEAR_DAYS } from '../config/components';

describe('季节性燃料价格', () => {
  it('天然气深冬基准抬升、夏季/换季回到 1.0', () => {
    const sim = new Simulation();
    const meanAt = (phase: number, fuel: 'coal' | 'gas' | 'uranium') => {
      sim.clock = phase * SEASON_YEAR_DAYS * 24;
      return sim.fuelSeasonMean(fuel);
    };
    expect(meanAt(0.75, 'gas')).toBeCloseTo(1.35, 2); // 深冬
    expect(meanAt(0.0, 'gas')).toBeCloseTo(1.0, 2); // 春
    expect(meanAt(0.25, 'gas')).toBeCloseTo(1.0, 2); // 夏
    expect(meanAt(0.75, 'coal')).toBeCloseTo(1.1, 2); // 煤：轻度冬季溢价
    expect(meanAt(0.75, 'uranium')).toBeCloseTo(1.0, 6); // 铀：无季节性
    expect(meanAt(0.75, 'gas')).toBeGreaterThan(meanAt(0.75, 'coal')); // 气的冬季溢价更强
  });

  it('一整年里冬季气价高于夏季（确定性积分）', () => {
    const orig = Math.random;
    Math.random = () => 0.5; // 去随机：随机游走=0、不触发跳涨 → 纯季节性回归
    try {
      const sim = new Simulation();
      sim.sandbox = true; // 空网防止自动通关中止 tick
      sim.forcedOutages = false;
      sim.events.nextAt = Infinity;
      let winterSum = 0, winterN = 0, summerSum = 0, summerN = 0;
      const totalH = 3 * SEASON_YEAR_DAYS * 24;
      for (let h = 0; h < totalH; h++) {
        sim.tick(3600, 1); // 推进 1 仿真小时
        if (h < SEASON_YEAR_DAYS * 24) continue; // 跳过首年瞬态
        const s = seasonIntensity(sim.yearPhase);
        if (s.winter > 0.7) { winterSum += sim.fuelPrice.gas; winterN++; }
        if (s.summer > 0.7) { summerSum += sim.fuelPrice.gas; summerN++; }
      }
      expect(winterN).toBeGreaterThan(0);
      expect(summerN).toBeGreaterThan(0);
      expect(winterSum / winterN).toBeGreaterThan(summerSum / summerN);
    } finally {
      Math.random = orig;
    }
  });
});
