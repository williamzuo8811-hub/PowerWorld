import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { AUTOOPS_CASH_FLOOR, SEASON_YEAR_DAYS } from '../config/components';

function setup(): Simulation {
  const sim = new Simulation();
  sim.forcedOutages = false;
  sim.events.nextAt = Infinity;
  const g = sim.grid;
  const coal = g.addPlant('coal', 0, 0).bus;
  const sub = g.addSubstation(2, 0);
  const load = g.addLoad(4, 0, 'industrial', 40, '厂', 0).bus;
  g.addLine(coal.id, sub.id);
  g.addLine(sub.id, load.id);
  return sim;
}

describe('自动运维 / 联合调度助理', () => {
  it('自动重合闸：跳闸线路约 60 秒后自动恢复（无需自愈科技）', () => {
    const sim = setup();
    sim.autoOps.reclose = true;
    const ln = [...sim.grid.lines.values()][0];
    ln.tripped = true;
    ln.overloadTimer = 0;
    for (let i = 0; i < 30; i++) sim.tick(0.05, 600); // 30×30=900 仿真秒 > 60s
    expect(ln.tripped).toBe(false);
    // 关闭助理则保持跳闸
    const sim2 = setup();
    const ln2 = [...sim2.grid.lines.values()][0];
    ln2.tripped = true;
    for (let i = 0; i < 30; i++) sim2.tick(0.05, 600);
    expect(ln2.tripped).toBe(true);
  });

  it('自动重合闸：变压器跳闸也能自动恢复', () => {
    const sim = setup();
    sim.autoOps.reclose = true;
    const sub = [...sim.grid.buses.values()].find((b) => b.kind === 'substation')!;
    sub.transformerTripped = true;
    sub.transformerTimer = 0;
    for (let i = 0; i < 30; i++) sim.tick(0.05, 600);
    expect(sub.transformerTripped).toBe(false);
  });

  it('淡季自动检修：换季窗口给高磨损机组安排大修', () => {
    const sim = setup();
    sim.autoOps.maintenance = true;
    sim.money = 5_000_000;
    sim.clock = SEASON_YEAR_DAYS * 24 * 0.99; // 即将进入春季（换季淡季）
    const gen = [...sim.grid.gens.values()][0];
    gen.age = 35; // 磨损 ~0.88
    const ageBefore = gen.age;
    for (let i = 0; i < 80; i++) sim.tick(0.05, 60_000); // 跨过日界与季节
    expect(gen.age).toBeLessThan(ageBefore); // 大修返新
  });

  it('自动还款：现金高于底线时偿还贷款', () => {
    const sim = setup();
    sim.autoOps.repay = true;
    sim.borrow(200_000);
    sim.money = AUTOOPS_CASH_FLOOR + 150_000;
    const debtBefore = sim.debt;
    for (let i = 0; i < 40; i++) sim.tick(0.05, 60_000); // 跨日界触发
    expect(sim.debt).toBeLessThan(debtBefore);
    expect(sim.money).toBeGreaterThanOrEqual(0);
  });

  it('迎峰预并网：晚峰前自动并网解列的慢启动机组', () => {
    const sim = setup();
    sim.autoOps.precommit = true;
    sim.clock = 16; // 第 0 天 16:00（预并网窗口内）
    const gen = [...sim.grid.gens.values()][0];
    gen.committed = false;
    gen.commitLockUntil = 0;
    sim.tick(0.05, 600);
    expect(gen.committed).toBe(true); // 已被联合调度预并网
    expect(sim.logs.some((l) => l.msg.includes('联合调度'))).toBe(true);
  });

  it('autoOps 随存档往返', () => {
    const sim = setup();
    sim.autoOps.reclose = true;
    sim.autoOps.precommit = true;
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.autoOps.reclose).toBe(true);
    expect(sim2.autoOps.precommit).toBe(true);
    expect(sim2.autoOps.maintenance).toBe(false);
  });
});
