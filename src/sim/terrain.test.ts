import { describe, it, expect } from 'vitest';
import { Terrain, TERRAIN_BUILD_FACTOR } from './terrain';
import { Simulation } from './simulation';

describe('地理资源图层', () => {
  it('同一种子完全确定，不同种子产生不同地图', () => {
    const a = new Terrain(42);
    const b = new Terrain(42);
    const c = new Terrain(43);
    let diff = 0;
    for (let x = 0; x < 30; x++) {
      for (let y = 0; y < 20; y++) {
        expect(a.kind(x, y)).toBe(b.kind(x, y));
        expect(a.windQuality(x, y)).toBe(b.windQuality(x, y));
        if (a.kind(x, y) !== c.kind(x, y)) diff++;
      }
    }
    expect(diff).toBeGreaterThan(20); // 不同种子的地形显著不同
  });

  it('资源质量落在配置范围内且随地点变化', () => {
    const t = new Terrain(7);
    const winds = new Set<number>();
    for (let x = 0; x < 40; x += 2) {
      for (let y = 0; y < 30; y += 2) {
        const w = t.windQuality(x, y);
        const s = t.solarQuality(x, y);
        expect(w).toBeGreaterThanOrEqual(0.8);
        expect(w).toBeLessThanOrEqual(1.2);
        expect(s).toBeGreaterThanOrEqual(0.85);
        expect(s).toBeLessThanOrEqual(1.15);
        winds.add(w);
      }
    }
    expect(winds.size).toBeGreaterThan(5); // 不是常数——选址有差异
  });

  it('光照南强北弱（纬度梯度）', () => {
    const t = new Terrain(7);
    let north = 0, south = 0;
    for (let x = 0; x < 40; x++) { north += t.solarQuality(x, 2); south += t.solarQuality(x, 34); }
    expect(south).toBeGreaterThan(north);
  });

  it('跨水域/山地的线路更贵', () => {
    const t = new Terrain(7);
    // 找一块水域
    let wx = -1, wy = -1, px = -1, py = -1;
    outer: for (let x = 0; x < 60; x++) {
      for (let y = 0; y < 36; y++) {
        if (wx < 0 && t.kind(x, y) === 'water') { wx = x; wy = y; }
        if (px < 0 && t.kind(x, y) === 'plain') { px = x; py = y; }
        if (wx >= 0 && px >= 0) break outer;
      }
    }
    expect(wx).toBeGreaterThanOrEqual(0); // 地图上有水域
    expect(t.buildFactor(wx, wy)).toBe(TERRAIN_BUILD_FACTOR.water);
    expect(t.buildFactor(px, py)).toBe(TERRAIN_BUILD_FACTOR.plain);
    // 穿过水域中心的短线 vs 平原上的短线
    const wet = t.lineFactor(wx - 1, wy, wx + 1, wy);
    expect(wet).toBeGreaterThan(1);
  });

  it('风电选址写入 siteFactor 并影响可用出力', () => {
    const sim = new Simulation();
    sim.grid.setTerrainSeed(7);
    // 扫描出高/低风资源点
    const t = sim.grid.terrain;
    let hi: [number, number] = [0, 0], lo: [number, number] = [0, 0];
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 30; y++) {
        if (t.windQuality(x, y) > t.windQuality(hi[0], hi[1])) hi = [x, y];
        if (t.windQuality(x, y) < t.windQuality(lo[0], lo[1])) lo = [x, y];
      }
    }
    const good = sim.grid.addPlant('wind', hi[0], hi[1]).gen;
    const poor = sim.grid.addPlant('wind', lo[0], lo[1]).gen;
    expect((good.siteFactor ?? 1)).toBeGreaterThan(poor.siteFactor ?? 1);
    sim.tick(0.05, 600); // 刷新 availability
    expect(good.availability).toBeGreaterThanOrEqual(poor.availability);
  });

  it('地形造价：buildCostAt 与 lineCost 抬价并随存档恢复', () => {
    const sim = new Simulation();
    sim.grid.setTerrainSeed(7);
    const t = sim.grid.terrain;
    // 找山地点
    let hx = -1, hy = -1;
    outer: for (let x = 0; x < 60; x++) {
      for (let y = 0; y < 36; y++) {
        if (t.kind(x, y) === 'hill') { hx = x; hy = y; break outer; }
      }
    }
    expect(hx).toBeGreaterThanOrEqual(0);
    expect(sim.buildCostAt(hx, hy, 100_000)).toBeGreaterThan(100_000);
    // 存档往返保留地形种子与 siteFactor
    sim.grid.addPlant('wind', 10, 10);
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.grid.terrain.seed).toBe(7);
    const g2 = [...sim2.grid.gens.values()][0];
    expect(g2.siteFactor).toBe([...sim.grid.gens.values()][0].siteFactor);
  });
});
