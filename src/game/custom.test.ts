import { describe, it, expect, beforeEach } from 'vitest';
import { Simulation } from '../sim/simulation';
import {
  parseCustomScenario, exportCurrentAsScenario, validateCustom, toScenario,
  listCustomScenarios, addCustomScenario, removeCustomScenario, type CustomScenarioData,
} from './custom';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

function sample(): CustomScenarioData {
  return {
    format: 'powerworld-scenario', version: 1, name: '测试镇', money: 700_000, goalDay: 10,
    buses: [
      { id: 'p1', kind: 'plant', x: 5, y: 5, plantType: 'coal' },
      { id: 's1', kind: 'substation', x: 10, y: 8 },
      { id: 'l1', kind: 'load', x: 15, y: 5, profile: 'residential', demand: 25 },
      { id: 'b1', kind: 'storage', x: 8, y: 10, storageType: 'battery' },
    ],
    lines: [['p1', 's1'], ['s1', 'l1'], ['s1', 'b1']],
  };
}

describe('自定义关卡（Mod）', () => {
  it('合法关卡通过校验并可装配游玩', () => {
    expect(validateCustom(sample())).toBeNull();
    const sim = new Simulation();
    toScenario(sample()).setup(sim);
    expect(sim.money).toBe(700_000);
    expect(sim.goalDay).toBe(10);
    expect(sim.grid.buses.size).toBe(4);
    expect(sim.grid.lines.size).toBe(3);
    for (let i = 0; i < 40; i++) sim.tick(0.05, 600); // 可正常推进
    expect(Number.isFinite(sim.money)).toBe(true);
  });

  it('非法数据被拒绝并给出原因', () => {
    expect(validateCustom({})).toContain('format');
    expect(validateCustom({ ...sample(), money: -5 })).toContain('资金');
    expect(validateCustom({ ...sample(), buses: [] })).toContain('设施');
    const dupId = sample();
    dupId.buses[1].id = 'p1';
    expect(validateCustom(dupId)).toContain('重复');
    const badLine = sample();
    badLine.lines = [['p1', 'nope']];
    expect(validateCustom(badLine)).toContain('不存在');
    const r = parseCustomScenario('not json');
    expect('error' in r && r.error).toContain('JSON');
  });

  it('goalDay ≤ 0 表示无尽模式', () => {
    const sim = new Simulation();
    toScenario({ ...sample(), goalDay: 0 }).setup(sim);
    expect(sim.goalDay).toBe(Infinity);
  });

  it('非法连线（不经变电站）装配时被跳过', () => {
    const bad = sample();
    bad.lines = [['p1', 'l1']]; // 电厂直连负荷：违反拓扑
    const sim = new Simulation();
    toScenario(bad).setup(sim);
    expect(sim.grid.lines.size).toBe(0);
  });

  it('导出当前局面 → 解析 → 重建 一致', () => {
    const sim = new Simulation();
    const g = sim.grid;
    g.setTerrainSeed(77);
    const coal = g.addPlant('coal', 4, 4).bus;
    const sub = g.addSubstation(9, 7);
    const load = g.addLoad(14, 5, 'commercial', 22, '商圈', 0.004).bus;
    g.addLine(coal.id, sub.id);
    g.addLine(sub.id, load.id);
    sim.money = 555_000;
    sim.goalDay = 14;

    const data = exportCurrentAsScenario(sim, '回环测试');
    expect(validateCustom(data)).toBeNull();
    const r = parseCustomScenario(JSON.stringify(data));
    expect('scenario' in r).toBe(true);
    const sim2 = new Simulation();
    (r as { scenario: { setup(s: Simulation): void } }).scenario.setup(sim2);
    expect(sim2.grid.buses.size).toBe(3);
    expect(sim2.grid.lines.size).toBe(2);
    expect(sim2.grid.terrain.seed).toBe(77);
    expect(sim2.goalDay).toBe(14);
    const l2 = [...sim2.grid.loads.values()][0];
    expect(l2.profile).toBe('commercial');
    expect(l2.baseDemand).toBe(22);
  });

  it('关卡库：保存/同名覆盖/删除', () => {
    addCustomScenario(sample());
    addCustomScenario({ ...sample(), money: 999_000 }); // 同名覆盖
    expect(listCustomScenarios().length).toBe(1);
    expect(listCustomScenarios()[0].money).toBe(999_000);
    removeCustomScenario('测试镇');
    expect(listCustomScenarios().length).toBe(0);
  });
});
