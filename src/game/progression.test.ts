// 元进度 / 变体模式 / 附加目标 / 新关卡类型 / 每日挑战扩展 / 自定义关卡 v2 的回归测试。
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Simulation } from '../sim/simulation';
import { objectiveDone, objectiveLabel, validateObjective } from '../sim/objectives';
import { loadMeta, recordRunResult, consumeRpBonus, levelOf, levelProgress, XP_LOSS } from './meta';
import { MODES, modeById, modeApplicable } from './modes';
import { scenarioById, setupDaily, mulberry32 } from './scenarios';
import { parseCustomScenario, SCENARIO_FORMAT, exportCurrentAsScenario, validateCustom } from './custom';
import { shareText, type ScoreRecord } from './leaderboard';

// node 环境没有 localStorage：内存 mock
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});
afterEach(() => vi.restoreAllMocks());

describe('元进度（meta）', () => {
  it('胜负都给 XP；失败武装下局 +10% 研发点补偿', () => {
    let r = recordRunResult(true, 'A');
    expect(r.gainedXp).toBeGreaterThan(XP_LOSS);
    r = recordRunResult(false, 'D');
    expect(r.lossBonusArmed).toBe(true);
    expect(loadMeta().pendingRpBonus).toBeGreaterThan(0);
    // 下一局消耗补偿
    expect(consumeRpBonus()).toBeCloseTo(1.1, 6);
    // 再下一局回到 1
    expect(consumeRpBonus()).toBe(1);
  });

  it('等级随 XP 单调上升且进度有界', () => {
    expect(levelOf(0)).toBe(1);
    expect(levelOf(100)).toBe(2);
    expect(levelOf(5000)).toBeGreaterThan(levelOf(1000));
    const p = levelProgress(123);
    expect(p.frac).toBeGreaterThanOrEqual(0);
    expect(p.frac).toBeLessThanOrEqual(1);
  });

  it('S 级通关比 D 级给更多 XP', () => {
    const s = recordRunResult(true, 'S').gainedXp;
    const d = recordRunResult(true, 'D').gainedXp;
    expect(s).toBeGreaterThan(d);
  });
});

describe('变体模式（modes）', () => {
  it('五种模式定义齐全且解锁等级递增', () => {
    expect(MODES.length).toBe(5);
    for (let i = 1; i < MODES.length; i++) expect(MODES[i].unlockLevel).toBeGreaterThan(MODES[i - 1].unlockLevel);
  });

  it('困难模式：资金减少、对手增强、事件更频繁', () => {
    const sim = new Simulation();
    scenarioById('town')!.setup(sim);
    const money0 = sim.money;
    const comp0 = sim.competitors[0].capacity;
    modeById('hard').apply(sim);
    expect(sim.money).toBeLessThan(money0);
    expect(sim.competitors[0].capacity).toBeGreaterThan(comp0);
    expect(sim.events.intensity).toBeGreaterThan(1);
  });

  it('竞速模式：目标日压到 7 天内', () => {
    const sim = new Simulation();
    scenarioById('fullyear')!.setup(sim); // 原 24 天
    modeById('speedrun').apply(sim);
    expect(sim.goalDay).toBeLessThanOrEqual(7);
  });

  it('无贷款模式禁止借款', () => {
    const sim = new Simulation();
    scenarioById('town')!.setup(sim);
    modeById('noloan').apply(sim);
    expect(sim.borrow(100_000)).toBe(false);
    expect(sim.debt).toBe(0);
  });

  it('极限模式：开局负债且会被利息侵蚀', () => {
    const sim = new Simulation();
    scenarioById('town')!.setup(sim);
    modeById('ironman').apply(sim);
    expect(sim.debt).toBeGreaterThanOrEqual(400_000);
  });

  it('教程/沙盒不可叠模式', () => {
    expect(modeApplicable('tutorial')).toBe(false);
    expect(modeApplicable('tutFinance')).toBe(false);
    expect(modeApplicable('sandbox')).toBe(false);
    expect(modeApplicable('town')).toBe(true);
    expect(modeApplicable('daily')).toBe(true);
  });
});

