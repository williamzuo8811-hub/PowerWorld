import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { CHURN_DAYS, BACKUP_FRACTION } from '../config/components';

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
