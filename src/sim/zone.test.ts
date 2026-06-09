import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('多区域市场（跨区套利）', () => {
  it('南区价高于北区，存在价差', () => {
    const sim = new Simulation();
    // 多次采样确保普遍成立（受周期相位影响）
    let southHigher = 0;
    for (let h = 0; h < 120; h += 5) {
      sim.clock = h;
      if (sim.zoneSouthPrice > sim.zoneNorthPrice) southHigher++;
      expect(sim.zoneSpread).toBeGreaterThanOrEqual(0);
    }
    expect(southHigher).toBeGreaterThan(12); // 多数时段南区更贵
  });

  it('接入市场且价差超过过网费时获套利收入', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    sim.marketEnabled = true;
    const m0 = sim.money;
    let arbed = false;
    for (let i = 0; i < 400; i++) { sim.tick(0.05, 600); if (sim.zoneArbMW > 0) arbed = true; }
    expect(arbed).toBe(true); // 确有套利发生
    expect(sim.finance.market).toBeGreaterThan(0); // 套利收入 > 联络线日费
    expect(sim.money).toBeGreaterThan(m0); // 净盈利（无电源/负荷，仅套利+日费）
  });

  it('未接入市场则不套利', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    sim.marketEnabled = false;
    for (let i = 0; i < 200; i++) sim.tick(0.05, 600);
    expect(sim.zoneArbMW).toBe(0);
  });
});
