import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { FLEX_PRICE_BASE, FLEX_PRICE_MIN, FLEX_PRICE_MAX } from '../config/components';

/** 正午（光伏满发）构造机队，返回灵活性市场指标。 */
function noonFlex(opts: { solar?: boolean; gas?: number; battery?: number }): { price: number; req: number; pen: number } {
  const sim = new Simulation();
  sim.forcedOutages = false;
  sim.events.nextAt = Infinity;
  sim.money = 50_000_000;
  const g = sim.grid;
  const sub = g.addSubstation(2, 0);
  const load = g.addLoad(4, 0, 'industrial', 30, '厂', 0);
  g.addLine(sub.id, load.bus.id);
  if (opts.solar) {
    const s = g.addPlant('solar', 0, 0);
    g.addLine(s.bus.id, sub.id);
  }
  const c = g.addPlant('coal', 0, 1);
  g.addLine(c.bus.id, sub.id);
  for (let k = 0; k < (opts.gas ?? 0); k++) {
    const ga = g.addPlant('gas', k, 3);
    g.addLine(ga.bus.id, sub.id);
  }
  for (let k = 0; k < (opts.battery ?? 0); k++) {
    const b = g.addBattery(k, 4, 'battery');
    g.addLine(b.bus.id, sub.id);
  }
  sim.clock = 12; // 正午
  sim.tick(0.05, 600);
  return { price: sim.flexPrice, req: sim.flexRequirementMW, pen: sim.renewablePenetration };
}

describe('灵活性/爬坡市场', () => {
  it('高新能源渗透率抬高灵活性需求与出清价', () => {
    const solar = noonFlex({ solar: true });
    const coal = noonFlex({ solar: false });
    expect(solar.pen).toBeGreaterThan(0.5);
    expect(solar.req).toBeGreaterThan(coal.req); // 净负荷波动更大
    expect(solar.price).toBeGreaterThan(coal.price);
  });

  it('增加快速可调资源（燃气/储能）压低灵活性价', () => {
    const scarce = noonFlex({ solar: true });
    const ampleGas = noonFlex({ solar: true, gas: 6 });
    const ampleBat = noonFlex({ solar: true, battery: 8 });
    expect(ampleGas.price).toBeLessThan(scarce.price);
    expect(ampleBat.price).toBeLessThan(scarce.price);
  });

  it('灵活性出清价落在配置上下限内', () => {
    const r = noonFlex({ solar: true });
    expect(r.price).toBeGreaterThanOrEqual(FLEX_PRICE_BASE * FLEX_PRICE_MIN - 1e-6);
    expect(r.price).toBeLessThanOrEqual(FLEX_PRICE_BASE * FLEX_PRICE_MAX + 1e-6);
  });
});
