// 自定义关卡（Mod 入口）：用 JSON 描述初始电网/目标/经济参数。
// 玩法：沙盒里搭好局面 → "导出为关卡文件" → 分享给朋友 → 对方导入即可游玩。
// v2 起支持"剧本"三件套：events[]（定时天气事件）、objectives[]（附加目标）、overrides{}（规则覆盖），
// 自定义关卡从"分享布局"升级为"分享剧本"。
import type { Simulation } from '../sim/simulation';
import type { Scenario } from './scenarios';
import type { PlantType, LoadProfile } from '../sim/types';
import type { WeatherKind } from '../sim/events';
import { validateObjective, type ObjectiveSpec } from '../sim/objectives';
import { PLANTS, STORAGE, type StorageType } from '../config/components';

export const SCENARIO_FORMAT = 'powerworld-scenario';
export const SCENARIO_VERSION = 2; // v1 仍可导入（新字段全部可选）

const WEATHER_KINDS: WeatherKind[] = ['clear', 'heatwave', 'coldsnap', 'calm', 'overcast', 'storm'];

/** 剧本事件：第 day 天 hour 点触发一场指定天气 */
export interface CustomEvent {
  day: number;
  hour?: number; // 缺省 12 点
  kind: WeatherKind;
}

/** 规则覆盖：改变本关的全局玩法参数 */
export interface CustomOverrides {
  noLoans?: boolean; // 禁止贷款
  banPlants?: PlantType[]; // 禁建机组类型
  competitorScale?: number; // 对手装机倍率（0.3~3）
  eventIntensity?: number; // 天气事件频率倍率（0.3~3）
  fuelVolatilityMult?: number; // 燃料波动率倍率（0.3~4）
  startDebt?: number; // 开局负债
}

export interface CustomBus {
  id: string; // 关卡内唯一标识（连线引用）
  kind: 'plant' | 'substation' | 'load' | 'storage';
  x: number;
  y: number;
  name?: string;
  plantType?: PlantType; // kind=plant 必填
  storageType?: StorageType; // kind=storage，缺省 battery
  profile?: LoadProfile; // kind=load 必填
  demand?: number; // kind=load 必填（基准 MW）
  growthPerHour?: number; // kind=load，缺省 0.003
}

export interface CustomScenarioData {
  format: typeof SCENARIO_FORMAT;
  version: number;
  name: string;
  brief?: string;
  hint?: string;
  money: number;
  goalDay: number; // ≤0 表示无尽（不设通关日）
  goalReliability?: number; // 缺省 0.9
  carbonPriceMult?: number;
  terrainSeed?: number;
  startClockHours?: number; // 开局时刻（累计仿真小时）：可指定开局季节/时辰，缺省 0
  buses: CustomBus[];
  lines?: [string, string][]; // 引用 bus id
  // —— v2 剧本三件套（全部可选，向后兼容 v1）——
  events?: CustomEvent[]; // 定时天气事件
  objectives?: ObjectiveSpec[]; // 附加目标（deadline/atWin）
  overrides?: CustomOverrides; // 规则覆盖
}

