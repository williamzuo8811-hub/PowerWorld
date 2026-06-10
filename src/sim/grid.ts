// 电网图容器：管理母线、机组、负荷、线路，并提供拓扑分析（连通分量 = 孤岛）。
import type { Bus, Generator, Load, Line, Battery, BusKind, PlantType, LoadProfile, VoltageClass } from './types';
import { PLANTS, VOLTAGE, SUBSTATION_RATING, STORAGE, type StorageType, X_PER_TILE, R_PER_TILE } from '../config/components';

/** 电网可序列化数据（存档用） */
export interface GridData {
  nextId: number;
  buses: Bus[];
  gens: Generator[];
  loads: Load[];
  lines: Line[];
  batteries: Battery[];
}

export class Grid {
  buses = new Map<number, Bus>();
  gens = new Map<number, Generator>();
  loads = new Map<number, Load>();
  lines = new Map<number, Line>();
  batteries = new Map<number, Battery>();
  private nextId = 1;

  private id(): number {
    return this.nextId++;
  }

  /** 清空全部内容（开新关卡前） */
  clear(): void {
    this.buses = new Map();
    this.gens = new Map();
    this.loads = new Map();
    this.lines = new Map();
    this.batteries = new Map();
    this.nextId = 1;
  }

  /** 导出为可 JSON 序列化的数据 */
  serialize(): GridData {
    return {
      nextId: this.nextId,
      buses: [...this.buses.values()],
      gens: [...this.gens.values()],
      loads: [...this.loads.values()],
      lines: [...this.lines.values()],
      batteries: [...this.batteries.values()],
    };
  }

