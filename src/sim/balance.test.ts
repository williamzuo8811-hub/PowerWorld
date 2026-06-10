import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { SCENARIOS } from '../game/scenarios';

// 经济平衡守护：一个供需匹配、容量充裕的电网应当稳态盈利且可靠供电。
// （不追求自动通关——通关需要随需求增长持续扩建，属玩法进程而非经济平衡问题。）
// 关闭随机天气以保证确定性。
describe('经济平衡（稳态盈利）', () => {
  it('容量充裕、每城区独立变电站的电网持续盈利且可靠', () => {
    const sim = new Simulation();
    SCENARIOS[0].setup(sim);
    sim.events.nextAt = Infinity;
    sim.forcedOutages = false; // 关闭随机停运以求确定性
    const g = sim.grid;
    const byName = (n: string) => [...g.buses.values()].find((b) => b.name === n)!;
    const subA = byName('中心变电站'); // 起步：coal→subA→居民区
    // 每个城区各一座变电站，避免单一变压器在景气高峰过载
    const subB = g.addSubstation(13, 13, '商业变电站');
    const subC = g.addSubstation(8, 12, '工业变电站');
    g.addLine(subA.id, subB.id); // HV 骨干
    g.addLine(subA.id, subC.id);
    g.addLine(subB.id, byName('商业区').id); // MV
    g.addLine(subC.id, byName('工业区').id); // MV
    // 电源集中在 subA 高压侧，经骨干送往各变电站
    g.addLine(g.addPlant('gas', 7, 7).bus.id, subA.id);
    g.addLine(g.addPlant('coal', 3, 7).bus.id, subA.id);

    const start = sim.money;
    for (let i = 0; i < 1000; i++) sim.tick(0.05, 5760); // 约 3.3 天

    expect(sim.gameOver).toBe(false);
    expect(sim.reliability).toBeGreaterThan(0.95); // 可靠供电
    expect(sim.money).toBeGreaterThan(start); // 稳态盈利（现金增长）
    expect(sim.finance.net).toBeGreaterThan(0); // 净现金流为正
  });
});
