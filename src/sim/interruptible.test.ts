import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { SEASON_YEAR_DAYS, INTERRUPT_RATE_BASE, INTERRUPT_SEASON_K } from '../config/components';

describe('可中断负荷合同（季节定价）', () => {
  it('签约设置容量与到期时刻，到期后失效', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    sim.events.nextAt = Infinity;
    expect(sim.signInterruptible(40, 5)).toBe(true);
    expect(sim.interruptibleMW).toBe(40);
    expect(sim.interruptibleEndClock).toBeCloseTo(5 * 24, 6);
    // 推进到期后，settlement 将其清零
    sim.clock = 6 * 24;
    sim.tick(0.05, 600);
    expect(sim.interruptibleMW).toBe(0);
  });

  it('可用费率旺季高于换季', () => {
    const sim = new Simulation();
    const rateAt = (phase: number) => {
      sim.clock = phase * SEASON_YEAR_DAYS * 24;
      return sim.interruptiblePremiumRate;
    };
    expect(rateAt(0)).toBeCloseTo(INTERRUPT_RATE_BASE, 6); // 春（换季）
    expect(rateAt(0.25)).toBeCloseTo(INTERRUPT_RATE_BASE * (1 + INTERRUPT_SEASON_K), 6); // 夏
    expect(rateAt(0.25)).toBeGreaterThan(rateAt(0));
    expect(rateAt(0.75)).toBeGreaterThan(rateAt(0.5)); // 冬 > 秋
  });

  it('可中断负荷提升容量充裕度（作可信容量）', () => {
    function adequacy(withContract: boolean): number {
      const sim = new Simulation();
      sim.forcedOutages = false;
      sim.events.nextAt = Infinity;
      sim.grid.addLoad(4, 0, 'industrial', 30, '厂', 0);
      if (withContract) sim.signInterruptible(80, 20);
      sim.tick(0.05, 600);
      return sim.capacityAdequacy;
    }
    expect(adequacy(true)).toBeGreaterThan(adequacy(false));
  });

  it('合同产生可用费支出（计入需求侧成本）', () => {
    function drFlow(withContract: boolean): number {
      const sim = new Simulation();
      sim.forcedOutages = false;
      sim.events.nextAt = Infinity;
      sim.sandbox = true;
      sim.clock = 0.25 * SEASON_YEAR_DAYS * 24; // 夏季，可用费更高
      if (withContract) sim.signInterruptible(100, 30);
      for (let i = 0; i < 60; i++) sim.tick(3600, 1);
      return sim.finance.dr;
    }
    expect(drFlow(true)).toBeLessThan(0); // 可用费体现为需求侧支出
    expect(drFlow(true)).toBeLessThan(drFlow(false)); // 比无合同更负
  });

  it('存档/读档保留可中断合同', () => {
    const sim = new Simulation();
    sim.signInterruptible(50, 12);
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.interruptibleMW).toBe(50);
    expect(sim2.interruptibleEndClock).toBeCloseTo(12 * 24, 6);
  });
});
