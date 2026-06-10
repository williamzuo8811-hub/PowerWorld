import { describe, it, expect } from 'vitest';
import { Simulation } from '../sim/simulation';
import { Tutorial } from './tutorial';

describe('新手教程驱动', () => {
  it('随玩家操作逐步推进并最终完成', () => {
    const sim = new Simulation();
    const g = sim.grid;
    const coal = g.addPlant('coal', 0, 0).bus;
    const load = g.addLoad(6, 0, 'residential', 24, '居民区', 0).bus;

    const t = new Tutorial();
    t.start();
    expect(t.update(sim)).toContain('变电站'); // 步骤1

    const sub = g.addSubstation(3, 0);
    expect(t.update(sim)).toContain('高压'); // 步骤2

    g.addLine(coal.id, sub.id);
    expect(t.update(sim)).toContain('中压'); // 步骤3

    g.addLine(sub.id, load.id);
    expect(t.update(sim)).toContain('开始供电'); // 步骤4（尚未开始计时）

    for (let i = 0; i < 8; i++) sim.tick(0.05, 600); // 推进时间 + 供电
    expect(t.update(sim)).toContain('储能'); // 步骤6：建储能并接线

    const bat = g.addBattery(3, 2).bus;
    g.addLine(sub.id, bat.id);
    expect(t.update(sim)).toContain('科技'); // 步骤7：解锁科技

    sim.tech.unlocked.add('ehv');
    expect(t.update(sim)).toBeNull(); // 全部完成
    expect(t.takeCompleted()).toBe(true);
    expect(t.takeCompleted()).toBe(false); // 一次性
    expect(t.active).toBe(false);
  });

  it('未启动时不返回提示', () => {
    const sim = new Simulation();
    const t = new Tutorial();
    expect(t.update(sim)).toBeNull();
  });
});
