import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('ESG 评级与绿色融资', () => {
  it('清洁可靠高口碑 → ESG 高于脏/低口碑', () => {
    const clean = new Simulation();
    clean.renewableShare = 1;
    clean.reputation = 95;

    const dirty = new Simulation();
    dirty.renewableShare = 0;
    dirty.reputation = 30;

    expect(clean.esgScore).toBeGreaterThan(dirty.esgScore);
  });

  it('高 ESG 享受更低贷款利率（信用相同）', () => {
    const clean = new Simulation();
    clean.renewableShare = 1;
    clean.reputation = 95;

    const dirty = new Simulation();
    dirty.renewableShare = 0;
    dirty.reputation = 30;
    // 两者净资产/可靠性/杠杆相同 → 信用评分相同，差异仅来自 ESG
    expect(clean.loanDailyRate).toBeLessThan(dirty.loanDailyRate);
  });

  it('ESG 评级字母随评分映射', () => {
    const top = new Simulation();
    top.renewableShare = 1;
    top.reputation = 100;
    top.money = 3_000_000; // 抬高治理(信用)分
    expect(['A+', 'A']).toContain(top.esgRating);
  });
});
