import { describe, it, expect } from 'vitest';
import { solveDC, solveLinear } from './powerflow';
import type { Line } from './types';

function makeLine(id: number, from: number, to: number, reactance: number): Line {
  return { id, from, to, voltage: 'HV', reactance, resistance: 0, capacity: 100, length: 1, flow: 0, loss: 0, tripped: false, overloadTimer: 0 };
}

/** 计算"流出某母线"的净潮流（from 端为流出正方向） */
function leaving(busId: number, lines: Line[], flows: Map<number, number>): number {
  let s = 0;
  for (const ln of lines) {
    const f = flows.get(ln.id) ?? 0;
    if (ln.from === busId) s += f;
    if (ln.to === busId) s -= f;
  }
  return s;
}

describe('solveLinear', () => {
  it('解 2x2 线性方程', () => {
    const x = solveLinear([[2, 1], [1, 3]], [5, 10]);
    expect(x[0]).toBeCloseTo(1, 6);
    expect(x[1]).toBeCloseTo(3, 6);
  });
});

describe('solveDC 直流潮流', () => {
  it('两母线：电源→负荷应有 50MW 潮流', () => {
    const lines = [makeLine(10, 1, 2, 0.1)];
    const inj = new Map([[2, -50]]); // 母线2 负荷 50MW；母线1 为松弛(电源)
    const { flows } = solveDC([1, 2], lines, inj);
    expect(flows.get(10)!).toBeCloseTo(50, 6); // from(1)->to(2) 为正
  });

  it('三角网络：每个节点功率平衡（KCL）', () => {
    const lines = [makeLine(12, 1, 2, 0.1), makeLine(23, 2, 3, 0.1), makeLine(13, 1, 3, 0.1)];
    const inj = new Map([[2, -30], [3, -30]]); // 两个 30MW 负荷，母线1 松弛供 60MW
    const { flows } = solveDC([1, 2, 3], lines, inj);
    expect(leaving(1, lines, flows)).toBeCloseTo(60, 5); // 松弛节点供出 60MW
    expect(leaving(2, lines, flows)).toBeCloseTo(-30, 5); // 负荷净流入 30MW
    expect(leaving(3, lines, flows)).toBeCloseTo(-30, 5);
  });

  it('并联阻抗：潮流按电纳反比分配', () => {
    // 两条并联线 1->2，电抗 0.1 与 0.2 => 电纳 10 与 5 => 潮流分配 2:1
    const lines = [makeLine(1, 1, 2, 0.1), makeLine(2, 1, 2, 0.2)];
    const inj = new Map([[2, -30]]);
    const { flows } = solveDC([1, 2], lines, inj);
    expect(flows.get(1)!).toBeCloseTo(20, 5);
    expect(flows.get(2)!).toBeCloseTo(10, 5);
  });
});
