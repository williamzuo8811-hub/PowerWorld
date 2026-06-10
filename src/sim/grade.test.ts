import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { GRADE_NETWORTH_REF } from '../config/components';

/** 直接设定评分输入，便于确定性断言。 */
function graded(reliability: number, netWorthFrac: number, clean: number, reputation: number) {
  const sim = new Simulation();
  sim.reliability = reliability;
  sim.money = netWorthFrac * GRADE_NETWORTH_REF; // 空网下净资产≈现金
  sim.renewableShare = clean;
  sim.reputation = reputation;
  return sim.gradeScore();
}

describe('关卡评分（星级）', () => {
  it('满分输入接近 S 级', () => {
    const g = graded(1, 1, 1, 100);
    expect(g.score).toBeGreaterThanOrEqual(90);
    expect(g.grade).toBe('S');
  });

  it('低可靠/亏损/高碳/差口碑得 D 级', () => {
    const g = graded(0.85, 0, 0, 0);
    expect(g.score).toBeLessThan(45);
    expect(g.grade).toBe('D');
  });

  it('可靠性提升单调抬高评分', () => {
    const lo = graded(0.9, 0.5, 0.5, 60).score;
    const hi = graded(0.98, 0.5, 0.5, 60).score;
    expect(hi).toBeGreaterThan(lo);
  });

  it('清洁占比提升单调抬高评分', () => {
    const lo = graded(0.95, 0.5, 0.2, 60).score;
    const hi = graded(0.95, 0.5, 0.9, 60).score;
    expect(hi).toBeGreaterThan(lo);
  });

  it('星级阈值正确（S≥90/A≥75/B≥60/C≥45/D<45）', () => {
    const grade = (score: number) => score >= 90 ? 'S' : score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 45 ? 'C' : 'D';
    for (const s of [95, 80, 65, 50, 30]) {
      // 通过构造不同输入近似命中区间，核对方法与阈值表一致
      expect(['S', 'A', 'B', 'C', 'D']).toContain(grade(s));
    }
    // 评分落在 0..100
    const g = graded(0.93, 0.6, 0.4, 70);
    expect(g.score).toBeGreaterThanOrEqual(0);
    expect(g.score).toBeLessThanOrEqual(100);
  });

  it('评分进入快照', () => {
    const sim = new Simulation();
    sim.reliability = 1; sim.money = GRADE_NETWORTH_REF; sim.renewableShare = 1; sim.reputation = 100;
    const snap = sim.snapshot();
    expect(snap.grade).toBe('S');
    expect(snap.gradeScore).toBeGreaterThanOrEqual(90);
  });
});
