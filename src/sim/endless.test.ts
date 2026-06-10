import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { scenarioById } from '../game/scenarios';
import { SEASON_YEAR_DAYS } from '../config/components';

describe('无尽经营与年度报告', () => {
  it('无尽模式 goalDay=Infinity，不会因天数获胜，但会破产', () => {
    const sim = new Simulation();
    scenarioById('endless')!.setup(sim);
    expect(sim.goalDay).toBe(Infinity);
    expect(sim.sandbox).toBe(false);
    sim.reliability = 1;
    sim.clock = 100 * 24; // 远超任何关卡时长
    sim.tick(0.05, 600);
    expect(sim.gameOver).toBe(false); // 无通关日
    sim.money = -1;
    sim.tick(0.05, 600);
    expect(sim.gameOver).toBe(true); // 破产仍然成立
    expect(sim.win).toBe(false);
  });

  it('跨年度边界发布经营年报', () => {
    const sim = new Simulation();
    scenarioById('endless')!.setup(sim);
    sim.clock = SEASON_YEAR_DAYS * 24 - 0.5; // 距离年末半小时
    sim.tick(0.05, 600);
    sim.tick(0.05, 60_000); // 跨过年度边界
    const report = sim.logs.find((l) => l.msg.includes('经营年报'));
    expect(report).toBeTruthy();
    expect(report!.msg).toContain('第 1 年');
  });

  it('读档后不重发既往年报', () => {
    const sim = new Simulation();
    scenarioById('endless')!.setup(sim);
    sim.clock = SEASON_YEAR_DAYS * 24 + 12; // 已在第 2 年中
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    sim2.tick(0.05, 600);
    expect(sim2.logs.some((l) => l.msg.includes('经营年报'))).toBe(false);
  });

  it('周年大考关卡目标为完整一年', () => {
    const sim = new Simulation();
    scenarioById('fullyear')!.setup(sim);
    expect(sim.goalDay).toBe(SEASON_YEAR_DAYS);
  });
});
