// HUD：用普通 DOM 叠加在画布上，负责状态栏、速度、工具栏、日志、检查器、结束遮罩。
// 渲染与仿真无关，只读快照 + 暴露当前工具/速度给 main 使用。
import type { SimSnapshot, LogEntry } from '../sim/types';
import {
  PLANTS, SUBSTATION_CAPEX, SUBSTATION_RATING, VOLTAGE, TIME_SCALES,
  FREQ_NOMINAL, WIN_DAY, WIN_RELIABILITY,
} from '../config/components';

export type ToolId =
  | 'inspect' | 'line' | 'substation'
  | 'coal' | 'gas' | 'wind' | 'solar' | 'nuclear' | 'bulldoze';

interface ToolDef { id: ToolId; label: string; sub: string; }

const TOOLS: ToolDef[] = [
  { id: 'inspect', label: '🔍 检查 / 重合闸', sub: '查看·恢复跳闸线路/变压器' },
  { id: 'line', label: '➖ 拉线路', sub: `HV¥${fmt(VOLTAGE.HV.costPerTile)} · MV¥${fmt(VOLTAGE.MV.costPerTile)} /格` },
  { id: 'substation', label: '◆ 变电站', sub: `¥${fmt(SUBSTATION_CAPEX)}·容量${SUBSTATION_RATING}MW` },
  { id: 'coal', label: '■ 燃煤 60MW', sub: `¥${fmt(PLANTS.coal.capex)}·慢·脏` },
  { id: 'gas', label: '■ 燃气 40MW', sub: `¥${fmt(PLANTS.gas.capex)}·快·贵` },
  { id: 'wind', label: '■ 风电 30MW', sub: `¥${fmt(PLANTS.wind.capex)}·看风` },
  { id: 'solar', label: '■ 光伏 30MW', sub: `¥${fmt(PLANTS.solar.capex)}·白天` },
  { id: 'nuclear', label: '■ 核电 120MW', sub: `¥${fmt(PLANTS.nuclear.capex)}·基荷` },
  { id: 'bulldoze', label: '✕ 拆除', sub: '移除设备 / 线路' },
];

export class Hud {
  currentTool: ToolId = 'line';
  private speedIndex = 0; // 默认暂停，先让玩家布网

  private statVals = new Map<string, HTMLElement>();
  private toolBtns = new Map<ToolId, HTMLButtonElement>();
  private speedBtns: HTMLButtonElement[] = [];
  private logEl!: HTMLElement;
  private inspectorEl!: HTMLElement;
  private hintEl!: HTMLElement;

  get timeScale(): number {
    return TIME_SCALES[this.speedIndex];
  }
  get paused(): boolean {
    return this.speedIndex === 0;
  }

  build(): void {
    this.buildTopbar();
    this.buildToolbar();
    this.logEl = document.getElementById('log')!;
    this.logEl.innerHTML = `<div class="title">事件日志</div><div id="log-body"></div>`;
    this.inspectorEl = document.getElementById('inspector')!;
    this.hintEl = document.getElementById('hint')!;
  }

  private buildTopbar(): void {
    const bar = document.getElementById('topbar')!;
    bar.innerHTML = '';
    const add = (key: string, label: string) => {
      const wrap = document.createElement('div');
      wrap.className = 'stat';
      wrap.innerHTML = `<span class="k">${label}</span><span class="v" id="stat-${key}">—</span>`;
      bar.appendChild(wrap);
      this.statVals.set(key, wrap.querySelector('.v')!);
    };
    add('money', '资金');
    add('time', '时间');
    add('freq', '频率');
    add('balance', '发电 / 需求');
    add('loss', '线损');
    add('reliab', '可靠性');
    add('co2', '碳排');
    add('goal', '目标');

    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    bar.appendChild(spacer);

    const speed = document.createElement('div');
    speed.id = 'speed';
    const labels = ['⏸', '▶', '▶▶', '▶▶▶'];
    labels.forEach((lab, i) => {
      const b = document.createElement('button');
      b.textContent = lab;
      b.onclick = () => this.setSpeed(i);
      speed.appendChild(b);
      this.speedBtns.push(b);
    });
    bar.appendChild(speed);
    this.refreshSpeedButtons();
  }

