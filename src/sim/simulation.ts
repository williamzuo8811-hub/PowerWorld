// 仿真主循环：把"调度 → 潮流 → 频率 → 跳闸 → 经济"串成一个 tick。
// 这是一个纯逻辑对象，不知道任何关于渲染的事；前端每帧调用 tick() 并读取快照。
import type { SimSnapshot, LogEntry } from './types';
import { Grid, type GridData } from './grid';
import { solveDC } from './powerflow';
import { EventSystem } from './events';
import { TechState } from './tech';
import { RP_PER_MWH, TECH_FX, type TechId } from '../config/tech';
import { demandMultiplier, renewableAvailability, seasonIntensity } from './profiles';
import {
  PLANTS, VOLTAGE, SUBSTATION_CAPEX, SUBSTATION_OM_PER_DAY,
  PLANT_FUEL, FUEL_INFO, FUEL_MEAN_REVERT, FUEL_MIN, FUEL_MAX, FUEL_SHOCK_CHANCE_PER_DAY, FUEL_CONTRACT_PREMIUM, FUEL_SEASON_WINTER_AMP, type FuelType,
  LOAN_BASE_CREDIT, LOAN_CREDIT_ASSET_FRAC, LOAN_BASE_DAILY_RATE,
  RATING_RATE_SPAN, RATING_REF_NETWORTH, RATING_REF_PROFIT, ESG_RATE_DISCOUNT,
  WEAR_FULL_DAYS, WEAR_COST_FACTOR, WEAR_OM_FACTOR, FAIL_BASE_HAZARD, REPAIR_DAYS,
  REPAIR_COST_FRACTION, SALVAGE_FRACTION, DEPREC_DAYS,
  MAINT_DAYS, MAINT_COST_FRACTION, MAINT_AGE_REDUCTION_DAYS, MAINT_SHOULDER_FACTOR, MAINT_PEAK_FACTOR,
  INSURANCE_RATE_PER_DAY, INSURANCE_COVERAGE,
} from '../config/components';
import type { Generator, Line, LoadProfile } from './types';
import {
  START_MONEY, TARIFF, TARIFF_CLASS, UNSERVED_PENALTY, CARBON_PRICE_START, CARBON_PRICE_GROWTH_PER_DAY,
  CARBON_BENCH_START, CARBON_BENCH_DECLINE_PER_DAY, CARBON_BENCH_MIN,
  REC_START, REC_DECLINE_PER_DAY, REC_MIN,
  FREQ_NOMINAL, FREQ_DROOP, FREQ_SHED_THRESHOLD, TRIP_DELAY,
  MAX_LOSS_FRACTION, WIN_DAY, WIN_RELIABILITY,
  GRADE_NETWORTH_REF, GRADE_W_RELIABILITY, GRADE_W_FINANCE, GRADE_W_CLEAN, GRADE_W_REPUTATION,
  BLACKSTART_TYPES, RESTORE_FAST_RATE, RESTORE_SLOW_RATE, BLACKOUT_DROP_RATE,
  LOAD_PF_TAN, GEN_Q_FACTOR, STORAGE_Q_FACTOR, LINE_Q_PER_FLOW2, CAPACITOR_Q, CAPACITOR_CAPEX, VOLT_SAG_K, VOLT_MIN, VOLT_LOW, VOLT_LOSS_K,
  POLLUTION_RADIUS, REP_TARIFF_MIN, REP_TARIFF_SPAN, REP_UNSERVED_WEIGHT,
  REP_CARBON_WEIGHT, REP_POLLUTION_WEIGHT, REP_TIME_CONSTANT, SPOT, HEDGE_FEE_PER_MW_DAY, OPTION_PREMIUM_RATE,
  INTERCONNECTOR_CAPACITY, IMPORT_MARKUP, MARKET_FEE_PER_DAY, EXPORT_WHEEL, IMPORT_CARBON_INTENSITY,
  CYCLE_PERIOD_DAYS, CYCLE_AMPLITUDE, HISTORY_SAMPLE_HOURS, HISTORY_MAX,
  SEASON_YEAR_DAYS, SEASON_SUMMER_DEMAND, SEASON_WINTER_DEMAND, SEASON_SOLAR_AMP, SEASON_WIND_AMP, SEASON_ADEQ_MARGIN,
  IRP_LOAD_FACTOR, IRP_SUMMER_PEAK, IRP_SOLAR_PEAK_CREDIT, IRP_WIND_PEAK_CREDIT, IRP_RENEW_CF,
  IRP_TIGHT_MARGIN, IRP_SCENARIOS, type StressScenarioSpec,
  REGIONAL_BASE_DEMAND, COMPETITORS_INIT, GEN_MARGIN_MARKUP, REGIONAL_SCARCITY_ADDER, COMPETITIVENESS_K,
  CAPACITY_PRICE_BASE, RESERVE_REQUIREMENT, CAP_ADEQ_REF, CAP_K, CAP_PRICE_MIN_FRAC, CAP_PRICE_MAX_FRAC,
  CAPACITY_CREDIT, STORAGE, CCS_CAPTURE_RATE, CCS_COST_FACTOR, CCS_CAPEX_PER_MW,
  CONGESTION_THRESHOLD, CONGESTION_PRICE, DR_FRACTION, DR_TRIGGER_PRICE, DR_INCENTIVE,
  AS_REG_PRICE_BASE, AS_RESERVE_PRICE_BASE, AS_GAS_REG_FACTOR, AS_REG_REQ_FRAC, AS_RESERVE_REQ_FRAC,
  AS_COMP_FAST_FRAC, AS_COMP_RESERVE_FRAC, AS_ADEQ_REF, AS_K, AS_PRICE_MIN, AS_PRICE_MAX, RENEW_RESERVE_K,
  FLEX_PRICE_BASE, FLEX_BASE_FRAC, FLEX_RENEW_FACTOR, FLEX_COMP_FRAC, FLEX_ADEQ_REF, FLEX_K, FLEX_PRICE_MIN, FLEX_PRICE_MAX,
  STORAGE_ARB_CAPTURE, STORAGE_ARB_SEASON_K, INTERRUPT_RATE_BASE, INTERRUPT_SEASON_K,
  FORWARD_CAP_PREMIUM, CAP_DELIVERY_PENALTY,
  ZONE_TRADE_CAPACITY, ZONE_WHEEL_FEE, ZONE_PERIOD_DAYS, ZONE_NORTH_OFFSET, ZONE_NORTH_AMP, ZONE_SOUTH_OFFSET, ZONE_SOUTH_AMP, FTR_MARKUP,
  COMPETITOR_EXPAND_RATE, COMPETITOR_RETIRE_RATE, COMPETITOR_EXPAND_MARGIN,
  COMPETITOR_CAP_MIN_FRAC, COMPETITOR_CAP_MAX_FRAC, ACQUISITION_PRICE_PER_MW,
  ANTITRUST_SOFT_SHARE, ANTITRUST_HARD_SHARE, ANTITRUST_PREMIUM_K,
  type CompetitorSpec,
} from '../config/components';

/** 运行期竞争对手（含初始容量，用于扩张/退役的上下限） */
interface Competitor extends CompetitorSpec {
  base: number;
}

/** 历史走势采样点 */
export interface HistorySample {
  clock: number;
  spot: number;
  netWorth: number;
  demand: number;
}

/** 多年规划轨迹的逐年采样（IRP） */
export interface YearPlan {
  year: number; // 距今第几年（0=当前）
  peakDemand: number; // 该年夏季晚峰需求 (MW)
  firmSupply: number; // 当前可信容量（"不新建"基线，保持不变）
  reserveMargin: number;
  verdict: 'adequate' | 'tight' | 'shortfall';
}

/** 扩容投资建议（IRP） */
export interface ExpansionAdvice {
  gapMW: number; // 约束情景下需补充的可信容量 (MW)，≤0 表示充裕
  bindingScenario: string; // 约束情景（备用率最低者）名称
  deficitDay: number; // 基准增长下备用率跌破 0 的日（Infinity=短期不发生）
  curDay: number; // 当前日（便于 UI 计算剩余天数）
  option: { // 推荐的最低成本补强方案（按每可信 MW 造价择优）
    label: string;
    units: number; // 需新建的机组/储能数量
    firmPerUnit: number; // 单台可信容量贡献 (MW)
    capex: number; // 总投资 (¥)
    buildDays: number; // 工期（天）
    startByDay: number; // 建议开工日（赤字日 − 工期）
  } | null;
}

/** 压力测试单情景结果（IRP） */
export interface StressResult {
  id: string;
  name: string;
  peakDemand: number; // 夏季晚峰需求 (MW)
  firmSupply: number; // 可信容量（可调+储能+新能源信用）(MW)
  reserveMargin: number; // firmSupply/peakDemand − 1
  verdict: 'adequate' | 'tight' | 'shortfall';
  dailyNet: number; // 该情景下粗估日净现金流 (¥/天)
}

interface IslandResult {
  gen: number;
  demand: number;
  served: number;
  loss: number;
  fuelCost: number;
  co2: number; // 吨/h
  marketImport: number; // 本岛向市场购电 (MW)
  curtailed: number; // 本岛弃风弃光 (MW，可外送)
  startupCost: number; // 本岛本 tick 发生的启停成本 ¥
  voltage: number; // 本岛电压（pu）
}

/** 一笔远期套保合约（差价合约） */
export interface Hedge {
  volume: number; // 锁定电量 (MW)
  strike: number; // 锁定价 ¥/MWh
  endClock: number; // 到期时刻（累计仿真小时）
}

/** 一份燃料长约（锁定某燃料的价格指数一段时间） */
export interface FuelContract {
  index: number; // 锁定的价格指数
  endClock: number; // 到期时刻（累计仿真小时）
}

/** 一份输电权（FTR）：收取南北区实际价差 */
export interface FTR {
  mw: number; // 名义容量 (MW)
  endClock: number; // 到期时刻（累计仿真小时）
}

/** 一份远期容量承诺（差价合约 + 交付义务） */
export interface CapacityCommitment {
  mw: number; // 承诺容量 (MW)
  price: number; // 锁定容量价 ¥/(MW·天)
  endClock: number; // 到期时刻（累计仿真小时）
}

/** 一份电力期权（put=价格下限保护；call=价格上限保护） */
export interface PriceOption {
  kind: 'put' | 'call';
  volume: number; // 名义电量 (MW)
  strike: number; // 行权价 ¥/MWh
  endClock: number; // 到期时刻（累计仿真小时）
}

/** 存档状态（可 JSON 序列化） */
export interface SimSaveState {
  money: number;
  clock: number;
  frequency: number;
  reliability: number;
  reputation: number;
  renewableShare: number;
  windBase: number;
  lastLossFraction: number;
  goalDay: number;
  goalReliability: number;
  carbonPriceMult: number;
  sandbox: boolean;
  gameOver: boolean;
  win: boolean;
  grid: GridData;
  events: { active: EventSystem['active']; nextAt: number };
  tech: { unlocked: TechId[]; points: number };
  fuelPrice: Record<FuelType, number>;
  fuelContracts: Partial<Record<FuelType, FuelContract>>;
  debt: number;
  avgSpot: number;
  hedges: Hedge[];
  options: PriceOption[];
  capCommitments: CapacityCommitment[];
  ftrs: FTR[];
  insured: boolean;
  marketEnabled: boolean;
  demandResponse: boolean;
  mergedCapacity: { mw: number; marginalCost: number }[];
  interruptibleMW: number;
  interruptibleEndClock: number;
  history: HistorySample[];
  nextSampleAt: number;
}

