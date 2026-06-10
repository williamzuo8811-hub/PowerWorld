import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

describe('能源品类资产组合', () => {
  it('空电网各品类计数为 0', () => {
    const sim = new Simulation();
    const cats = sim.portfolio();
    expect(cats.length).toBe(10); // 6 供给/电网/工商业 + 4 大客户
    for (const c of cats) expect(c.count).toBe(0);
  });

  it('按品类正确归类与计数', () => {
    const sim = new Simulation();
    const g = sim.grid;
    g.addPlant('wind', 0, 0); g.addPlant('solar', 1, 0); // 可再生 ×2
    g.addPlant('nuclear', 2, 0); // 核电 ×1
    g.addPlant('coal', 3, 0); g.addPlant('gas', 4, 0); // 火电 ×2
    g.addBattery(5, 0, 'battery'); // 储能 ×1
    g.addLoad(6, 0, 'datacenter', 40, 'DC', 0); // 数据中心 ×1
    g.addLoad(7, 0, 'mining', 50, '矿', 0); // 矿业 ×1
    g.addLoad(8, 0, 'industrial', 30, '厂', 0); // 工商业 ×1
    const by = Object.fromEntries(sim.portfolio().map((c) => [c.key, c.count]));
    expect(by.renewable).toBe(2);
    expect(by.nuclear).toBe(1);
    expect(by.thermal).toBe(2);
    expect(by.storage).toBe(1);
    expect(by.datacenter).toBe(1);
    expect(by.mining).toBe(1);
    expect(by.ci).toBe(1);
  });

  it('电网品类统计变电站与线路', () => {
    const sim = new Simulation();
    const g = sim.grid;
    const a = g.addSubstation(0, 0);
    const b = g.addSubstation(4, 0);
    g.addLine(a.id, b.id);
    const grid = sim.portfolio().find((c) => c.key === 'grid')!;
    expect(grid.count).toBe(3); // 2 变电站 + 1 线路
  });

  it('大客户品类显示满意度', () => {
    const sim = new Simulation();
    sim.grid.addLoad(0, 0, 'datacenter', 40, 'DC', 0);
    const dc = sim.portfolio().find((c) => c.key === 'datacenter')!;
    expect(dc.count).toBe(1);
    expect(dc.value).toContain('满意');
  });
});
