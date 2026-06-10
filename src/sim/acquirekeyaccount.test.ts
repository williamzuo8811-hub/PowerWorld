import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { KEY_ACCOUNTS, ACQ_STANDING_MIN } from '../config/components';

/** 直接设定决定竞争力的三项指标。 */
function withStanding(rep: number, reliab: number, sat: number): Simulation {
  const sim = new Simulation();
  sim.reputation = rep;
  sim.reliability = reliab;
  sim.customerSatisfaction = sat;
  return sim;
}

describe('大客户竞价招商', () => {
  it('招商竞争力落在 0..1 且随三项指标提升', () => {
    const lo = withStanding(20, 0.4, 0.4).companyStanding;
    const hi = withStanding(95, 1, 1).companyStanding;
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
    expect(hi).toBeGreaterThan(lo);
  });

  it('竞争力越高招商代价越低', () => {
    const strong = withStanding(95, 1, 1).keyAccountAcquireCost('datacenter');
    const weak = withStanding(45, 0.7, 0.6).keyAccountAcquireCost('datacenter');
    expect(strong).toBeGreaterThan(0);
    expect(weak).toBeGreaterThan(strong); // 竞争力低 → 更贵
  });

  it('高竞争力可低于基准接入费（折扣）', () => {
    const cost = withStanding(95, 1, 1).keyAccountAcquireCost('datacenter');
    expect(cost).toBeLessThan(KEY_ACCOUNTS.datacenter.connectionCapex);
  });

  it('竞争力过低则大客户拒绝入驻（返回 -1）', () => {
    const sim = withStanding(15, 0.25, 0.2);
    expect(sim.companyStanding).toBeLessThan(ACQ_STANDING_MIN);
    expect(sim.keyAccountAcquireCost('datacenter')).toBe(-1);
  });

  it('非大客户品类不可招商（返回 -1）', () => {
    const sim = withStanding(80, 1, 1);
    expect(sim.keyAccountAcquireCost('residential')).toBe(-1);
  });
});
