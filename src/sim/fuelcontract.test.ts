import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('燃料长约采购', () => {
  it('签约后有效燃料指数锁定，不随现货变化', () => {
    const sim = new Simulation();
    const gas = sim.grid.addPlant('gas', 0, 0).gen;
    sim.fuelPrice.gas = 1;
    sim.signFuelContract('gas', 15);
    const lockedMC = sim.effMarginalCost(gas);

    sim.fuelPrice.gas = 2; // 现货暴涨
    expect(sim.effMarginalCost(gas)).toBeCloseTo(lockedMC, 6); // 仍按锁价
    expect(sim.effMarginalCost(gas)).toBeLessThan(gas.marginalCost * 2); // 低于现货
  });

  it('长约到期后回到现货', () => {
    const sim = new Simulation();
    sim.grid.addPlant('gas', 0, 0);
    sim.fuelPrice.gas = 1;
    sim.signFuelContract('gas', 5);
    sim.fuelPrice.gas = 2;
    sim.clock = 5 * 24 + 1; // 超过到期
    expect(sim.effFuelIndex('gas')).toBeCloseTo(2, 6); // 回到现货
  });

  it('锁价含溢价（高于当时现货）', () => {
    const sim = new Simulation();
    sim.fuelPrice.coal = 1;
    sim.signFuelContract('coal', 10);
    expect(sim.effFuelIndex('coal')).toBeGreaterThan(1); // 溢价
  });

  it('存档保留燃料长约', () => {
    const sim = new Simulation();
    sim.fuelPrice.coal = 1.2;
    sim.signFuelContract('coal', 10);
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.fuelContracts.coal).toBeTruthy();
    expect(sim2.effFuelIndex('coal')).toBeGreaterThan(1);
  });
});