export class Simulation {
  grid = new Grid();
  money = START_MONEY;
  clock = 0; // 累计仿真小时
  frequency = FREQ_NOMINAL;
  voltage = 1; // 主电网电压（pu）
  reliability = 1; // 供电率滑动平均 0..1
  reputation = 70; // 公众形象 0..100
  renewableShare = 1; // 清洁电力占比 0..1（EMA）
  peakServed = 0; // 历史峰值供电 (MW) —— 成就用
  totalEnergyServed = 0; // 累计送达电量 (MWh) —— 成就用
  outageEnergyTotal = 0; // 累计失负荷电量 (MWh) —— 韧性指标（SAIDI 代理）
  n1Secure = false; // 是否通过过 N-1 校核 —— 成就用（由 UI 置位）
  badEventCount = 0; // 累计严重事件数（跳闸/破产等）—— UI 用来触发报警音
  logs: LogEntry[] = [];
  gameOver = false;
  win = false;
  goalDay = WIN_DAY; // 关卡目标：撑到第几天（可被关卡覆盖）
  goalReliability = WIN_RELIABILITY; // 且可靠性达标
  carbonPriceMult = 1; // 碳价倍率（关卡可调，如"碳中和转型"加压）
  sandbox = false; // 沙盒模式：无输赢、无破产
  events = new EventSystem();
  tech = new TechState();
  fuelPrice: Record<FuelType, number> = { coal: 1, gas: 1, uranium: 1 }; // 燃料价格指数
  fuelContracts: Partial<Record<FuelType, FuelContract>> = {}; // 活跃燃料长约
  forcedOutages = true; // 是否启用强迫停运（测试可关闭以求确定性）
  insured = false; // 是否投保设备保险
  marketEnabled = false; // 是否接入批发市场（联络线，需主动接入）
  demandResponse = false; // 是否启用需求响应（可中断负荷）
  drCurtailedMW = 0; // 本 tick 需求响应削减量 (MW，显示用)
  marketImportMW = 0; // 本 tick 全网购电量 (MW，显示用)
  marketExportMW = 0; // 本 tick 全网外送量 (MW，显示用)
  zoneArbMW = 0; // 本 tick 跨区套利交易量 (MW，显示用)
  competitors: Competitor[] = COMPETITORS_INIT.map((c) => ({ ...c, base: c.capacity })); // AI 竞争对手
  mergedCapacity: { mw: number; marginalCost: number }[] = []; // 已并购的商船队（在市场出清中作为自有）
  marketClearingPrice = TARIFF; // 区域出清价（批发）
  marketShare = 0; // 本公司在区域市场的发电份额 0..1
  capacityPrice = CAPACITY_PRICE_BASE; // 当前容量拍卖价 ¥/(MW·天)
  capacityAdequacy = 1; // 区域容量充裕度
  regPrice = AS_REG_PRICE_BASE; // 当前调频出清价 ¥/(MW·天)
  reservePrice = AS_RESERVE_PRICE_BASE; // 当前备用出清价 ¥/(MW·天)
  reserveReqMult = 1; // 新能源预测误差对运行备用需求的放大倍数（≥1）
  reserveRequirementMW = 0; // 当前运行备用需求 (MW)
  renewablePenetration = 0; // 当前瞬时新能源出力占比 0..1
  flexPrice = FLEX_PRICE_BASE; // 当前灵活性/爬坡出清价 ¥/(MW·天)
  flexRequirementMW = 0; // 当前灵活性需求 (MW)
  storageArbDay = 0; // 储能价差套利日收益（EMA, ¥/天）
  netLoadAvg = 0; // 净负荷日均（套利价差信号的参考）
  interruptibleMW = 0; // 已签约的可中断负荷容量 (MW)
  interruptibleEndClock = 0; // 可中断合同到期时刻（仿真小时）
  private lastSeason = ''; // 上一次的季节标签（用于迎峰预警的边沿触发）
  history: HistorySample[] = []; // 历史走势采样
  private nextSampleAt = 0; // 下次采样时刻
  private claimCoveredTick = 0; // 本 tick 保险理赔覆盖额（用于报表）
  spotPrice = TARIFF; // 当前现货电价 ¥/MWh
  avgSpot = TARIFF; // 现货电价滑动均值（作为远期报价）
  reserveMargin = 1; // 当前备用率（可用容量/需求）
  debt = 0; // 未偿贷款本金
  hedges: Hedge[] = []; // 活跃套保合约
  options: PriceOption[] = []; // 活跃电力期权
  capCommitments: CapacityCommitment[] = []; // 活跃远期容量承诺
  ftrs: FTR[] = []; // 活跃输电权
  // 现金流（按日估算，EMA 平滑，供财务报表显示）
  finance = {
    revenue: 0, fuel: 0, carbon: 0, om: 0, interest: 0, penalty: 0, hedge: 0, rec: 0, insurance: 0, market: 0, capacity: 0, congestion: 0, dr: 0, ancillary: 0, startup: 0, net: 0,
    byClass: { residential: 0, commercial: 0, industrial: 0 } as Record<LoadProfile, number>,
  };
  startupsTotal = 0; // 累计机组启动次数（统计）

  constructor() {
    this.events.schedule(0);
  }

  /** 清空回到初始状态（开新关卡前调用）。保持同一 Grid 实例，渲染器引用不失效。 */
  reset(): void {
    this.grid.clear();
    this.money = START_MONEY;
    this.clock = 0;
    this.frequency = FREQ_NOMINAL;
    this.voltage = 1;
    this.reliability = 1;
    this.reputation = 70;
    this.renewableShare = 1;
    this.peakServed = 0;
    this.totalEnergyServed = 0;
    this.outageEnergyTotal = 0;
    this.n1Secure = false;
    this.badEventCount = 0;
    this.logs = [];
    this.gameOver = false;
    this.win = false;
    this.goalDay = WIN_DAY;
    this.goalReliability = WIN_RELIABILITY;
    this.carbonPriceMult = 1;
    this.sandbox = false;
    this.windBase = 0.6;
    this.lastLossFraction = 0.02;
    this.totalGen = this.totalDemand = this.totalServed = this.totalLoss = this.co2Rate = 0;
    this.events = new EventSystem();
    this.events.schedule(0);
    this.tech = new TechState();
    this.fuelPrice = { coal: 1, gas: 1, uranium: 1 };
    this.fuelContracts = {};
    this.spotPrice = TARIFF;
    this.avgSpot = TARIFF;
    this.reserveMargin = 1;
    this.debt = 0;
    this.hedges = [];
    this.options = [];
    this.capCommitments = [];
    this.ftrs = [];
    this.forcedOutages = true;
    this.insured = false;
    this.marketEnabled = false;
    this.demandResponse = false;
    this.drCurtailedMW = 0;
    this.marketImportMW = 0;
    this.marketExportMW = 0;
    this.zoneArbMW = 0;
    this.competitors = COMPETITORS_INIT.map((c) => ({ ...c, base: c.capacity }));
    this.mergedCapacity = [];
    this.marketClearingPrice = TARIFF;
    this.marketShare = 0;
    this.capacityPrice = CAPACITY_PRICE_BASE;
    this.capacityAdequacy = 1;
    this.regPrice = AS_REG_PRICE_BASE;
    this.reservePrice = AS_RESERVE_PRICE_BASE;
    this.flexPrice = FLEX_PRICE_BASE;
    this.storageArbDay = 0;
    this.netLoadAvg = 0;
    this.interruptibleMW = 0;
    this.interruptibleEndClock = 0;
    this.lastSeason = '';
    this.history = [];
    this.nextSampleAt = 0;
    this.claimCoveredTick = 0;
    this.finance = {
      revenue: 0, fuel: 0, carbon: 0, om: 0, interest: 0, penalty: 0, hedge: 0, rec: 0, insurance: 0, market: 0, capacity: 0, congestion: 0, dr: 0, ancillary: 0, startup: 0, net: 0,
      byClass: { residential: 0, commercial: 0, industrial: 0 },
    };
    this.startupsTotal = 0;
  }

  /** 导出存档 */
  serialize(): SimSaveState {
    return {
      money: this.money, clock: this.clock, frequency: this.frequency,
      reliability: this.reliability, reputation: this.reputation, renewableShare: this.renewableShare,
      windBase: this.windBase, lastLossFraction: this.lastLossFraction,
      goalDay: this.goalDay, goalReliability: this.goalReliability, carbonPriceMult: this.carbonPriceMult, sandbox: this.sandbox,
      gameOver: this.gameOver, win: this.win,
      grid: this.grid.serialize(),
      events: { active: this.events.active.map((e) => ({ ...e })), nextAt: this.events.nextAt },
      tech: { unlocked: [...this.tech.unlocked], points: this.tech.points },
      fuelPrice: { ...this.fuelPrice },
      fuelContracts: { ...this.fuelContracts },
      debt: this.debt,
      avgSpot: this.avgSpot,
      hedges: this.hedges.map((h) => ({ ...h })),
      options: this.options.map((o) => ({ ...o })),
      capCommitments: this.capCommitments.map((c) => ({ ...c })),
      ftrs: this.ftrs.map((f) => ({ ...f })),
      insured: this.insured,
      marketEnabled: this.marketEnabled,
      demandResponse: this.demandResponse,
      mergedCapacity: this.mergedCapacity.map((m) => ({ ...m })),
      interruptibleMW: this.interruptibleMW,
      interruptibleEndClock: this.interruptibleEndClock,
      history: this.history.map((h) => ({ ...h })),
      nextSampleAt: this.nextSampleAt,
    };
  }

  /** 读取存档（覆盖当前状态，复用同一 Grid 实例） */
  deserialize(d: SimSaveState): void {
    this.money = d.money;
    this.clock = d.clock;
    this.frequency = d.frequency;
    this.reliability = d.reliability;
    this.reputation = d.reputation ?? 70;
    this.renewableShare = d.renewableShare ?? 1;
    this.windBase = d.windBase;
    this.lastLossFraction = d.lastLossFraction;
    this.goalDay = d.goalDay;
    this.goalReliability = d.goalReliability;
    this.carbonPriceMult = d.carbonPriceMult ?? 1;
    this.sandbox = d.sandbox ?? false;
    this.gameOver = d.gameOver;
    this.win = d.win;
    this.grid.deserialize(d.grid);
    this.events = new EventSystem();
    this.events.active = d.events.active.map((e) => ({ ...e }));
    this.events.nextAt = d.events.nextAt;
    this.events.update(this);
    this.tech = new TechState();
    this.tech.points = d.tech?.points ?? 0;
    for (const id of d.tech?.unlocked ?? []) this.tech.unlocked.add(id);
    this.fuelPrice = { coal: 1, gas: 1, uranium: 1 };
    if (d.fuelPrice) this.fuelPrice = { ...this.fuelPrice, ...d.fuelPrice };
    this.fuelContracts = { ...(d.fuelContracts ?? {}) };
    this.debt = d.debt ?? 0;
    this.avgSpot = d.avgSpot ?? TARIFF;
    this.hedges = (d.hedges ?? []).map((h) => ({ ...h }));
    this.options = (d.options ?? []).map((o) => ({ ...o }));
    this.capCommitments = (d.capCommitments ?? []).map((c) => ({ ...c }));
    this.ftrs = (d.ftrs ?? []).map((f) => ({ ...f }));
    this.insured = d.insured ?? false;
    this.marketEnabled = d.marketEnabled ?? false;
    this.demandResponse = d.demandResponse ?? false;
    this.mergedCapacity = (d.mergedCapacity ?? []).map((m) => ({ ...m }));
    this.interruptibleMW = d.interruptibleMW ?? 0;
    this.interruptibleEndClock = d.interruptibleEndClock ?? 0;
    this.history = (d.history ?? []).map((h) => ({ ...h }));
    this.nextSampleAt = d.nextSampleAt ?? 0;
  }

  private windBase = 0.6; // 当日风况基准，慢变随机游走
  private lastLossFraction = 0.02; // 上一 tick 的线损占比，用于本 tick 多发一点
  private totalGen = 0;
  private totalDemand = 0;
  private totalServed = 0;
  private totalLoss = 0;
  private co2Rate = 0;

  get day(): number {
    return Math.floor(this.clock / 24);
  }
  get hourOfDay(): number {
    return this.clock % 24;
  }
  get carbonPrice(): number {
    return (CARBON_PRICE_START + CARBON_PRICE_GROWTH_PER_DAY * this.day) * this.carbonPriceMult;
  }
  /** 当前免费排放基准强度 (t/MWh)，随时间收紧 */
  get benchmarkIntensity(): number {
    return Math.max(CARBON_BENCH_MIN, CARBON_BENCH_START - CARBON_BENCH_DECLINE_PER_DAY * this.day);
  }
  /** 当前绿证价 ¥/MWh，随政策退坡 */
  get recPrice(): number {
    return Math.max(REC_MIN, REC_START - REC_DECLINE_PER_DAY * this.day);
  }
  /** 经济周期正弦相位（-1..1） */
  private get cyclePhase(): number {
    return Math.sin((2 * Math.PI * this.clock) / (CYCLE_PERIOD_DAYS * 24));
  }
  /** 景气需求系数（繁荣>1、衰退<1） */
  get cycleFactor(): number {
    return 1 + CYCLE_AMPLITUDE * this.cyclePhase;
  }
  /** 景气阶段标签 */
  get cycleLabel(): string {
    const s = this.cyclePhase;
    return s > 0.3 ? '繁荣' : s < -0.3 ? '衰退' : '平稳';
  }
  /** 年内相位 [0,1)：0=春、0.25=夏、0.5=秋、0.75=冬 */
  get yearPhase(): number {
    return (this.day % SEASON_YEAR_DAYS) / SEASON_YEAR_DAYS;
  }
  /** 季节需求系数（盛夏制冷 + 深冬采暖双峰） */
  get seasonDemandFactor(): number {
    const s = seasonIntensity(this.yearPhase);
    return 1 + SEASON_SUMMER_DEMAND * s.summer + SEASON_WINTER_DEMAND * s.winter;
  }
  /** 光伏季节系数（夏强冬弱） */
  get seasonSolarFactor(): number {
    const s = seasonIntensity(this.yearPhase);
    return clamp(1 + SEASON_SOLAR_AMP * (s.summer - s.winter), 0, 2);
  }
  /** 风电季节系数（冬强夏弱） */
  get seasonWindFactor(): number {
    const s = seasonIntensity(this.yearPhase);
    return clamp(1 + SEASON_WIND_AMP * (s.winter - s.summer), 0, 2);
  }
  /** 季节标签 */
  get seasonLabel(): string {
    const p = this.yearPhase;
    if (p < 0.125 || p >= 0.875) return '春';
    if (p < 0.375) return '夏';
    if (p < 0.625) return '秋';
    return '冬';
  }
  /** 可中断负荷可用费率 ¥/(MW·天)：旺季更贵（更稀缺、更值钱） */
  get interruptiblePremiumRate(): number {
    const s = seasonIntensity(this.yearPhase);
    return INTERRUPT_RATE_BASE * (1 + INTERRUPT_SEASON_K * Math.max(s.summer, s.winter));
  }
  /** 签订可中断负荷合同：承诺 mw MW × days 天（替换现有合同） */
  signInterruptible(mw: number, days: number): boolean {
    if (mw <= 0 || days <= 0) return false;
    this.interruptibleMW = mw;
    this.interruptibleEndClock = this.clock + days * 24;
    this.log('info', `🔌 签订可中断负荷合同：${mw.toFixed(0)}MW × ${days}天（可用费 ¥${this.interruptiblePremiumRate.toFixed(1)}/MW·天，作备用/容量资源）`);
    return true;
  }