describe('附加目标（objectives）', () => {
  it('keyAccountByDay：签下大客户后达成；到期未达成判负', () => {
    const sim = new Simulation();
    scenarioById('megadeal')!.setup(sim);
    expect(sim.objectives.length).toBe(1);
    expect(objectiveDone(sim, sim.objectives[0])).toBe(false);
    expect(objectiveLabel(sim.objectives[0])).toContain('数据中心');
    // 模拟到期未签 → 判负
    sim.clock = 8 * 24 + 1;
    sim.money = 100_000;
    sim.tick(0.05, 1440);
    expect(sim.gameOver).toBe(true);
    expect(sim.win).toBe(false);
  });

  it('keyAccountByDay：签下即达成，不再判负', () => {
    const sim = new Simulation();
    scenarioById('megadeal')!.setup(sim);
    sim.grid.addLoad(20, 10, 'datacenter', 48, '云数据中心', 0.005);
    expect(objectiveDone(sim, sim.objectives[0])).toBe(true);
    sim.clock = 8 * 24 + 1;
    sim.tick(0.05, 1440);
    expect(sim.gameOver).toBe(false);
  });

  it('n1ByDay：n1Secure 置位后达成', () => {
    const sim = new Simulation();
    scenarioById('restore')!.setup(sim);
    expect(objectiveDone(sim, sim.objectives[0])).toBe(false);
    sim.n1Secure = true;
    expect(objectiveDone(sim, sim.objectives[0])).toBe(true);
  });

  it('atWin 型目标作为通关门槛：未达成不判胜', () => {
    const sim = new Simulation();
    sim.goalDay = 1;
    sim.goalReliability = 0;
    sim.objectives = [{ kind: 'netWorthAtWin', amount: 99_999_999_999 }];
    sim.clock = 24 * 2;
    sim.tick(0.05, 1440);
    expect(sim.win).toBe(false);
    expect(sim.gameOver).toBe(false); // 不判负，继续经营
  });

  it('目标可序列化进存档', () => {
    const sim = new Simulation();
    scenarioById('megadeal')!.setup(sim);
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.objectives).toEqual(sim.objectives);
    expect(sim2.scriptedWeather.length).toBe(sim.scriptedWeather.length);
  });

  it('validateObjective 拒绝非法数据', () => {
    expect(validateObjective({ kind: 'keyAccountByDay', profile: 'datacenter', byDay: 8 })).toBeNull();
    expect(validateObjective({ kind: 'keyAccountByDay', profile: 'nope', byDay: 8 })).not.toBeNull();
    expect(validateObjective({ kind: 'cleanShareAtWin', share: 2 })).not.toBeNull();
    expect(validateObjective({ kind: 'wat' })).not.toBeNull();
    expect(validateObjective(null)).not.toBeNull();
  });
});

describe('新关卡类型', () => {
  it('残局修复：开局即有跳闸线路与检修机组', () => {
    const sim = new Simulation();
    scenarioById('restore')!.setup(sim);
    expect([...sim.grid.lines.values()].filter((l) => l.tripped).length).toBeGreaterThanOrEqual(2);
    expect([...sim.grid.gens.values()].some((g) => g.outageUntil != null)).toBe(true);
    expect([...sim.grid.gens.values()].some((g) => g.age > 20)).toBe(true);
  });

  it('精打细算：禁贷生效', () => {
    const sim = new Simulation();
    scenarioById('budget')!.setup(sim);
    expect(sim.loanBan).toBe(true);
    expect(sim.borrow(50_000)).toBe(false);
  });

  it('大停电考古：剧本风暴按时触发并损毁线路', () => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(7));
    const sim = new Simulation();
    scenarioById('blackout2003')!.setup(sim);
    sim.forcedOutages = false;
    expect(sim.scriptedWeather.length).toBeGreaterThanOrEqual(2);
    const trippedBefore = [...sim.grid.lines.values()].filter((l) => l.tripped).length;
    expect(trippedBefore).toBe(0);
    // 推进到剧本时刻之后
    while (sim.clock < 6 && !sim.gameOver) sim.tick(0.05, 2880);
    const trippedAfter = [...sim.grid.lines.values()].filter((l) => l.tripped).length;
    expect(trippedAfter).toBeGreaterThanOrEqual(1); // 风暴打掉了一条线
  });
});

describe('每日挑战扩展维度', () => {
  it('同一种子完全确定（含新维度）', () => {
    const a = new Simulation();
    const b = new Simulation();
    setupDaily(a, 20260611);
    setupDaily(b, 20260611);
    expect(a.events.intensity).toBe(b.events.intensity);
    expect(a.fuelVolatilityMult).toBe(b.fuelVolatilityMult);
    expect([...a.bannedPlants]).toEqual([...b.bannedPlants]);
    expect(a.loanBan).toBe(b.loanBan);
    expect(a.competitors[0].base).toBeCloseTo(b.competitors[0].base, 9);
    expect(a.grid.buses.size).toBe(b.grid.buses.size);
  });

  it('不同种子产生不同的规则组合（采样 60 天应出现禁令/烈度差异）', () => {
    const intensities = new Set<number>();
    let sawBanOrNoLoan = false;
    for (let d = 0; d < 60; d++) {
      const sim = new Simulation();
      setupDaily(sim, 20260101 + d);
      intensities.add(sim.events.intensity);
      if (sim.bannedPlants.size > 0 || sim.loanBan) sawBanOrNoLoan = true;
    }
    expect(intensities.size).toBeGreaterThan(1);
    expect(sawBanOrNoLoan).toBe(true);
  });
});

