import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { INTERCONNECTOR_CAPACITY } from '../config/components';

function build(marketOn: boolean) {
  const sim = new Simulation();
  sim.forcedOutages = false;
  sim.marketEnabled = marketOn;
  const g = sim.grid;
  // 电源不足：一台燃气(40MW) 供 工业 80MW
  const gas = g.addPlant('gas', 0, 0);
  const sub = g.addSubstation(2, 0);
  const load = g.addLoad(4, 0, 'industrial', 80, '重工', 0);
  g.addLine(gas.bus.id, sub.id);
  g.addLine(sub.id, load.bus.id);
  return { sim, load };
}

describe('批发市场互联', () => {
  it('电源不足时购电补缺，减少停电', () => {
    const withMkt = build(true);
    const noMkt = build(false);
    for (let i = 0; i < 200; i++) { withMkt.sim.tick(0.05, 600); noMkt.sim.tick(0.05, 600); }
    expect(withMkt.sim.marketImportMW).toBeGreaterThan(0); // 有购电
    expect(withMkt.sim.reliability).toBeGreaterThan(noMkt.sim.reliability); // 供电更可靠
  });

  it('购电量受联络线容量限制', () => {
    const { sim } = build(true);
    for (let i = 0; i < 100; i++) sim.tick(0.05, 600);
    expect(sim.marketImportMW).toBeLessThanOrEqual(INTERCONNECTOR_CAPACITY + 1e-6);
  });

  it('断开市场则不再购电', () => {
    const { sim } = build(false);
    for (let i = 0; i < 100; i++) sim.tick(0.05, 600);
    expect(sim.marketImportMW).toBe(0);
  });

  it('存档保留市场接入状态', () => {
    const sim = new Simulation();
    sim.marketEnabled = false;
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.marketEnabled).toBe(false);
  });
});