  private buildToolbar(): void {
    const tb = document.getElementById('toolbar')!;
    tb.innerHTML = '<div class="title">建造工具（按数字键 1-9 快速切换）</div>';
    TOOLS.forEach((t) => {
      const b = document.createElement('button');
      b.innerHTML = `${t.label}<span class="cost">${t.sub}</span>`;
      b.onclick = () => this.setTool(t.id);
      tb.appendChild(b);
      this.toolBtns.set(t.id, b);
    });
    this.refreshToolButtons();
  }

  setTool(id: ToolId): void {
    this.currentTool = id;
    this.refreshToolButtons();
  }
  setSpeed(i: number): void {
    this.speedIndex = Math.max(0, Math.min(TIME_SCALES.length - 1, i));
    this.refreshSpeedButtons();
  }
  togglePause(): void {
    this.setSpeed(this.speedIndex === 0 ? 1 : 0);
  }

  private refreshToolButtons(): void {
    for (const [id, b] of this.toolBtns) b.classList.toggle('active', id === this.currentTool);
  }
  private refreshSpeedButtons(): void {
    this.speedBtns.forEach((b, i) => b.classList.toggle('active', i === this.speedIndex));
  }

  setHint(text: string | null): void {
    this.hintEl.style.display = text ? 'block' : 'none';
    if (text) this.hintEl.textContent = text;
  }

  setInspector(html: string | null): void {
    this.inspectorEl.style.display = html ? 'block' : 'none';
    if (html) this.inspectorEl.innerHTML = html;
  }

  /** 每帧刷新状态栏与日志 */
  update(s: SimSnapshot, logs: LogEntry[]): void {
    this.set('money', `¥${fmt(s.money)}`, s.money < 50_000 ? 'freq-bad' : '');
    const hh = Math.floor(s.hourOfDay).toString().padStart(2, '0');
    const mm = Math.floor((s.hourOfDay % 1) * 60).toString().padStart(2, '0');
    this.set('time', `第${s.day + 1}天 ${hh}:${mm}`);
    this.set('freq', `${s.frequency.toFixed(2)} Hz`, freqClass(s.frequency));
    this.set('balance', `${s.totalGen.toFixed(0)} / ${s.totalDemand.toFixed(0)} MW`,
      s.totalServed < s.totalDemand - 0.5 ? 'freq-warn' : '');
    this.set('loss', `${s.totalLoss.toFixed(1)} MW`);
    this.set('reliab', `${(s.reliability * 100).toFixed(1)}%`,
      s.reliability < WIN_RELIABILITY ? 'freq-warn' : 'freq-ok');
    this.set('co2', `${s.co2.toFixed(1)} t/h`);
    this.set('goal', `撑到第${WIN_DAY}天·可靠性≥${(WIN_RELIABILITY * 100).toFixed(0)}%`);

    const body = document.getElementById('log-body');
    if (body) {
      body.innerHTML = logs.slice(-7).reverse().map((l) => {
        const hh2 = Math.floor(l.time % 24).toString().padStart(2, '0');
        const mm2 = Math.floor((l.time % 1) * 60).toString().padStart(2, '0');
        return `<div class="entry e-${l.level}">[${hh2}:${mm2}] ${l.msg}</div>`;
      }).join('');
    }

    if (s.gameOver) this.showOverlay(s.win);
  }

  private set(key: string, value: string, cls = ''): void {
    const el = this.statVals.get(key);
    if (!el) return;
    el.textContent = value;
    el.className = 'v ' + cls;
  }

  private showOverlay(win: boolean): void {
    const ov = document.getElementById('overlay')!;
    if (ov.style.display === 'flex') return;
    ov.style.display = 'flex';
    document.getElementById('overlay-title')!.textContent = win ? '🏆 通关！' : '💸 破产了';
    document.getElementById('overlay-text')!.textContent = win
      ? `你把这座小镇平稳地带过了 ${WIN_DAY} 天，电网坚强、灯火通明。下一步可以挑战更大的城市与新能源转型。`
      : '电力公司资金耗尽。停电罚款、燃料与碳成本压垮了现金流——下次更早布局电源与冗余线路。';
  }
}

function freqClass(f: number): string {
  const d = Math.abs(f - FREQ_NOMINAL);
  if (d <= 0.2) return 'freq-ok';
  if (d <= 0.7) return 'freq-warn';
  return 'freq-bad';
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