  /** 季节性检修成本系数：换季优惠、旺季加价（按夏/冬峰强度插值） */
  get seasonMaintFactor(): number {
    const s = seasonIntensity(this.yearPhase);
    const peak = Math.max(s.summer, s.winter); // 0=换季, 1=盛夏/深冬
    return MAINT_SHOULDER_FACTOR + (MAINT_PEAK_FACTOR - MAINT_SHOULDER_FACTOR) * peak;
  }
  /** 北区(便宜)电价 */
  get zoneNorthPrice(): number {
    const s = Math.sin((2 * Math.PI * this.clock) / (ZONE_PERIOD_DAYS * 24));
    return clamp(this.marketClearingPrice + ZONE_NORTH_OFFSET + ZONE_NORTH_AMP * s, SPOT.floor, SPOT.cap);
  }
  /** 南区(贵)电价 */
  get zoneSouthPrice(): number {
    const s = Math.sin((2 * Math.PI * this.clock) / (ZONE_PERIOD_DAYS * 24) + 2);
    return clamp(this.marketClearingPrice + ZONE_SOUTH_OFFSET + ZONE_SOUTH_AMP * s, SPOT.floor, SPOT.cap);
  }
  /** 跨区价差 */
  get zoneSpread(): number {
    return Math.abs(this.zoneSouthPrice - this.zoneNorthPrice);
  }

  /** 区域市场总需求 (MW)：日曲线 × 景气 × 季节 */
  get regionalDemand(): number {
    const m = (demandMultiplier(this.hourOfDay, 'residential')
      + demandMultiplier(this.hourOfDay, 'commercial')
      + demandMultiplier(this.hourOfDay, 'industrial')) / 3;
    return REGIONAL_BASE_DEMAND * m * this.cycleFactor * this.seasonDemandFactor;
  }
  /** 区域市场出清：你与竞争对手按报价排序，对区域需求出清 */
  private marketClearing(): { clearingCost: number; playerDispatched: number; shortfall: number } {
    const demand = this.regionalDemand;
    const blocks: { mw: number; cost: number; player: boolean }[] = [];
    for (const c of this.competitors) blocks.push({ mw: c.capacity, cost: c.marginalCost, player: false });
    for (const m of this.mergedCapacity) blocks.push({ mw: m.mw, cost: m.marginalCost, player: true }); // 商船队=自有
    for (const g of this.grid.gens.values()) {
      if (this.genOffline(g)) continue;
      if (g.dispatchable) blocks.push({ mw: g.capacity, cost: this.effMarginalCost(g), player: true });
      else blocks.push({ mw: g.capacity * g.availability, cost: 0.5, player: true });
    }
    blocks.sort((a, b) => a.cost - b.cost);
    let cum = 0, clearingCost = 0, playerDispatched = 0;
    for (const b of blocks) {
      if (cum >= demand) break;
      const take = Math.min(b.mw, demand - cum);
      cum += take;
      clearingCost = b.cost;
      if (b.player) playerDispatched += take;
    }
    return { clearingCost, playerDispatched, shortfall: Math.max(0, demand - cum) };
  }

  /** 玩家自有装机（自有机组 + 已并购商船队）MW —— 反垄断口径 */
  get playerNameplate(): number {
    let cap = 0;
    for (const g of this.grid.gens.values()) cap += g.capacity;
    for (const m of this.mergedCapacity) cap += m.mw;
    return cap;
  }
  /** 全区域装机（玩家 + 所有竞争对手）MW */
  get regionNameplate(): number {
    let cap = this.playerNameplate;
    for (const c of this.competitors) cap += c.capacity;
    return cap;
  }

  /**
   * 并购报价（含反垄断审查）：返回基础估值、补救费、合计、并购后市占与是否被否决。
   * 监管按全网装机口径衡量集中度：市占越高，补救费越贵；超过硬上限直接否决。
   */
  acquisitionQuote(index: number): { base: number; remedy: number; total: number; postShare: number; blocked: boolean } | null {
    const c = this.competitors[index];
    if (!c) return null;
    const region = Math.max(this.regionNameplate, 1);
    const postShare = (this.playerNameplate + c.capacity) / region;
    const base = Math.round(c.capacity * ACQUISITION_PRICE_PER_MW);
    const blocked = postShare > ANTITRUST_HARD_SHARE;
    const over = clamp((postShare - ANTITRUST_SOFT_SHARE) / (ANTITRUST_HARD_SHARE - ANTITRUST_SOFT_SHARE), 0, 1);
    const remedy = blocked ? 0 : Math.round(base * ANTITRUST_PREMIUM_K * over);
    return { base, remedy, total: base + remedy, postShare, blocked };
  }

  /** 并购一家竞争对手：过审后付估值(+补救费)，吸收为商船队（市场出清中作自有，捕获其市场利润） */
  acquireCompetitor(index: number): boolean {
    const c = this.competitors[index];
    const q = this.acquisitionQuote(index);
    if (!c || !q) return false;
    if (q.blocked) {
      this.log('warn', `🚫 反垄断否决：并购「${c.name}」后市占将达 ${(q.postShare * 100).toFixed(0)}%，超过 ${(ANTITRUST_HARD_SHARE * 100).toFixed(0)}% 上限`);
      return false;
    }
    if (this.money < q.total) return false;
    this.money -= q.total;
    this.mergedCapacity.push({ mw: c.capacity, marginalCost: c.marginalCost });
    this.competitors.splice(index, 1);
    const remedyNote = q.remedy > 0 ? `（含反垄断补救费 ¥${q.remedy.toLocaleString('en-US')}）` : '';
    this.log('good', `🤝 并购「${c.name}」${c.capacity.toFixed(0)}MW（¥${q.total.toLocaleString('en-US')}）${remedyNote}：吸收为自有商船队`);
    return true;
  }

  /** 竞争对手演化：出清价高于其成本一定幅度则扩张，亏损则退役 */
  private evolveCompetitors(dtDays: number): void {
    for (const c of this.competitors) {
      const margin = this.marketClearingPrice - c.marginalCost;
      if (margin > COMPETITOR_EXPAND_MARGIN) c.capacity *= 1 + COMPETITOR_EXPAND_RATE * dtDays;
      else if (margin < 0) c.capacity *= 1 - COMPETITOR_RETIRE_RATE * dtDays;
      c.capacity = clamp(c.capacity, c.base * COMPETITOR_CAP_MIN_FRAC, c.base * COMPETITOR_CAP_MAX_FRAC);
    }
  }

  /** 已建资产的账面价值（按 capex 估值），用于净资产与信用额度 */
  get assetValue(): number {
    let v = 0;
    for (const g of this.grid.gens.values()) v += PLANTS[g.type].capex;
    for (const b of this.grid.batteries.values()) v += STORAGE[b.type].capex;
    for (const bus of this.grid.buses.values()) if (bus.kind === 'substation') v += SUBSTATION_CAPEX;
    for (const ln of this.grid.lines.values()) v += ln.length * VOLTAGE[ln.voltage].costPerTile;
    return v;
  }
  /** 杠杆率（以资产+基础额度为基数，避免与信用额度循环依赖） */
  get leverage(): number {
    return this.debt / Math.max(this.assetValue + LOAN_BASE_CREDIT, 1);
  }
  /** 信用评分 0..100：净资产/杠杆/可靠性/盈利综合 */
  get creditScore(): number {
    const leverageScore = 1 - clamp(this.leverage, 0, 1);
    const netWorthScore = clamp(0.5 + this.netWorth / (2 * RATING_REF_NETWORTH), 0, 1);
    const reliabScore = clamp(this.reliability, 0, 1);
    const profitScore = clamp(0.5 + this.finance.net / (2 * RATING_REF_PROFIT), 0, 1);
    return (0.3 * leverageScore + 0.3 * netWorthScore + 0.2 * reliabScore + 0.2 * profitScore) * 100;
  }
  /** 信用评级字母 */
  get creditRating(): string {
    const s = this.creditScore;
    if (s >= 90) return 'AAA';
    if (s >= 80) return 'AA';
    if (s >= 70) return 'A';
    if (s >= 60) return 'BBB';
    if (s >= 50) return 'BB';
    if (s >= 40) return 'B';
    if (s >= 25) return 'CCC';
    return 'D';
  }
  /** 信用额度 = (基础额度 + 资产抵押) × 评级系数(0.5~1.5) */
  get creditLimit(): number {
    return (LOAN_BASE_CREDIT + this.assetValue * LOAN_CREDIT_ASSET_FRAC) * (0.5 + this.creditScore / 100);
  }
  get debtRatio(): number {
    return this.creditLimit > 0 ? this.debt / this.creditLimit : 0;
  }
  /** ESG 评分 0..100（环境/社会/治理三维平均） */
  get esgScore(): number {
    const intensity = this.co2Rate / Math.max(this.totalServed, 1);
    const e = clamp(this.renewableShare * 0.6 + (1 - clamp(intensity / 0.9, 0, 1)) * 0.4, 0, 1); // 环境
    const s = clamp(this.reliability * 0.5 + (this.reputation / 100) * 0.5, 0, 1); // 社会
    const gov = clamp(this.creditScore / 100, 0, 1); // 治理
    return ((e + s + gov) / 3) * 100;
  }
  /** ESG 评级字母 */
  get esgRating(): string {
    const s = this.esgScore;
    if (s >= 85) return 'A+';
    if (s >= 70) return 'A';
    if (s >= 55) return 'B';
    if (s >= 40) return 'C';
    return 'D';
  }
  /** 日利率：基础 + 评级风险溢价 − ESG 绿色折扣 */
  get loanDailyRate(): number {
    const base = LOAN_BASE_DAILY_RATE + (1 - this.creditScore / 100) * RATING_RATE_SPAN;
    return Math.max(0.001, base - (this.esgScore / 100) * ESG_RATE_DISCOUNT);
  }
  /** 净资产 = 现金 + 资产 − 负债 */
  get netWorth(): number {
    return this.money + this.assetValue - this.debt;
  }
  /** 当前日保费（已投保时） */
  get insurancePremiumPerDay(): number {
    return this.insured ? this.assetValue * INSURANCE_RATE_PER_DAY : 0;
  }
  /** 发生一次意外损失：已投保则保险覆盖大部分，玩家只付自付额 */
  incurDamage(gross: number, label: string): void {
    const covered = this.insured ? gross * INSURANCE_COVERAGE : 0;
    const net = gross - covered;
    this.money -= net;
    this.claimCoveredTick += covered;
    this.log('bad', `💥 ${label} ¥${Math.round(gross).toLocaleString('en-US')}${covered > 0 ? `（保险赔付 ¥${Math.round(covered).toLocaleString('en-US')}，自付 ¥${Math.round(net).toLocaleString('en-US')}）` : ''}`);
  }
  /** 签订一笔远期套保合约：锁定 volume MW × days 天，锁价 = 当前远期报价(avgSpot)；收手续费 */
  addHedge(volume: number, days: number): boolean {
    if (volume <= 0 || days <= 0) return false;
    const fee = volume * days * HEDGE_FEE_PER_MW_DAY;
    if (this.money < fee) return false;
    this.money -= fee;
    const strike = Math.round(this.avgSpot);
    this.hedges.push({ volume, strike, endClock: this.clock + days * 24 });
    this.log('info', `🔒 套保 ${volume}MW × ${days}天 @ ¥${strike}/MWh（手续费 ¥${Math.round(fee).toLocaleString('en-US')}）`);
    return true;
  }

  /** 买入电力期权：行权价=当前远期报价(avgSpot)，按量×天收权利金 */
  addOption(kind: 'put' | 'call', volume: number, days: number): boolean {
    if (volume <= 0 || days <= 0) return false;
    const premium = volume * days * OPTION_PREMIUM_RATE;
    if (this.money < premium) return false;
    this.money -= premium;
    const strike = Math.round(this.avgSpot);
    this.options.push({ kind, volume, strike, endClock: this.clock + days * 24 });
    this.log('info', `🎟 ${kind === 'put' ? '看跌(保底)' : '看涨(封顶)'}期权 ${volume}MW × ${days}天 @ ¥${strike}（权利金 ¥${Math.round(premium).toLocaleString('en-US')}）`);
    return true;
  }

