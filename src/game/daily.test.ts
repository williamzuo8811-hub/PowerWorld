import { describe, it, expect } from 'vitest';
import { Simulation } from '../sim/simulation';
import { setupDaily, dailySeed, mulberry32, scenarioById } from './scenarios';

describe('每日挑战', () => {
  it('同一种子生成完全相同的题面', () => {
    const a = new Simulation();
    const b = new Simulation();
    setupDaily(a, 20260610);
    setupDaily(b, 20260610);
    expect(a.money).toBe(b.money);
    expect(a.goalDay).toBe(b.goalDay);
    expect(a.clock).toBe(b.clock);
    expect(a.grid.buses.size).toBe(b.grid.buses.size);
    const posA = [...a.grid.buses.values()].map((x) => `${x.kind}@${x.x},${x.y}`).join('|');
    const posB = [...b.grid.buses.values()].map((x) => `${x.kind}@${x.x},${x.y}`).join('|');
    expect(posA).toBe(posB);
    expect(a.fuelPrice.gas).toBeCloseTo(b.fuelPrice.gas, 10);
    expect(a.carbonPriceMult).toBeCloseTo(b.carbonPriceMult, 10);
  });

  it('不同种子生成不同题面', () => {
    const a = new Simulation();
    const b = new Simulation();
    setupDaily(a, 20260610);
    setupDaily(b, 20260611);
    const posA = [...a.grid.buses.values()].map((x) => `${x.x},${x.y}`).join('|');
    const posB = [...b.grid.buses.values()].map((x) => `${x.x},${x.y}`).join('|');
    expect(posA === posB && a.money === b.money && a.goalDay === b.goalDay).toBe(false);
  });

  it('dailySeed 同一天稳定、跨天变化', () => {
    expect(dailySeed(new Date('2026-06-10T08:00:00Z'))).toBe(dailySeed(new Date('2026-06-10T23:59:00Z')));
    expect(dailySeed(new Date('2026-06-10T00:00:00Z'))).not.toBe(dailySeed(new Date('2026-06-11T00:00:00Z')));
  });

  it('mulberry32 确定性且分布在 [0,1)', () => {
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = r1();
      expect(v).toBe(r2());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('每日挑战关卡可正常开局并推进', () => {
    const sim = new Simulation();
    scenarioById('daily')!.setup(sim);
    expect(sim.grid.loads.size).toBeGreaterThanOrEqual(3);
    expect(Number.isFinite(sim.goalDay)).toBe(true);
    sim.tick(0.05, 600);
    expect(Number.isFinite(sim.money)).toBe(true);
  });
});
