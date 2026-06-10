import { describe, it, expect } from 'vitest';
import { Simulation } from '../sim/simulation';
import { SCENARIOS, scenarioById } from './scenarios';
import { CARBON_PRICE_START } from '../config/components';

describe('战役关卡', () => {
  it('关卡 id 唯一且字段齐全', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SCENARIOS) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.brief.length).toBeGreaterThan(0);
      expect(typeof s.setup).toBe('function');
    }
  });

  it('每个关卡 setup 不抛错并配置目标/初始电网', () => {
    for (const s of SCENARIOS) {
      const sim = new Simulation();
      expect(() => s.setup(sim)).not.toThrow();
      expect(sim.money).toBeGreaterThan(0);
      // 教程/沙盒外的关卡应有有限目标日
      if (s.id !== 'tutorial' && s.id !== 'sandbox') {
        expect(Number.isFinite(sim.goalDay)).toBe(true);
      }
    }
  });

  it('碳中和转型：碳价倍率>1 并抬高有效碳价', () => {
    const sim = new Simulation();
    scenarioById('lowcarbon')!.setup(sim);
    expect(sim.carbonPriceMult).toBeGreaterThan(1);
    expect(sim.carbonPrice).toBeGreaterThan(CARBON_PRICE_START); // 倍率生效
  });

  it('迎峰度夏：开局即处于夏季', () => {
    const sim = new Simulation();
    scenarioById('summer')!.setup(sim);
    expect(sim.seasonLabel).toBe('夏');
    expect(sim.seasonDemandFactor).toBeGreaterThan(1); // 夏季需求加成
  });

  it('碳价倍率纳入存档', () => {
    const sim = new Simulation();
    scenarioById('lowcarbon')!.setup(sim);
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.carbonPriceMult).toBeCloseTo(sim.carbonPriceMult, 6);
  });
});