/** 校验关卡数据；合法返回 null，否则返回错误描述 */
export function validateCustom(d: unknown): string | null {
  const c = d as Partial<CustomScenarioData>;
  if (!c || typeof c !== 'object') return '不是有效的 JSON 对象';
  if (c.format !== SCENARIO_FORMAT) return '不是电力世界关卡文件（format 不符）';
  if (typeof c.version !== 'number' || c.version > SCENARIO_VERSION) return '关卡文件版本过新，请升级游戏';
  if (!c.name || typeof c.name !== 'string') return '缺少关卡名称';
  if (typeof c.money !== 'number' || c.money <= 0) return '起始资金必须为正数';
  if (!Array.isArray(c.buses) || c.buses.length === 0) return '至少需要一个设施（buses）';
  const ids = new Set<string>();
  for (const b of c.buses) {
    if (!b.id || ids.has(b.id)) return `设施 id 缺失或重复：${b.id ?? '(空)'}`;
    ids.add(b.id);
    if (typeof b.x !== 'number' || typeof b.y !== 'number' || Math.abs(b.x) > 200 || Math.abs(b.y) > 200) return `设施「${b.id}」坐标非法`;
    if (b.kind === 'plant' && !(b.plantType! in PLANTS)) return `设施「${b.id}」的机组类型非法`;
    if (b.kind === 'storage' && b.storageType != null && !(b.storageType in STORAGE)) return `设施「${b.id}」的储能类型非法`;
    if (b.kind === 'load') {
      if (!b.profile) return `负荷「${b.id}」缺少 profile`;
      if (typeof b.demand !== 'number' || b.demand <= 0 || b.demand > 2000) return `负荷「${b.id}」的 demand 非法`;
    }
    if (!['plant', 'substation', 'load', 'storage'].includes(b.kind)) return `设施「${b.id}」的 kind 非法`;
  }
  for (const [a, b] of c.lines ?? []) {
    if (!ids.has(a) || !ids.has(b)) return `线路引用了不存在的设施：${a} → ${b}`;
  }
  // —— v2 剧本字段校验 ——
  for (const e of c.events ?? []) {
    if (typeof e.day !== 'number' || e.day < 0 || e.day > 1000) return `剧本事件的 day 非法：${e.day}`;
    if (e.hour != null && (typeof e.hour !== 'number' || e.hour < 0 || e.hour >= 24)) return `剧本事件的 hour 非法：${e.hour}`;
    if (!WEATHER_KINDS.includes(e.kind)) return `剧本事件的 kind 非法：${e.kind}`;
  }
  for (const o of c.objectives ?? []) {
    const err = validateObjective(o);
    if (err) return `附加目标非法：${err}`;
  }
  const ov = c.overrides;
  if (ov) {
    if (ov.competitorScale != null && (typeof ov.competitorScale !== 'number' || ov.competitorScale < 0.3 || ov.competitorScale > 3)) return 'overrides.competitorScale 须在 0.3~3';
    if (ov.eventIntensity != null && (typeof ov.eventIntensity !== 'number' || ov.eventIntensity < 0.3 || ov.eventIntensity > 3)) return 'overrides.eventIntensity 须在 0.3~3';
    if (ov.fuelVolatilityMult != null && (typeof ov.fuelVolatilityMult !== 'number' || ov.fuelVolatilityMult < 0.3 || ov.fuelVolatilityMult > 4)) return 'overrides.fuelVolatilityMult 须在 0.3~4';
    if (ov.startDebt != null && (typeof ov.startDebt !== 'number' || ov.startDebt < 0 || ov.startDebt > 10_000_000)) return 'overrides.startDebt 非法';
    for (const p of ov.banPlants ?? []) {
      if (!(p in PLANTS)) return `overrides.banPlants 含非法机组类型：${p}`;
    }
  }
  return null;
}

/** 把关卡数据装配为可玩的 Scenario（应先 validateCustom） */
export function toScenario(data: CustomScenarioData): Scenario {
  return {
    id: `custom:${data.name}`,
    name: `🛠 ${data.name}`,
    brief: data.brief ?? '自定义关卡',
    hint: data.hint ?? '自定义关卡——祝你好运！',
    setup(sim: Simulation) {
      sim.money = data.money;
      sim.goalDay = data.goalDay > 0 ? data.goalDay : Infinity;
      sim.goalReliability = data.goalReliability ?? 0.9;
      if (data.carbonPriceMult != null) sim.carbonPriceMult = data.carbonPriceMult;
      if (data.terrainSeed != null) sim.grid.setTerrainSeed(data.terrainSeed);
      if (data.startClockHours != null && data.startClockHours > 0) sim.clock = data.startClockHours;
      const g = sim.grid;
      const idMap = new Map<string, number>();
      for (const b of data.buses) {
        if (b.kind === 'plant') {
          idMap.set(b.id, g.addPlant(b.plantType!, b.x, b.y).bus.id);
        } else if (b.kind === 'substation') {
          idMap.set(b.id, g.addSubstation(b.x, b.y, b.name ?? '变电站').id);
        } else if (b.kind === 'storage') {
          idMap.set(b.id, g.addBattery(b.x, b.y, b.storageType ?? 'battery').bus.id);
        } else {
          idMap.set(b.id, g.addLoad(b.x, b.y, b.profile!, b.demand!, b.name ?? '城区', b.growthPerHour ?? 0.003).bus.id);
        }
      }
      for (const [a, b] of data.lines ?? []) {
        const fa = idMap.get(a)!, fb = idMap.get(b)!;
        if (g.canConnect(fa, fb).ok) g.addLine(fa, fb); // 非法连线（如未经变电站）跳过
      }
      // —— v2 剧本三件套 ——
      sim.scriptedWeather = (data.events ?? []).map((e) => ({ atClock: e.day * 24 + (e.hour ?? 12), kind: e.kind }));
      sim.objectives = (data.objectives ?? []).map((o) => ({ ...o }));
      const ov = data.overrides;
      if (ov) {
        if (ov.noLoans) sim.loanBan = true;
        for (const p of ov.banPlants ?? []) sim.bannedPlants.add(p);
        if (ov.competitorScale != null) for (const cpt of sim.competitors) { cpt.base *= ov.competitorScale; cpt.capacity = cpt.base; }
        if (ov.eventIntensity != null) { sim.events.intensity = ov.eventIntensity; sim.events.schedule(sim.clock); }
        if (ov.fuelVolatilityMult != null) sim.fuelVolatilityMult = ov.fuelVolatilityMult;
        if (ov.startDebt != null && ov.startDebt > 0) sim.debt = ov.startDebt;
      }
      sim.log('info', `【${data.name}】自定义关卡开局——${data.hint ?? '祝你好运！'}`);
    },
  };
}

