import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { CHURN_DAYS, CONTRACT_DAYS } from '../config/components';

describe('大客户长约', () => {
  it('签约设置到期、仅限大客户、不重复', () => {
    const sim = new Simulation();
    const city = sim.grid.addLoad(2, 0, 'residential', 20, '城区', 0);
    expect(sim.signKeyAccountContract(city.bus.id)).toBe(false); // 非大客户
    const dc = sim.grid.addLoad(0, 0, 'datacenter', 40, 'DC', 0);
    expect(sim.signKeyAccountContract(dc.bus.id)).toBe(true);
    expect(dc.load.contractEndClock).toBeCloseTo(CONTRACT_DAYS * 24, 6);
    expect(sim.signKeyAccountContract(dc.bus.id)).toBe(false); // 已有有效长约
  });

  it('长约期内即便长期欠供也不被挖角', () => {
    const sim = new Simulation();
    sim.forcedOutages = false; sim.events.nextAt = Infinity; sim.sandbox = true;
    const { bus, load } = sim.grid.addLoad(0, 0, 'datacenter', 40, '云数据中心', 0); // 无电源→欠供
    sim.signKeyAccountContract(bus.id);
    const hours = Math.ceil(CHURN_DAYS * 24) + 48;
    for (let i = 0; i < hours; i++) sim.tick(3600, 1);
    expect(sim.grid.loads.has(load.id)).toBe(true); // 长约锁定，未流失
  });

  it('长约期内电价折让（售电收入下降）', () => {
    function revenue(contract: boolean): number {
      const sim = new Simulation();
      sim.forcedOutages = false; sim.events.nextAt = Infinity; sim.sandbox = true;
      const g = sim.grid;
      const coal = g.addPlant('coal', 0, 0);
      const sub = g.addSubstation(2, 0);
      const ld = g.addLoad(4, 0, 'datacenter', 40, 'DC', 0);
      g.addLine(coal.bus.id, sub.id);
      g.addLine(sub.id, ld.bus.id);
      if (contract) sim.signKeyAccountContract(ld.bus.id);
      for (let i = 0; i < 60; i++) sim.tick(0.05, 600);
      return sim.finance.revenue;
    }
    expect(revenue(true)).toBeLessThan(revenue(false)); // 折让 → 收入更低
  });

  it('长约纳入存档', () => {
    const sim = new Simulation();
    const dc = sim.grid.addLoad(0, 0, 'datacenter', 40, 'DC', 0);
    sim.signKeyAccountContract(dc.bus.id);
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.grid.loadsAtBus(dc.bus.id)[0].contractEndClock).toBeCloseTo(CONTRACT_DAYS * 24, 4);
  });
});
