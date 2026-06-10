import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { COMP_PEAKER_WAR_FLOOR, STORAGE_REG_ARB_FACTOR, STORAGE_ARB_CAPTURE } from '../config/components';

function setup(): Simulation {
  const sim = new Simulation();
  sim.forcedOutages = false;
  const g = sim.grid;
  const coal = g.addPlant('coal', 0, 0).bus;
  const sub = g.addSubstation(2, 0);
  const load = g.addLoad(4, 0, 'industrial', 40, '厂', 0).bus;
  g.addLine(coal.id, sub.id);
  g.addLine(sub.id, load.id);
  return sim;
}

describe('对手性格化与平衡调参', () => {
  it('对手随存档往返（容量/报价演化不丢失）', () => {
    const sim = setup();
    sim.competitors[0].capacity = 333;
    sim.competitors[2].marginalCost = 44;
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.competitors[0].capacity).toBeCloseTo(333);
    expect(sim2.competitors[2].marginalCost).toBeCloseTo(44);
    expect(sim2.competitors[2].style).toBe('peaker');
  });

  it('激进调峰型在玩家高市占时发动价格战', () => {
    const sim = setup();
    const peaker = sim.competitors.find((c) => c.style === 'peaker')!;
    const mcBase = peaker.marginalCost;
    sim.marketShare = 0.6; // 强行设置高市占
    // 直接调 evolveCompetitors 多天
    const evolve = (sim as unknown as { evolveCompetitors(d: number): void });
    for (let i = 0; i < 30; i++) { evolve.evolveCompetitors(1); sim.marketShare = 0.6; }
    expect(peaker.marginalCost).toBeLessThan(mcBase * 0.85);
    expect(peaker.marginalCost).toBeGreaterThanOrEqual(mcBase * COMP_PEAKER_WAR_FLOOR - 1);
    // 威胁解除后回归基准
    sim.marketShare = 0.1;
    for (let i = 0; i < 60; i++) { evolve.evolveCompetitors(1); sim.marketShare = 0.1; }
    expect(peaker.marginalCost).toBeGreaterThan(mcBase * 0.95);
  });

  it('环保督查同样限产火电型对手（市场出清容量折减）', () => {
    const sim = setup();
    sim.policy.current = { kind: 'inspection', endClock: sim.clock + 72 };
    // 出清价应因火电对手限产而（趋于）抬升：直接对比清空政策前后的出清结果
    const before = (sim as unknown as { marketClearing(): { clearingCost: number } }).marketClearing();
    sim.policy.current = null;
    const after = (sim as unknown as { marketClearing(): { clearingCost: number } }).marketClearing();
    expect(before.clearingCost).toBeGreaterThanOrEqual(after.clearingCost);
  });

  it('储能策略二选一：投调频则套利捕获减半', () => {
    expect(STORAGE_ARB_CAPTURE * STORAGE_REG_ARB_FACTOR).toBeLessThan(STORAGE_ARB_CAPTURE);
    const sim = setup();
    expect(sim.storageStrategy).toBe('arb');
    sim.storageStrategy = 'reg';
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.storageStrategy).toBe('reg');
  });

  it('在建工程取消全额退款', () => {
    const sim = new Simulation();
    const { bus } = sim.grid.addPlant('coal', 0, 0);
    bus.underConstruction = true;
    bus.commissionAt = sim.clock + 96;
    const refund = sim.cancelRefund(bus.id);
    expect(refund).toBeGreaterThan(0);
    // 已投运资产不可走取消通道
    bus.underConstruction = false;
    expect(sim.cancelRefund(bus.id)).toBeNull();
  });
});