  /** 买入输电权(FTR)：付当前价差×溢价的权利金，期内收取实际南北价差 */
  addFTR(mw: number, days: number): boolean {
    if (mw <= 0 || days <= 0) return false;
    const premium = Math.round(this.zoneSpread * mw * days * 24 * FTR_MARKUP);
    if (this.money < premium) return false;
    this.money -= premium;
    this.ftrs.push({ mw, endClock: this.clock + days * 24 });
    this.log('info', `🔗 输电权 ${mw}MW × ${days}天（权利金 ¥${premium.toLocaleString('en-US')}），收取南北价差`);
    return true;
  }

  /** 承诺远期容量：锁定容量价×溢价 days 天（差价合约 + 交付义务） */
  addCapacityCommitment(mw: number, days: number): boolean {
    if (mw <= 0 || days <= 0) return false;
    this.capCommitments.push({ mw, price: this.capacityPrice * FORWARD_CAP_PREMIUM, endClock: this.clock + days * 24 });
    this.log('info', `📜 远期容量 ${mw}MW × ${days}天 @ ¥${(this.capacityPrice * FORWARD_CAP_PREMIUM).toFixed(1)}/MW·天（须交付，否则罚款）`);
    return true;
  }

  /** 借款（受信用额度约束），成功返回 true */
  borrow(amount: number): boolean {
    if (amount <= 0 || this.debt + amount > this.creditLimit) return false;
    this.debt += amount;
    this.money += amount;
    this.log('info', `🏦 借入 ¥${Math.round(amount).toLocaleString('en-US')}（负债 ¥${Math.round(this.debt).toLocaleString('en-US')}）`);
    return true;
  }
  /** 还款（不超过负债与现金），返回实际还款额 */
  repay(amount: number): number {
    const x = Math.max(0, Math.min(amount, this.debt, this.money));
    if (x <= 0) return 0;
    this.debt -= x;
    this.money -= x;
    this.log('info', `🏦 还款 ¥${Math.round(x).toLocaleString('en-US')}（负债 ¥${Math.round(this.debt).toLocaleString('en-US')}）`);
    return x;
  }

  /** 机组磨损系数 0..1（随役龄上升） */
  wear(g: Generator): number {
    return clamp(g.age / WEAR_FULL_DAYS, 0, 1);
  }
  /** 机组是否离线：在建中、或处于强迫停运检修 */
  genOffline(g: Generator): boolean {
    const bus = this.grid.buses.get(g.busId);
    if (!bus || bus.underConstruction) return true;
    return g.outageUntil != null && this.clock < g.outageUntil;
  }
  /** 某燃料的有效价格指数：有活跃长约用锁定价，否则用现货 */
  effFuelIndex(fuel: FuelType): number {
    const c = this.fuelContracts[fuel];
    if (c && this.clock < c.endClock) return c.index;
    return this.fuelPrice[fuel];
  }

  /** 机组的有效边际成本 = 基准 × 燃料指数 × 高效科技 ×（含老化上浮）×（CCS 能耗惩罚） */
  effMarginalCost(g: Generator): number {
    const fuel = PLANT_FUEL[g.type];
    const idx = fuel ? this.effFuelIndex(fuel) : 1;
    return g.marginalCost * idx * this.tech.fuelCostFactor * (1 + this.wear(g) * WEAR_COST_FACTOR) * (g.ccs ? CCS_COST_FACTOR : 1);
  }
  /** 机组有效碳排放强度 (t/MWh)：CCS 捕集后大幅下降 */
  effCo2(g: Generator): number {
    return PLANTS[g.type].co2 * this.tech.co2Factor * (g.ccs ? 1 - CCS_CAPTURE_RATE : 1);
  }
  /** 给火电加装碳捕集改造（付改造费） */
  retrofitCCS(busId: number): boolean {
    const bus = this.grid.buses.get(busId);
    if (!bus || bus.kind !== 'plant' || bus.underConstruction) return false;
    const g = this.grid.gensAtBus(busId)[0];
    if (!g || g.ccs || PLANTS[g.type].co2 <= 0) return false; // 仅火电、未改造
    const cost = Math.round(g.capacity * CCS_CAPEX_PER_MW);
    if (this.money < cost) return false;
    this.money -= cost;
    g.ccs = true;
    this.log('good', `🌫 ${bus.name} 加装碳捕集（¥${cost.toLocaleString('en-US')}）：捕碳 ${(CCS_CAPTURE_RATE * 100).toFixed(0)}%，成本上浮`);
    return true;
  }

  /** 给变电站加装电容器组（无功补偿，支撑电压、降欠压线损） */
  addCapacitor(busId: number): boolean {
    const bus = this.grid.buses.get(busId);
    if (!bus || bus.kind !== 'substation' || bus.underConstruction || bus.capacitor) return false;
    if (this.money < CAPACITOR_CAPEX) return false;
    this.money -= CAPACITOR_CAPEX;
    bus.capacitor = true;
    this.log('good', `⚡ ${bus.name} 加装电容器组（¥${CAPACITOR_CAPEX.toLocaleString('en-US')}）：+${CAPACITOR_Q} MVAr 无功补偿，支撑电压`);
    return true;
  }

  /** 签订燃料长约：锁定该燃料当前现货指数 × 溢价，锁定 days 天 */
  signFuelContract(fuel: FuelType, days: number): boolean {
    if (days <= 0) return false;
    const index = this.fuelPrice[fuel] * FUEL_CONTRACT_PREMIUM;
    this.fuelContracts[fuel] = { index, endClock: this.clock + days * 24 };
    this.log('info', `📑 ${FUEL_INFO[fuel].label}长约：锁定指数 ${index.toFixed(2)} × ${days}天`);
    return true;
  }

  /** 某电厂当前（季节调整后）的计划检修费用；不可检修返回 null */
  maintenanceCost(busId: number): number | null {
    const bus = this.grid.buses.get(busId);
    if (!bus || bus.kind !== 'plant' || bus.underConstruction) return null;
    const g = this.grid.gensAtBus(busId)[0];
    if (!g) return null;
    return Math.round(PLANTS[g.type].capex * MAINT_COST_FRACTION * this.seasonMaintFactor);
  }

  /** 安排某电厂计划检修：短暂离线 + 检修费，换取役龄下降（更低成本与故障率） */
  scheduleMaintenance(busId: number): boolean {
    const bus = this.grid.buses.get(busId);
    if (!bus || bus.kind !== 'plant' || bus.underConstruction) return false;
    const g = this.grid.gensAtBus(busId)[0];
    if (!g || this.genOffline(g)) return false; // 在建/已离线不可重复检修
    const factor = this.seasonMaintFactor;
    const cost = this.maintenanceCost(busId)!;
    if (this.money < cost) return false;
    this.money -= cost;
    g.outageUntil = this.clock + MAINT_DAYS * 24;
    g.output = 0;
    g.age = Math.max(0, g.age - MAINT_AGE_REDUCTION_DAYS);
    const seasonHint = factor < 0.95 ? `（${this.seasonLabel}季淡季优惠）` : factor > 1.05 ? `（${this.seasonLabel}季旺季加价·占用尖峰可用）` : '';
    this.log('good', `🛠 ${bus.name} 计划检修（${MAINT_DAYS}天，¥${cost.toLocaleString('en-US')}）役龄 −${MAINT_AGE_REDUCTION_DAYS}天${seasonHint}`);
    return true;
  }

  /** 退役某资产的残值（按 capex × 基准比例 ×(1−役龄折旧)） */
  salvageValue(busId: number): number {
    const bus = this.grid.buses.get(busId);
    if (!bus) return 0;
    if (bus.kind === 'plant') {
      const g = this.grid.gensAtBus(busId)[0];
      const deprec = g ? clamp(g.age / DEPREC_DAYS, 0, 0.85) : 0;
      const capex = g ? PLANTS[g.type].capex : 0;
      return Math.round(capex * SALVAGE_FRACTION * (1 - deprec));
    }
    if (bus.kind === 'storage') {
      const bat = this.grid.batteriesAtBus(busId)[0];
      return Math.round((bat ? STORAGE[bat.type].capex : STORAGE.battery.capex) * SALVAGE_FRACTION);
    }
    if (bus.kind === 'substation') return Math.round(SUBSTATION_CAPEX * SALVAGE_FRACTION);
    return 0;
  }
  /** 拆除线路的残值 */
  lineSalvage(ln: Line): number {
    return Math.round(ln.length * VOLTAGE[ln.voltage].costPerTile * SALVAGE_FRACTION * 0.5);
  }

  /** 某燃料的季节性回归基准（深冬抬升、夏季/换季回到 1.0） */
  fuelSeasonMean(fuel: FuelType): number {
    return 1 + FUEL_SEASON_WINTER_AMP[fuel] * seasonIntensity(this.yearPhase).winter;
  }

  /** 燃料价格波动：季节性均值回归 + 随机游走 + 偶发跳涨 */
  private updateFuelPrices(dtHours: number): void {
    const dtDay = dtHours / 24;
    for (const fuel of Object.keys(this.fuelPrice) as FuelType[]) {
      const info = FUEL_INFO[fuel];
      let p = this.fuelPrice[fuel];
      p += (this.fuelSeasonMean(fuel) - p) * FUEL_MEAN_REVERT * dtDay; // 向季节性基准回归
      p += (Math.random() * 2 - 1) * info.volatility * Math.sqrt(dtDay); // 随机游走
      if (Math.random() < FUEL_SHOCK_CHANCE_PER_DAY * dtDay) {
        p *= 1 + Math.random() * 0.5; // 供给冲击：跳涨 0~50%
        this.log('warn', `📈 ${info.label}价格跳涨（指数 ${clamp(p, FUEL_MIN, FUEL_MAX).toFixed(2)}）`);
      }
      this.fuelPrice[fuel] = clamp(p, FUEL_MIN, FUEL_MAX);
    }
  }
  /** 口碑越好，公众/监管越认可，等效电价越高（0.85 ~ 1.15） */
  get reputationTariffFactor(): number {
    return REP_TARIFF_MIN + (this.reputation / 100) * REP_TARIFF_SPAN;
  }

  log(level: LogEntry['level'], msg: string): void {
    this.logs.push({ time: this.clock, level, msg });
    if (level === 'bad') this.badEventCount++;
    if (this.logs.length > 40) this.logs.shift();
  }

  canAfford(amount: number): boolean {
    return this.money >= amount;
  }
  spend(amount: number): boolean {
    if (this.money < amount) return false;
    this.money -= amount;
    return true;
  }
  refund(amount: number): void {
    this.money += amount;
  }

