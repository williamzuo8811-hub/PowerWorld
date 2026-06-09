// 电网图容器：管理母线、机组、负荷、线路，并提供拓扑分析（连通分量 = 孤岛）。
import type { Bus, Generator, Load, Line, BusKind, PlantType, LoadProfile } from './types';
import { PLANTS, X_PER_TILE, R_PER_TILE, LINE_DEFAULT_CAPACITY, LINE_COST_PER_TILE } from '../config/components';

export class Grid {
  buses = new Map<number, Bus>();
  gens = new Map<number, Generator>();
  loads = new Map<number, Load>();
  lines = new Map<number, Line>();
  private nextId = 1;

  private id(): number {
    return this.nextId++;
  }

  addBus(kind: BusKind, x: number, y: number, name: string): Bus {
    const bus: Bus = { id: this.id(), name, kind, x, y, blackout: false };
    this.buses.set(bus.id, bus);
    return bus;
  }

  /** 建一座电厂：自动创建母线 + 机组 */
  addPlant(type: PlantType, x: number, y: number): { bus: Bus; gen: Generator } {
    const spec = PLANTS[type];
    const bus = this.addBus('plant', x, y, spec.label);
    const gen: Generator = {
      id: this.id(), busId: bus.id, type,
      capacity: spec.capacity, pmin: spec.pmin, output: 0,
      rampRate: spec.rampRate, marginalCost: spec.marginalCost,
      dispatchable: spec.dispatchable, availability: spec.dispatchable ? 1 : 0,
    };
    this.gens.set(gen.id, gen);
    return { bus, gen };
  }

  addSubstation(x: number, y: number, name = '变电站'): Bus {
    return this.addBus('substation', x, y, name);
  }

  /** 建一个负荷点（城市区块），用于关卡初始化 */
  addLoad(x: number, y: number, profile: LoadProfile, baseDemand: number, name: string, growthPerHour: number): { bus: Bus; load: Load } {
    const bus = this.addBus('load', x, y, name);
    const load: Load = {
      id: this.id(), busId: bus.id, profile, baseDemand,
      demand: 0, served: 0, growthPerHour,
    };
    this.loads.set(load.id, load);
    return { bus, load };
  }

  /** 连一条线路（自动按两端母线距离计算电抗/电阻/长度） */
  addLine(fromBusId: number, toBusId: number, capacity = LINE_DEFAULT_CAPACITY): Line {
    const a = this.buses.get(fromBusId)!;
    const b = this.buses.get(toBusId)!;
    const length = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const line: Line = {
      id: this.id(), from: fromBusId, to: toBusId,
      reactance: X_PER_TILE * length, resistance: R_PER_TILE * length,
      capacity, length, flow: 0, loss: 0, tripped: false, overloadTimer: 0,
    };
    this.lines.set(line.id, line);
    return line;
  }

  removeBus(busId: number): void {
    for (const g of [...this.gens.values()]) if (g.busId === busId) this.gens.delete(g.id);
    for (const l of [...this.loads.values()]) if (l.busId === busId) this.loads.delete(l.id);
    for (const ln of [...this.lines.values()]) if (ln.from === busId || ln.to === busId) this.lines.delete(ln.id);
    this.buses.delete(busId);
  }

  removeLine(lineId: number): void {
    this.lines.delete(lineId);
  }

  gensAtBus(busId: number): Generator[] {
    return [...this.gens.values()].filter((g) => g.busId === busId);
  }

  loadsAtBus(busId: number): Load[] {
    return [...this.loads.values()].filter((l) => l.busId === busId);
  }

  /** 是否已存在连接这两条母线的线路（避免重复连线） */
  hasLineBetween(a: number, b: number): boolean {
    for (const ln of this.lines.values()) {
      if ((ln.from === a && ln.to === b) || (ln.from === b && ln.to === a)) return true;
    }
    return false;
  }

  /**
   * 计算连通分量（孤岛）：只沿未跳闸的线路连接。
   * 返回若干个母线 id 数组，每个数组就是一个电气孤岛。
   */
  islands(): number[][] {
    const adj = new Map<number, number[]>();
    for (const id of this.buses.keys()) adj.set(id, []);
    for (const ln of this.lines.values()) {
      if (ln.tripped) continue;
      adj.get(ln.from)?.push(ln.to);
      adj.get(ln.to)?.push(ln.from);
    }
    const seen = new Set<number>();
    const result: number[][] = [];
    for (const start of this.buses.keys()) {
      if (seen.has(start)) continue;
      const comp: number[] = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const cur = stack.pop()!;
        comp.push(cur);
        for (const nb of adj.get(cur) ?? []) {
          if (!seen.has(nb)) {
            seen.add(nb);
            stack.push(nb);
          }
        }
      }
      result.push(comp);
    }
    return result;
  }

  /** 计算建一条线路的造价（用于 UI 预览/扣款） */
  lineCost(fromBusId: number, toBusId: number): number {
    const a = this.buses.get(fromBusId)!;
    const b = this.buses.get(toBusId)!;
    const length = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    return Math.round(length * LINE_COST_PER_TILE);
  }
}
