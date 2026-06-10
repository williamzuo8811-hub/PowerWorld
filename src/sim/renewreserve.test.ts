import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { RENEW_RESERVE_K } from '../config/components';

/** 在正午（光伏满发）构造混合机队，返回备用需求相关指标。 */
function noonMix(withSolar: boolean): { mult: number; reqMW: number; pen: number; price: number } {
  const sim = new Simulation();
  sim.forcedOutages = false;
  sim.events.nextAt = Infinity;
  const g = sim.grid;
  const sub = g.addSubstation(2, 0);
  const load = g.addLoad(4, 0, 'industrial', 30, '厂', 0);
  g.addLine(sub.id, load.bus.id);
  if (withSolar) {
    const s = g.addPlant('solar', 0, 0);
    g.addLine(s.bus.id, sub.id);
  }
  const c = g.addPlant('coal', 0, 1);
  g.addLine(c.bus.id, sub.id);
  sim.clock = 12; // 正午 → 光伏可用率最高
  sim.tick(0.05, 600);
  return { mult: sim.reserveReqMult, reqMW: sim.reserveRequirementMW, pen: sim.renewablePenetration, price: sim.reservePrice };
}

describe('新能源预测误差 → 运行备用需求', () => {
  it('无新能源出力时备用需求不放大（系数=1）', () => {
    const coalOnly = noonMix(false);
    expect(coalOnly.pen).toBeCloseTo(0, 6);
    expect(coalOnly.mult).toBeCloseTo(1, 6);
  });

  it('正午光伏顶峰显著抬高新能源占比与备用需求', () => {
    const solar = noonMix(true);
    const coal = noonMix(false);
    expect(solar.pen).toBeGreaterThan(0.5); // 光伏供给主力
    expect(solar.mult).toBeGreaterThan(coal.mult);
    expect(solar.reqMW).toBeGreaterThan(coal.reqMW);
  });

  it('备用需求系数与瞬时新能源占比成线性关系', () => {
    const solar = noonMix(true);
    expect(solar.mult).toBeCloseTo(1 + RENEW_RESERVE_K * solar.pen, 6);
  });

  it('高新能源占比下备用出清价不低于纯火电（需求更高）', () => {
    expect(noonMix(true).price).toBeGreaterThanOrEqual(noonMix(false).price);
  });

  it('空机队不产生备用需求放大（避免 EMA 初值假象）', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    sim.events.nextAt = Infinity;
    sim.renewableShare = 1; // 即使清洁占比 EMA=1
    sim.tick(0.05, 600);
    expect(sim.reserveReqMult).toBeCloseTo(1, 6); // 无实际新能源出力 → 不放大
  });
});
