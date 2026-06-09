import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { seasonIntensity } from './profiles';
import { SEASON_YEAR_DAYS } from '../config/components';

describe('季节性（年度循环）', () => {
  it('seasonIntensity 在四季节点取值正确', () => {
    const spring = seasonIntensity(0);
    expect(spring.summer).toBeCloseTo(0, 6);
    expect(spring.winter).toBeCloseTo(0, 6);
    const summer = seasonIntensity(0.25);
    expect(summer.summer).toBeCloseTo(1, 6);
    expect(summer.winter).toBeCloseTo(0, 6);
    const autumn = seasonIntensity(0.5);
    expect(autumn.summer).toBeCloseTo(0, 6);
    expect(autumn.winter).toBeCloseTo(0, 6);
    const winter = seasonIntensity(0.75);
    expect(winter.summer).toBeCloseTo(0, 6);
    expect(winter.winter).toBeCloseTo(1, 6);
  });

  it('夏冬需求高于春秋', () => {
    const sim = new Simulation();
    sim.clock = 0; // 春
    const spring = sim.seasonDemandFactor;
    sim.clock = 0.25 * SEASON_YEAR_DAYS * 24; // 夏
    const summer = sim.seasonDemandFactor;
    sim.clock = 0.5 * SEASON_YEAR_DAYS * 24; // 秋
    const autumn = sim.seasonDemandFactor;
    sim.clock = 0.75 * SEASON_YEAR_DAYS * 24; // 冬
    const winter = sim.seasonDemandFactor;
    expect(spring).toBeCloseTo(1, 6);
    expect(autumn).toBeCloseTo(1, 6);
    expect(summer).toBeGreaterThan(spring);
    expect(winter).toBeGreaterThan(autumn);
    expect(summer).toBeGreaterThan(winter); // 制冷峰 > 采暖峰
  });

  it('光伏夏强冬弱、风电冬强夏弱', () => {
    const sim = new Simulation();
    sim.clock = 0.25 * SEASON_YEAR_DAYS * 24; // 夏
    const solarSummer = sim.seasonSolarFactor;
    const windSummer = sim.seasonWindFactor;
    sim.clock = 0.75 * SEASON_YEAR_DAYS * 24; // 冬
    const solarWinter = sim.seasonSolarFactor;
    const windWinter = sim.seasonWindFactor;
    expect(solarSummer).toBeGreaterThan(solarWinter);
    expect(windWinter).toBeGreaterThan(windSummer);
  });

  it('季节标签随相位推进', () => {
    const sim = new Simulation();
    const label = (phase: number) => {
      sim.clock = phase * SEASON_YEAR_DAYS * 24;
      return sim.seasonLabel;
    };
    expect(label(0.0)).toBe('春');
    expect(label(0.25)).toBe('夏');
    expect(label(0.5)).toBe('秋');
    expect(label(0.75)).toBe('冬');
  });

  it('夏季区域需求高于春季（端到端，剔除景气扰动）', () => {
    // 取整天 → 同一时刻(0点)；除以景气系数以隔离季节效应
    function seasonalDemand(day: number): number {
      const sim = new Simulation();
      sim.clock = day * 24;
      return sim.regionalDemand / sim.cycleFactor;
    }
    const spring = seasonalDemand(0); // 春
    const summer = seasonalDemand(0.25 * SEASON_YEAR_DAYS); // 夏（第6天）
    expect(summer).toBeGreaterThan(spring);
  });

  it('季节性进入存档快照', () => {
    const sim = new Simulation();
    sim.clock = 0.25 * SEASON_YEAR_DAYS * 24;
    const snap = sim.snapshot();
    expect(snap.season).toBe('夏');
    expect(snap.seasonFactor).toBeGreaterThan(1);
  });
});
