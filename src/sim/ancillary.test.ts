import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

function ancillaryOf(setup: (s: Simulation) => void): number {
  const sim = new Simulation();
  sim.forcedOutages = false;
  setup(sim);
  for (let i = 0; i < 50; i++) sim.tick(0.05, 600);
  return sim.finance.ancillary;
}

describe('辅助服务市场', () => {
  it('储能提供调频获得辅助服务收入', () => {
    expect(ancillaryOf((s) => s.grid.addBattery(0, 0, 'battery'))).toBeGreaterThan(0);
  });

  it('闲置可调容量提供备用获得收入', () => {
    // 燃气在建满负荷之前有大量备用容量
    expect(ancillaryOf((s) => s.grid.addPlant('gas', 0, 0))).toBeGreaterThan(0);
  });

  it('储能让辅助服务收入更高（调频价更高）', () => {
    const withBattery = ancillaryOf((s) => { s.grid.addPlant('coal', 0, 0); s.grid.addBattery(2, 0, 'battery'); });
    const coalOnly = ancillaryOf((s) => s.grid.addPlant('coal', 0, 0));
    expect(withBattery).toBeGreaterThan(coalOnly);
  });

  it('reset 清零辅助服务损益', () => {
    const sim = new Simulation();
    sim.finance.ancillary = 999;
    sim.reset();
    expect(sim.finance.ancillary).toBe(0);
  });
});
