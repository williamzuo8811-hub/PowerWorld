import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { KEY_ACCOUNTS, POACH_WIN_FRACTION } from '../config/components';

describe('反向挖角（从对手赢得大客户）', () => {
  it('竞品客户机会下接入成功削弱最强对手并清除机会', () => {
    const sim = new Simulation();
    const topBefore = sim.competitors.reduce((a, b) => (b.capacity > a.capacity ? b : a));
    const capBefore = topBefore.capacity;
    sim.keyAccountLead = { profile: 'datacenter', endClock: sim.clock + 1000, poach: true };
    sim.onKeyAccountAcquired('datacenter');
    const top = sim.competitors.reduce((a, b) => (b.capacity > a.capacity ? b : a));
    expect(capBefore - top.capacity).toBeCloseTo(KEY_ACCOUNTS.datacenter.baseDemand * POACH_WIN_FRACTION, 3);
    expect(sim.keyAccountLead).toBeNull(); // 机会已用掉
  });

  it('普通招商机会接入不削弱对手', () => {
    const sim = new Simulation();
    const capBefore = sim.competitors.reduce((a, b) => (b.capacity > a.capacity ? b : a)).capacity;
    sim.keyAccountLead = { profile: 'datacenter', endClock: sim.clock + 1000, poach: false };
    sim.onKeyAccountAcquired('datacenter');
    const capAfter = sim.competitors.reduce((a, b) => (b.capacity > a.capacity ? b : a)).capacity;
    expect(capAfter).toBe(capBefore);
    expect(sim.keyAccountLead).toBeNull();
  });

  it('品类不匹配则不消费机会', () => {
    const sim = new Simulation();
    sim.keyAccountLead = { profile: 'datacenter', endClock: sim.clock + 1000, poach: true };
    sim.onKeyAccountAcquired('mining'); // 与机会品类不符
    expect(sim.keyAccountLead).not.toBeNull(); // 机会仍在
  });

  it('竞品客户机会标记进入存档', () => {
    const sim = new Simulation();
    sim.keyAccountLead = { profile: 'mining', endClock: sim.clock + 500, poach: true };
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.keyAccountLead?.poach).toBe(true);
  });
});
