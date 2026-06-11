// 新手教程驱动：一串步骤，每步有提示文字与"完成判定"。
// 判定基于电网状态，玩家做对相应操作即自动进入下一步——纯逻辑，可单测。
import type { Simulation } from '../sim/simulation';
import type { BusKind } from '../sim/types';

function hasSubstation(sim: Simulation): boolean {
  for (const b of sim.grid.buses.values()) if (b.kind === 'substation') return true;
  return false;
}

function lineBetween(sim: Simulation, k1: BusKind, k2: BusKind): boolean {
  for (const ln of sim.grid.lines.values()) {
    const a = sim.grid.buses.get(ln.from);
    const b = sim.grid.buses.get(ln.to);
    if (!a || !b) continue;
    if ((a.kind === k1 && b.kind === k2) || (a.kind === k2 && b.kind === k1)) return true;
  }
  return false;
}

export interface TutorialStep {
  text: string;
  done: (sim: Simulation) => boolean;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  { text: '点工具栏「◆ 变电站」，在电厂和居民区之间的空地点一下，建一座变电站。', done: hasSubstation },
  { text: '选「➖ 拉线路」，先点电厂、再点变电站，架一条高压输电线。', done: (s) => lineBetween(s, 'plant', 'substation') },
  { text: '继续用「拉线路」，把变电站接到居民区（中压配电线）。', done: (s) => lineBetween(s, 'substation', 'load') },
  { text: '点顶栏 ▶（或按空格）开始供电，让时间流动起来。', done: (s) => s.clock > 0.02 },
  { text: '盯住「频率」≈50Hz 与「发电/需求」——居民区有电了！', done: (s) => [...s.grid.loads.values()].some((l) => l.served > 0.5) },
  { text: '展开工具栏「储能」分类，建一座 ▰ 电池储能并用线路接到变电站——它会低充高放、平滑峰谷。', done: (s) => s.grid.batteries.size > 0 && [...s.grid.batteries.values()].some((b) => [...s.grid.lines.values()].some((ln) => ln.from === b.busId || ln.to === b.busId)) },
  { text: '点顶栏 🔬 打开科技树，用送你的研发点解锁任意一项科技（五条分支各有专精）。教程完成 🎓', done: (s) => s.tech.unlocked.size > 0 },
];

// —— 进阶 mini 教程：用预设残局把"绝大多数玩家永远不会发现"的后期系统各教一遍 ——

/** 💼 财务融资教程：贷款 → 投保 → 燃料长约 → 还款 */
export const FINANCE_TUTORIAL_STEPS: TutorialStep[] = [
  { text: '打开顶栏 📊 财务面板，在「贷款」区借入任意金额——建设期现金流靠它摊平。', done: (s) => s.debt > 0 },
  { text: '注意右上「净资产」没有变（借款不是收入）——现在在财务面板给设备「投保」，强迫停运与风暴损失可赔 80%。', done: (s) => s.insured },
  { text: '在财务面板「燃料」区给天然气签一份长约（任意天数）——锁定指数，旺季气价飙升与你无关。', done: (s) => s.fuelContracts.gas != null },
  { text: '回到「贷款」区还掉一部分贷款（利息按日复利，闲钱还债=最稳的理财）。完成 🎓', done: (s) => s.debt < 200_000 },
];

/** 🏪 市场竞争教程：批发市场 → 需求响应 → 长约锁客 → 自备应急 */
export const MARKET_TUTORIAL_STEPS: TutorialStep[] = [
  { text: '打开 📊 财务面板，找到「批发市场」开关并接入——自有电源不足时可购电兜底（有日费）。', done: (s) => s.marketEnabled },
  { text: '在财务面板启用「需求响应」——现货高价时自动付费削减用户负荷，比顶着罚款停电便宜。', done: (s) => s.demandResponse },
  { text: '左侧工具栏展开「改造 / 合约」，用 📜 长约工具点击地图上的数据中心——合约期内对手挖不走它。', done: (s) => [...s.grid.loads.values()].some((l) => l.contractEndClock != null && s.clock < l.contractEndClock) },
  { text: '用 🔋 自备应急电源工具再点数据中心——停电时兜底 60% 负荷，满意度不再跳水。完成 🎓', done: (s) => [...s.grid.loads.values()].some((l) => l.backup) },
];

/** 📈 衍生品风控教程：套保 → 期权 → 输电权 → 远期容量 */
export const DERIVATIVES_TUTORIAL_STEPS: TutorialStep[] = [
  { text: '打开 📊 财务面板「套保」区，签一笔远期套保（任意量/天数）——把卖电价锁在远期报价。', done: (s) => s.hedges.length > 0 },
  { text: '在「期权」区买一份看跌期权（put）——付权利金买"电价跌穿行权价就赔我"的保险。', done: (s) => s.options.length > 0 },
  { text: '在「输电权 FTR」区买入任意容量——它收取南北区价差，是纯金融的拥堵租金。', done: (s) => s.ftrs.length > 0 },
  { text: '在「远期容量」区承诺一笔容量（注意交付义务与罚款）。四件套齐了，风控毕业 🎓', done: (s) => s.capCommitments.length > 0 },
];

export class Tutorial {
  active = false;
  index = 0;
  private steps: TutorialStep[] = TUTORIAL_STEPS;
  private completed = false;

  /** 开始一套教程步骤（缺省为新手教程；进阶教程传入各自步骤表） */
  start(steps: TutorialStep[] = TUTORIAL_STEPS): void {
    this.active = true;
    this.index = 0;
    this.steps = steps;
    this.completed = false;
  }
  stop(): void {
    this.active = false;
  }

  /** 每帧调用：返回当前步骤提示（自动跳过已完成的步骤）；全部完成返回 null */
  update(sim: Simulation): string | null {
    if (!this.active) return null;
    while (this.index < this.steps.length && this.steps[this.index].done(sim)) this.index++;
    if (this.index >= this.steps.length) {
      this.active = false;
      this.completed = true;
      return null;
    }
    return `教程 ${this.index + 1}/${this.steps.length}：${this.steps[this.index].text}`;
  }

  /** 取出"刚刚完成"事件（一次性） */
  takeCompleted(): boolean {
    if (this.completed) {
      this.completed = false;
      return true;
    }
    return false;
  }
}
