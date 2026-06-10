import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('输电权 FTR', () => {
  it('买入扣权利金并加入持仓', () => {
    const sim = new Simulation();
    const m0 = sim.money;
    expect(sim.addFTR(15, 5)).toBe(true);
    expect(sim.money).toBeLessThan(m0); // 付权利金
    expect(sim.ftrs.length).toBe(1);
    expect(sim.ftrs[0].mw).toBe(15);
  });

  it('持有期内按南北价差获赔付（不依赖物理接入）', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    sim.marketEnabled = false; // 纯金融合约
    sim.addFTR(15, 5);
    const m1 = sim.money; // 已付权利金
    sim.tick(0.05, 600); // 收一笔价差
    expect(sim.money).toBeGreaterThan(m1); // 收到价差赔付（无其他现金流）
  });

  it('到期后移除', () => {
    const sim = new Simulation();
    sim.addFTR(10, 1);
    expect(sim.ftrs.length).toBe(1);
    sim.clock = 100; // 远超到期
    sim.tick(0.05, 600);
    expect(sim.ftrs.length).toBe(0);
  });

  it('存档保留 FTR', () => {
    const sim = new Simulation();
    sim.addFTR(20, 7);
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.ftrs.length).toBe(1);
    expect(sim2.ftrs[0].mw).toBe(20);
  });
});
