import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

// 构造一个新能源过剩的电网：大风电 + 小负荷 → 富余被弃/外送
function build(marketOn: boolean) {
  const sim = new Simulation();
  sim.forcedOutages = false;
  sim.events.nextAt = Infinity;
  sim.marketEnabled = marketOn;
  const g = sim.grid;
  const sub = g.addSubstation(0, 0);
  for (let k = 0; k < 4; k++) g.addLine(g.addPlant('wind', k, 2).bus.id, sub.id); // 大量风电
  const { bus: loadBus } = g.addLoad(2, 0, 'industrial', 15, '小厂', 0); // 小负荷
  g.addLine(sub.id, loadBus.id);
  return sim;
}

describe('跨区外送（卖入批发市场）', () => {
  it('过剩清洁电量外送获得收入', () => {
    const on = build(true);
    let exported = false;
    for (let i = 0; i < 300; i++) { on.tick(0.05, 600); if (on.marketExportMW > 0) exported = true; }
    expect(exported).toBe(true); // 确有外送
    expect(on.finance.market).toBeGreaterThan(0); // 市场净现金流为正（外送收入>购电/日费）
  });

  it('未接入市场则不外送', () => {
    const off = build(false);
    for (let i = 0; i < 200; i++) off.tick(0.05, 600);
    expect(off.marketExportMW).toBe(0);
  });

  it('外送量受联络线容量限制', () => {
    const on = build(true);
    for (let i = 0; i < 200; i++) on.tick(0.05, 600);
    expect(on.marketExportMW).toBeLessThanOrEqual(40 + 1e-6); // INTERCONNECTOR_CAPACITY
  });
});
