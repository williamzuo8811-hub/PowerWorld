// 无头整局测试：用简单 bot 自动玩关卡到通关，并对比多种电源策略的可行性。
// 这是平衡性的回归防线——任何调参若让"标准打法"无法通关或让某策略破产，测试会失败。
import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { scenarioById } from '../game/scenarios';

/** 勤快运维 bot：每步把跳闸线路/变压器重合闸（等价于玩家点「检查/重合闸」） */
function recloseAll(sim: Simulation): void {
  for (const ln of sim.grid.lines.values()) {
    if (ln.tripped) { ln.tripped = false; ln.overloadTimer = 0; }
  }
  for (const b of sim.grid.buses.values()) {
    if (b.transformerTripped) { b.transformerTripped = false; b.transformerTimer = 0; }
  }
}

/** 推进 N 游戏天（每 tick≈0.08 仿真小时） */
function runDays(sim: Simulation, days: number, op?: (s: Simulation) => void): void {
  const targetClock = sim.clock + days * 24;
  let guard = 0;
  while (sim.clock < targetClock && !sim.gameOver && guard++ < 50_000) {
    sim.tick(0.05, 5760);
    op?.(sim);
  }
}

describe('整局自动通关（bot playthrough）', () => {
  it('「点亮小镇」标准打法可通关', () => {
    const sim = new Simulation();
    scenarioById('town')!.setup(sim);
    sim.forcedOutages = false; // 排除强迫停运的运气因素
    const g = sim.grid;
    // bot 建造：把商业区/工业区接入中心变电站，补一台燃气调峰 + 一座电池
    const sub = [...g.buses.values()].find((b) => b.kind === 'substation')!;
    for (const l of g.loads.values()) {
      if (!g.hasLineBetween(sub.id, l.busId)) {
        sim.spend(g.lineCost(sub.id, l.busId));
        g.addLine(sub.id, l.busId);
      }
    }
    const gas = g.addPlant('gas', 7, 5).bus;
    sim.spend(110_000 + g.lineCost(gas.id, sub.id));
    g.addLine(gas.id, sub.id);
    const bat = g.addBattery(9, 6).bus;
    sim.spend(175_000 + g.lineCost(bat.id, sub.id));
    g.addLine(bat.id, sub.id);
    expect(sim.money).toBeGreaterThan(0);

    // 城市会成长——bot 像玩家一样在备用率吃紧时增建调峰机组（留厚备用扛热浪/寒潮）
    let px = 3;
    const operate = (s: Simulation) => {
      recloseAll(s);
      if (s.reserveMargin < 1.3 && s.money > 350_000) { // 留足现金安全垫，避免扩建到破产
        const p = s.grid.addPlant('gas', px, 3).bus;
        s.spend(110_000 + s.grid.lineCost(p.id, sub.id));
        s.grid.addLine(p.id, sub.id);
        px += 2;
      }
    };
    // 跑到第 16 天：胜利从第 12 天起持续判定，给极端天气后的可靠性 EMA 留回升时间
    runDays(sim, 16, operate);
    expect(sim.gameOver).toBe(true);
    expect(sim.win).toBe(true);
    expect(sim.reliability).toBeGreaterThanOrEqual(0.92);
  }, 30_000);

  it('坐视不管（不接负荷）则无法通关', () => {
    const sim = new Simulation();
    scenarioById('town')!.setup(sim);
    sim.forcedOutages = false;
    runDays(sim, 13);
    // 两个城区从未接入 → 可靠性必然低于 92% → 不会赢
    expect(sim.win).toBe(false);
  }, 30_000);
});

describe('电源策略可行性（平衡回归）', () => {
  /** 构造同一负荷形态下的指定机队，跑 8 天，返回经营结果 */
  function runStrategy(build: (sim: Simulation, hub: number) => void): Simulation {
    const sim = new Simulation();
    sim.forcedOutages = false;
    sim.events.nextAt = Infinity; // 关闭随机天气：专注考察电源组合自身的充裕度（避免抖动）
    const g = sim.grid;
    const sub = g.addSubstation(10, 8);
    g.addLine(g.addLoad(14, 4, 'residential', 24, '居民', 0.002).bus.id, sub.id);
    g.addLine(g.addLoad(15, 11, 'commercial', 20, '商业', 0.002).bus.id, sub.id);
    g.addLine(g.addLoad(6, 12, 'industrial', 30, '工业', 0.002).bus.id, sub.id);
    build(sim, sub.id);
    runDays(sim, 8, recloseAll);
    return sim;
  }
  const connect = (sim: Simulation, busId: number, hub: number) => sim.grid.addLine(busId, hub);

  it('火电基荷 / 燃气+储能 / 清洁组合三种策略都能存活且保供', () => {
    const coalOnly = runStrategy((s, hub) => {
      connect(s, s.grid.addPlant('coal', 4, 5).bus.id, hub);
      connect(s, s.grid.addPlant('coal', 4, 11).bus.id, hub);
    });
    const gasBattery = runStrategy((s, hub) => {
      connect(s, s.grid.addPlant('gas', 4, 5).bus.id, hub);
      connect(s, s.grid.addPlant('gas', 4, 11).bus.id, hub);
      connect(s, s.grid.addBattery(6, 4).bus.id, hub);
    });
    const cleanMix = runStrategy((s, hub) => {
      connect(s, s.grid.addPlant('hydro', 4, 5).bus.id, hub);
      connect(s, s.grid.addPlant('biomass', 2, 7).bus.id, hub); // 清洁基荷兜底间歇性
      connect(s, s.grid.addPlant('wind', 4, 11).bus.id, hub);
      connect(s, s.grid.addPlant('wind', 3, 9).bus.id, hub);
      connect(s, s.grid.addPlant('solar', 6, 12).bus.id, hub);
      connect(s, s.grid.addPlant('solar', 8, 13).bus.id, hub);
      connect(s, s.grid.addBattery(6, 4).bus.id, hub);
      connect(s, s.grid.addBattery(8, 4).bus.id, hub);
    });

    for (const [name, sim] of [['火电', coalOnly], ['燃气储能', gasBattery], ['清洁组合', cleanMix]] as const) {
      expect(sim.gameOver, `${name}策略破产`).toBe(false);
      expect(sim.reliability, `${name}策略保供不足`).toBeGreaterThan(0.7);
      expect(Number.isFinite(sim.netWorth)).toBe(true);
    }
    // 清洁组合应取得更高清洁占比（机制自检）
    expect(cleanMix.renewableShare).toBeGreaterThan(coalOnly.renewableShare);
  }, 60_000);
});