  /**
   * 推进一个 tick。
   * @param dtReal   真实经过秒数（来自 requestAnimationFrame）
   * @param timeScale 仿真秒 / 真实秒（暂停=0）
   */
  tick(dtReal: number, timeScale: number): void {
    if (this.gameOver || timeScale <= 0) return;
    const dtSim = dtReal * timeScale; // 本 tick 的仿真秒
    const dtHours = dtSim / 3600;
    this.clock += dtHours;
    this.claimCoveredTick = 0; // 重置本 tick 保险理赔累计

    // —— 天气：风况慢变随机游走 + 天气/危机事件 ——
    this.windBase = clamp(this.windBase + (Math.random() - 0.5) * 0.25 * dtHours, 0.12, 1.0);
    this.events.update(this);

    // —— 工程投运：到期的在建资产投入运行 ——
    for (const bus of this.grid.buses.values()) {
      if (bus.underConstruction && this.clock >= (bus.commissionAt ?? 0)) {
        bus.underConstruction = false;
        this.log('good', `🏗 ${bus.name} 建成投运`);
      }
    }
    for (const ln of this.grid.lines.values()) {
      if (ln.underConstruction && this.clock >= (ln.commissionAt ?? 0)) ln.underConstruction = false;
    }

    // —— 燃料价格波动 ——
    this.updateFuelPrices(dtHours);

    // —— 迎峰预警：进入夏/冬旺季时校核可信容量对季节峰值的充裕度 ——
    this.checkSeasonAlert();

    // —— 机组老化 + 强迫停运 ——
    const dtDays = dtHours / 24;
    for (const g of this.grid.gens.values()) {
      const bus = this.grid.buses.get(g.busId);
      if (!bus || bus.underConstruction) continue; // 在建不计役龄
      g.age += dtDays;
      if (g.outageUntil != null && this.clock >= g.outageUntil) g.outageUntil = undefined; // 检修完成
      if (this.forcedOutages && g.outageUntil == null) {
        const hazard = FAIL_BASE_HAZARD * (0.3 + this.wear(g)) * dtDays;
        if (Math.random() < hazard) {
          g.outageUntil = this.clock + REPAIR_DAYS * 24;
          g.output = 0;
          const repair = Math.round(PLANTS[g.type].capex * REPAIR_COST_FRACTION * (0.5 + this.wear(g)));
          this.incurDamage(repair, `${bus.name} 强迫停运检修（约 ${REPAIR_DAYS}天）`);
        }
      }
    }

    // —— 更新负荷需求（城市增长 × 竞争力 + 噪声 + 事件 + 需求响应 + 景气）——
    const compFactor = clamp(0.6 + this.marketShare * COMPETITIVENESS_K, 0.6, 1.5); // 越有竞争力获客越快
    const drActive = this.demandResponse && this.spotPrice > DR_TRIGGER_PRICE; // 高价时段触发可中断负荷
    const drFactor = drActive ? 1 - DR_FRACTION : 1;
    this.drCurtailedMW = 0;
    for (const load of this.grid.loads.values()) {
      load.baseDemand *= 1 + load.growthPerHour * compFactor * dtHours;
      const noise = 1 + (Math.random() - 0.5) * 0.05;
      const full = load.baseDemand * demandMultiplier(this.hourOfDay, load.profile) * noise * this.events.demandFactor * this.tech.demandFactor * this.cycleFactor * this.seasonDemandFactor;
      load.demand = full * drFactor;
      this.drCurtailedMW += full - load.demand;
    }

    // —— 更新新能源可用系数（叠加天气事件对风/光的压制）——
    for (const g of this.grid.gens.values()) {
      if (!g.dispatchable) {
        let a = renewableAvailability(g.type, this.hourOfDay, this.windBase);
        if (g.type === 'wind') a *= this.events.windCap * this.seasonWindFactor;
        if (g.type === 'solar') a *= this.events.solarCap * this.seasonSolarFactor;
        g.availability = clamp(a, 0, 1);
      }
    }

    // 每 tick 先清零线路潮流 / 变电站通过量，再按孤岛逐个回填
    for (const ln of this.grid.lines.values()) {
      ln.flow = 0;
      ln.loss = 0;
    }
    for (const bus of this.grid.buses.values()) {
      bus.blackout = false;
      if (bus.kind === 'substation') bus.throughput = 0;
    }
    for (const g of this.grid.gens.values()) if (this.genOffline(g)) g.output = 0; // 离线机组出力清零

    // —— 逐孤岛求解 ——
    const islands = this.grid.islands();
    let revenue = 0, fuelCost = 0, penalty = 0, co2Rate = 0, startupCostAgg = 0;
    let aggGen = 0, aggDemand = 0, aggServed = 0, aggLoss = 0, aggMarketImport = 0, aggCurtailed = 0;
    let mainDemand = -1;
    let mainFreq = FREQ_NOMINAL;
    let mainVoltage = 1;

    for (const busIds of islands) {
      const r = this.solveIsland(busIds, dtSim);
      aggGen += r.gen; aggDemand += r.demand; aggServed += r.served; aggLoss += r.loss;
      aggMarketImport += r.marketImport;
      aggCurtailed += r.curtailed;
      fuelCost += r.fuelCost; co2Rate += r.co2;
      startupCostAgg += r.startupCost;
      penalty += Math.max(0, r.demand - r.served) * UNSERVED_PENALTY * dtHours;
      // 把"需求最大的岛"视为主电网，用其频率/电压做仪表显示
      if (r.demand > mainDemand) {
        mainDemand = r.demand;
        mainFreq = freqFromBalance(r.gen, r.demand);
        mainVoltage = r.voltage;
      }
    }
    this.voltage = mainVoltage;

    // —— 过载保护 / 连锁跳闸（含自动重合闸科技）——
    for (const ln of this.grid.lines.values()) {
      if (ln.tripped) {
        // 电网自愈：跳闸线路冷却一段时间后自动重合闸
        if (this.tech.autoReclose) {
          ln.overloadTimer += dtSim;
          if (ln.overloadTimer >= TECH_FX.autoRecloseDelay) {
            ln.tripped = false;
            ln.overloadTimer = 0;
          }
        }
        continue;
      }
      const over = Math.abs(ln.flow) - ln.capacity;
      if (over > 0.5) {
        ln.overloadTimer += dtSim;
        if (ln.overloadTimer >= TRIP_DELAY) {
          ln.tripped = true;
          ln.overloadTimer = 0;
          this.log('bad', `⚡ 线路过载跳闸！(${Math.abs(ln.flow).toFixed(0)}>${ln.capacity}MW) 可能引发连锁停电`);
        }
      } else {
        ln.overloadTimer = Math.max(0, ln.overloadTimer - dtSim * 1.5);
      }
    }

    // —— 变电站变压器过载保护 ——
    for (const bus of this.grid.buses.values()) {
      if (bus.kind !== 'substation' || bus.rating == null || bus.transformerTripped) continue;
      const effRating = bus.rating * this.tech.transformerRatingFactor; // 大容量变压器科技
      const over = (bus.throughput ?? 0) - effRating;
      if (over > 0.5) {
        bus.transformerTimer = (bus.transformerTimer ?? 0) + dtSim;
        if (bus.transformerTimer >= TRIP_DELAY) {
          bus.transformerTripped = true;
          bus.transformerTimer = 0;
          this.log('bad', `⚡ 变电站「${bus.name}」变压器过载跳闸！(${(bus.throughput ?? 0).toFixed(0)}>${effRating.toFixed(0)}MW) 下游配电中断`);
        }
      } else {
        bus.transformerTimer = Math.max(0, (bus.transformerTimer ?? 0) - dtSim * 1.5);
      }
    }

    // —— 现货电价：本地备用率 × 区域竞价市场的能量成本 ——
    let availCap = 0;
    for (const g of this.grid.gens.values()) {
      if (this.genOffline(g)) continue;
      availCap += g.dispatchable ? g.capacity : g.capacity * g.availability;
    }
    for (const b of this.grid.batteries.values()) {
      const bus = this.grid.buses.get(b.busId);
      if (bus && !bus.underConstruction && b.soc > 1) availCap += b.powerRating * this.tech.batteryPowerFactor;
    }
    const reserveRatio = availCap / Math.max(aggDemand, 1);
    const localMult = clamp(1 + (SPOT.scarcityRef - reserveRatio) * SPOT.scarcityK, SPOT.multMin, SPOT.multMax);
    // 区域市场出清：竞争对手影响能量成本水平与你的市场份额
    const clr = this.marketClearing();
    this.marketClearingPrice = clamp(clr.clearingCost * GEN_MARGIN_MARKUP + (clr.shortfall > 0 ? REGIONAL_SCARCITY_ADDER : 0), SPOT.floor, SPOT.cap);
    const marketFactor = clamp(SPOT.fuelMin + clr.clearingCost / SPOT.fuelRef, SPOT.fuelMin, SPOT.fuelMax);
    this.spotPrice = clamp(TARIFF * localMult * marketFactor, SPOT.floor, SPOT.cap);
    this.reserveMargin = reserveRatio;
    this.marketShare = this.regionalDemand > 0 ? clr.playerDispatched / this.regionalDemand : 0;
    this.evolveCompetitors(dtHours / 24); // 市场自平衡：竞争对手扩张/退役
    // 远期报价（现货均值）
    const aS = clamp(dtHours / 12, 0, 1);
    this.avgSpot = this.avgSpot * (1 - aS) + this.spotPrice * aS;

    // —— 储能价差套利：以净负荷（需求−新能源）相对日均的偏离作为价差信号 ——
    // 储能在净负荷高（紧张/高价）时放电、净负荷低（宽松/低价）时充电，天然赚取价差；旺季摆幅更宽。
    let renewOutNow = 0;
    for (const g of this.grid.gens.values()) if (!g.dispatchable && !this.genOffline(g)) renewOutNow += g.output;
    const netLoad = aggDemand - renewOutNow;
    const aN = clamp(dtHours / 24, 0, 1);
    this.netLoadAvg = this.netLoadAvg <= 0 ? netLoad : this.netLoadAvg * (1 - aN) + netLoad * aN;
    const priceDev = TARIFF * clamp((netLoad - this.netLoadAvg) / Math.max(this.netLoadAvg, 1), -1, 1);
    const seasonSpreadF = 1 + STORAGE_ARB_SEASON_K * Math.max(seasonIntensity(this.yearPhase).summer, seasonIntensity(this.yearPhase).winter);
    let storageArbCash = 0;
    for (const b of this.grid.batteries.values()) {
      const bus = this.grid.buses.get(b.busId);
      if (!bus || bus.underConstruction) continue;
      storageArbCash += b.output * priceDev * STORAGE_ARB_CAPTURE * seasonSpreadF * dtHours;
    }

    // 套保结算（差价合约）：市价低于锁价获补偿，高于则让出收益（可为负）
    this.hedges = this.hedges.filter((h) => this.clock < h.endClock);
    let hedgeIncome = 0;
    for (const h of this.hedges) hedgeIncome += (h.strike - this.spotPrice) * h.volume * dtHours;
    // 期权按行权方向单向赔付（不行权则只损失权利金）
    this.options = this.options.filter((o) => this.clock < o.endClock);
    for (const o of this.options) {
      const payoff = o.kind === 'put' ? Math.max(0, o.strike - this.spotPrice) : Math.max(0, this.spotPrice - o.strike);
      hedgeIncome += payoff * o.volume * dtHours;
    }

    // 分类电价：按客户类别加权计算售电收入
    const classServed: Record<LoadProfile, number> = { residential: 0, commercial: 0, industrial: 0 };
    for (const l of this.grid.loads.values()) classServed[l.profile] += l.served;
    revenue = (classServed.residential * TARIFF_CLASS.residential
      + classServed.commercial * TARIFF_CLASS.commercial
      + classServed.industrial * TARIFF_CLASS.industrial) * this.spotPrice * dtHours;

    // —— 碳配额交易：免费配额 = 送达电量 × 基准强度；超出买入、富余卖出（可为负=获利）——
    const allowanceRate = Math.max(0, aggServed - aggMarketImport) * this.benchmarkIntensity; // 免费配额仅按自有发电（不含进口）
    // 进口电力的碳关税（碳边境调节）：进口越多、碳价越高，成本越大
    const carbonBorderTax = aggMarketImport * IMPORT_CARBON_INTENSITY * this.carbonPrice * dtHours;
    const carbonCost = (co2Rate - allowanceRate) * this.carbonPrice * dtHours + carbonBorderTax;

    // —— 绿证：新能源发电量按绿证价获补贴收入 ——
    let renewMWh = 0;
    for (const g of this.grid.gens.values()) if (!g.dispatchable && !this.genOffline(g)) renewMWh += g.output * dtHours;
    const recIncome = renewMWh * this.recPrice;

    // —— 固定运维成本（仅已投运资产）——
    const omDayFrac = dtHours / 24;
    let omCost = 0;
    for (const g of this.grid.gens.values()) {
      if (!this.grid.buses.get(g.busId)?.underConstruction) omCost += PLANTS[g.type].omPerDay * (1 + this.wear(g) * WEAR_OM_FACTOR) * omDayFrac;
    }
    for (const bt of this.grid.batteries.values()) {
      if (!this.grid.buses.get(bt.busId)?.underConstruction) omCost += STORAGE[bt.type].omPerDay * omDayFrac;
    }
    for (const b of this.grid.buses.values()) {
      if (b.kind === 'substation' && !b.underConstruction) omCost += SUBSTATION_OM_PER_DAY * omDayFrac;
    }

    // —— 可中断负荷合同：到期失效；作为可信容量与运行备用资源参与 ——
    if (this.clock >= this.interruptibleEndClock) this.interruptibleMW = 0;
    const interMW = this.interruptibleMW;
    const interruptPremium = interMW * this.interruptiblePremiumRate * omDayFrac; // 季节性可用费

    // —— 容量补偿：按可用确定性容量获补偿（奖励保留备用）——
    let firmCapacity = interMW; // 可中断负荷=确定性可信容量
    for (const g of this.grid.gens.values()) {
      if (this.genOffline(g)) continue;
      firmCapacity += g.capacity * CAPACITY_CREDIT[g.type];
    }
    for (const b of this.grid.batteries.values()) {
      const bus = this.grid.buses.get(b.busId);
      if (bus && !bus.underConstruction) firmCapacity += b.powerRating * STORAGE[b.type].capacityCredit;
    }
    // 容量拍卖出清：区域容量目标 vs 总可用容量（你 + 竞争对手）
    let regionFirm = firmCapacity;
    for (const c of this.competitors) regionFirm += c.capacity;
    for (const m of this.mergedCapacity) regionFirm += m.mw;
    const capTarget = REGIONAL_BASE_DEMAND * (1 + RESERVE_REQUIREMENT) * this.cycleFactor * this.seasonDemandFactor;
    this.capacityAdequacy = regionFirm / Math.max(capTarget, 1);
    this.capacityPrice = CAPACITY_PRICE_BASE * clamp(1 + (CAP_ADEQ_REF - this.capacityAdequacy) * CAP_K, CAP_PRICE_MIN_FRAC, CAP_PRICE_MAX_FRAC);
    const capacityIncome = firmCapacity * this.capacityPrice * omDayFrac;

    // —— 辅助服务：快速资源(储能/燃气)提供调频，闲置可调容量提供运行备用 ——
    let regCap = 0, reserveCap = 0;
    for (const g of this.grid.gens.values()) {
      if (this.genOffline(g)) continue;
      if (g.type === 'gas') regCap += g.capacity * AS_GAS_REG_FACTOR;
      if (g.dispatchable) reserveCap += Math.max(0, g.capacity - g.output);
    }
    for (const b of this.grid.batteries.values()) {
      const bus = this.grid.buses.get(b.busId);
      if (bus && !bus.underConstruction) regCap += b.powerRating * this.tech.batteryPowerFactor;
    }
    // 辅助服务竞价出清：需求∝区域需求，供给含竞争对手快速/闲置容量
    const compCap = this.competitors.reduce((s, c) => s + c.capacity, 0);
    const regReq = this.regionalDemand * AS_REG_REQ_FRAC;
    const regSupply = regCap + compCap * AS_COMP_FAST_FRAC;
    this.regPrice = AS_REG_PRICE_BASE * clamp(1 + (AS_ADEQ_REF - regSupply / Math.max(regReq, 1)) * AS_K, AS_PRICE_MIN, AS_PRICE_MAX);
    // 新能源预测误差推高运行备用需求：按当前瞬时新能源出力占比放大（无新能源出力则不加）
    let renewOut = 0, totalOut = 0;
    for (const g of this.grid.gens.values()) {
      if (this.genOffline(g)) continue;
      totalOut += g.output;
      if (!g.dispatchable) renewOut += g.output;
    }
    this.renewablePenetration = totalOut > 0.5 ? clamp(renewOut / totalOut, 0, 1) : 0;
    this.reserveReqMult = 1 + RENEW_RESERVE_K * this.renewablePenetration;
    const reserveReq = this.regionalDemand * AS_RESERVE_REQ_FRAC * this.reserveReqMult;
    this.reserveRequirementMW = reserveReq;
    const reserveSupply = reserveCap + compCap * AS_COMP_RESERVE_FRAC;
    this.reservePrice = AS_RESERVE_PRICE_BASE * clamp(1 + (AS_ADEQ_REF - reserveSupply / Math.max(reserveReq, 1)) * AS_K, AS_PRICE_MIN, AS_PRICE_MAX);
    // —— 灵活性/爬坡市场：净负荷波动（∝新能源渗透率）越大越缺灵活资源；奖励燃气/储能等快速可调 ——
    let flexCap = 0; // 玩家快速可调能力 (MW)
    for (const g of this.grid.gens.values()) {
      if (this.genOffline(g)) continue;
      if (g.type === 'gas') flexCap += g.capacity;
    }
    for (const b of this.grid.batteries.values()) {
      const bus = this.grid.buses.get(b.busId);
      if (bus && !bus.underConstruction) flexCap += b.powerRating * this.tech.batteryPowerFactor;
    }
    const flexReq = this.regionalDemand * (FLEX_BASE_FRAC + FLEX_RENEW_FACTOR * this.renewablePenetration);
    this.flexRequirementMW = flexReq;
    const flexSupply = flexCap + compCap * FLEX_COMP_FRAC;
    this.flexPrice = FLEX_PRICE_BASE * clamp(1 + (FLEX_ADEQ_REF - flexSupply / Math.max(flexReq, 1)) * FLEX_K, FLEX_PRICE_MIN, FLEX_PRICE_MAX);
    const ancillaryIncome = (regCap * this.regPrice + reserveCap * this.reservePrice + flexCap * this.flexPrice) * omDayFrac;

    // —— 远期容量结算：差价合约(锁价−现货) − 欠交付罚款 ——
    this.capCommitments = this.capCommitments.filter((c) => this.clock < c.endClock);
    let forwardCapCash = 0;
    for (const c of this.capCommitments) {
      forwardCapCash += (c.price - this.capacityPrice) * c.mw * omDayFrac;
      forwardCapCash -= Math.max(0, c.mw - firmCapacity) * CAP_DELIVERY_PENALTY * omDayFrac;
    }

    // —— 需求响应激励：付费换取尖峰削减 ——
    const drCost = this.drCurtailedMW * DR_INCENTIVE * dtHours + interruptPremium;

    // —— 输电阻塞成本：线路超过阈值负载率即计费 ——
    let congestionCost = 0;
    for (const ln of this.grid.lines.values()) {
      if (!this.grid.lineActive(ln)) continue;
      const over = Math.abs(ln.flow) - ln.capacity * CONGESTION_THRESHOLD;
      if (over > 0) congestionCost += over * CONGESTION_PRICE * dtHours;
    }

    // —— 贷款利息 + 保险费 + 市场购电/联络线费 ——
    const interestCost = this.debt * this.loanDailyRate * omDayFrac;
    const premiumCost = this.insurancePremiumPerDay * omDayFrac;
    this.marketImportMW = aggMarketImport;
    const importCost = aggMarketImport * this.avgSpot * IMPORT_MARKUP * dtHours;
    // 外送：被弃的过剩（清洁）电量按出清价卖入批发市场（受联络线容量与过网折扣限制）
    this.marketExportMW = this.marketEnabled ? Math.min(aggCurtailed, INTERCONNECTOR_CAPACITY) : 0;
    const exportIncome = this.marketExportMW * this.marketClearingPrice * EXPORT_WHEEL * dtHours;
    // 跨区套利：买便宜区、卖昂贵区，赚价差减过网费（受交易容量限制）
    const arbProfit = Math.max(0, this.zoneSpread - ZONE_WHEEL_FEE);
    this.zoneArbMW = this.marketEnabled && arbProfit > 0 ? ZONE_TRADE_CAPACITY : 0;
    const arbIncome = this.zoneArbMW * arbProfit * dtHours;
    // 输电权：金融合约，收取实际南北价差（不依赖物理接入）
    this.ftrs = this.ftrs.filter((f) => this.clock < f.endClock);
    let ftrIncome = 0;
    for (const f of this.ftrs) ftrIncome += (this.zoneSouthPrice - this.zoneNorthPrice) * f.mw * dtHours;
    // 并购商船队在批发市场获取价差利润（成本低于出清价的部分）
    let merchantCash = 0;
    for (const m of this.mergedCapacity) {
      if (m.marginalCost < this.marketClearingPrice) merchantCash += m.mw * (this.marketClearingPrice - m.marginalCost) * dtHours;
    }
    const marketFee = this.marketEnabled ? MARKET_FEE_PER_DAY * omDayFrac : 0;
    const revEff = revenue * this.reputationTariffFactor; // 口碑调整后的售电收入

    // —— 结算（扣除各项成本，加套保差价/绿证/容量补偿）——
    this.money += revEff - fuelCost - carbonCost - penalty - omCost - interestCost - premiumCost - importCost - marketFee - congestionCost - drCost - startupCostAgg + hedgeIncome + recIncome + capacityIncome + exportIncome + ancillaryIncome + forwardCapCash + arbIncome + ftrIncome + merchantCash + storageArbCash;

    // —— 现金流按日估算（EMA 平滑，供财务报表）——
    const toDay = dtHours > 0 ? 24 / dtHours : 0;
    const aF = clamp(dtHours / 3, 0, 1);
    const ema = (cur: number, val: number) => cur * (1 - aF) + val * aF;
    this.finance.revenue = ema(this.finance.revenue, revEff * toDay);
    this.finance.fuel = ema(this.finance.fuel, fuelCost * toDay);
    this.finance.carbon = ema(this.finance.carbon, carbonCost * toDay);
    this.finance.om = ema(this.finance.om, omCost * toDay);
    this.finance.interest = ema(this.finance.interest, interestCost * toDay);
    this.finance.penalty = ema(this.finance.penalty, penalty * toDay);
    this.finance.hedge = ema(this.finance.hedge, hedgeIncome * toDay);
    this.finance.rec = ema(this.finance.rec, recIncome * toDay);
    this.finance.insurance = ema(this.finance.insurance, (this.claimCoveredTick - premiumCost) * toDay);
    this.finance.market = ema(this.finance.market, (exportIncome + arbIncome + ftrIncome + merchantCash + storageArbCash - importCost - marketFee) * toDay);
    this.storageArbDay = ema(this.storageArbDay, storageArbCash * toDay);
    this.finance.capacity = ema(this.finance.capacity, (capacityIncome + forwardCapCash) * toDay);
    this.finance.ancillary = ema(this.finance.ancillary, ancillaryIncome * toDay);
    this.finance.congestion = ema(this.finance.congestion, -congestionCost * toDay);
    this.finance.dr = ema(this.finance.dr, -drCost * toDay);
    this.finance.startup = ema(this.finance.startup, -startupCostAgg * toDay);
    const repF = this.reputationTariffFactor;
    for (const cls of ['residential', 'commercial', 'industrial'] as LoadProfile[]) {
      const r = classServed[cls] * TARIFF_CLASS[cls] * this.spotPrice * repF;
      this.finance.byClass[cls] = ema(this.finance.byClass[cls], r * 24); // ¥/天
    }
    this.finance.net = this.finance.revenue - this.finance.fuel - this.finance.carbon
      - this.finance.om - this.finance.interest - this.finance.penalty
      + this.finance.hedge + this.finance.rec + this.finance.insurance + this.finance.market + this.finance.capacity + this.finance.congestion + this.finance.dr + this.finance.ancillary + this.finance.startup;
    this.frequency = mainFreq;
    this.totalGen = aggGen;
    this.totalDemand = aggDemand;
    this.totalServed = aggServed;
    this.totalLoss = aggLoss;
    this.co2Rate = co2Rate;
    this.startupsTotal = [...this.grid.gens.values()].reduce((s, g) => s + (g.startups ?? 0), 0);
    this.lastLossFraction = aggDemand > 1 ? clamp(aggLoss / aggDemand, 0, MAX_LOSS_FRACTION) : 0.02;

    // 研发点：随送达电量积累（电网越大、运行越好，研发越快）
    this.tech.points += aggServed * dtHours * RP_PER_MWH;
    this.peakServed = Math.max(this.peakServed, aggServed);
    this.totalEnergyServed += aggServed * dtHours;
    this.outageEnergyTotal += Math.max(0, aggDemand - aggServed) * dtHours;

    // 可靠性滑动平均（EMA）
    const instReliab = aggDemand > 0.5 ? aggServed / aggDemand : 1;
    const a = clamp(dtHours / 6, 0, 1); // 约 6 小时时间常数
    this.reliability = this.reliability * (1 - a) + instReliab * a;

    this.updateReputation(aggGen, aggServed, aggDemand, co2Rate, dtHours);

    // —— 历史走势采样 ——
    if (this.clock >= this.nextSampleAt) {
      this.history.push({ clock: this.clock, spot: this.spotPrice, netWorth: this.netWorth, demand: this.totalDemand });
      if (this.history.length > HISTORY_MAX) this.history.shift();
      this.nextSampleAt = this.clock + HISTORY_SAMPLE_HOURS;
    }

    this.checkEndConditions();
  }

