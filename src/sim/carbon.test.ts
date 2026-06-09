import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

function carbonFinance(type: 'coal' | 'gas'): number {
  const sim = new Simulation();
  sim.forcedOutages = false;
  const g = sim.grid;
  const p = g.addPlant(type, 0, 0);
  const sub = g.addSubstation(2, 0);
  const load = g.addLoad(4, 0, 'industrial', 30, '厂', 0);
  g.addLine(p.bus.id, sub.id);
  g.addLine(sub.id, load.bus.id);
  for (let i = 0; i < 200; i++) sim.tick(0.05, 600);
  return sim.finance.carbon; // 正=买配额(成本)，负=卖配额(收益)
}

describe('碳配额交易', () => {
  it('基准排放强度随时间收紧', () => {
    const sim = new Simulation();
    const b0 = sim.benchmarkIntensity;
    sim.clock = 24 * 10; // 第 10 天
    const b10 = sim.benchmarkIntensity;
    expect(b10).toBeLessThan(b0);
    sim.clock = 24 * 100; // 远期 → 触及下限
    expect(sim.benchmarkIntensity).toBeGreaterThanOrEqual(0.1);
  });

  it('高于基准（燃煤）需买配额付费', () => {
    expect(carbonFinance('coal')).toBeGreaterThan(0);
  });

  it('低于基准（燃气，开局更清洁）卖出配额获利', () => {
    // 燃气排放 0.45 < 开局基准 0.55 → 富余配额卖出 → 碳收益（负成本）
    expect(carbonFinance('gas')).toBeLessThan(0);
  });
});
