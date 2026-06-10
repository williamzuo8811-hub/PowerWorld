import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';

function setup(): Simulation {
  const sim = new Simulation();
  const g = sim.grid;
  const coal = g.addPlant('coal', 0, 0).bus;
  const sub = g.addSubstation(2, 0);
  const load = g.addLoad(4, 0, 'residential', 30, '城', 0).bus;
  g.addLine(coal.id, sub.id);
  g.addLine(sub.id, load.id);
  return sim;
}

describe('天气预报', () => {
  it('开局后即可看到下一场事件的预报', () => {
    const sim = setup();
    sim.tick(0.05, 600);
    expect(sim.events.forecast).not.toBeNull();
    expect(sim.events.forecast!.at).toBe(sim.events.nextAt);
    expect(sim.events.forecastLabel(sim.clock)).toMatch(/~\d+h/);
  });

  it('事件触发时兑现预报的种类', () => {
    const sim = setup();
    sim.tick(0.05, 600); // 生成预报
    const predicted = sim.events.forecast!.kind;
    // 快进到事件触发
    for (let i = 0; i < 600 && sim.events.active.length === 0; i++) sim.tick(0.05, 3600);
    expect(sim.events.active.length).toBeGreaterThan(0);
    expect(sim.events.active[0].kind).toBe(predicted);
    // 触发后已生成下一场预报
    expect(sim.events.forecast!.at).toBe(sim.events.nextAt);
    expect(sim.events.forecast!.at).toBeGreaterThan(sim.clock);
  });

  it('预报随存档往返保留', () => {
    const sim = setup();
    sim.tick(0.05, 600);
    const predicted = sim.events.forecast!.kind;
    const blob = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation();
    sim2.deserialize(blob);
    expect(sim2.events.forecast!.kind).toBe(predicted);
  });

  it('快照含预报标签', () => {
    const sim = setup();
    sim.tick(0.05, 600);
    expect(sim.snapshot().forecast).toBeTruthy();
  });
});