  /** 对单个孤岛执行调度 + 平衡 + 直流潮流，返回聚合量 */
  private solveIsland(busIds: number[], dtSim: number): IslandResult {
    const dtHours = dtSim / 3600;
    const set = new Set(busIds);
    const uc = (busId: number) => this.grid.buses.get(busId)?.underConstruction === true; // 在建中不参与运行
    const gens = [...this.grid.gens.values()].filter((g) => set.has(g.busId) && !this.genOffline(g));
    const loads = [...this.grid.loads.values()].filter((l) => set.has(l.busId));
    const demand = loads.reduce((s, l) => s + l.demand, 0);

    // 新能源可用出力（必发）
    const availMax = new Map<number, number>();
    let renewAvail = 0;
    for (const g of gens) {
      if (!g.dispatchable) {
        const m = g.capacity * g.availability;
        availMax.set(g.id, m);
        renewAvail += m;
      }
    }

    // 目标出力 = 需求 ×(1+线损占比)，先扣掉新能源必发
    const target = demand * (1 + this.lastLossFraction);
    let remaining = Math.max(0, target - renewAvail);

    // 可调机组：仅"已并网 或 离线但已过最小停机锁"的机组可参与出清（merit order）
    const disp = gens.filter((g) => g.dispatchable);
    const merit = disp.filter((g) => g.committed || this.clock >= (g.commitLockUntil ?? 0))
      .sort((x, y) => this.effMarginalCost(x) - this.effMarginalCost(y));
    const desired = new Map<number, number>();
    let rem = remaining;
    for (const g of merit) {
      const give = clamp(rem, 0, g.capacity);
      desired.set(g.id, give);
      rem -= give;
    }
    // —— 机组组合：最小开/停机约束 + 冷启动成本 ——
    let startupCost = 0;
    for (const g of disp) {
      const sel = (desired.get(g.id) ?? 0) > 0.5;
      const spec = PLANTS[g.type];
      if (g.committed) {
        if (sel) {
          desired.set(g.id, Math.max(desired.get(g.id) ?? 0, g.pmin)); // 在线机组至少 pmin
        } else if (this.clock < (g.commitLockUntil ?? 0)) {
          desired.set(g.id, g.pmin); // 最小开机锁内：必须维持 pmin（must-run）
        } else {
          g.committed = false; // 解列，进入最小停机锁
          g.commitLockUntil = this.clock + spec.minDownHours; // clock 与 minDownHours 同为"小时"
          desired.set(g.id, 0);
        }
      } else if (sel) {
        g.committed = true; // 冷启动并网，进入最小开机锁
        g.commitLockUntil = this.clock + spec.minUpHours; // clock 与 minUpHours 同为"小时"
        g.startups = (g.startups ?? 0) + 1;
        startupCost += spec.startupCost;
        desired.set(g.id, Math.max(desired.get(g.id) ?? 0, g.pmin));
      } else {
        desired.set(g.id, 0); // 停机锁内或不需要
      }
    }
    // 按爬坡率把实际出力向期望值移动（这就是"机组无法瞬时响应"的硬核张力来源）
    for (const g of disp) {
      const want = desired.get(g.id) ?? 0;
      const step = g.rampRate * dtSim;
      if (g.output < want) g.output = Math.min(want, g.output + step);
      else g.output = Math.max(want, g.output - step);
      g.output = clamp(g.output, 0, g.capacity);
    }
    // 新能源先按可用出力发满
    for (const g of gens) if (!g.dispatchable) g.output = availMax.get(g.id) ?? 0;
    let genBase = gens.reduce((s, g) => s + g.output, 0);

    // —— 储能调度：缺电则放电补缺口，过剩则充电吸收 ——
    const batteries = [...this.grid.batteries.values()].filter((b) => set.has(b.busId) && !uc(b.busId));
    for (const b of batteries) b.output = 0;
    const net = demand - genBase; // >0 缺口；<0 过剩
    const batPowerFactor = this.tech.batteryPowerFactor; // 先进储能科技
    if (net > 0.01) {
      let need = net;
      for (const b of [...batteries].sort((x, y) => y.soc - x.soc)) {
        const power = b.powerRating * batPowerFactor;
        const avail = Math.min(power, b.soc / Math.max(dtHours, 1e-6));
        const give = clamp(need, 0, avail);
        b.output = give;
        b.soc = Math.max(0, b.soc - give * dtHours);
        need -= give;
      }
    } else if (net < -0.01) {
      let surplus = -net;
      for (const b of [...batteries].sort((x, y) => x.soc - y.soc)) {
        const power = b.powerRating * batPowerFactor;
        const rt = Math.min(0.98, b.roundTrip + this.tech.batteryRoundTripBonus);
        const room = (b.energyCapacity - b.soc) / Math.max(dtHours * rt, 1e-6);
        const take = clamp(surplus, 0, Math.min(power, room));
        b.output = -take;
        b.soc = Math.min(b.energyCapacity, b.soc + take * rt * dtHours);
        surplus -= take;
      }
    }
    const dischargeSum = batteries.reduce((s, b) => s + Math.max(0, b.output), 0);
    const chargeSum = batteries.reduce((s, b) => s + Math.max(0, -b.output), 0);

    // 仍有过剩（充电也吸收不完）则弃风弃光，保持系统平衡（被弃的可外送市场）
    let supply = genBase + dischargeSum;
    const consumption = demand + chargeSum;
    let curtailed = 0;
    if (supply > consumption + 0.01) {
      const excess = supply - consumption;
      const renew = gens.filter((g) => !g.dispatchable && g.output > 0);
      const renewTotal = renew.reduce((s, g) => s + g.output, 0);
      if (renewTotal > 0) {
        const scale = Math.max(0, (renewTotal - excess) / renewTotal);
        for (const g of renew) g.output *= scale;
        curtailed = renewTotal - renew.reduce((s, g) => s + g.output, 0);
      }
      genBase = gens.reduce((s, g) => s + g.output, 0);
      supply = genBase + dischargeSum;
    }

    const totalGen = supply; // 含储能放电的总电源
    const localServed = Math.min(demand, supply - chargeSum); // 本地电源可供
    // 不足部分向批发市场购电补缺（受联络线容量限制）
    let marketImport = 0;
    if (this.marketEnabled && localServed < demand - 0.01) {
      marketImport = Math.min(demand - localServed, INTERCONNECTOR_CAPACITY);
    }
    const served = localServed + marketImport;
    const ratio = demand > 0 ? served / demand : 1;
    const islandDead = supply < 0.01 && marketImport < 0.01 && demand > 0.01;

    // 频率：购电也提供功率支撑，纳入平衡
    const freq = freqFromBalance(supply + marketImport, consumption);
    const shedding = freq < FREQ_SHED_THRESHOLD || islandDead;

    // —— 黑启动与停电恢复：仅对"已建有电源"的孤岛适用（区分故障全黑 vs 绿地待接入）——
    // 全黑时能量化骤降；恢复速率取决于岛内是否有黑启动资源（燃气/储能）。
    let hasBuiltGen = false;
    for (const id of busIds) {
      const b = this.grid.buses.get(id);
      if (b && (b.kind === 'plant' || b.kind === 'storage') && !b.underConstruction) { hasBuiltGen = true; break; }
    }
    if (hasBuiltGen) {
      const supplying = supply > 0.01;
      let hasBlackStart = false;
      for (const g of gens) if (BLACKSTART_TYPES[g.type]) { hasBlackStart = true; break; }
      if (!hasBlackStart) for (const b of batteries) if (b.soc > 1) { hasBlackStart = true; break; }
      for (const id of busIds) {
        const b = this.grid.buses.get(id);
        if (!b) continue;
        const cur = b.energized ?? 1;
        const target = supplying ? 1 : 0;
        const rate = target < cur ? BLACKOUT_DROP_RATE : (hasBlackStart ? RESTORE_FAST_RATE : RESTORE_SLOW_RATE);
        b.energized = clamp(cur + Math.sign(target - cur) * rate * dtHours, 0, 1);
      }
    }

    // 分配实际供电到各负荷（受供需比 × 恢复程度限制），并标记停电
    let servedDelivered = 0;
    for (const l of loads) {
      const bus = this.grid.buses.get(l.busId);
      const ez = bus?.energized ?? 1;
      l.served = l.demand * ratio * ez;
      servedDelivered += l.served;
      if (bus) bus.blackout = ratio * ez < 0.999;
    }
    if (islandDead) for (const id of busIds) { const b = this.grid.buses.get(id); if (b) b.blackout = true; }
    if (shedding && !islandDead && ratio < 0.95) {
      // 仅在明显甩负荷时记一条告警（避免刷屏）
      if (Math.random() < 0.02) this.log('warn', `频率 ${freq.toFixed(2)}Hz 偏低，发生甩负荷`);
    }

    // —— 直流潮流 ——
    const injection = new Map<number, number>();
    for (const id of busIds) injection.set(id, 0);
    for (const g of gens) injection.set(g.busId, (injection.get(g.busId) ?? 0) + g.output);
    for (const b of batteries) injection.set(b.busId, (injection.get(b.busId) ?? 0) + b.output); // 放电+ / 充电-
    // 购电视为在负荷处就地注入，仅本地发电的部分经网络流动
    const localFraction = served > 0 ? (served - marketImport) / served : 1;
    for (const l of loads) injection.set(l.busId, (injection.get(l.busId) ?? 0) - l.served * localFraction);

    const islandLines = [...this.grid.lines.values()].filter(
      (ln) => this.grid.lineActive(ln) && set.has(ln.from) && set.has(ln.to),
    );
    const { flows } = solveDC(busIds, islandLines, injection);

    let lossSum = 0;
    for (const ln of islandLines) {
      const f = flows.get(ln.id) ?? 0;
      ln.flow = f;
      // 线损按电压等级：HV 远小于 MV（这正是要升压输电的原因）；超高压科技进一步降低 HV 线损
      const lossScale = VOLTAGE[ln.voltage].lossScale * (ln.voltage === 'HV' ? this.tech.hvLossFactor : 1);
      const loss = Math.min(Math.abs(f) * MAX_LOSS_FRACTION, ln.resistance * f * f * lossScale);
      ln.loss = loss;
      lossSum += loss;
      // 累计变电站变压器通过量（只有 MV 配电线经过变压器降压）
      if (ln.voltage === 'MV') {
        const sub = this.grid.substationOf(ln);
        if (sub) sub.throughput = (sub.throughput ?? 0) + Math.abs(f);
      }
    }

    // —— 无功/电压：按孤岛无功平衡近似推算电压（pu）；欠压增大线损 ——
    let qDemand = 0;
    for (const l of loads) qDemand += l.served * LOAD_PF_TAN; // 负荷无功
    for (const ln of islandLines) qDemand += ln.flow * ln.flow * ln.reactance * LINE_Q_PER_FLOW2; // 线路无功消耗（长重线压降）
    let qSupply = 0;
    for (const g of gens) qSupply += g.capacity * GEN_Q_FACTOR; // 在线机组无功能力
    for (const b of batteries) qSupply += b.powerRating * STORAGE_Q_FACTOR; // 储能逆变器
    for (const id of busIds) {
      const b = this.grid.buses.get(id);
      if (b?.capacitor && !b.underConstruction) qSupply += CAPACITOR_Q; // 电容器组补偿
    }
    const qMargin = qDemand > 0.1 ? qSupply / qDemand : 2;
    const voltage = clamp(qMargin >= 1 ? 1 : 1 - VOLT_SAG_K * (1 - qMargin), VOLT_MIN, 1);
    for (const id of busIds) { const b = this.grid.buses.get(id); if (b) b.voltage = voltage; }
    lossSum *= 1 + VOLT_LOSS_K * Math.max(0, VOLT_LOW - voltage); // 欠压→大电流→线损上升

    // 经济量（燃料价格 × 高效机组科技；碳排单列）
    let fuelCost = 0, co2 = 0;
    for (const g of gens) {
      fuelCost += g.output * this.effMarginalCost(g) * dtHours;
      co2 += g.output * this.effCo2(g);
    }

    return { gen: totalGen, demand, served: servedDelivered, loss: lossSum, fuelCost, co2, marketImport, curtailed, startupCost, voltage };
  }

