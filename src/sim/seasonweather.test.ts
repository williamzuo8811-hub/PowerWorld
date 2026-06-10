import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { weatherWeights, weightedChoice } from './events';
import { SEASON_YEAR_DAYS } from '../config/components';

describe('季节性极端天气', () => {
  it('weatherWeights：夏偏热浪/雷暴、冬偏寒潮', () => {
    const summer = Object.fromEntries(weatherWeights(1, 0));
    const winter = Object.fromEntries(weatherWeights(0, 1));
    expect(summer.heatwave).toBeGreaterThan(winter.heatwave);
    expect(winter.coldsnap).toBeGreaterThan(summer.coldsnap);
    expect(summer.storm).toBeGreaterThan(winter.storm);
  });

  it('weightedChoice 按季节权重选择（统计）', () => {
    let heatSummer = 0, heatWinter = 0;
    const N = 6000;
    for (let i = 0; i < N; i++) {
      if (weightedChoice(weatherWeights(1, 0)) === 'heatwave') heatSummer++;
      if (weightedChoice(weatherWeights(0, 1)) === 'heatwave') heatWinter++;
    }
    expect(heatSummer).toBeGreaterThan(heatWinter); // 盛夏更常出热浪
  });

  it('盛夏热浪强度高于换季热浪', () => {
    const orig = Math.random;
    Math.random = () => 0.5; // rnd 取中点，去随机
    try {
      const make = (phase: number) => {
        const sim = new Simulation();
        sim.clock = phase * SEASON_YEAR_DAYS * 24;
        sim.events.triggerKind(sim, 'heatwave');
        sim.events.update(sim);
        return sim.events.demandFactor;
      };
      expect(make(0.25)).toBeGreaterThan(make(0.0)); // 盛夏 > 春
    } finally {
      Math.random = orig;
    }
  });

  it('深冬寒潮强度高于换季寒潮', () => {
    const orig = Math.random;
    Math.random = () => 0.5;
    try {
      const make = (phase: number) => {
        const sim = new Simulation();
        sim.clock = phase * SEASON_YEAR_DAYS * 24;
        sim.events.triggerKind(sim, 'coldsnap');
        sim.events.update(sim);
        return sim.events.demandFactor;
      };
      expect(make(0.75)).toBeGreaterThan(make(0.5)); // 深冬 > 秋
    } finally {
      Math.random = orig;
    }
  });
});
