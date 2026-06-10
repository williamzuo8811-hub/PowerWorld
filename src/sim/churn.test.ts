import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { CHURN_DAYS, BACKUP_FRACTION } from '../config/components';

/** 让一个数据中心持续欠供，运行若干小时后返回其流失计时（未流失时）。 */
function churnTimerAfter(playerGens: number, hours: number): number {
  const sim = new Simulation();
  sim.forcedOutages = false; sim.events.nextAt = Infinity; sim.sandbox = true;
  for (let k = 0; k < playerGens; k++) sim.grid.addPlant('coal', k, 9); // 玩家装机→降低竞争激烈度
  const { load } = sim.grid.addLoad(0, 0, 'datacenter', 40, 'DC', 0); // 不接线→始终欠供
  for (let i = 0; i < hours; i++) sim.tick(3600, 1);
  return sim.grid.loads.has(load.id) ? (load.churnTimer ?? 0) : Infinity;
}

describe('大客户流失与自备应急', () => {
  it('长期供电不足导致大客户流失（撤离）', () => {
    const sim = new Simulation();
    sim.forcedOutages = false; sim.events.nextAt = Infinity; sim.sandbox = true;
    const { load } = sim.grid.addLoad(0, 0, 'datacenter', 40, '云数据中心', 0); // 无电源 → 持续失负荷
    const id = load.id;
    // 推进超过流失阈值天数
    const hours = Math.ceil(CHURN_DAYS * 24) + 24;
    for (let i = 0; i < hours; i++) sim.tick(3600, 1);
    expect(sim.grid.loads.has(id)).toBe(false); // 已流失
  });

  it('短期欠供未达阈值不流失', () => {
    const sim = new Simulation();
    sim.forcedOutages = false; sim.events.nextAt = Infinity; sim.sandbox = true;
    const { load } = sim.grid.addLoad(0, 0, 'datacenter', 40, '云数据中心', 0);
    for (let i = 0; i < 24; i++) sim.tick(3600, 1); // 仅 1 天
    expect(sim.grid.loads.has(load.id)).toBe(true);
  });

  it('自备应急电源护住满意度、避免流失', () => {
    const sim = new Simulation();
    sim.forcedOutages = false; sim.events.nextAt = Infinity; sim.sandbox = true;
    sim.money = 10_000_000;
    const { bus, load } = sim.grid.addLoad(0, 0, 'datacenter', 40, '云数据中心', 0);
    expect(sim.addBackup(bus.id)).toBe(true);
    expect(load.backup).toBe(true);
    const hours = Math.ceil(CHURN_DAYS * 24) + 48;
    for (let i = 0; i < hours; i++) sim.tick(3600, 1);
    expect(sim.grid.loads.has(load.id)).toBe(true); // 未流失
    expect(load.satisfaction!).toBeGreaterThanOrEqual(BACKUP_FRACTION - 0.05); // 满意度被兜底托住
  });

  it('自备应急仅对大客户、未装、资金足时可加装', () => {
    const sim = new Simulation();
    sim.money = 10_000_000;
    const dc = sim.grid.addLoad(0, 0, 'datacenter', 40, 'DC', 0);
    const city = sim.grid.addLoad(2, 0, 'residential', 20, '城区', 0);
    expect(sim.addBackup(city.bus.id)).toBe(false); // 普通城区非大客户
    expect(sim.addBackup(dc.bus.id)).toBe(true);
    expect(sim.addBackup(dc.bus.id)).toBe(false); // 已加装
  });

  it('竞争越激烈挖角越快（流失计时增长更快）', () => {
    const contested = churnTimerAfter(0, 30); // 玩家无装机→竞争激烈
    const dominant = churnTimerAfter(12, 30); // 玩家主导市场→竞争温和
    expect(contested).toBeGreaterThan(dominant);
  });

  it('竞争市场中流失被记为"被对手挖走"并增强对手', () => {
    const sim = new Simulation();
    sim.forcedOutages = false; sim.events.nextAt = Infinity; sim.sandbox = true;
    const topBefore = Math.max(...sim.competitors.map((c) => c.capacity));
    sim.grid.addLoad(0, 0, 'datacenter', 40, '云数据中心', 0); // 欠供 → 终将被挖走
    const hours = Math.ceil(CHURN_DAYS * 24) + 12;
    for (let i = 0; i < hours; i++) sim.tick(3600, 1);
    expect(sim.logs.some((l) => l.msg.includes('被竞争对手挖走'))).toBe(true);
    const topAfter = Math.max(...sim.competitors.map((c) => c.capacity));
    expect(topAfter).toBeGreaterThan(topBefore); // 对手因挖角增强
  });

  it('满意度告急时发出挖角预警（流失前）', () => {
    const sim = new Simulation();
    sim.forcedOutages = false; sim.events.nextAt = Infinity; sim.sandbox = true;
    sim.grid.addLoad(0, 0, 'datacenter', 40, '云数据中心', 0); // 持续欠供
    // 推进到达预警线但尚未流失
    for (let i = 0; i < 30; i++) sim.tick(3600, 1);
    expect(sim.logs.some((l) => l.level === 'warn' && l.msg.includes('满意度告急'))).toBe(true);
  });

  it('自备应急电源纳入存档', () => {
    const sim = new Simulation();
    sim.money = 10_000_000;
    const dc = sim.grid.addLoad(0, 0, 'datacenter', 40, 'DC', 0);
    sim.addBackup(dc.bus.id);
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.grid.loadsAtBus(dc.bus.id)[0].backup).toBe(true);
  });
});