/** 解析 JSON 字符串为关卡；失败返回错误描述 */
export function parseCustomScenario(json: string): { data: CustomScenarioData; scenario: Scenario } | { error: string } {
  try {
    const data = JSON.parse(json) as CustomScenarioData;
    const err = validateCustom(data);
    if (err) return { error: err };
    return { data, scenario: toScenario(data) };
  } catch {
    return { error: 'JSON 解析失败' };
  }
}

/** 把当前局面导出为关卡数据（沙盒搭图 → 分享）：电网快照 + 当前目标/经济参数 */
export function exportCurrentAsScenario(sim: Simulation, name: string): CustomScenarioData {
  const g = sim.grid;
  const buses: CustomBus[] = [];
  const lines: [string, string][] = [];
  const idOf = (busId: number) => `b${busId}`;
  for (const bus of g.buses.values()) {
    if (bus.kind === 'plant') {
      const gen = g.gensAtBus(bus.id)[0];
      if (gen) buses.push({ id: idOf(bus.id), kind: 'plant', x: bus.x, y: bus.y, plantType: gen.type });
    } else if (bus.kind === 'substation') {
      buses.push({ id: idOf(bus.id), kind: 'substation', x: bus.x, y: bus.y, name: bus.name });
    } else if (bus.kind === 'storage') {
      const bat = g.batteriesAtBus(bus.id)[0];
      buses.push({ id: idOf(bus.id), kind: 'storage', x: bus.x, y: bus.y, storageType: bat?.type ?? 'battery' });
    } else {
      const l = g.loadsAtBus(bus.id)[0];
      if (l) buses.push({ id: idOf(bus.id), kind: 'load', x: bus.x, y: bus.y, name: bus.name, profile: l.profile, demand: Math.round(l.baseDemand), growthPerHour: l.growthPerHour });
    }
  }
  for (const ln of g.lines.values()) lines.push([idOf(ln.from), idOf(ln.to)]);
  const overrides: CustomOverrides = {};
  if (sim.loanBan) overrides.noLoans = true;
  if (sim.bannedPlants.size) overrides.banPlants = [...sim.bannedPlants];
  if (sim.events.intensity !== 1) overrides.eventIntensity = sim.events.intensity;
  if (sim.fuelVolatilityMult !== 1) overrides.fuelVolatilityMult = sim.fuelVolatilityMult;
  return {
    format: SCENARIO_FORMAT,
    version: SCENARIO_VERSION,
    name,
    brief: `自制关卡：${g.loads.size} 个负荷 · ${g.gens.size} 台机组 · 起始 ¥${Math.round(sim.money).toLocaleString('en-US')}`,
    money: Math.max(50_000, Math.round(sim.money)),
    goalDay: Number.isFinite(sim.goalDay) ? sim.goalDay : 0,
    goalReliability: sim.goalReliability,
    carbonPriceMult: sim.carbonPriceMult,
    terrainSeed: g.terrain.seed,
    startClockHours: Math.floor(sim.clock),
    buses,
    lines,
    objectives: sim.objectives.length ? sim.objectives.map((o) => ({ ...o })) : undefined,
    overrides: Object.keys(overrides).length ? overrides : undefined,
  };
}

// —— 自定义关卡库（localStorage 持久化）——
const LIB_KEY = 'powerworld.customlib.v1';

export function listCustomScenarios(): CustomScenarioData[] {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    if (raw) return (JSON.parse(raw) as CustomScenarioData[]).filter((d) => validateCustom(d) == null);
  } catch {
    /* 忽略 */
  }
  return [];
}

export function addCustomScenario(data: CustomScenarioData): void {
  const list = listCustomScenarios().filter((d) => d.name !== data.name); // 同名覆盖
  list.push(data);
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(list));
  } catch {
    /* 忽略 */
  }
}

export function removeCustomScenario(name: string): void {
  const list = listCustomScenarios().filter((d) => d.name !== name);
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(list));
  } catch {
    /* 忽略 */
  }
}
