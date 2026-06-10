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

export class Tutorial {
  active = false;
  index = 0;
  private completed = false;

  start(): void {
    this.active = true;
    this.index = 0;
    this.completed = false;
  }
  stop(): void {
    this.active = false;
  }

  /** 每帧调用：返回当前步骤提示（自动跳过已完成的步骤）；全部完成返回 null */
  update(sim: Simulation): string | null {
    if (!this.active) return null;
    while (this.index < TUTORIAL_STEPS.length && TUTORIAL_STEPS[this.index].done(sim)) this.index++;
    if (this.index >= TUTORIAL_STEPS.length) {
      this.active = false;
      this.completed = true;
      return null;
    }
    return `教程 ${this.index + 1}/${TUTORIAL_STEPS.length}：${TUTORIAL_STEPS[this.index].text}`;
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