  /** 更新公众形象与清洁电力占比 */
  private updateReputation(aggGen: number, aggServed: number, aggDemand: number, co2Rate: number, dtHours: number): void {
    // 清洁电力占比 = (新能源出力 + 储能放电) / 总电源
    let cleanGen = 0;
    for (const g of this.grid.gens.values()) if (!g.dispatchable) cleanGen += g.output;
    for (const b of this.grid.batteries.values()) cleanGen += Math.max(0, b.output);
    const instClean = aggGen > 0.5 ? clamp(cleanGen / aggGen, 0, 1) : this.renewableShare;
    const aClean = clamp(dtHours / 6, 0, 1);
    this.renewableShare = this.renewableShare * (1 - aClean) + instClean * aClean;

    // 影响口碑的三个压力：停电、碳强度、临近居民的火电污染
    const unservedFrac = aggDemand > 0.5 ? clamp((aggDemand - aggServed) / aggDemand, 0, 1) : 0;
    const carbonIntensity = aggServed > 0.5 ? co2Rate / aggServed : 0; // 吨/MWh
    let dirtyNear = 0;
    for (const g of this.grid.gens.values()) {
      if (g.dispatchable && g.output > 0 && PLANTS[g.type].co2 > 0) {
        const pb = this.grid.buses.get(g.busId);
        if (pb && this.hasNearbyLoad(pb.x, pb.y)) dirtyNear += g.output;
      }
    }
    const pollution = aggServed > 0.5 ? clamp(dirtyNear / aggServed, 0, 1) : 0;

    const target = clamp(
      100 - unservedFrac * REP_UNSERVED_WEIGHT - carbonIntensity * REP_CARBON_WEIGHT - pollution * REP_POLLUTION_WEIGHT,
      0, 100,
    );
    const aRep = clamp(dtHours / REP_TIME_CONSTANT, 0, 1);
    this.reputation = this.reputation * (1 - aRep) + target * aRep;
  }

  private hasNearbyLoad(x: number, y: number): boolean {
    for (const l of this.grid.loads.values()) {
      const lb = this.grid.buses.get(l.busId);
      if (lb && Math.hypot(lb.x - x, lb.y - y) < POLLUTION_RADIUS) return true;
    }
    return false;
  }

  /** 电网是否具备黑启动能力（有可用燃气机组或有电量的储能作种子） */
  get blackStartCapable(): boolean {
    for (const g of this.grid.gens.values()) {
      const bus = this.grid.buses.get(g.busId);
      if (bus && !bus.underConstruction && BLACKSTART_TYPES[g.type] && !this.genOffline(g)) return true;
    }
    for (const b of this.grid.batteries.values()) {
      const bus = this.grid.buses.get(b.busId);
      if (bus && !bus.underConstruction && b.soc > 1) return true;
    }
    return false;
  }

  /** 全网负荷加权的能量化程度（0..1）：<1 表示正处于停电恢复中 */
  get gridEnergized(): number {
    let sum = 0, w = 0;
    for (const l of this.grid.loads.values()) {
      const b = this.grid.buses.get(l.busId);
      sum += (b?.energized ?? 1) * l.demand;
      w += l.demand;
    }
    return w > 0 ? sum / w : 1;
  }

  /**
   * 关卡综合评分（0..100）与星级（S/A/B/C/D）：可靠性 + 财务 + 清洁占比 + 口碑加权。
   * 纯分析，可随时调用（HUD/通关界面展示）。
   */
  gradeScore(): { score: number; grade: string; parts: { reliability: number; finance: number; clean: number; reputation: number } } {
    const reliability = clamp((this.reliability - 0.85) / 0.15, 0, 1); // 0.85→0, 1.0→1
    const finance = clamp(this.netWorth / GRADE_NETWORTH_REF, 0, 1);
    const clean = clamp(this.renewableShare, 0, 1);
    const reputation = clamp(this.reputation / 100, 0, 1);
    const score = (reliability * GRADE_W_RELIABILITY + finance * GRADE_W_FINANCE + clean * GRADE_W_CLEAN + reputation * GRADE_W_REPUTATION) * 100;
    const grade = score >= 90 ? 'S' : score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 45 ? 'C' : 'D';
    return { score, grade, parts: { reliability: reliability * 100, finance: finance * 100, clean: clean * 100, reputation: reputation * 100 } };
  }

