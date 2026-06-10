import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

function congestionOf(base: number): number {
  const sim = new Simulation();
  sim.forcedOutages = false;
  sim.events.nextAt = Infinity; // 关闭随机天气以求确定性
  const g = sim.grid;
  const coal = g.addPlant('coal', 0, 0);
  const sub = g.addSubstation(2, 0);
  const load = g.addLoad(4, 0, 'industrial', base, '厂', 0);
  g.addLine(coal.bus.id, sub.id);
  g.addLine(sub.id, load.bus.id);
  for (let i = 0; i < 100; i++) sim.tick(0.05, 600);
  return sim.finance.congestion; // 负=阻塞成本
}

describe('输电阻塞（节点价差）', () => {
  it('高负载线路产生更高阻塞成本', () => {
    const heavy = congestionOf(80); // 接近 MV 线热极限(70)
    const light = congestionOf(30); // 远低于阈值
    expect(heavy).toBeLessThan(light); // 更负=成本更高
    expect(heavy).toBeLessThan(0);
  });

  it('轻载电网几乎无阻塞成本', () => {
    expect(Math.abs(congestionOf(20))).toBeLessThan(50);
  });

  it('reset 清零阻塞', () => {
    const sim = new Simulation();
    sim.finance.congestion = -123;
    sim.reset();
    expect(sim.finance.congestion).toBe(0);
  });
});
