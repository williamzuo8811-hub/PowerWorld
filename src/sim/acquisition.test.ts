import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { ACQUISITION_PRICE_PER_MW } from '../config/components';

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
