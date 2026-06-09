// 天气与危机事件系统：给电网注入外部冲击，让储能/冗余/调峰的投资有了意义。
// 事件改变全局需求系数、风/光出力上限，或直接损毁线路。
import type { Simulation } from './simulation';
import { STORM_DAMAGE } from '../config/components';

export type WeatherKind = 'clear' | 'heatwave' | 'coldsnap' | 'calm' | 'overcast' | 'storm';

const LABEL: Record<WeatherKind, string> = {
  clear: '☀ 晴朗',
  heatwave: '🌡 热浪',
  coldsnap: '❄ 寒潮',
  calm: '🌫 无风',
  overcast: '☁ 阴雨',
  storm: '🌪 风暴',
};

interface ActiveEvent {
  kind: WeatherKind;
  endTime: number; // 仿真小时
  demandFactor: number;
  windCap: number;
  solarCap: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
function choice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export class EventSystem {
  active: ActiveEvent[] = [];
  nextAt = Infinity;

  // 聚合后的全局修正（供仿真读取）
  demandFactor = 1;
  windCap = 1;
  solarCap = 1;
  current: WeatherKind = 'clear';
  label = LABEL.clear;

  /** 安排第一场事件（开局后若干小时） */
  schedule(clock: number): void {
    this.nextAt = clock + rnd(8, 16);
  }

  update(sim: Simulation): void {
    const t = sim.clock;
    let guard = 0;
    while (t >= this.nextAt && guard++ < 8) {
      this.trigger(sim);
      this.nextAt += rnd(10, 24);
    }
    // 过期事件移除
    this.active = this.active.filter((e) => e.endTime > t);
    // 聚合：需求系数相乘，风/光上限取最严（最小）
    let d = 1, w = 1, s = 1;
    for (const e of this.active) {
      d *= e.demandFactor;
      w = Math.min(w, e.windCap);
      s = Math.min(s, e.solarCap);
    }
    this.demandFactor = d;
    this.windCap = w;
    this.solarCap = s;
    this.current = this.active.length ? this.active[this.active.length - 1].kind : 'clear';
    this.label = LABEL[this.current];
  }

  /** 随机触发一场事件（storm 权重略低） */
  private trigger(sim: Simulation): void {
    const kind = choice<WeatherKind>([
      'heatwave', 'heatwave', 'coldsnap', 'coldsnap', 'calm', 'calm', 'overcast', 'overcast', 'storm',
    ]);
    this.triggerKind(sim, kind);
  }

  /** 触发指定事件（随机也走这里，便于测试直接调用） */
  triggerKind(sim: Simulation, kind: WeatherKind): void {
    const t = sim.clock;
    switch (kind) {
      case 'heatwave':
        this.active.push({ kind, endTime: t + rnd(5, 10), demandFactor: rnd(1.3, 1.6), windCap: 1, solarCap: 1 });
        sim.log('warn', '🌡 热浪来袭：空调负荷激增，备好调峰电源！');
        break;
      case 'coldsnap':
        this.active.push({ kind, endTime: t + rnd(5, 10), demandFactor: rnd(1.35, 1.65), windCap: 1, solarCap: 1 });
        sim.log('warn', '❄ 寒潮来袭：取暖负荷激增，注意供需平衡！');
        break;
      case 'calm':
        this.active.push({ kind, endTime: t + rnd(6, 12), demandFactor: 1, windCap: rnd(0.1, 0.25), solarCap: 1 });
        sim.log('warn', '🌫 无风天气：风电出力骤减。');
        break;
      case 'overcast':
        this.active.push({ kind, endTime: t + rnd(4, 9), demandFactor: 1, windCap: 1, solarCap: rnd(0.2, 0.4) });
        sim.log('warn', '☁ 阴雨天气：光伏出力骤减。');
        break;
      case 'storm': {
        this.active.push({ kind, endTime: t + rnd(2, 4), demandFactor: 1, windCap: 0.5, solarCap: 0.6 });
        // 直接损毁一条在运线路 → 需重合闸恢复
        const lines = [...sim.grid.lines.values()].filter((l) => !l.tripped);
        if (lines.length) {
          const l = choice(lines);
          l.tripped = true;
          l.overloadTimer = 0;
          sim.incurDamage(STORM_DAMAGE, '风暴损毁线路'); // 维修成本（保险可赔）
          sim.log('warn', '🌪 用「检查/重合闸」恢复送电。');
        } else {
          sim.log('warn', '🌪 风暴过境。');
        }
        break;
      }
      case 'clear':
        break;
    }
  }
}
