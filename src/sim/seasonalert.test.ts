import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { SEASON_YEAR_DAYS } from '../config/components';

/** 从春季跨入夏季，返回过渡那一拍新增的日志。 */
function enterSummerLogs(firmEnough: boolean) {
  const sim = new Simulation();
  sim.forcedOutages = false;
  sim.events.nextAt = Infinity;
  sim.money = 50_000_000;
  sim.grid.addLoad(4, 0, 'industrial', 30, '厂', 0);
  if (firmEnough) for (let k = 0; k < 4; k++) sim.grid.addPlant('coal', k, 0);
  sim.clock = 0; // 春
  sim.tick(3600, 1); // 设定 lastSeason='春'（春季不触发预警）
  sim.clock = 0.2 * SEASON_YEAR_DAYS * 24; // 进入夏季
  const before = sim.logs.length;
  sim.tick(3600, 1);
  return sim.logs.slice(before);
}

describe('迎峰度夏/度冬充裕度预警', () => {
  it('容量不足时进入夏季发出迎峰警告', () => {
    const logs = enterSummerLogs(false);
    const alert = logs.find((l) => l.msg.includes('迎峰度夏'));
    expect(alert).toBeDefined();
    expect(alert!.level).toBe('warn');
    expect(alert!.msg).toContain('补强');
  });

  it('容量充裕时进入夏季给出充裕提示', () => {
    const logs = enterSummerLogs(true);
    const alert = logs.find((l) => l.msg.includes('迎峰度夏'));
    expect(alert).toBeDefined();
    expect(alert!.level).toBe('good');
    expect(alert!.msg).toContain('充裕');
  });

  it('停留在同一季节不重复预警', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    sim.events.nextAt = Infinity;
    sim.grid.addLoad(4, 0, 'industrial', 30, '厂', 0);
    sim.clock = 0.2 * SEASON_YEAR_DAYS * 24; // 夏
    sim.tick(3600, 1); // 首次进入夏 → 预警一次
    const after = sim.logs.length;
    sim.tick(3600, 1); // 仍在夏 → 不应再预警
    const newLogs = sim.logs.slice(after).filter((l) => l.msg.includes('迎峰'));
    expect(newLogs.length).toBe(0);
  });

  it('seasonalPeakAdequacy 随可信容量上升而提高', () => {
    const sim = new Simulation();
    sim.grid.addLoad(4, 0, 'industrial', 30, '厂', 0);
    const m0 = sim.seasonalPeakAdequacy().margin;
    for (let k = 0; k < 4; k++) sim.grid.addPlant('coal', k, 0);
    const m1 = sim.seasonalPeakAdequacy().margin;
    expect(m1).toBeGreaterThan(m0);
  });
});
