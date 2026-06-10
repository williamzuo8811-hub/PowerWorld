import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { AS_PRICE_MIN, AS_PRICE_MAX, AS_REG_PRICE_BASE } from '../config/components';

describe('辅助服务竞价出清', () => {
  it('玩家增加快速容量(储能·投标调频策略)拉低调频出清价', () => {
    function regPrice(nBatteries: number): number {
      const sim = new Simulation();
      sim.forcedOutages = false;
      sim.storageStrategy = 'reg'; // 储能须选择"投标调频"策略才计入调频供给
      for (let k = 0; k < nBatteries; k++) sim.grid.addBattery(k, 0, 'battery');
      sim.tick(0.05, 600);
      return sim.regPrice;
    }
    expect(regPrice(0)).toBeGreaterThan(regPrice(20)); // 大量储能 → 调频供给充裕 → 价低
  });

  it('储能选择"专注套利"策略时不计入调频供给', () => {
    function regPrice(strategy: 'arb' | 'reg'): number {
      const sim = new Simulation();
      sim.forcedOutages = false;
      sim.storageStrategy = strategy;
      for (let k = 0; k < 20; k++) sim.grid.addBattery(k, 0, 'battery');
      sim.tick(0.05, 600);
      return sim.regPrice;
    }
    expect(regPrice('arb')).toBeGreaterThan(regPrice('reg')); // 不投标 → 供给少 → 价高
  });

  it('增加闲置可调容量拉低备用出清价', () => {
    function reservePrice(nPlants: number): number {
      const sim = new Simulation();
      sim.forcedOutages = false;
      for (let k = 0; k < nPlants; k++) sim.grid.addPlant('coal', k, 0); // 闲置 → 备用
      sim.tick(0.05, 600);
      return sim.reservePrice;
    }
    expect(reservePrice(0)).toBeGreaterThan(reservePrice(12));
  });

  it('调频/备用出清价落在配置上下限内', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    for (let i = 0; i < 100; i++) sim.tick(0.05, 600);
    expect(sim.regPrice).toBeGreaterThanOrEqual(AS_REG_PRICE_BASE * AS_PRICE_MIN - 1e-6);
    expect(sim.regPrice).toBeLessThanOrEqual(AS_REG_PRICE_BASE * AS_PRICE_MAX + 1e-6);
  });
});
