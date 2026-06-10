import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('储能电池', () => {
  it('放电填补慢机组爬坡缺口，避免初期停电', () => {
    const sim = new Simulation();
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0).bus; // 爬坡慢
    const sub = g.addSubstation(2, 0);
    const { bus: loadBus } = g.addLoad(4, 0, 'industrial', 40, '厂区', 0);
    const bat = g.addBattery(2, 2);
    g.addLine(coal.id, sub.id); // HV
    g.addLine(sub.id, loadBus.id); // MV
    g.addLine(sub.id, bat.bus.id); // HV（储能经变电站接入）

    const socStart = bat.battery.soc;
    sim.tick(0.05, 600); // 首个 tick：燃煤还没爬起来
    expect(bat.battery.output).toBeGreaterThan(0); // 储能在放电
    expect(loadBus.blackout).toBe(false); // 负荷被储能托住

    for (let i = 0; i < 60; i++) sim.tick(0.05, 600);
    expect(bat.battery.soc).toBeLessThan(socStart); // 放过电，SoC 下降
  });

  it('过剩时充电吸收（消纳新能源）', () => {
    const sim = new Simulation();
    const g = sim.grid;
    const sub = g.addSubstation(0, 0);
    const wind = g.addPlant('wind', 0, 2).bus;
    const bat = g.addBattery(2, 0); // 无负荷 → 风电全是过剩
    g.addLine(sub.id, wind.id);
    g.addLine(sub.id, bat.bus.id);

    const socStart = bat.battery.soc;
    let charged = false;
    for (let i = 0; i < 120; i++) {
      sim.tick(0.05, 600);
      if (bat.battery.soc > socStart + 0.5) { charged = true; break; }
    }
    expect(charged).toBe(true);
  });

  it('空电池无法供电，下游仍会停电', () => {
    const sim = new Simulation();
    const g = sim.grid;
    const sub = g.addSubstation(0, 0);
    const bat = g.addBattery(0, 2);
    bat.battery.soc = 0; // 没电
    const { bus: loadBus } = g.addLoad(2, 0, 'industrial', 20, '厂', 0);
    g.addLine(sub.id, bat.bus.id);
    g.addLine(sub.id, loadBus.id);

    sim.tick(0.05, 600);
    expect(loadBus.blackout).toBe(true);
  });
});
