import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('远期容量拍卖', () => {
  it('承诺远期容量加入合约列表并锁定容量价', () => {
    const sim = new Simulation();
    sim.grid.addPlant('coal', 0, 0);
    expect(sim.addCapacityCommitment(50, 10)).toBe(true);
    expect(sim.capCommitments.length).toBe(1);
    expect(sim.capCommitments[0].mw).toBe(50);
    expect(sim.capCommitments[0].price).toBeGreaterThan(0);
  });

  it('能交付时承诺带来正向容量现金流（锁价溢价）', () => {
    function run(commit: boolean): number {
      const sim = new Simulation();
      sim.forcedOutages = false;
      sim.grid.addPlant('coal', 0, 0); // 60MW 充足
      sim.tick(0.05, 600);
      if (commit) sim.addCapacityCommitment(40, 10); // 承诺 < 可交付容量
      for (let i = 0; i < 80; i++) sim.tick(0.05, 600);
      return sim.finance.capacity;
    }
    expect(run(true)).toBeGreaterThan(run(false)); // 锁价溢价 → 容量现金流更高
  });

  it('欠交付承诺导致罚款（容量现金流下降）', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    sim.grid.addPlant('coal', 0, 0); // 仅 60MW
    sim.tick(0.05, 600);
    sim.addCapacityCommitment(400, 10); // 远超可交付容量
    for (let i = 0; i < 80; i++) sim.tick(0.05, 600);
    expect(sim.finance.capacity).toBeLessThan(0); // 罚款压垮容量现金流
  });

  it('存档保留远期容量承诺', () => {
    const sim = new Simulation();
    sim.addCapacityCommitment(30, 7);
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.capCommitments.length).toBe(1);
    expect(sim2.capCommitments[0].mw).toBe(30);
  });
});
