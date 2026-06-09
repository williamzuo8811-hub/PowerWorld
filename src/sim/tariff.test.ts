import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { TARIFF_CLASS } from '../config/components';
import type { LoadProfile } from './types';

function unitRevenue(profile: LoadProfile): number {
  const sim = new Simulation();
  sim.forcedOutages = false;
  const g = sim.grid;
  const coal = g.addPlant('coal', 0, 0); // 容量充裕，始终满足
  const sub = g.addSubstation(2, 0);
  const load = g.addLoad(4, 0, profile, 40, '区', 0);
  g.addLine(coal.bus.id, sub.id);
  g.addLine(sub.id, load.bus.id);
  for (let i = 0; i < 200; i++) sim.tick(0.05, 600);
  // ¥/天 ÷ 当前供电(MW) ≈ 单位电量收入（剔除供电量差异）
  return sim.finance.revenue / Math.max(sim.snapshot().totalServed, 0.01);
}

describe('差异化电价（客户分类）', () => {
  it('分类系数：居民 > 商业 > 工业', () => {
    expect(TARIFF_CLASS.residential).toBeGreaterThan(TARIFF_CLASS.commercial);
    expect(TARIFF_CLASS.commercial).toBeGreaterThan(TARIFF_CLASS.industrial);
  });

  it('居民单位电量收入高于工业', () => {
    expect(unitRevenue('residential')).toBeGreaterThan(unitRevenue('industrial'));
  });

  it('财务报表按类别拆分售电收入', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0);
    const sub = g.addSubstation(2, 0);
    const load = g.addLoad(4, 0, 'commercial', 30, '商区', 0);
    g.addLine(coal.bus.id, sub.id);
    g.addLine(sub.id, load.bus.id);
    for (let i = 0; i < 200; i++) sim.tick(0.05, 600);
    expect(sim.finance.byClass.commercial).toBeGreaterThan(0);
    expect(sim.finance.byClass.industrial).toBe(0);
  });
});
