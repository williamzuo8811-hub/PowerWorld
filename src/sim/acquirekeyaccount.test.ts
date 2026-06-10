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

  it('高竞争力 + 市场主导可低于基准接入费（折扣）', () => {
    const sim = withStanding(95, 1, 1);
    for (let k = 0; k < 12; k++) sim.grid.addPlant('coal', k, 0); // 市场主导 → 竞争不激烈
    const cost = sim.keyAccountAcquireCost('datacenter');
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

  it('玩家装机越多市场招商越不激烈', () => {
    const small = withStanding(80, 1, 1); // 默认竞争对手、玩家无装机
    const big = withStanding(80, 1, 1);
    for (let k = 0; k < 8; k++) big.grid.addPlant('coal', k, 0); // 玩家装机多
    expect(big.marketContestation).toBeLessThan(small.marketContestation);
  });

  it('竞争越激烈招商代价越高', () => {
    const contested = withStanding(80, 1, 1); // 玩家弱、对手相对强 → 竞争激烈
    const dominant = withStanding(80, 1, 1);
    for (let k = 0; k < 8; k++) dominant.grid.addPlant('coal', k, 0); // 玩家主导市场
    expect(contested.keyAccountAcquireCost('datacenter')).toBeGreaterThan(dominant.keyAccountAcquireCost('datacenter'));
  });

  it('限时招商机会期间接入费打折，仅限对应品类', () => {
    const sim = withStanding(80, 1, 1);
    const normalDC = sim.keyAccountAcquireCost('datacenter');
    const normalMine = sim.keyAccountAcquireCost('mining');
    sim.keyAccountLead = { profile: 'datacenter', endClock: sim.clock + 1000 };
    expect(sim.keyAccountLeadActive('datacenter')).toBe(true);
    expect(sim.keyAccountLeadActive('mining')).toBe(false);
    expect(sim.keyAccountAcquireCost('datacenter')).toBeLessThan(normalDC); // 数据中心打折
    expect(sim.keyAccountAcquireCost('mining')).toBe(normalMine); // 矿业不受影响
  });

  it('竞争力高则下一个招商机会更早', () => {
    function nextInterval(rep: number, reliab: number, sat: number): number {
      const orig = Math.random;
      Math.random = () => 0; // 去掉抖动项
      try {
        const sim = new Simulation();
        sim.reputation = rep; sim.reliability = reliab; sim.customerSatisfaction = sat;
        sim.events.nextAt = Infinity; sim.sandbox = true;
        sim.nextLeadAt = 0; // 首拍立即触发机会（此时口碑尚未漂移）
        sim.tick(3600, 1);
        return sim.nextLeadAt - sim.clock; // 距下个机会的间隔
      } finally { Math.random = orig; }
    }
    const strong = nextInterval(95, 1, 1);
    const weak = nextInterval(40, 0.6, 0.5);
    expect(strong).toBeLessThan(weak); // 竞争力高 → 下个机会更早
  });

  it('招商机会到点出现并可存档', () => {
    const sim = new Simulation();
    sim.forcedOutages = false; sim.events.nextAt = Infinity; sim.sandbox = true;
    expect(sim.keyAccountLead).toBeNull();
    for (let i = 0; i < 24 * 6; i++) sim.tick(3600, 1); // 推进 6 天（超过首个机会日）
    expect(sim.keyAccountLead).not.toBeNull();
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.keyAccountLead?.profile).toBe(sim.keyAccountLead?.profile);
  });
});
