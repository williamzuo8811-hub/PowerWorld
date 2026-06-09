import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

function shareOf(type: 'nuclear' | 'gas'): number {
  const sim = new Simulation();
  sim.forcedOutages = false;
  sim.grid.addPlant(type, 0, 0);
  sim.tick(0.05, 600);
  return sim.marketShare;
}

describe('多公司竞价市场', () => {
  it('更便宜的电源获得更高市场份额', () => {
    const nuc = shareOf('nuclear'); // 边际成本 10，便宜
    const gas = shareOf('gas'); // 边际成本 58，昂贵
    expect(nuc).toBeGreaterThan(0);
    expect(nuc).toBeGreaterThan(gas); // 便宜者份额更高
  });

  it('出清价与现货价处于合理区间（不被竞争压垮）', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0);
    const sub = g.addSubstation(2, 0);
    const load = g.addLoad(4, 0, 'industrial', 40, '厂', 0);
    g.addLine(coal.bus.id, sub.id);
    g.addLine(sub.id, load.bus.id);
    for (let i = 0; i < 100; i++) sim.tick(0.05, 600);
    expect(sim.marketClearingPrice).toBeGreaterThan(0);
    expect(sim.spotPrice).toBeGreaterThan(30); // 仍接近零售电价水平
    expect(sim.spotPrice).toBeLessThan(180);
  });

  it('区域需求随景气波动且为正', () => {
    const sim = new Simulation();
    sim.clock = 48; // 繁荣
    const boom = sim.regionalDemand;
    sim.clock = 144; // 衰退
    const bust = sim.regionalDemand;
    expect(boom).toBeGreaterThan(0);
    expect(boom).toBeGreaterThan(bust);
  });

  it('reset 后竞争对手复位', () => {
    const sim = new Simulation();
    sim.competitors[0].capacity = 999;
    sim.reset();
    expect(sim.competitors[0].capacity).not.toBe(999);
  });
});
