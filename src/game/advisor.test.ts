import { describe, it, expect } from 'vitest';
import { Simulation } from '../sim/simulation';
import { Advisor, ADVISOR_RULES } from './advisor';

describe('顾问提示系统', () => {
  it('规则 id 唯一', () => {
    const ids = ADVISOR_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('现金吃紧且有信用额度时提示贷款，且每局只发一次', () => {
    const sim = new Simulation();
    sim.grid.addPlant('coal', 0, 0); // 有资产 → 有信用额度
    sim.money = 30_000;
    const adv = new Advisor();
    const tip = adv.update(sim);
    expect(tip).toContain('贷款');
    // 同一条不再重发（推进时间再查）
    sim.clock += 1;
    const tips: string[] = [];
    for (let i = 0; i < 5; i++) {
      sim.clock += 1;
      const t = adv.update(sim);
      if (t) tips.push(t);
    }
    expect(tips.every((t) => !t.includes('贷款'))).toBe(true);
  });

  it('reset 后规则可再次触发', () => {
    const sim = new Simulation();
    sim.grid.addPlant('coal', 0, 0);
    sim.money = 30_000;
    const adv = new Advisor();
    expect(adv.update(sim)).toBeTruthy();
    adv.reset();
    expect(adv.update(sim)).toBeTruthy();
  });

  it('节流：同一仿真时刻内不会连发多条', () => {
    const sim = new Simulation();
    sim.grid.addPlant('coal', 0, 0);
    sim.money = 30_000;
    sim.grid.addBattery(1, 0);
    const adv = new Advisor();
    expect(adv.update(sim)).toBeTruthy();
    expect(adv.update(sim)).toBeNull(); // 未推进时间 → 节流
  });

  it('限时招商机会出现时提示', () => {
    const sim = new Simulation();
    sim.money = 10_000_000; // 不触发 lowCash
    sim.keyAccountLead = { profile: 'datacenter', endClock: sim.clock + 72, poach: false };
    const adv = new Advisor();
    let found = false;
    for (let i = 0; i < ADVISOR_RULES.length + 2; i++) {
      const t = adv.update(sim);
      if (t?.includes('招商')) { found = true; break; }
      if (!t) break;
      sim.clock += 1;
    }
    expect(found).toBe(true);
  });
});