  private checkEndConditions(): void {
    if (this.gameOver || this.sandbox) return; // 沙盒模式没有输赢
    if (this.money < 0) {
      this.gameOver = true;
      this.win = false;
      this.log('bad', '💸 资金耗尽，电力公司破产了。');
      return;
    }
    if (this.day >= this.goalDay && this.reliability >= this.goalReliability) {
      this.gameOver = true;
      this.win = true;
      this.log('good', '🏆 达成关卡目标，灯火通明，你赢了！');
    }
  }

  /**
   * 长期规划压力测试（IRP）：在当前机队上跑一组 what-if 情景，
   * 评估各情景下的容量充裕度（备用率）与经济韧性（粗估日净现金流）。
   * 纯分析，不改动任何仿真状态。
   */
  /** 某类负荷的日内峰值乘子（采样日曲线取最大） */
  private dayPeakMultiplier(profile: LoadProfile): number {
    let mx = 0;
    for (let h = 0; h < 24; h++) mx = Math.max(mx, demandMultiplier(h, profile));
    return mx;
  }

  /** 本公司可信容量（可调机组 + 储能信用 + 新能源极低尖峰信用）MW */
  private ownFirmCapacity(): number {
    let firm = 0;
    for (const g of this.grid.gens.values()) {
      if (this.genOffline(g)) continue;
      const credit = g.dispatchable ? CAPACITY_CREDIT[g.type] : (g.type === 'solar' ? IRP_SOLAR_PEAK_CREDIT : IRP_WIND_PEAK_CREDIT);
      firm += g.capacity * credit;
    }
    for (const b of this.grid.batteries.values()) {
      const bus = this.grid.buses.get(b.busId);
      if (bus && !bus.underConstruction) firm += b.powerRating * STORAGE[b.type].capacityCredit;
    }
    return firm;
  }

  /** 当前季节下，本公司可信容量对自有峰值负荷的充裕度 */
  seasonalPeakAdequacy(): { firm: number; peak: number; margin: number } {
    const firm = this.ownFirmCapacity();
    let peak = 0;
    for (const load of this.grid.loads.values()) peak += load.baseDemand * this.dayPeakMultiplier(load.profile);
    peak *= this.seasonDemandFactor; // 当前季节峰
    const margin = peak > 0 ? firm / peak - 1 : (firm > 0 ? 1 : 0);
    return { firm, peak, margin };
  }

  /** 迎峰预警：进入夏/冬旺季时（季节边沿）校核充裕度并提示 */
  private checkSeasonAlert(): void {
    const season = this.seasonLabel;
    if (season === this.lastSeason) return;
    this.lastSeason = season;
    if ((season !== '夏' && season !== '冬') || this.grid.loads.size === 0) return;
    const a = this.seasonalPeakAdequacy();
    if (a.peak <= 0) return;
    const name = season === '夏' ? '迎峰度夏' : '迎峰度冬';
    if (a.margin < SEASON_ADEQ_MARGIN) {
      this.log('warn', `⚠ ${name}：可信容量 ${a.firm.toFixed(0)}MW vs 季节峰值 ${a.peak.toFixed(0)}MW（备用 ${(a.margin * 100).toFixed(0)}%），及时补强/购电避免缺供`);
    } else {
      this.log('good', `${name}：可信容量充裕（备用 ${(a.margin * 100).toFixed(0)}%）`);
    }
  }

  stressTest(scenarios: StressScenarioSpec[] = IRP_SCENARIOS): StressResult[] {
    // 基础夏季晚峰需求（剔除当前季节/景气，取纯峰）
    let basePeak = 0;
    for (const load of this.grid.loads.values()) basePeak += load.baseDemand * this.dayPeakMultiplier(load.profile);
    basePeak *= IRP_SUMMER_PEAK;

    const gens = [...this.grid.gens.values()];
    const disp = gens.filter((g) => g.dispatchable);
    const renew = gens.filter((g) => !g.dispatchable);
    const dispFirm = disp.reduce((s, g) => s + g.capacity * CAPACITY_CREDIT[g.type], 0);
    const storageFirm = [...this.grid.batteries.values()].reduce((s, b) => s + b.powerRating * STORAGE[b.type].capacityCredit, 0);
    const dispOrder = disp.slice().sort((a, b) => this.effMarginalCost(a) - this.effMarginalCost(b));

    return scenarios.map((sc) => {
      const peak = basePeak * sc.demandGrowth;
      const renewFirm = renew.reduce((s, g) => {
        const credit = g.type === 'solar' ? IRP_SOLAR_PEAK_CREDIT : IRP_WIND_PEAK_CREDIT;
        return s + g.capacity * credit * sc.renewDerate;
      }, 0);
      const firm = dispFirm + storageFirm + renewFirm;
      const margin = peak > 0 ? firm / peak - 1 : (firm > 0 ? 1 : 0);
      const verdict: StressResult['verdict'] = margin < 0 ? 'shortfall' : margin < IRP_TIGHT_MARGIN ? 'tight' : 'adequate';

      // —— 经济韧性（粗估）——
      const potentialAvg = peak * IRP_LOAD_FACTOR; // 期望平均负荷
      // 新能源先供（按平均容量因子 × 折减）
      const renewAvg = renew.reduce((s, g) => s + g.capacity * IRP_RENEW_CF * sc.renewDerate, 0);
      const renewServed = Math.min(potentialAvg, renewAvg);
      let residual = Math.max(0, potentialAvg - renewServed);
      let fuelCost = 0, carbonCost = 0, dispServed = 0;
      for (const g of dispOrder) {
        if (residual <= 1e-9) break;
        const take = Math.min(g.capacity, residual);
        residual -= take;
        dispServed += take;
        fuelCost += take * 24 * this.effMarginalCost(g) * sc.fuelMult;
        carbonCost += take * 24 * this.effCo2(g) * this.carbonPrice * sc.carbonMult;
      }
      const served = renewServed + dispServed;
      const unserved = Math.max(0, potentialAvg - served);
      const revenue = served * 24 * TARIFF; // 用固定电价保持情景间可比
      const penalty = unserved * 24 * UNSERVED_PENALTY;
      const dailyNet = revenue - fuelCost - carbonCost - penalty;

      return { id: sc.id, name: sc.name, peakDemand: peak, firmSupply: firm, reserveMargin: margin, verdict, dailyNet };
    });
  }

  /**
   * 扩容投资建议（IRP）：在压力测试基础上，给出补强约束情景缺口的最低成本方案，
   * 并按基准需求增长推算「赤字日」与「建议开工日」（须扣除工期前置时间）。纯分析。
   */
  recommendExpansion(scenarios: StressScenarioSpec[] = IRP_SCENARIOS): ExpansionAdvice {
    const results = this.stressTest(scenarios);
    const binding = results.reduce((a, b) => (b.reserveMargin < a.reserveMargin ? b : a));
    const gap = binding.reserveMargin < 0 ? -binding.reserveMargin * binding.peakDemand : 0;

    // 候选补强：可调机组 + 储能，按"每可信 MW 造价"择优
    type Cand = { label: string; firmPerUnit: number; capexPerUnit: number; buildDays: number };
    const cands: Cand[] = [];
    for (const [t, s] of Object.entries(PLANTS)) {
      if (!s.dispatchable) continue;
      const firm = s.capacity * (CAPACITY_CREDIT as Record<string, number>)[t];
      if (firm > 0) cands.push({ label: s.label, firmPerUnit: firm, capexPerUnit: s.capex, buildDays: s.buildDays });
    }
    for (const s of Object.values(STORAGE)) {
      const firm = s.powerRating * s.capacityCredit;
      if (firm > 0) cands.push({ label: s.label, firmPerUnit: firm, capexPerUnit: s.capex, buildDays: s.buildDays });
    }
    cands.sort((a, b) => a.capexPerUnit / a.firmPerUnit - b.capexPerUnit / b.firmPerUnit);
    const best = cands[0];

    // 基准增长下备用率跌破 0 的赤字日
    let wsum = 0, gsum = 0;
    for (const load of this.grid.loads.values()) { wsum += load.baseDemand; gsum += load.baseDemand * load.growthPerHour; }
    const ghHour = wsum > 0 ? gsum / wsum : 0;
    const dgDay = Math.pow(1 + ghHour, 24) - 1;
    const base = results.find((r) => r.id === 'base')!;
    let deficitDay = Infinity;
    if (base.peakDemand > 0 && base.firmSupply <= base.peakDemand) deficitDay = this.day;
    else if (base.peakDemand > 0 && dgDay > 1e-9) deficitDay = this.day + Math.log(base.firmSupply / base.peakDemand) / Math.log(1 + dgDay);

    let option: ExpansionAdvice['option'] = null;
    if (gap > 0 && best) {
      const units = Math.ceil(gap / best.firmPerUnit);
      const anchor = Number.isFinite(deficitDay) ? deficitDay : this.day;
      option = {
        label: best.label,
        units,
        firmPerUnit: best.firmPerUnit,
        capex: units * best.capexPerUnit,
        buildDays: best.buildDays,
        startByDay: anchor - best.buildDays,
      };
    }
    return { gapMW: gap, bindingScenario: binding.name, deficitDay, curDay: this.day, option };
  }

  /**
   * 多年滚动规划轨迹（IRP）：在"不新建"基线下，按基准需求增长逐年推算夏季晚峰
   * 与备用率，直观展示充裕度如何被增长侵蚀、缺口首次出现在第几年。纯分析。
   */
  planningTrajectory(years = 6, scenarioId = 'base'): YearPlan[] {
    const results = this.stressTest();
    const sc = results.find((r) => r.id === scenarioId) ?? results[0];
    const firm = sc.firmSupply;
    const peak0 = sc.peakDemand;
    let wsum = 0, gsum = 0;
    for (const load of this.grid.loads.values()) { wsum += load.baseDemand; gsum += load.baseDemand * load.growthPerHour; }
    const ghHour = wsum > 0 ? gsum / wsum : 0;
    const yearFactor = Math.pow(1 + ghHour, 24 * SEASON_YEAR_DAYS); // 一年的复合增长
    const plans: YearPlan[] = [];
    for (let y = 0; y <= years; y++) {
      const peak = peak0 * Math.pow(yearFactor, y);
      const margin = peak > 0 ? firm / peak - 1 : (firm > 0 ? 1 : 0);
      const verdict: YearPlan['verdict'] = margin < 0 ? 'shortfall' : margin < IRP_TIGHT_MARGIN ? 'tight' : 'adequate';
      plans.push({ year: y, peakDemand: peak, firmSupply: firm, reserveMargin: margin, verdict });
    }
    return plans;
  }

  snapshot(): SimSnapshot {
    const grade = this.gradeScore();
    return {
      clock: this.clock,
      day: this.day,
      hourOfDay: this.hourOfDay,
      money: this.money,
      frequency: this.frequency,
      totalGen: this.totalGen,
      totalDemand: this.totalDemand,
      totalServed: this.totalServed,
      totalLoss: this.totalLoss,
      co2: this.co2Rate,
      reliability: this.reliability,
      weather: this.events.label,
      demandFactor: this.events.demandFactor,
      goalDay: this.goalDay,
      goalReliability: this.goalReliability,
      researchPoints: this.tech.points,
      reputation: this.reputation,
      renewableShare: this.renewableShare,
      cycle: this.cycleLabel,
      cycleFactor: this.cycleFactor,
      season: this.seasonLabel,
      seasonFactor: this.seasonDemandFactor,
      committedUnits: [...this.grid.gens.values()].filter((g) => g.dispatchable && g.committed).length,
      dispatchableUnits: [...this.grid.gens.values()].filter((g) => g.dispatchable && !this.grid.buses.get(g.busId)?.underConstruction).length,
      startupsTotal: this.startupsTotal,
      marketShare: this.marketShare,
      marketClearingPrice: this.marketClearingPrice,
      regionalDemand: this.regionalDemand,
      spotPrice: this.spotPrice,
      reserveMargin: this.reserveMargin,
      fuelPrice: { ...this.fuelPrice },
      debt: this.debt,
      creditLimit: this.creditLimit,
      netWorth: this.netWorth,
      assetValue: this.assetValue,
      sandbox: this.sandbox,
      gameOver: this.gameOver,
      win: this.win,
      grade: grade.grade,
      gradeScore: grade.score,
      blackStartCapable: this.blackStartCapable,
      gridEnergized: this.gridEnergized,
      outageEnergyTotal: this.outageEnergyTotal,
      voltage: this.voltage,
    };
  }
}

/** 由供需失衡推算系统频率 */
function freqFromBalance(gen: number, demand: number): number {
  if (demand <= 0.01) return FREQ_NOMINAL;
  const imbalance = (gen - demand) / demand;
  return clamp(FREQ_NOMINAL + FREQ_DROOP * imbalance, 46, 52);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
