// 2026-06 平衡重调的回归测试：储能套利流动性衰减 + SoC 约束、火电灵活性启停折扣、
// VPP 可信容量、新能源分钟级出力噪声（功率预测 AI 联动）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Simulation, arbLiquidityFactor, arbSocFactor } from './simulation';
import {
  STORAGE_ARB_LIQUIDITY_MW, STORAGE_ARB_SOC_EDGE_FACTOR, RENEW_NOISE_CLAMP, BACKUP_CAPEX,
  POACH_WIN_CHANCE, POACH_WIN_FRACTION, CARBON_PRICE_GROWTH_PER_DAY, PLANTS,
} from '../config/components';
import { TECH_FX } from '../config/tech';
import { mulberry32 } from '../game/scenarios';

afterEach(() => vi.restoreAllMocks());

describe('储能套利：流动性衰减 + SoC 区间', () => {
  it('机队越大，单位套利系数越低（凹收益，不再是印钞机）', () => {
    const f25 = arbLiquidityFactor(25);
    const f100 = arbLiquidityFactor(100);
    const f400 = arbLiquidityFactor(400);
    expect(f25).toBeLessThanOrEqual(1);
    expect(f100).toBeLessThan(f25);
    expect(f400).toBeLessThan(f100);
    // 半衰参考点：fleet = LIQUIDITY 时恰为 0.5
    expect(arbLiquidityFactor(STORAGE_ARB_LIQUIDITY_MW)).toBeCloseTo(0.5, 6);
    // 零机队不衰减
    expect(arbLiquidityFactor(0)).toBeCloseTo(1, 6);
  });

  it('SoC 贴边时套利捕获打折：空电高卖/满电低买都不成立', () => {
    expect(arbSocFactor(0.5, 10)).toBe(1); // 中段放电：全额
    expect(arbSocFactor(0.5, -10)).toBe(1); // 中段充电：全额
    expect(arbSocFactor(0.02, 10)).toBe(STORAGE_ARB_SOC_EDGE_FACTOR); // 几乎空电还在放：折减
    expect(arbSocFactor(0.97, -10)).toBe(STORAGE_ARB_SOC_EDGE_FACTOR); // 几乎满电还在充：折减
    expect(arbSocFactor(0.02, -10)).toBe(1); // 空电充电是合理低买：全额
    expect(arbSocFactor(0.97, 10)).toBe(1); // 满电放电是合理高卖：全额
    expect(arbSocFactor(0.5, 0)).toBe(1); // 待机无收益也无折减
  });
});

describe('剥削性策略的数值修正', () => {
  it('自备应急电源造价已翻倍、反向挖角概率/比例已下调、碳价增速已加快', () => {
    expect(BACKUP_CAPEX).toBeGreaterThanOrEqual(180_000);
    expect(POACH_WIN_CHANCE).toBeLessThanOrEqual(0.3);
    expect(POACH_WIN_FRACTION).toBeLessThanOrEqual(0.4);
    expect(CARBON_PRICE_GROWTH_PER_DAY).toBeGreaterThanOrEqual(1.0);
  });

  it('碳价增速使"煤 vs 气"边际成本在 80 天内交叉（清洁转型有真实压力）', () => {
    // 煤 26 + 0.95×c vs 气 58 + 0.45×c → 交叉碳价 c = 64
    const crossCarbon = (PLANTS.gas.marginalCost - PLANTS.coal.marginalCost) / (PLANTS.coal.co2 - PLANTS.gas.co2);
    const daysToCross = (crossCarbon - 4) / CARBON_PRICE_GROWTH_PER_DAY;
    expect(daysToCross).toBeLessThan(80);
    expect(daysToCross).toBeGreaterThan(20); // 也不能太快——前期煤电仍应是便宜基荷
  });
});

describe('科技重平衡', () => {
  it('火电灵活性改造使燃煤启停成本减半', () => {
    const sim = new Simulation();
    expect(sim.tech.coalStartupFactor).toBe(1);
    sim.tech.unlocked.add('efficient');
    sim.tech.unlocked.add('flexCoal');
    expect(sim.tech.coalStartupFactor).toBe(TECH_FX.coalStartupFactor);
    expect(sim.tech.coalStartupFactor).toBeLessThan(1);
  });

  it('VPP 解锁后可削减负荷计入可信容量', () => {
    const sim = new Simulation();
    expect(sim.tech.vppFirmCredit).toBe(0);
    sim.tech.unlocked.add('demandResponse');
    sim.tech.unlocked.add('vpp');
    expect(sim.tech.vppFirmCredit).toBeGreaterThan(0);
  });

  it('功率预测 AI 使新能源噪声幅度减半', () => {
    const sim = new Simulation();
    expect(sim.tech.renewNoiseFactor).toBe(1);
    sim.tech.unlocked.add('demandResponse');
    sim.tech.unlocked.add('forecasting');
    expect(sim.tech.renewNoiseFactor).toBe(TECH_FX.forecastNoiseFactor);
  });

  it('DLR 覆盖 MV 配电线而 HVDC 仅强化 HV（分支差异化）', () => {
    const sim = new Simulation();
    sim.tech.unlocked.add('ehv');
    sim.tech.unlocked.add('hvdc');
    expect(sim.tech.lineCapacityFactor('MV')).toBe(1); // HVDC 管不到配电
    expect(sim.tech.lineCapacityFactor('HV')).toBeGreaterThan(1);
    sim.tech.unlocked.add('dlr');
    expect(sim.tech.lineCapacityFactor('MV')).toBeGreaterThan(1); // DLR 才能扩配电
  });
});

describe('新能源出力预测误差（分钟级噪声）', () => {
  it('噪声是有界的均值回归过程，且确实在波动', () => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(42));
    const sim = new Simulation();
    const g = sim.grid;
    const sub = g.addSubstation(10, 8);
    g.addLine(g.addLoad(14, 4, 'residential', 20, '居民', 0).bus.id, sub.id);
    g.addLine(g.addPlant('wind', 5, 5).bus.id, sub.id);
    g.addLine(g.addPlant('coal', 4, 9).bus.id, sub.id);
    sim.forcedOutages = false;
    sim.events.nextAt = Infinity;
    const samples: number[] = [];
    for (let i = 0; i < 600; i++) {
      sim.tick(0.05, 2880);
      samples.push(sim.windNoise);
    }
    // 有界
    for (const s of samples) expect(Math.abs(s)).toBeLessThanOrEqual(RENEW_NOISE_CLAMP + 1e-9);
    // 确实波动（非恒零）
    const spread = Math.max(...samples) - Math.min(...samples);
    expect(spread).toBeGreaterThan(0.05);
    // 均值回归：长期均值接近 0
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(Math.abs(mean)).toBeLessThan(0.15);
  });
});
