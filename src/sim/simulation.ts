// 仿真主循环：把"调度 → 潮流 → 频率 → 跳闸 → 经济"串成一个 tick。
// 这是一个纯逻辑对象，不知道任何关于渲染的事；前端每帧调用 tick() 并读取快照。
import type { SimSnapshot, LogEntry } from './types';
import { Grid, type GridData } from './grid';
import { solveDC } from './powerflow';
import { EventSystem } from './events';
import { TechState } from './tech';
import { RP_PER_MWH, TECH_FX, type TechId } from '../config/tech';
import { demandMultiplier, renewableAvailability } from './profiles';
import {
  PLANTS, VOLTAGE, BATTERY, SUBSTATION_CAPEX, SUBSTATION_OM_PER_DAY,
  PLANT_FUEL, FUEL_INFO, FUEL_MEAN_REVERT, FUEL_MIN, FUEL_MAX, FUEL_SHOCK_CHANCE_PER_DAY, FUEL_CONTRACT_PREMIUM, type FuelType,
  LOAN_BASE_CREDIT, LOAN_CREDIT_ASSET_FRAC, LOAN_BASE_DAILY_RATE,
  RATING_RATE_SPAN, RATING_REF_NETWORTH, RATING_REF_PROFIT,
  WEAR_FULL_DAYS, WEAR_COST_FACTOR, WEAR_OM_FACTOR, FAIL_BASE_HAZARD, REPAIR_DAYS,
  REPAIR_COST_FRACTION, SALVAGE_FRACTION, DEPREC_DAYS,
  MAINT_DAYS, MAINT_COST_FRACTION, MAINT_AGE_REDUCTION_DAYS,
  INSURANCE_RATE_PER_DAY, INSURANCE_COVERAGE,
} from '../config/components';
import type { Generator, Line, LoadProfile } from './types';
import {
  START_MONEY, TARIFF, TARIFF_CLASS, UNSERVED_PENALTY, CARBON_PRICE_START, CARBON_PRICE_GROWTH_PER_DAY,
  CARBON_BENCH_START, CARBON_BENCH_DECLINE_PER_DAY, CARBON_BENCH_MIN,
  REC_START, REC_DECLINE_PER_DAY, REC_MIN,
  FREQ_NOMINAL, FREQ_DROOP, FREQ_SHED_THRESHOLD, TRIP_DELAY,
  MAX_LOSS_FRACTION, WIN_DAY, WIN_RELIABILITY,
  POLLUTION_RADIUS, REP_TARIFF_MIN, REP_TARIFF_SPAN, REP_UNSERVED_WEIGHT,
  REP_CARBON_WEIGHT, REP_POLLUTION_WEIGHT, REP_TIME_CONSTANT, SPOT, HEDGE_FEE_PER_MW_DAY,
  INTERCONNECTOR_CAPACITY, IMPORT_MARKUP, MARKET_FEE_PER_DAY,
  CYCLE_PERIOD_DAYS, CYCLE_AMPLITUDE, HISTORY_SAMPLE_HOURS, HISTORY_MAX,
} from '../config/components';

/** 历史走势采样点 */
export interface HistorySample {
  clock: number;
  spot: number;
  netWorth: number;
  demand: number;
}

interface IslandResult {
  gen: number;
  demand: number;
  served: number;
  loss: number;
  fuelCost: number;
  co2: number; // 吨/h
  marketImport: number; // 本岛向市场购电 (MW)
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
  insured: boolean;
  marketEnabled: boolean;
  history: HistorySample[];
  nextSampleAt: number;
}

