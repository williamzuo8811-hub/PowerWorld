import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { TARIFF, SPOT } from '../config/components';

function setup(demand: number): Simulation {
  const sim = new Simulation();
  const g = sim.grid;
  const coal = g.addPlant('coal', 0, 0).bus; // 60MW 容量
  const sub = g.addSubstation(2, 0);
  const load = g.addLoad(4, 0, 'industrial', demand, '厂', 0).bus;
  g.addLine(coal.id, sub.id);
  g.addLine(sub.id, load.id);
  for (let i = 0; i < 40; i++) sim.tick(0.05, 600);
  return sim;
}

describe('现货电价', () => {
  it('稀缺时电价高于充裕时，且高于基准电价', () => {
    const plenty = setup(20); // 容量远大于需求
    const scarce = setup(220); // 需求远大于容量
    expect(scarce.spotPrice).toBeGreaterThan(plenty.spotPrice);
    expect(scarce.spotPrice).toBeGreaterThan(TARIFF);
  });

  it('电价始终落在配置的上下限内', () => {
    const sim = setup(220);
    for (let i = 0; i < 50; i++) sim.tick(0.05, 600);
    expect(sim.spotPrice).toBeGreaterThanOrEqual(SPOT.floor);
    expect(sim.spotPrice).toBeLessThanOrEqual(SPOT.cap);
  });

  it('备用率随需求/容量比变化', () => {
    const plenty = setup(20);
    const scarce = setup(220);
    expect(plenty.reserveMargin).toBeGreaterThan(scarce.reserveMargin);
  });
});
