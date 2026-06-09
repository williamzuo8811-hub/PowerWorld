import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('电压等级与拓扑约束', () => {
  it('电厂/负荷不能直连，必须经变电站；电压等级按两端类型决定', () => {
    const sim = new Simulation();
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0).bus;
    const load = g.addLoad(4, 0, 'industrial', 30, '城区', 0).bus;
    expect(g.canConnect(coal.id, load.id).ok).toBe(false); // 直连被拒

    const sub = g.addSubstation(2, 0);
    expect(g.canConnect(coal.id, sub.id).ok).toBe(true);
    expect(g.canConnect(coal.id, sub.id).voltage).toBe('HV'); // 电厂↔变电站 = 高压
    expect(g.canConnect(sub.id, load.id).voltage).toBe('MV'); // 变电站↔负荷 = 中压
  });
});

describe('变电站变压器过载保护', () => {
  it('变压器过载会跳闸并切断下游配电', () => {
    const sim = new Simulation();
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0).bus; // 60MW 电源充足
    const sub = g.addSubstation(2, 0);
    sub.rating = 20; // 故意给一个偏小的变压器
    const load = g.addLoad(4, 0, 'industrial', 45, '重工区', 0).bus; // 需求 > 20MW

    g.addLine(coal.id, sub.id); // HV
    g.addLine(sub.id, load.id); // MV（经变压器降压）

    let tripped = false;
    for (let i = 0; i < 300; i++) {
      sim.tick(0.05, 600);
      if (sub.transformerTripped) { tripped = true; break; }
    }
    expect(tripped).toBe(true);

    // 跳闸后下游成为无源孤岛 → 停电
    for (let i = 0; i < 10; i++) sim.tick(0.05, 600);
    expect(load.blackout).toBe(true);
  });
});
