import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('远期套保', () => {
  it('签约收取手续费并加入合约列表', () => {
    const sim = new Simulation();
    const m0 = sim.money;
    expect(sim.addHedge(20, 5)).toBe(true);
    expect(sim.money).toBeLessThan(m0); // 收了手续费
    expect(sim.hedges.length).toBe(1);
  });

  function hedgeFinance(strike: number): number {
    const sim = new Simulation();
    sim.forcedOutages = false;
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0);
    const sub = g.addSubstation(2, 0);
    const load = g.addLoad(4, 0, 'industrial', 20, '厂', 0);
    g.addLine(coal.bus.id, sub.id);
    g.addLine(sub.id, load.bus.id);
    sim.avgSpot = strike; // 设定锁价
    sim.addHedge(30, 5);
    for (let i = 0; i < 200; i++) sim.tick(0.05, 600);
    return sim.finance.hedge;
  }

  it('锁价高于市价 → 套保获补偿（正）', () => {
    expect(hedgeFinance(150)).toBeGreaterThan(0);
  });

  it('锁价低于市价 → 套保让出收益（负）', () => {
    expect(hedgeFinance(20)).toBeLessThan(0);
  });

  it('存档保留套保合约', () => {
    const sim = new Simulation();
    sim.avgSpot = 80;
    sim.addHedge(25, 7);
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.hedges.length).toBe(1);
    expect(sim2.hedges[0].volume).toBe(25);
    expect(sim2.hedges[0].strike).toBe(80);
  });
});
