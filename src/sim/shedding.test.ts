// 逐级甩负荷：缺供时按保供权重分轮次切负荷——数据中心（SLA 权重最高）最后断，
// 普通工业/居民先被切。这替代了旧的"全网等比例一刀切"。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Simulation } from './simulation';
import { mulberry32 } from '../game/scenarios';
import { RELIABILITY_WEIGHT } from '../config/components';

afterEach(() => vi.restoreAllMocks());

function buildShortageGrid(): Simulation {
  const sim = new Simulation();
  sim.forcedOutages = false;
  sim.events.nextAt = Infinity;
  const g = sim.grid;
  const sub = g.addSubstation(10, 8);
  // 单台燃气 40MW vs 总需求 ~80MW → 长期缺供，必然甩负荷
  g.addLine(g.addPlant('gas', 5, 6).bus.id, sub.id);
  g.addLine(g.addLoad(15, 5, 'datacenter', 40, '数据中心', 0).bus.id, sub.id);
  g.addLine(g.addLoad(15, 11, 'industrial', 40, '工业区', 0).bus.id, sub.id);
  return sim;
}

describe('逐级甩负荷', () => {
  it('缺供时关键负荷（数据中心）供电率显著高于普通负荷', () => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(11));
    const sim = buildShortageGrid();
    for (let i = 0; i < 800; i++) sim.tick(0.05, 2880);
    const loads = [...sim.grid.loads.values()];
    const dc = loads.find((l) => l.profile === 'datacenter')!;
    const ind = loads.find((l) => l.profile === 'industrial')!;
    expect(RELIABILITY_WEIGHT.datacenter).toBeGreaterThan(RELIABILITY_WEIGHT.industrial);
    const dcRate = dc.served / Math.max(dc.demand, 0.1);
    const indRate = ind.served / Math.max(ind.demand, 0.1);
    // 数据中心优先保供：供电率应明显更高
    expect(dcRate).toBeGreaterThan(indRate + 0.2);
    expect(dcRate).toBeGreaterThan(0.8);
  });

  it('供电充足时所有负荷全额供电（与旧行为一致）', () => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(12));
    const sim = new Simulation();
    sim.forcedOutages = false;
    sim.events.nextAt = Infinity;
    const g = sim.grid;
    const sub = g.addSubstation(10, 8);
    g.addLine(g.addPlant('coal', 5, 6).bus.id, sub.id);
    g.addLine(g.addPlant('gas', 4, 9).bus.id, sub.id);
    g.addLine(g.addLoad(15, 5, 'residential', 20, '居民', 0).bus.id, sub.id);
    for (let i = 0; i < 600; i++) sim.tick(0.05, 2880);
    expect(sim.reliability).toBeGreaterThan(0.95);
  });

  it('同级负荷按需求比例均摊（不会一个全有一个全无）', () => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(13));
    const sim = new Simulation();
    sim.forcedOutages = false;
    sim.events.nextAt = Infinity;
    const g = sim.grid;
    const sub = g.addSubstation(10, 8);
    g.addLine(g.addPlant('gas', 5, 6).bus.id, sub.id); // 40MW vs 80MW 同级需求
    g.addLine(g.addLoad(15, 5, 'industrial', 40, '工业A', 0).bus.id, sub.id);
    g.addLine(g.addLoad(15, 11, 'industrial', 40, '工业B', 0).bus.id, sub.id);
    for (let i = 0; i < 800; i++) sim.tick(0.05, 2880);
    const [a, b] = [...sim.grid.loads.values()];
    const ra = a.served / Math.max(a.demand, 0.1);
    const rb = b.served / Math.max(b.demand, 0.1);
    expect(Math.abs(ra - rb)).toBeLessThan(0.05); // 同级均摊
    expect(ra).toBeGreaterThan(0.2);
    expect(ra).toBeLessThan(0.95); // 确实处于缺供
  });
});
