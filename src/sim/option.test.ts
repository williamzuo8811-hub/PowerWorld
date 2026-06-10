import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

function build() {
  const sim = new Simulation();
  sim.forcedOutages = false;
  const g = sim.grid;
  const coal = g.addPlant('coal', 0, 0);
  const sub = g.addSubstation(2, 0);
  const load = g.addLoad(4, 0, 'industrial', 20, '厂', 0);
  g.addLine(coal.bus.id, sub.id);
  g.addLine(sub.id, load.bus.id);
  return sim;
}

function optionPayout(kind: 'put' | 'call', strike: number): number {
  const sim = build();
  sim.avgSpot = strike; // 设定行权价
  sim.addOption(kind, 30, 5);
  for (let i = 0; i < 200; i++) sim.tick(0.05, 600);
  return sim.finance.hedge; // 期权赔付计入套保/期权损益
}

describe('电力期权', () => {
  it('买入扣权利金并加入合约列表', () => {
    const sim = new Simulation();
    const m0 = sim.money;
    expect(sim.addOption('put', 30, 7)).toBe(true);
    expect(sim.money).toBeLessThan(m0);
    expect(sim.options.length).toBe(1);
  });

  it('看跌(保底)在市价低于行权价时赔付，反之不赔', () => {
    expect(optionPayout('put', 150)).toBeGreaterThan(0); // 行权价高>市价 → 赔付
    expect(optionPayout('put', 20)).toBeLessThan(optionPayout('put', 150)); // 行权价低<市价 → 几乎不赔
  });

  it('看涨(封顶)在市价高于行权价时赔付', () => {
    expect(optionPayout('call', 20)).toBeGreaterThan(0); // 行权价低<市价 → 赔付
  });

  it('存档保留期权', () => {
    const sim = new Simulation();
    sim.avgSpot = 70;
    sim.addOption('put', 25, 7);
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.options.length).toBe(1);
    expect(sim2.options[0].kind).toBe('put');
    expect(sim2.options[0].strike).toBe(70);
  });
});
