import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { ACQUISITION_PRICE_PER_MW, ANTITRUST_HARD_SHARE } from '../config/components';

describe('资产并购（吸收竞争对手为自有商船队）', () => {
  it('并购扣款、移除竞争对手、计入商船队', () => {
    const sim = new Simulation();
    sim.money = 5_000_000;
    const before = sim.money;
    const c = sim.competitors[0]; // 绿源电力 150MW @¥6
    const cost = Math.round(c.capacity * ACQUISITION_PRICE_PER_MW);
    const nComp = sim.competitors.length;
    expect(sim.acquireCompetitor(0)).toBe(true);
    expect(sim.money).toBe(before - cost);
    expect(sim.competitors.length).toBe(nComp - 1);
    expect(sim.mergedCapacity.length).toBe(1);
    expect(sim.mergedCapacity[0].mw).toBe(c.capacity);
    expect(sim.mergedCapacity[0].marginalCost).toBe(c.marginalCost);
  });

  it('资金不足时并购失败且不改变状态', () => {
    const sim = new Simulation();
    sim.money = 100; // 远不够
    const nComp = sim.competitors.length;
    expect(sim.acquireCompetitor(0)).toBe(false);
    expect(sim.competitors.length).toBe(nComp);
    expect(sim.mergedCapacity.length).toBe(0);
  });

  it('非法下标返回 false', () => {
    const sim = new Simulation();
    sim.money = 5_000_000;
    expect(sim.acquireCompetitor(99)).toBe(false);
    expect(sim.mergedCapacity.length).toBe(0);
  });

  it('并购廉价对手后提升市占并获取市场价差利润', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    sim.events.nextAt = Infinity;
    sim.money = 5_000_000;
    sim.tick(0.05, 200); // 建立基线
    const shareBefore = sim.marketShare;
    expect(sim.acquireCompetitor(0)).toBe(true); // 绿源 @¥6，远低于出清价
    sim.tick(0.05, 600);
    expect(sim.marketShare).toBeGreaterThan(shareBefore);
    expect(sim.finance.market).toBeGreaterThan(0); // 商船队捕获价差
  });

  it('高集中度并购计入反垄断补救费，超上限则否决', () => {
    const sim = new Simulation();
    sim.money = 1_000_000_000;
    // 构造可控市场：自有装机 100MW（商船队注入），两家对手 A=100 / B=200
    sim.competitors.length = 0;
    sim.competitors.push({ name: 'A', capacity: 100, marginalCost: 20, base: 100, mcBase: 20, style: 'coal' });
    sim.competitors.push({ name: 'B', capacity: 200, marginalCost: 30, base: 200, mcBase: 30, style: 'coal' });
    sim.mergedCapacity.push({ mw: 100, marginalCost: 25 }); // 全网装机 = 100+100+200 = 400

    const qA = sim.acquisitionQuote(0)!; // 并 A：市占 (100+100)/400 = 0.50（补救区间）
    expect(qA.postShare).toBeCloseTo(0.5, 3);
    expect(qA.blocked).toBe(false);
    expect(qA.remedy).toBeGreaterThan(0);
    expect(qA.total).toBe(qA.base + qA.remedy);

    const qB = sim.acquisitionQuote(1)!; // 并 B：市占 (100+200)/400 = 0.75（否决区间）
    expect(qB.postShare).toBeGreaterThan(ANTITRUST_HARD_SHARE);
    expect(qB.blocked).toBe(true);

    // 否决：资金充足也无法并购 B
    expect(sim.acquireCompetitor(1)).toBe(false);
    expect(sim.competitors.length).toBe(2);

    // 含补救费的并购按合计扣款
    const before = sim.money;
    expect(sim.acquireCompetitor(0)).toBe(true);
    expect(sim.money).toBe(before - qA.total);
  });

  it('低市占并购不产生补救费（total=base）', () => {
    const sim = new Simulation();
    sim.money = 5_000_000;
    const q = sim.acquisitionQuote(0)!; // 默认空机队，市占低
    expect(q.postShare).toBeLessThan(0.45);
    expect(q.remedy).toBe(0);
    expect(q.total).toBe(q.base);
  });

  it('存档/读档保留商船队', () => {
    const sim = new Simulation();
    sim.money = 5_000_000;
    sim.acquireCompetitor(0);
    const saved = sim.serialize();
    const sim2 = new Simulation();
    sim2.deserialize(saved);
    expect(sim2.mergedCapacity.length).toBe(1);
    expect(sim2.mergedCapacity[0].mw).toBe(150);
    expect(sim2.mergedCapacity[0].marginalCost).toBe(6);
  });
});
