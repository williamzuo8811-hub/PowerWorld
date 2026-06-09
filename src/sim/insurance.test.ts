import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('设备保险', () => {
  it('未投保时损失全额自付', () => {
    const sim = new Simulation();
    sim.insured = false;
    const m0 = sim.money;
    sim.incurDamage(10_000, '测试');
    expect(sim.money).toBeCloseTo(m0 - 10_000, 3);
  });

  it('已投保时保险覆盖大部分（自付20%）', () => {
    const sim = new Simulation();
    sim.insured = true;
    const m0 = sim.money;
    sim.incurDamage(10_000, '测试');
    expect(sim.money).toBeCloseTo(m0 - 2_000, 3); // 赔付 80%
  });

  it('投保需持续缴纳保费', () => {
    function run(ins: boolean): number {
      const sim = new Simulation();
      sim.forcedOutages = false;
      sim.grid.addPlant('coal', 0, 0); // 资产 → 保费基数
      sim.insured = ins;
      for (let i = 0; i < 200; i++) sim.tick(0.05, 600);
      return sim.money;
    }
    expect(run(true)).toBeLessThan(run(false)); // 保费拉低资金
  });

  it('存档保留投保状态', () => {
    const sim = new Simulation();
    sim.insured = true;
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.insured).toBe(true);
  });
});
