import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

/** 跑一座小电网若干 tick，校验端到端不变量 */
describe('Simulation 集成', () => {
  it('已接入且电源充足的负荷应被供电；孤立负荷应停电', () => {
    const sim = new Simulation();
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0).bus;
    const sub = g.addSubstation(3, 0);
    const { bus: loadBus } = g.addLoad(6, 0, 'industrial', 30, '工业区', 0);
    g.addLine(coal.id, sub.id);
    g.addLine(sub.id, loadBus.id);
    // 一个完全孤立的负荷（没接线）
    const { bus: islandLoad } = g.addLoad(20, 20, 'residential', 15, '孤岛', 0);

    let bestServedRatio = 0;
    for (let i = 0; i < 400; i++) {
      sim.tick(0.05, 600); // dtSim=30s/步
      // 不变量：关键数值始终有限、频率在物理范围内
      expect(Number.isFinite(sim.money)).toBe(true);
      expect(sim.frequency).toBeGreaterThanOrEqual(46);
      expect(sim.frequency).toBeLessThanOrEqual(52);
      const snap = sim.snapshot();
      expect(snap.totalServed).toBeLessThanOrEqual(snap.totalDemand + 1e-6);
      const l = g.loadsAtBus(loadBus.id)[0];
      if (l.demand > 0) bestServedRatio = Math.max(bestServedRatio, l.served / l.demand);
    }

    // 接入电网的工业负荷应当被基本满足
    expect(bestServedRatio).toBeGreaterThan(0.9);
    // 孤立负荷所在母线应处于停电
    expect(islandLoad.blackout).toBe(true);
  });

  it('线路跳闸会让下游孤岛停电（连锁停电）', () => {
    const sim = new Simulation();
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0).bus;
    const { bus: loadBus, load } = g.addLoad(4, 0, 'industrial', 30, '城区', 0);
    const line = g.addLine(coal.id, loadBus.id);

    for (let i = 0; i < 50; i++) sim.tick(0.05, 600);
    expect(loadBus.blackout).toBe(false); // 正常送电

    line.tripped = true; // 模拟唯一通道跳闸
    for (let i = 0; i < 20; i++) sim.tick(0.05, 600);
    expect(loadBus.blackout).toBe(true); // 下游成为无源孤岛 → 停电
    expect(load.served).toBeLessThan(1);
  });
});
