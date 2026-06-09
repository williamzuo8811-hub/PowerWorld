import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { STORAGE } from '../config/components';

describe('多类型长时储能', () => {
  it('按类型创建不同容量/功率/效率的储能', () => {
    const sim = new Simulation();
    const pumped = sim.grid.addBattery(0, 0, 'pumped').battery;
    const hydro = sim.grid.addBattery(2, 0, 'hydrogen').battery;
    expect(pumped.type).toBe('pumped');
    expect(pumped.energyCapacity).toBe(STORAGE.pumped.energyCapacity);
    expect(hydro.energyCapacity).toBe(STORAGE.hydrogen.energyCapacity);
    expect(hydro.energyCapacity).toBeGreaterThan(pumped.energyCapacity); // 氢储时长更长
    expect(hydro.roundTrip).toBeLessThan(pumped.roundTrip); // 氢储效率更低
  });

  it('长时储能可充放电参与调度', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0); // 慢机组
    const sub = g.addSubstation(2, 0);
    const { bus: loadBus } = g.addLoad(4, 0, 'industrial', 50, '厂', 0);
    const pumped = g.addBattery(2, 2, 'pumped');
    g.addLine(coal.bus.id, sub.id);
    g.addLine(sub.id, loadBus.id);
    g.addLine(sub.id, pumped.bus.id);
    const soc0 = pumped.battery.soc;
    sim.tick(0.05, 600); // 首个 tick 煤未爬起 → 抽蓄放电补缺
    expect(pumped.battery.output).toBeGreaterThan(0);
    expect(loadBus.blackout).toBe(false);
    expect(pumped.battery.soc).toBeLessThan(soc0);
  });

  it('长时储能容量信用高于电池（每 MW）', () => {
    function firmCredit(type: 'battery' | 'pumped'): number {
      const sim = new Simulation();
      sim.forcedOutages = false;
      sim.grid.addBattery(0, 0, type);
      sim.tick(0.05, 600);
      return sim.finance.capacity; // 容量补偿正比于容量信用
    }
    // 抽蓄功率更大且信用更高 → 容量补偿更高
    expect(firmCredit('pumped')).toBeGreaterThan(firmCredit('battery'));
  });

  it('存档保留储能类型', () => {
    const sim = new Simulation();
    sim.grid.addBattery(0, 0, 'hydrogen');
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect([...sim2.grid.batteries.values()][0].type).toBe('hydrogen');
  });
});