describe('战绩分享：策略签名与徽章', () => {
  it('shareText 包含签名/徽章/模式', () => {
    const rec: ScoreRecord = {
      scenarioId: 'town', ts: 1, day: 12, score: 92, grade: 'S',
      reliability: 0.99, clean: 0.8, marketShare: 0.4, netWorth: 2_000_000,
      sig: '煤1·气2·风3·储2', badges: ['⚡零失负荷', '🌱全清洁'], mode: '困难',
    };
    const text = shareText(rec, '① 点亮小镇');
    expect(text).toContain('煤1·气2·风3·储2');
    expect(text).toContain('⚡零失负荷');
    expect(text).toContain('【困难】');
  });
});

describe('自定义关卡 v2（剧本三件套）', () => {
  it('events/objectives/overrides 全链路：导入→装配→生效', () => {
    const json = JSON.stringify({
      format: SCENARIO_FORMAT, version: 2, name: '剧本测试', money: 500_000, goalDay: 10,
      buses: [
        { id: 'p1', kind: 'plant', x: 5, y: 5, plantType: 'coal' },
        { id: 's1', kind: 'substation', x: 10, y: 8 },
        { id: 'l1', kind: 'load', x: 15, y: 6, profile: 'residential', demand: 25 },
      ],
      lines: [['p1', 's1'], ['s1', 'l1']],
      events: [{ day: 2, hour: 6, kind: 'storm' }],
      objectives: [{ kind: 'cleanShareAtWin', share: 0.5 }],
      overrides: { noLoans: true, banPlants: ['nuclear'], eventIntensity: 1.5, startDebt: 100_000 },
    });
    const r = parseCustomScenario(json);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    const sim = new Simulation();
    r.scenario.setup(sim);
    expect(sim.scriptedWeather).toEqual([{ atClock: 2 * 24 + 6, kind: 'storm' }]);
    expect(sim.objectives.length).toBe(1);
    expect(sim.loanBan).toBe(true);
    expect(sim.bannedPlants.has('nuclear')).toBe(true);
    expect(sim.events.intensity).toBe(1.5);
    expect(sim.debt).toBe(100_000);
  });

  it('非法剧本字段被拒绝', () => {
    const base = {
      format: SCENARIO_FORMAT, version: 2, name: 'x', money: 100_000, goalDay: 5,
      buses: [{ id: 'a', kind: 'substation', x: 1, y: 1 }],
    };
    expect(validateCustom({ ...base, events: [{ day: -1, kind: 'storm' }] })).not.toBeNull();
    expect(validateCustom({ ...base, events: [{ day: 1, kind: 'sharknado' }] })).not.toBeNull();
    expect(validateCustom({ ...base, objectives: [{ kind: 'cleanShareAtWin', share: 9 }] })).not.toBeNull();
    expect(validateCustom({ ...base, overrides: { competitorScale: 99 } })).not.toBeNull();
    expect(validateCustom({ ...base, overrides: { banPlants: ['fusion'] } })).not.toBeNull();
  });

  it('导出当前局面：禁令/禁贷/目标随档导出', () => {
    const sim = new Simulation();
    scenarioById('budget')!.setup(sim);
    sim.bannedPlants.add('coal');
    sim.objectives = [{ kind: 'n1ByDay', byDay: 5 }];
    const data = exportCurrentAsScenario(sim, '导出测试');
    expect(data.version).toBe(2);
    expect(data.overrides?.noLoans).toBe(true);
    expect(data.overrides?.banPlants).toContain('coal');
    expect(data.objectives?.length).toBe(1);
    expect(validateCustom(data)).toBeNull(); // 导出的文件自身必须合法
  });

  it('v1 旧版关卡文件仍可导入（向后兼容）', () => {
    const json = JSON.stringify({
      format: SCENARIO_FORMAT, version: 1, name: '旧关卡', money: 300_000, goalDay: 8,
      buses: [{ id: 'a', kind: 'substation', x: 3, y: 3 }],
    });
    const r = parseCustomScenario(json);
    expect('error' in r).toBe(false);
  });
});
