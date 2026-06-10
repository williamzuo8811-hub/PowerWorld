// 成就引擎：跨存档全局持久化（localStorage）。evaluate 给定状态即可解锁，纯逻辑可测。
import { ACHIEVEMENTS, type Achievement, type AchvContext } from '../config/achievements';

const KEY = 'powerworld.achievements.v1';

export class Achievements {
  unlocked = new Set<string>();
  private queue: Achievement[] = []; // 待弹出的解锁提示

  /** 从 localStorage 载入已解锁成就（无环境时静默忽略） */
  load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) for (const id of JSON.parse(raw) as string[]) this.unlocked.add(id);
    } catch {
      /* 忽略 */
    }
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify([...this.unlocked]));
    } catch {
      /* 忽略 */
    }
  }

  /** 根据当前状态判定并解锁新成就 */
  evaluate(ctx: AchvContext): void {
    let changed = false;
    for (const a of ACHIEVEMENTS) {
      if (!this.unlocked.has(a.id) && a.check(ctx)) {
        this.unlocked.add(a.id);
        this.queue.push(a);
        changed = true;
      }
    }
    if (changed) this.save();
  }

  /** 取出并清空待弹出的解锁提示 */
  drain(): Achievement[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  get count(): number {
    return this.unlocked.size;
  }
}
