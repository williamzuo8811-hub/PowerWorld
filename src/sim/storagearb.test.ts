import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { SEASON_YEAR_DAYS } from '../config/components';

/** 光伏+储能日内套利场景：白天光伏过剩→储能充电(低价)，傍晚缺口→放电(高价)。 */
function runArb(phaseDays: number): number {
  const sim = new Simulation();
  sim.forcedOutages = false;
  sim.events.nextAt = Infinity;
  sim.sandbox = true;
  const g = sim.grid;
  const sub = g.addSubstation(2, 0);
  const load = g.addLoad(4, 0, 'industrial', 60, '厂', 0);
  g.addLine(sub.id, load.bus.id);
  for (let k = 0; k < 3; k++) { const s = g.addPlant('solar', k, 1); g.addLine(s.bus.id, sub.id); }
  const c = g.addPlant('coal', 0, 2); g.addLine(c.bus.id, sub.id);
  for (let k = 0; k < 3; k++) { const b = g.addBattery(k, 3, 'pumped'); g.addLine(b.bus.id, sub.id); }
  sim.clock = phaseDays * 24; // 指定季节相位（整天 → 0 点起）
  for (let i = 0; i < 24 * 3; i++) sim.tick(3600, 1); // 推进 3 天，跨越日内价格波动
  return sim.storageArbDay;
}

describe('储能价差套利（季节性）', () => {
  it('日内充放电带来正的套利收益', () => {
    const arb = runArb(0); // 春
    expect(arb).toBeGreaterThan(0);
  });

  it('旺季（夏）价差更宽，套利收益高于换季（春）', () => {
    const spring = runArb(0); // 春（换季）
    const summer = runArb(0.25 * SEASON_YEAR_DAYS); // 夏（旺季）
    expect(summer).toBeGreaterThan(spring);
  });

  it('无储能则无套利收益', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    sim.events.nextAt = Infinity;
    sim.sandbox = true;
    const g = sim.grid;
    const sub = g.addSubstation(2, 0);
    const load = g.addLoad(4, 0, 'industrial', 60, '厂', 0);
    g.addLine(sub.id, load.bus.id);
    const c = g.addPlant('coal', 0, 2); g.addLine(c.bus.id, sub.id);
    for (let i = 0; i < 24 * 2; i++) sim.tick(3600, 1);
    expect(sim.storageArbDay).toBeCloseTo(0, 6);
  });
});