export class Simulation {
  grid = new Grid();
  money = START_MONEY;
  clock = 0; // 累计仿真小时
  frequency = FREQ_NOMINAL;
  reliability = 1; // 供电率滑动平均 0..1
  reputation = 70; // 公众形象 0..100
  renewableShare = 1; // 清洁电力占比 0..1（EMA）
  peakServed = 0; // 历史峰值供电 (MW) —— 成就用
  totalEnergyServed = 0; // 累计送达电量 (MWh) —— 成就用
  n1Secure = false; // 是否通过过 N-1 校核 —— 成就用（由 UI 置位）
  badEventCount = 0; // 累计严重事件数（跳闸/破产等）—— UI 用来触发报警音
  logs: LogEntry[] = [];
  gameOver = false;
  win = false;
  goalDay = WIN_DAY; // 关卡目标：撑到第几天（可被关卡覆盖）
  goalReliability = WIN_RELIABILITY; // 且可靠性达标
  sandbox = false; // 沙盒模式：无输赢、无破产
  events = new EventSystem();
  tech = new TechState();
  fuelPrice: Record<FuelType, number> = { coal: 1, gas: 1, uranium: 1 }; // 燃料价格指数
  fuelContracts: Partial<Record<FuelType, FuelContract>> = {}; // 活跃燃料长约
  forcedOutages = true; // 是否启用强迫停运（测试可关闭以求确定性）
  insured = false; // 是否投保设备保险
  marketEnabled = false; // 是否接入批发市场（联络线，需主动接入）
  marketImportMW = 0; // 本 tick 全网购电量 (MW，显示用)
  history: HistorySample[] = []; // 历史走势采样
  private nextSampleAt = 0; // 下次采样时刻
  private claimCoveredTick = 0; // 本 tick 保险理赔覆盖额（用于报表）
  spotPrice = TARIFF; // 当前现货电价 ¥/MWh
  avgSpot = TARIFF; // 现货电价滑动均值（作为远期报价）
  reserveMargin = 1; // 当前备用率（可用容量/需求）
  debt = 0; // 未偿贷款本金
  hedges: Hedge[] = []; // 活跃套保合约
  // 现金流（按日估算，EMA 平滑，供财务报表显示）
  finance = {
    revenue: 0, fuel: 0, carbon: 0, om: 0, interest: 0, penalty: 0, hedge: 0, rec: 0, insurance: 0, market: 0, net: 0,
    byClass: { residential: 0, commercial: 0, industrial: 0 } as Record<LoadProfile, number>,
  };

  constructor() {
    this.events.schedule(0);
  }

  /** 清空回到初始状态（开新关卡前调用）。保持同一 Grid 实例，渲染器引用不失效。 */
  reset(): void {
    this.grid.clear();
    this.money = START_MONEY;
    this.clock = 0;
    this.frequency = FREQ_NOMINAL;
    this.reliability = 1;
    this.reputation = 70;
    this.renewableShare = 1;
    this.peakServed = 0;
    this.totalEnergyServed = 0;
    this.n1Secure = false;
    this.badEventCount = 0;
    this.logs = [];
    this.gameOver = false;
    this.win = false;
    this.goalDay = WIN_DAY;
    this.goalReliability = WIN_RELIABILITY;
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
    this.forcedOutages = true;
    this.insured = false;
    this.marketEnabled = false;
    this.marketImportMW = 0;
    this.history = [];
    this.nextSampleAt = 0;
    this.claimCoveredTick = 0;
    this.finance = {
      revenue: 0, fuel: 0, carbon: 0, om: 0, interest: 0, penalty: 0, hedge: 0, rec: 0, insurance: 0, market: 0, net: 0,
      byClass: { residential: 0, commercial: 0, industrial: 0 },
    };
  }