  /** 从存档数据重建（深拷贝，避免与存档对象共享引用） */
  deserialize(d: GridData): void {
    this.buses = new Map(d.buses.map((b) => [b.id, { ...b }]));
    this.gens = new Map(d.gens.map((g) => [g.id, { ...g }]));
    this.loads = new Map(d.loads.map((l) => [l.id, { ...l }]));
    this.lines = new Map(d.lines.map((l) => [l.id, { ...l }]));
    this.batteries = new Map((d.batteries ?? []).map((b) => [b.id, { ...b }]));
    this.nextId = d.nextId;
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
      age: 0, committed: false, commitLockUntil: 0, startups: 0,
    };
    this.gens.set(gen.id, gen);
    return { bus, gen };
  }

  addSubstation(x: number, y: number, name = '变电站'): Bus {
    const bus = this.addBus('substation', x, y, name);
    bus.rating = SUBSTATION_RATING;
    bus.throughput = 0;
    bus.transformerTripped = false;
    bus.transformerTimer = 0;
    return bus;
  }

  /** 建一座储能电站（按类型）：自动创建母线 + 储能单元 */
  addBattery(x: number, y: number, type: StorageType = 'battery'): { bus: Bus; battery: Battery } {
    const spec = STORAGE[type];
    const bus = this.addBus('storage', x, y, spec.label);
    const battery: Battery = {
      id: this.id(), busId: bus.id, type,
      powerRating: spec.powerRating, energyCapacity: spec.energyCapacity,
      soc: spec.energyCapacity * 0.5, output: 0, roundTrip: spec.roundTrip,
    };
    this.batteries.set(battery.id, battery);
    return { bus, battery };
  }

  batteriesAtBus(busId: number): Battery[] {
    return [...this.batteries.values()].filter((b) => b.busId === busId);
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

  /** 两端母线决定电压等级：任一端是负荷 → 中压配电(MV)，否则 → 高压输电(HV) */
  connectionVoltage(aId: number, bId: number): VoltageClass {
    const a = this.buses.get(aId);
    const b = this.buses.get(bId);
    return a?.kind === 'load' || b?.kind === 'load' ? 'MV' : 'HV';
  }

  /**
   * 校验一条连线是否合法（供交互 UI 使用）。强制电网拓扑：
   *   电厂 →[HV]→ 变电站 →[MV]→ 负荷
   * 即电厂/负荷都必须经变电站，不能直连——这让"变电站"成为电网的必经枢纽。
   */
  canConnect(aId: number, bId: number): { ok: boolean; voltage?: VoltageClass; reason?: string } {
    if (aId === bId) return { ok: false, reason: '不能连到自己' };
    const a = this.buses.get(aId);
    const b = this.buses.get(bId);
    if (!a || !b) return { ok: false, reason: '母线不存在' };
    if (this.hasLineBetween(aId, bId)) return { ok: false, reason: '这两点之间已有线路' };
    // 强制拓扑：电厂/负荷/储能不能直连，至少一端必须是变电站。
    if (a.kind !== 'substation' && b.kind !== 'substation') {
      return { ok: false, reason: '必须经变电站中转（先建一座变电站）' };
    }
    return { ok: true, voltage: this.connectionVoltage(aId, bId) };
  }

  /** 连一条线路（自动按两端类型定电压、按距离算电抗/电阻/容量/长度） */
  addLine(fromBusId: number, toBusId: number, capacityOverride?: number): Line {
    const a = this.buses.get(fromBusId)!;
    const b = this.buses.get(toBusId)!;
    const voltage = this.connectionVoltage(fromBusId, toBusId);
    const spec = VOLTAGE[voltage];
    const length = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const line: Line = {
      id: this.id(), from: fromBusId, to: toBusId, voltage,
      reactance: X_PER_TILE * length, resistance: R_PER_TILE * length,
      capacity: capacityOverride ?? spec.defaultCapacity, length,
      flow: 0, loss: 0, tripped: false, overloadTimer: 0,
    };
    this.lines.set(line.id, line);
    return line;
  }

  removeBus(busId: number): void {
    for (const g of [...this.gens.values()]) if (g.busId === busId) this.gens.delete(g.id);
    for (const l of [...this.loads.values()]) if (l.busId === busId) this.loads.delete(l.id);
    for (const b of [...this.batteries.values()]) if (b.busId === busId) this.batteries.delete(b.id);
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

  /** 取一条线路的变电站端（MV 线用于判断变压器是否跳闸） */
  substationOf(ln: Line): Bus | undefined {
    const a = this.buses.get(ln.from);
    if (a?.kind === 'substation') return a;
    const b = this.buses.get(ln.to);
    if (b?.kind === 'substation') return b;
    return undefined;
  }

  /** 线路是否导通：已投运、未跳闸、两端母线均已投运，且（若为 MV）变压器未跳闸 */
  lineActive(ln: Line): boolean {
    if (ln.tripped || ln.underConstruction) return false;
    if (this.buses.get(ln.from)?.underConstruction || this.buses.get(ln.to)?.underConstruction) return false;
    if (ln.voltage === 'MV') {
      const sub = this.substationOf(ln);
      if (sub?.transformerTripped) return false;
    }
    return true;
  }

  /**
   * 计算连通分量（孤岛）：只沿导通的线路连接。
   * @param isActive 自定义"线路是否在运"判据（N-1 校核时用来模拟某元件停运）；默认用 lineActive。
   */
  islands(isActive: (ln: Line) => boolean = (ln) => this.lineActive(ln)): number[][] {
    const adj = new Map<number, number[]>();
    for (const id of this.buses.keys()) adj.set(id, []);
    for (const ln of this.lines.values()) {
      if (!isActive(ln)) continue;
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

  /** 计算建一条线路的造价（按电压等级，用于 UI 预览/扣款） */
  lineCost(fromBusId: number, toBusId: number): number {
    const a = this.buses.get(fromBusId)!;
    const b = this.buses.get(toBusId)!;
    const length = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    return Math.round(length * VOLTAGE[this.connectionVoltage(fromBusId, toBusId)].costPerTile);
  }
}
