import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { SEASON_YEAR_DAYS, MAINT_SHOULDER_FACTOR, MAINT_PEAK_FACTOR } from '../config/components';

describe('季节性检修成本', () => {
  it('换季检修优惠、旺季检修加价', () => {
    const sim = new Simulation();
    const factorAt = (phase: number) => {
      sim.clock = phase * SEASON_YEAR_DAYS * 24;
      return sim.seasonMaintFactor;
    };
    expect(factorAt(0.0)).toBeCloseTo(MAINT_SHOULDER_FACTOR, 4); // 春（换季）
    expect(factorAt(0.5)).toBeCloseTo(MAINT_SHOULDER_FACTOR, 4); // 秋（换季）
    expect(factorAt(0.25)).toBeCloseTo(MAINT_PEAK_FACTOR, 4); // 夏（旺季）
    expect(factorAt(0.75)).toBeCloseTo(MAINT_PEAK_FACTOR, 4); // 冬（旺季）
    expect(factorAt(0.25)).toBeGreaterThan(factorAt(0.0)); // 旺季 > 淡季
  });

  it('同一电厂夏季检修费高于春季', () => {
    function maintCost(phase: number): number {
      const sim = new Simulation();
      const { bus } = sim.grid.addPlant('coal', 0, 0);
      sim.clock = phase * SEASON_YEAR_DAYS * 24;
      return sim.maintenanceCost(bus.id)!;
    }
    const spring = maintCost(0.0);
    const summer = maintCost(0.25);
    expect(summer).toBeGreaterThan(spring);
  });

  it('scheduleMaintenance 在旺季多扣费、机组离线、役龄下降', () => {
    const sim = new Simulation();
    sim.money = 10_000_000;
    const { bus, gen } = sim.grid.addPlant('coal', 0, 0);
    gen.age = 50;
    sim.clock = 0.25 * SEASON_YEAR_DAYS * 24; // 盛夏
    const quote = sim.maintenanceCost(bus.id)!;
    const before = sim.money;
    expect(sim.scheduleMaintenance(bus.id)).toBe(true);
    expect(before - sim.money).toBe(quote); // 按季节调整后报价扣费
    expect(sim.genOffline(gen)).toBe(true); // 离线检修
    expect(gen.age).toBeLessThan(50); // 役龄下降
  });

  it('maintenanceCost 对非电厂/在建返回 null', () => {
    const sim = new Simulation();
    const sub = sim.grid.addSubstation(0, 0);
    expect(sim.maintenanceCost(sub.id)).toBeNull();
  });
});
