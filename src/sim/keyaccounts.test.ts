import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { demandMultiplier } from './profiles';
import { TARIFF_CLASS, RELIABILITY_WEIGHT, KEY_ACCOUNTS } from '../config/components';

describe('大客户负荷（能源品类）', () => {
  it('数据中心负荷曲线近乎恒定高负载', () => {
    let mn = 1, mx = 0;
    for (let h = 0; h < 24; h++) {
      const m = demandMultiplier(h, 'datacenter');
      mn = Math.min(mn, m); mx = Math.max(mx, m);
    }
    expect(mn).toBeGreaterThan(0.9); // 始终高负载
    expect(mx - mn).toBeLessThan(0.1); // 极平
  });

  it('大交通枢纽呈通勤双峰', () => {
    const peakAM = demandMultiplier(8, 'transport');
    const peakPM = demandMultiplier(18, 'transport');
    const trough = demandMultiplier(3, 'transport');
    expect(peakAM).toBeGreaterThan(trough + 0.3);
    expect(peakPM).toBeGreaterThan(trough + 0.3);
  });

  it('品类电价系数符合定位（数据中心溢价、石化/矿业折扣）', () => {
    expect(TARIFF_CLASS.datacenter).toBeGreaterThan(1);
    expect(TARIFF_CLASS.petrochem).toBeLessThan(TARIFF_CLASS.commercial);
    expect(TARIFF_CLASS.mining).toBeLessThan(TARIFF_CLASS.commercial);
  });

  it('数据中心停电产生更重的 SLA 罚款', () => {
    function penaltyDrop(profile: 'datacenter' | 'industrial'): number {
      const sim = new Simulation();
      sim.forcedOutages = false; sim.events.nextAt = Infinity; sim.sandbox = true;
      sim.grid.addLoad(0, 0, profile, 50, 'L', 0); // 无电源 → 全失负荷
      const m0 = sim.money;
      for (let i = 0; i < 10; i++) sim.tick(0.05, 600);
      return m0 - sim.money;
    }
    expect(RELIABILITY_WEIGHT.datacenter).toBeGreaterThan(RELIABILITY_WEIGHT.industrial);
    expect(penaltyDrop('datacenter')).toBeGreaterThan(penaltyDrop('industrial') * 1.5);
  });

  it('数据中心售电享溢价，单位电量收入高于工业', () => {
    function revenue(profile: 'datacenter' | 'industrial'): number {
      const sim = new Simulation();
      sim.forcedOutages = false; sim.events.nextAt = Infinity; sim.sandbox = true;
      const g = sim.grid;
      const coal = g.addPlant('coal', 0, 0);
      const sub = g.addSubstation(2, 0);
      const load = g.addLoad(4, 0, profile, 40, 'L', 0);
      g.addLine(coal.bus.id, sub.id);
      g.addLine(sub.id, load.bus.id);
      for (let i = 0; i < 60; i++) sim.tick(0.05, 600);
      return sim.finance.revenue;
    }
    expect(revenue('datacenter')).toBeGreaterThan(revenue('industrial'));
  });

  it('在建大客户尚未接入，不抽取功率', () => {
    const sim = new Simulation();
    sim.forcedOutages = false; sim.events.nextAt = Infinity; sim.sandbox = true;
    const { bus, load } = sim.grid.addLoad(0, 0, 'datacenter', 50, '数据中心', 0);
    bus.underConstruction = true;
    bus.commissionAt = 9999;
    sim.tick(0.05, 600);
    expect(load.demand).toBe(0);
  });

  it('需求响应：石化最可中断，数据中心几乎不切', () => {
    function demandWith(profile: 'petrochem' | 'datacenter', dr: boolean, spot: number): number {
      const orig = Math.random;
      Math.random = () => 0.5; // 去噪
      try {
        const sim = new Simulation();
        sim.forcedOutages = false; sim.events.nextAt = Infinity; sim.sandbox = true;
        sim.demandResponse = dr;
        const { load } = sim.grid.addLoad(0, 0, profile, 50, 'L', 0);
        sim.spotPrice = spot; // 需求循环开始即读取该价
        sim.tick(0.05, 600);
        return load.demand;
      } finally { Math.random = orig; }
    }
    const petroCurtail = 1 - demandWith('petrochem', true, 200) / demandWith('petrochem', false, 50);
    const dcCurtail = 1 - demandWith('datacenter', true, 200) / demandWith('datacenter', false, 50);
    expect(petroCurtail).toBeGreaterThan(dcCurtail);
    expect(petroCurtail).toBeGreaterThan(0.1); // 石化明显被削峰
    expect(dcCurtail).toBeLessThan(0.05); // 数据中心几乎不被切
  });

  it('充分供电的大客户满意度保持高位', () => {
    const sim = new Simulation();
    sim.forcedOutages = false; sim.events.nextAt = Infinity; sim.sandbox = true;
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0);
    const sub = g.addSubstation(2, 0);
    const { load } = g.addLoad(4, 0, 'datacenter', 40, '数据中心', 0);
    g.addLine(coal.bus.id, sub.id);
    g.addLine(sub.id, load.busId);
    for (let i = 0; i < 24; i++) sim.tick(3600, 1);
    expect(load.satisfaction).toBeGreaterThan(0.95);
    expect(sim.customerSatisfaction).toBeGreaterThan(0.95);
  });

  it('长期欠供使大客户满意度下降', () => {
    const sim = new Simulation();
    sim.forcedOutages = false; sim.events.nextAt = Infinity; sim.sandbox = true;
    const { load } = sim.grid.addLoad(0, 0, 'datacenter', 40, '数据中心', 0); // 无电源 → 失负荷
    for (let i = 0; i < 24; i++) sim.tick(3600, 1);
    expect(load.satisfaction).toBeLessThan(0.4);
    expect(sim.customerSatisfaction).toBeLessThan(0.4);
  });

  it('满意度进入快照', () => {
    const sim = new Simulation();
    sim.grid.addLoad(0, 0, 'datacenter', 40, '数据中心', 0);
    expect(sim.snapshot().customerSatisfaction).toBeGreaterThanOrEqual(0);
  });

  it('KEY_ACCOUNTS 含四类大客户且 profile 一致', () => {
    expect(Object.keys(KEY_ACCOUNTS).sort()).toEqual(['datacenter', 'mining', 'petrochem', 'transport']);
    for (const [id, spec] of Object.entries(KEY_ACCOUNTS)) {
      expect(spec.profile).toBe(id);
      expect(spec.baseDemand).toBeGreaterThan(0);
    }
  });
});
