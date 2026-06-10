import { describe, it, expect, beforeEach } from 'vitest';
import { recordScore, bestFor, allBests, shareText, type ScoreRecord } from './leaderboard';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

function rec(over: Partial<ScoreRecord> = {}): ScoreRecord {
  return {
    scenarioId: 'town', ts: Date.now(), day: 12, score: 80, grade: 'A',
    reliability: 0.97, clean: 0.5, marketShare: 0.3, netWorth: 1_200_000, ...over,
  };
}

describe('本地排行榜与战绩分享', () => {
  it('记录成绩并识别个人最佳', () => {
    const r1 = recordScore(rec({ score: 70, grade: 'B' }));
    expect(r1.isBest).toBe(true);
    const r2 = recordScore(rec({ score: 88, grade: 'A' }));
    expect(r2.isBest).toBe(true);
    const r3 = recordScore(rec({ score: 60, grade: 'B' }));
    expect(r3.isBest).toBe(false);
    expect(r3.best.score).toBe(88);
    expect(bestFor('town')!.score).toBe(88);
  });

  it('每日挑战按种子区分题面', () => {
    recordScore(rec({ scenarioId: 'daily', seed: 20260610, score: 75 }));
    recordScore(rec({ scenarioId: 'daily', seed: 20260611, score: 90 }));
    expect(bestFor('daily', 20260610)!.score).toBe(75);
    expect(bestFor('daily', 20260611)!.score).toBe(90);
    expect(bestFor('daily', 20260612)).toBeNull();
    expect(allBests().daily.score).toBe(90); // 菜单徽章取任意日最高
  });

  it('不同关卡的最佳互不干扰', () => {
    recordScore(rec({ scenarioId: 'town', score: 70 }));
    recordScore(rec({ scenarioId: 'green', score: 95, grade: 'S' }));
    const bests = allBests();
    expect(bests.town.score).toBe(70);
    expect(bests.green.grade).toBe('S');
  });

  it('分享文本包含关键战绩', () => {
    const text = shareText(rec({ grade: 'S', score: 92, seed: 20260610 }), '📅 每日挑战');
    expect(text).toContain('每日挑战');
    expect(text).toContain('#20260610');
    expect(text).toContain('S');
    expect(text).toContain('92');
    expect(text).toContain('97.0%');
  });

  it('历史记录有限额不会无限增长', () => {
    for (let i = 0; i < 100; i++) recordScore(rec({ score: i }));
    const raw = JSON.parse(store.get('powerworld.scores.v1')!) as { history: unknown[] };
    expect(raw.history.length).toBeLessThanOrEqual(60);
  });
});
