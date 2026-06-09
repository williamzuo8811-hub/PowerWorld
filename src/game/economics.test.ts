import { describe, it, expect } from 'vitest';
import { genEconomics } from './economics';
import { PLANTS } from '../config/components';

describe('投资回报估算', () => {
  it('覆盖全部机组并带出工期', () => {
    const rows = genEconomics(64);
    expect(rows.length).toBe(Object.keys(PLANTS).length);
    const gas = rows.find((r) => r.type === 'gas')!;
    expect(gas.buildDays).toBe(PLANTS.gas.buildDays);
    expect(gas.fuel).toBe(PLANTS.gas.marginalCost);
  });

  it('零燃料机组的度电成本低于燃气', () => {
    const rows = genEconomics(64);
    const gas = rows.find((r) => r.type === 'gas')!;
    const wind = rows.find((r) => r.type === 'wind')!;
    expect(wind.fuel).toBe(0);
    expect(wind.lcoe).toBeLessThan(gas.lcoe); // 零燃料 → 度电成本更低
  });

  it('回本周期含工期且为正', () => {
    const rows = genEconomics(64);
    for (const r of rows) {
      expect(r.paybackDays).toBeGreaterThanOrEqual(r.buildDays);
      expect(Number.isFinite(r.paybackDays)).toBe(true);
    }
  });

  it('电价越高日均毛利越高', () => {
    const lo = genEconomics(40).find((r) => r.type === 'coal')!;
    const hi = genEconomics(90).find((r) => r.type === 'coal')!;
    expect(hi.dailyProfit).toBeGreaterThan(lo.dailyProfit);
  });
});