  /** 导出存档 */
  serialize(): SimSaveState {
    return {
      money: this.money, clock: this.clock, frequency: this.frequency,
      reliability: this.reliability, reputation: this.reputation, renewableShare: this.renewableShare,
      windBase: this.windBase, lastLossFraction: this.lastLossFraction,
      goalDay: this.goalDay, goalReliability: this.goalReliability, sandbox: this.sandbox,
      gameOver: this.gameOver, win: this.win,
      grid: this.grid.serialize(),
      events: { active: this.events.active.map((e) => ({ ...e })), nextAt: this.events.nextAt },
      tech: { unlocked: [...this.tech.unlocked], points: this.tech.points },
      fuelPrice: { ...this.fuelPrice },
      fuelContracts: { ...this.fuelContracts },
      debt: this.debt,
      avgSpot: this.avgSpot,
      hedges: this.hedges.map((h) => ({ ...h })),
      insured: this.insured,
      marketEnabled: this.marketEnabled,
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
    this.insured = d.insured ?? false;
    this.marketEnabled = d.marketEnabled ?? false;
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
    return CARBON_PRICE_START + CARBON_PRICE_GROWTH_PER_DAY * this.day;
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

  /** 已建资产的账面价值（按 capex 估值），用于净资产与信用额度 */
  get assetValue(): number {
    let v = 0;
    for (const g of this.grid.gens.values()) v += PLANTS[g.type].capex;
    for (const b of this.grid.batteries.values()) { void b; v += BATTERY.capex; }
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
  /** 日利率：基础 + 评级风险溢价（评级越差越高） */
  get loanDailyRate(): number {
    return LOAN_BASE_DAILY_RATE + (1 - this.creditScore / 100) * RATING_RATE_SPAN;
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

  /** 机组的有效边际成本 = 基准 × 燃料指数(含长约) × 高效科技 ×（含老化上浮） */
  effMarginalCost(g: Generator): number {
    const fuel = PLANT_FUEL[g.type];
    const idx = fuel ? this.effFuelIndex(fuel) : 1;
    return g.marginalCost * idx * this.tech.fuelCostFactor * (1 + this.wear(g) * WEAR_COST_FACTOR);
  }

  /** 签订燃料长约：锁定该燃料当前现货指数 × 溢价，锁定 days 天 */
  signFuelContract(fuel: FuelType, days: number): boolean {
    if (days <= 0) return false;
    const index = this.fuelPrice[fuel] * FUEL_CONTRACT_PREMIUM;
    this.fuelContracts[fuel] = { index, endClock: this.clock + days * 24 };
    this.log('info', `📑 ${FUEL_INFO[fuel].label}长约：锁定指数 ${index.toFixed(2)} × ${days}天`);
    return true;
  }

  /** 安排某电厂计划检修：短暂离线 + 检修费，换取役龄下降（更低成本与故障率） */
  scheduleMaintenance(busId: number): boolean {
    const bus = this.grid.buses.get(busId);
    if (!bus || bus.kind !== 'plant' || bus.underConstruction) return false;
    const g = this.grid.gensAtBus(busId)[0];
    if (!g || this.genOffline(g)) return false; // 在建/已离线不可重复检修
    const cost = Math.round(PLANTS[g.type].capex * MAINT_COST_FRACTION);
    if (this.money < cost) return false;
    this.money -= cost;
    g.outageUntil = this.clock + MAINT_DAYS * 24;
    g.output = 0;
    g.age = Math.max(0, g.age - MAINT_AGE_REDUCTION_DAYS);
    this.log('good', `🛠 ${bus.name} 计划检修（${MAINT_DAYS}天，¥${cost.toLocaleString('en-US')}）役龄 −${MAINT_AGE_REDUCTION_DAYS}天`);
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
    if (bus.kind === 'storage') return Math.round(BATTERY.capex * SALVAGE_FRACTION);
    if (bus.kind === 'substation') return Math.round(SUBSTATION_CAPEX * SALVAGE_FRACTION);
    return 0;
  }
  /** 拆除线路的残值 */
  lineSalvage(ln: Line): number {
    return Math.round(ln.length * VOLTAGE[ln.voltage].costPerTile * SALVAGE_FRACTION * 0.5);
  }

  /** 燃料价格波动：均值回归 + 随机游走 + 偶发跳涨 */
  private updateFuelPrices(dtHours: number): void {
    const dtDay = dtHours / 24;
    for (const fuel of Object.keys(this.fuelPrice) as FuelType[]) {
      const info = FUEL_INFO[fuel];
      let p = this.fuelPrice[fuel];
      p += (1 - p) * FUEL_MEAN_REVERT * dtDay; // 向基准回归
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

    // —— 更新负荷需求（城市增长 + 噪声 + 事件需求系数 + 需求响应科技）——
    for (const load of this.grid.loads.values()) {
      load.baseDemand *= 1 + load.growthPerHour * dtHours;
      const noise = 1 + (Math.random() - 0.5) * 0.05;
      load.demand = load.baseDemand * demandMultiplier(this.hourOfDay, load.profile) * noise * this.events.demandFactor * this.tech.demandFactor * this.cycleFactor;
    }

    // —— 更新新能源可用系数（叠加天气事件对风/光的压制）——
    for (const g of this.grid.gens.values()) {
      if (!g.dispatchable) {
        let a = renewableAvailability(g.type, this.hourOfDay, this.windBase);
        if (g.type === 'wind') a *= this.events.windCap;
        if (g.type === 'solar') a *= this.events.solarCap;
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
    let revenue = 0, fuelCost = 0, penalty = 0, co2Rate = 0;
    let aggGen = 0, aggDemand = 0, aggServed = 0, aggLoss = 0, aggMarketImport = 0;
    let mainDemand = -1;
    let mainFreq = FREQ_NOMINAL;

    for (const busIds of islands) {
      const r = this.solveIsland(busIds, dtSim);
      aggGen += r.gen; aggDemand += r.demand; aggServed += r.served; aggLoss += r.loss;
      aggMarketImport += r.marketImport;
      fuelCost += r.fuelCost; co2Rate += r.co2;
      penalty += Math.max(0, r.demand - r.served) * UNSERVED_PENALTY * dtHours;
      // 把"需求最大的岛"视为主电网，用其频率做仪表显示
      if (r.demand > mainDemand) {
        mainDemand = r.demand;
        mainFreq = freqFromBalance(r.gen, r.demand);
      }
    }

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

    // —— 现货电价：备用率 + 边际机组成本动态定价 ——
    let availCap = 0;
    let marginalUnitCost = 0;
    for (const g of this.grid.gens.values()) {
      if (this.genOffline(g)) continue;
      availCap += g.dispatchable ? g.capacity : g.capacity * g.availability;
      if (g.dispatchable && g.output > 0.5) marginalUnitCost = Math.max(marginalUnitCost, this.effMarginalCost(g));
    }
    for (const b of this.grid.batteries.values()) {
      const bus = this.grid.buses.get(b.busId);
      if (bus && !bus.underConstruction && b.soc > 1) availCap += b.powerRating * this.tech.batteryPowerFactor;
    }
    const reserveRatio = availCap / Math.max(aggDemand, 1);
    const scarcityMult = clamp(1 + (SPOT.scarcityRef - reserveRatio) * SPOT.scarcityK, SPOT.multMin, SPOT.multMax);
    const fuelInfluence = clamp(SPOT.fuelMin + marginalUnitCost / SPOT.fuelRef, SPOT.fuelMin, SPOT.fuelMax);
    this.spotPrice = clamp(TARIFF * scarcityMult * fuelInfluence, SPOT.floor, SPOT.cap);
    this.reserveMargin = reserveRatio;
    // 远期报价（现货均值）
    const aS = clamp(dtHours / 12, 0, 1);
    this.avgSpot = this.avgSpot * (1 - aS) + this.spotPrice * aS;

    // 套保结算（差价合约）：市价低于锁价获补偿，高于则让出收益（可为负）
    this.hedges = this.hedges.filter((h) => this.clock < h.endClock);
    let hedgeIncome = 0;
    for (const h of this.hedges) hedgeIncome += (h.strike - this.spotPrice) * h.volume * dtHours;

    // 分类电价：按客户类别加权计算售电收入
    const classServed: Record<LoadProfile, number> = { residential: 0, commercial: 0, industrial: 0 };
    for (const l of this.grid.loads.values()) classServed[l.profile] += l.served;
    revenue = (classServed.residential * TARIFF_CLASS.residential
      + classServed.commercial * TARIFF_CLASS.commercial
      + classServed.industrial * TARIFF_CLASS.industrial) * this.spotPrice * dtHours;

    // —— 碳配额交易：免费配额 = 送达电量 × 基准强度；超出买入、富余卖出（可为负=获利）——
    const allowanceRate = aggServed * this.benchmarkIntensity; // t/h 免费配额
    const carbonCost = (co2Rate - allowanceRate) * this.carbonPrice * dtHours;

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
      if (!this.grid.buses.get(bt.busId)?.underConstruction) omCost += BATTERY.omPerDay * omDayFrac;
    }
    for (const b of this.grid.buses.values()) {
      if (b.kind === 'substation' && !b.underConstruction) omCost += SUBSTATION_OM_PER_DAY * omDayFrac;
    }

    // —— 贷款利息 + 保险费 + 市场购电/联络线费 ——
    const interestCost = this.debt * this.loanDailyRate * omDayFrac;
    const premiumCost = this.insurancePremiumPerDay * omDayFrac;
    this.marketImportMW = aggMarketImport;
    const importCost = aggMarketImport * this.avgSpot * IMPORT_MARKUP * dtHours;
    const marketFee = this.marketEnabled ? MARKET_FEE_PER_DAY * omDayFrac : 0;
    const revEff = revenue * this.reputationTariffFactor; // 口碑调整后的售电收入

    // —— 结算（扣除各项成本，加套保差价/绿证收入）——
    this.money += revEff - fuelCost - carbonCost - penalty - omCost - interestCost - premiumCost - importCost - marketFee + hedgeIncome + recIncome;

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
    this.finance.market = ema(this.finance.market, -(importCost + marketFee) * toDay);
    const repF = this.reputationTariffFactor;
    for (const cls of ['residential', 'commercial', 'industrial'] as LoadProfile[]) {
      const r = classServed[cls] * TARIFF_CLASS[cls] * this.spotPrice * repF;
      this.finance.byClass[cls] = ema(this.finance.byClass[cls], r * 24); // ¥/天
    }
    this.finance.net = this.finance.revenue - this.finance.fuel - this.finance.carbon
      - this.finance.om - this.finance.interest - this.finance.penalty
      + this.finance.hedge + this.finance.rec + this.finance.insurance + this.finance.market;
    this.frequency = mainFreq;
    this.totalGen = aggGen;
    this.totalDemand = aggDemand;
    this.totalServed = aggServed;
    this.totalLoss = aggLoss;
    this.co2Rate = co2Rate;
    this.lastLossFraction = aggDemand > 1 ? clamp(aggLoss / aggDemand, 0, MAX_LOSS_FRACTION) : 0.02;

    // 研发点：随送达电量积累（电网越大、运行越好，研发越快）
    this.tech.points += aggServed * dtHours * RP_PER_MWH;
    this.peakServed = Math.max(this.peakServed, aggServed);
    this.totalEnergyServed += aggServed * dtHours;

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

    // 可调机组按"有效边际成本"排序（merit order，随燃料价格变化）
    const disp = gens.filter((g) => g.dispatchable).sort((x, y) => this.effMarginalCost(x) - this.effMarginalCost(y));
    const desired = new Map<number, number>();
    let rem = remaining;
    for (const g of disp) {
      const give = clamp(rem, 0, g.capacity);
      desired.set(g.id, give);
      rem -= give;
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

    // 仍有过剩（充电也吸收不完）则弃风弃光，保持系统平衡
    let supply = genBase + dischargeSum;
    const consumption = demand + chargeSum;
    if (supply > consumption + 0.01) {
      const excess = supply - consumption;
      const renew = gens.filter((g) => !g.dispatchable && g.output > 0);
      const renewTotal = renew.reduce((s, g) => s + g.output, 0);
      if (renewTotal > 0) {
        const scale = Math.max(0, (renewTotal - excess) / renewTotal);
        for (const g of renew) g.output *= scale;
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

    // 分配实际供电到各负荷，并标记停电
    for (const l of loads) {
      l.served = l.demand * ratio;
      const bus = this.grid.buses.get(l.busId);
      if (bus) bus.blackout = ratio < 0.999;
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

    // 经济量（燃料价格 × 高效机组科技；碳排单列）
    let fuelCost = 0, co2 = 0;
    for (const g of gens) {
      fuelCost += g.output * this.effMarginalCost(g) * dtHours;
      co2 += g.output * PLANTS[g.type].co2 * this.tech.co2Factor;
    }

    return { gen: totalGen, demand, served, loss: lossSum, fuelCost, co2, marketImport };
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

  snapshot(): SimSnapshot {
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
