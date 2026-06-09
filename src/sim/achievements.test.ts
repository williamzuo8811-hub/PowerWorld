import { describe, it, expect } from 'vitest';
import { Achievements } from './achievements';
import type { AchvContext } from '../config/achievements';

const base: AchvContext = {
  peakServed: 0, totalEnergyServed: 0, renewableShare: 0, reputation: 0,
  techCount: 0, allTech: false, won: false, n1Secure: false,
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
});
