import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('贷款 / 融资', () => {
  it('借款增加现金与负债，受信用额度约束', () => {
    const sim = new Simulation();
    const cash0 = sim.money;
    const ok = sim.borrow(100_000);
    expect(ok).toBe(true);
    expect(sim.money).toBeCloseTo(cash0 + 100_000, 3);
    expect(sim.debt).toBeCloseTo(100_000, 3);
    // 超过信用额度则失败
    expect(sim.borrow(sim.creditLimit + 1)).toBe(false);
  });

  it('还款减少现金与负债', () => {
    const sim = new Simulation();
    sim.borrow(80_000);
    const repaid = sim.repay(50_000);
    expect(repaid).toBeCloseTo(50_000, 3);
    expect(sim.debt).toBeCloseTo(30_000, 3);
  });

  it('负债持续产生利息，拉低现金', () => {
    const sim = new Simulation();
    sim.borrow(200_000);
    const cashAfterBorrow = sim.money;
    for (let i = 0; i < 200; i++) sim.tick(0.05, 600); // 约 1.7 天
    expect(sim.money).toBeLessThan(cashAfterBorrow); // 利息扣款
  });

  it('资产提升信用额度；净资产计入资产并扣负债', () => {
    const sim = new Simulation();
    const credit0 = sim.creditLimit;
    sim.grid.addPlant('coal', 0, 0); // 增加资产
    expect(sim.creditLimit).toBeGreaterThan(credit0);
    const nwBefore = sim.netWorth;
    sim.borrow(100_000);
    // 借款：现金+负债同增，净资产基本不变
    expect(sim.netWorth).toBeCloseTo(nwBefore, 0);
  });

  it('存档保留负债', () => {
    const sim = new Simulation();
    sim.borrow(120_000);
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.debt).toBeCloseTo(120_000, 3);
  });
});
