import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { CYCLE_AMPLITUDE } from '../config/components';

describe('经济周期', () => {
  it('景气系数在繁荣期>1、衰退期<1，且有界', () => {
    const sim = new Simulation();
    sim.clock = 48; // 8天周期的峰值（第2天）
    expect(sim.cycleFactor).toBeGreaterThan(1 + CYCLE_AMPLITUDE * 0.9);
    expect(sim.cycleLabel).toBe('繁荣');
    sim.clock = 144; // 谷值（第6天）
    expect(sim.cycleFactor).toBeLessThan(1 - CYCLE_AMPLITUDE * 0.9);
    expect(sim.cycleLabel).toBe('衰退');
  });

  it('系数始终落在 [1-振幅, 1+振幅]', () => {
    const sim = new Simulation();
    for (let h = 0; h < 400; h += 7) {
      sim.clock = h;
      expect(sim.cycleFactor).toBeGreaterThanOrEqual(1 - CYCLE_AMPLITUDE - 1e-9);
      expect(sim.cycleFactor).toBeLessThanOrEqual(1 + CYCLE_AMPLITUDE + 1e-9);
    }
  });

  it('繁荣期需求高于衰退期（同一时刻）', () => {
    function demandAt(clock: number): number {
      const sim = new Simulation();
      sim.events.nextAt = Infinity;
      sim.forcedOutages = false;
      const { load } = sim.grid.addLoad(0, 0, 'industrial', 40, 'x', 0);
      sim.clock = clock;
      sim.tick(0.0001, 1); // 极小步长，clock 几乎不变
      return load.demand;
    }
    // 48h 与 144h 同为 0 点钟（96h=4天整），但景气相反
    expect(demandAt(48)).toBeGreaterThan(demandAt(144));
  });
});
