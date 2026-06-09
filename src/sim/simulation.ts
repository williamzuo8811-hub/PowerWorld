// 仿真主循环：把"调度 → 潮流 → 频率 → 跳闸 → 经济"串成一个 tick。
// 这是一个纯逻辑对象，不知道任何关于渲染的事；前端每帧调用 tick() 并读取快照。
import type { SimSnapshot, LogEntry } from './types';
import { Grid } from './grid';
import { solveDC } from './powerflow';
import { demandMultiplier, renewableAvailability } from './profiles';
import { PLANTS } from '../config/components';
import {
  START_MONEY, TARIFF, UNSERVED_PENALTY, CARBON_PRICE_START, CARBON_PRICE_GROWTH_PER_DAY,
  FREQ_NOMINAL, FREQ_DROOP, FREQ_SHED_THRESHOLD, TRIP_DELAY,
  LOSS_SCALE, MAX_LOSS_FRACTION, WIN_DAY, WIN_RELIABILITY,
} from '../config/components';

interface IslandResult {
  gen: number;
  demand: number;
  served: number;
  loss: number;
  fuelCost: number;
  co2: number; // 吨/h
}

export class Simulation {
  grid = new Grid();
  money = START_MONEY;
  clock = 0; // 累计仿真小时
  frequency = FREQ_NOMINAL;
  reliability = 1; // 供电率滑动平均 0..1
  logs: LogEntry[] = [];
  gameOver = false;
  win = false;

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

  log(level: LogEntry['level'], msg: string): void {
    this.logs.push({ time: this.clock, level, msg });
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

    // —— 天气：风况慢变随机游走 ——
    this.windBase = clamp(this.windBase + (Math.random() - 0.5) * 0.25 * dtHours, 0.12, 1.0);

    // —— 更新负荷需求（含城市发展增长 + 小幅噪声）——
    for (const load of this.grid.loads.values()) {
      load.baseDemand *= 1 + load.growthPerHour * dtHours;
      const noise = 1 + (Math.random() - 0.5) * 0.05;
      load.demand = load.baseDemand * demandMultiplier(this.hourOfDay, load.profile) * noise;
    }

    // —— 更新新能源可用系数 ——
    for (const g of this.grid.gens.values()) {
      if (!g.dispatchable) g.availability = renewableAvailability(g.type, this.hourOfDay, this.windBase);
    }

    // 每 tick 先清零线路潮流，再按孤岛逐个回填
    for (const ln of this.grid.lines.values()) {
      ln.flow = 0;
      ln.loss = 0;
    }
    for (const bus of this.grid.buses.values()) bus.blackout = false;

    // —— 逐孤岛求解 ——
    const islands = this.grid.islands();
    let revenue = 0, fuelCost = 0, penalty = 0, co2Rate = 0;
    let aggGen = 0, aggDemand = 0, aggServed = 0, aggLoss = 0;
    let mainDemand = -1;
    let mainFreq = FREQ_NOMINAL;

    for (const busIds of islands) {
      const r = this.solveIsland(busIds, dtSim);
      aggGen += r.gen; aggDemand += r.demand; aggServed += r.served; aggLoss += r.loss;
      fuelCost += r.fuelCost; co2Rate += r.co2;
      revenue += r.served * TARIFF * dtHours;
      penalty += Math.max(0, r.demand - r.served) * UNSERVED_PENALTY * dtHours;
      // 把"需求最大的岛"视为主电网，用其频率做仪表显示
      if (r.demand > mainDemand) {
        mainDemand = r.demand;
        mainFreq = freqFromBalance(r.gen, r.demand);
      }
    }

    // —— 过载保护 / 连锁跳闸 ——
    for (const ln of this.grid.lines.values()) {
      if (ln.tripped) continue;
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

    // —— 碳成本 ——
    const carbonCost = co2Rate * this.carbonPrice * dtHours;

    // —— 结算 ——
    this.money += revenue - fuelCost - carbonCost - penalty;
    this.frequency = mainFreq;
    this.totalGen = aggGen;
    this.totalDemand = aggDemand;
    this.totalServed = aggServed;
    this.totalLoss = aggLoss;
    this.co2Rate = co2Rate;
    this.lastLossFraction = aggDemand > 1 ? clamp(aggLoss / aggDemand, 0, MAX_LOSS_FRACTION) : 0.02;

    // 可靠性滑动平均（EMA）
    const instReliab = aggDemand > 0.5 ? aggServed / aggDemand : 1;
    const a = clamp(dtHours / 6, 0, 1); // 约 6 小时时间常数
    this.reliability = this.reliability * (1 - a) + instReliab * a;

    this.checkEndConditions();
  }

  /** 对单个孤岛执行调度 + 平衡 + 直流潮流，返回聚合量 */
  private solveIsland(busIds: number[], dtSim: number): IslandResult {
    const dtHours = dtSim / 3600;
    const set = new Set(busIds);
    const gens = [...this.grid.gens.values()].filter((g) => set.has(g.busId));
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

    // 可调机组按边际成本排序（merit order），贪心填充期望出力
    const disp = gens.filter((g) => g.dispatchable).sort((x, y) => x.marginalCost - y.marginalCost);
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

    let totalGen = gens.reduce((s, g) => s + g.output, 0);

    // 过剩则弃风弃光（优先削减新能源，保持系统平衡）
    if (totalGen > demand + 0.01 && demand > 0.01) {
      let excess = totalGen - demand;
      const renew = gens.filter((g) => !g.dispatchable && g.output > 0);
      const renewTotal = renew.reduce((s, g) => s + g.output, 0);
      if (renewTotal > 0) {
        const scale = Math.max(0, (renewTotal - excess) / renewTotal);
        for (const g of renew) g.output *= scale;
      }
      totalGen = gens.reduce((s, g) => s + g.output, 0);
    }

    const served = Math.min(demand, totalGen);
    const ratio = demand > 0 ? served / demand : 1;
    const islandDead = totalGen < 0.01 && demand > 0.01;

    // 频率：低于阈值视为低频减载（已通过 served<demand 自然甩负荷）
    const freq = freqFromBalance(totalGen, demand);
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
    for (const l of loads) injection.set(l.busId, (injection.get(l.busId) ?? 0) - l.served);

    const islandLines = [...this.grid.lines.values()].filter(
      (ln) => !ln.tripped && set.has(ln.from) && set.has(ln.to),
    );
    const { flows } = solveDC(busIds, islandLines, injection);

    let lossSum = 0;
    for (const ln of islandLines) {
      const f = flows.get(ln.id) ?? 0;
      ln.flow = f;
      const loss = Math.min(Math.abs(f) * MAX_LOSS_FRACTION, ln.resistance * f * f * LOSS_SCALE);
      ln.loss = loss;
      lossSum += loss;
    }

    // 经济量
    let fuelCost = 0, co2 = 0;
    for (const g of gens) {
      fuelCost += g.output * g.marginalCost * dtHours;
      co2 += g.output * PLANTS[g.type].co2;
    }

    return { gen: totalGen, demand, served, loss: lossSum, fuelCost, co2 };
  }

  private checkEndConditions(): void {
    if (this.gameOver) return;
    if (this.money < 0) {
      this.gameOver = true;
      this.win = false;
      this.log('bad', '💸 资金耗尽，电力公司破产了。');
      return;
    }
    if (this.day >= WIN_DAY && this.reliability >= WIN_RELIABILITY) {
      this.gameOver = true;
      this.win = true;
      this.log('good', '🏆 撑过了考验，小镇灯火通明，你赢了！');
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
