import { describe, it, expect, beforeEach } from 'vitest';
import { Simulation } from '../sim/simulation';
import { SCENARIOS } from './scenarios';
import {
  saveGame, loadGame, listSaves, deleteSave, exportSave, importSave, hasSave, hasAnySave, migrateSave, SAVE_VERSION,
} from './save';

// node 环境没有 localStorage：用内存版 mock
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

function makeSim(): Simulation {
  const sim = new Simulation();
  SCENARIOS[0].setup(sim);
  for (let i = 0; i < 20; i++) sim.tick(0.05, 600);
  return sim;
}

describe('多槽位存档', () => {
  it('保存/读取/列表/删除多个槽位', () => {
    const sim = makeSim();
    expect(saveGame(sim, 'town', 'quick')).toBe(true);
    expect(saveGame(sim, 'town', 'auto')).toBe(true);
    expect(saveGame(sim, 'town', 'slot1')).toBe(true);
    expect(listSaves().length).toBe(3);
    expect(hasSave('quick')).toBe(true);
    expect(hasAnySave()).toBe(true);
    const data = loadGame('slot1');
    expect(data).not.toBeNull();
    expect(data!.scenarioId).toBe('town');
    deleteSave('slot1');
    expect(loadGame('slot1')).toBeNull();
    expect(listSaves().length).toBe(2);
  });

  it('读档可恢复仿真状态', () => {
    const sim = makeSim();
    saveGame(sim, 'town', 'quick');
    const data = loadGame('quick')!;
    const sim2 = new Simulation();
    sim2.deserialize(data.save);
    expect(sim2.grid.buses.size).toBe(sim.grid.buses.size);
    expect(sim2.money).toBeCloseTo(sim.money, 3);
  });

  it('旧版 v1 单槽存档自动迁移到 quick 槽', () => {
    const sim = makeSim();
    const legacy = { version: 1, scenarioId: 'green', ts: 123, save: sim.serialize() };
    store.set('powerworld.save.v1', JSON.stringify(legacy));
    const data = loadGame('quick');
    expect(data).not.toBeNull();
    expect(data!.scenarioId).toBe('green');
    expect(store.has('powerworld.save.v1')).toBe(false); // 旧 key 已清理
    expect(store.has('powerworld.save2.quick')).toBe(true); // 已写入新槽
  });

  it('导出/导入往返', () => {
    const sim = makeSim();
    saveGame(sim, 'town', 'slot2');
    const json = exportSave('slot2')!;
    expect(json.length).toBeGreaterThan(100);
    deleteSave('slot2');
    expect(importSave(json, 'slot3')).toBe(true);
    const data = loadGame('slot3');
    expect(data!.scenarioId).toBe('town');
  });

  it('导入非法 JSON / 不兼容版本被拒绝', () => {
    expect(importSave('not json at all')).toBe(false);
    expect(importSave('{"version":99,"scenarioId":"x","save":{}}')).toBe(false);
    expect(importSave('{"foo":1}')).toBe(false);
  });

  it('migrateSave 校验结构完整性', () => {
    const sim = makeSim();
    const good = migrateSave({ version: 1, scenarioId: 'town', ts: 1, save: sim.serialize() });
    expect(good).not.toBeNull();
    expect(good!.version).toBe(SAVE_VERSION);
    expect(migrateSave(null)).toBeNull();
    expect(migrateSave({ version: 2 })).toBeNull(); // 缺 save/scenarioId
    expect(migrateSave({ version: 2, scenarioId: 'x', ts: 1, save: { money: 'oops' } })).toBeNull();
  });
});
