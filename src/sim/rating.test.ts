import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('信用评级', () => {
  it('健康财务评分高于高杠杆/低可靠', () => {
    const healthy = new Simulation();
    healthy.money = 1_500_000;
    healthy.reliability = 1;

    const weak = new Simulation();
    weak.grid.addPlant('coal', 0, 0); // 提供资产以便举债
    weak.money = 50_000;
    weak.reliability = 0.4;
    weak.debt = weak.creditLimit; // 拉满杠杆

    expect(healthy.creditScore).toBeGreaterThan(weak.creditScore);
  });

  it('评级越好利率越低、融资上限越高', () => {
    const good = new Simulation();
    good.money = 2_000_000;
    good.reliability = 1;

    const bad = new Simulation();
    bad.grid.addPlant('coal', 0, 0);
    bad.money = -200_000;
    bad.reliability = 0.2;
    bad.debt = bad.creditLimit;

    expect(good.loanDailyRate).toBeLessThan(bad.loanDailyRate);
    expect(good.creditLimit).toBeGreaterThan(0);
    expect(good.creditScore).toBeGreaterThan(bad.creditScore);
  });

  it('评级字母随评分映射', () => {
    const sim = new Simulation();
    sim.money = 5_000_000; // 极健康
    sim.reliability = 1;
    expect(['AAA', 'AA']).toContain(sim.creditRating);

    const sim2 = new Simulation();
    sim2.grid.addPlant('coal', 0, 0);
    sim2.money = -500_000;
    sim2.reliability = 0;
    sim2.debt = sim2.creditLimit;
    expect(['CCC', 'D', 'B']).toContain(sim2.creditRating);
  });
});
