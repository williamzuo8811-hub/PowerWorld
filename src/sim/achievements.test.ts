import { describe, it, expect } from 'vitest';
import { Achievements } from './achievements';
import type { AchvContext } from '../config/achievements';

const base: AchvContext = {
  peakServed: 0, totalEnergyServed: 0, renewableShare: 0, reputation: 0,
  techCount: 0, allTech: false, won: false, n1Secure: false,
  grade: 'D', outageEnergyTotal: 999, netWorth: 0, debt: 0, marketShare: 0, day: 0, keyAccountKinds: 0,
};

describe('成就引擎', () => {
  it('达成条件即解锁，并进入待弹出队列', () => {
    const a = new Achievements();
    a.evaluate({ ...base, totalEnergyServed: 1, peakServed: 120 });
    expect(a.unlocked.has('firstPower')).toBe(true);
    expect(a.unlocked.has('grid100')).toBe(true);
    const drained = a.drain();
    expect(drained.length).toBe(2);
    expect(a.drain().length).toBe(0); // 取出后清空
  });

  it('同一成就不会重复解锁', () => {
    const a = new Achievements();
    a.evaluate({ ...base, reputation: 96 });
    a.drain();
    a.evaluate({ ...base, reputation: 96 });
    expect(a.drain().length).toBe(0);
  });

  it('点满科技 / 通关 / N-1 各自的判定', () => {
    const a = new Achievements();
    a.evaluate({ ...base, allTech: true, won: true, n1Secure: true, techCount: 6 });
    expect(a.unlocked.has('allTech')).toBe(true);
    expect(a.unlocked.has('champion')).toBe(true);
    expect(a.unlocked.has('n1')).toBe(true);
    expect(a.unlocked.has('researcher')).toBe(true);
  });

  it('挑战型成就：S 级通关 / 零失负荷 / 无债通关', () => {
    const a = new Achievements();
    a.evaluate({ ...base, won: true, grade: 'S', outageEnergyTotal: 0.2, debt: 0, netWorth: 2_000_000 });
    expect(a.unlocked.has('sWin')).toBe(true);
    expect(a.unlocked.has('zeroOutage')).toBe(true);
    expect(a.unlocked.has('debtFreeWin')).toBe(true);
    // 未通关时不解锁
    const b = new Achievements();
    b.evaluate({ ...base, won: false, grade: 'S', outageEnergyTotal: 0, netWorth: 9e9 });
    expect(b.unlocked.has('sWin')).toBe(false);
    expect(b.unlocked.has('zeroOutage')).toBe(false);
  });

  it('经营成就：大亨 / 市场霸主 / 招商满堂彩 / 春夏秋冬', () => {
    const a = new Achievements();
    a.evaluate({ ...base, netWorth: 3_500_000, marketShare: 0.65, keyAccountKinds: 4, day: 30 });
    expect(a.unlocked.has('tycoon')).toBe(true);
    expect(a.unlocked.has('marketKing')).toBe(true);
    expect(a.unlocked.has('fullHouse')).toBe(true);
    expect(a.unlocked.has('fullYear')).toBe(true);
  });
});
