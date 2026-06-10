// 设置面板：音量/背景音乐/色盲配色/UI 缩放/自动存档 + 快捷键一览（复用 #panel）。
// 设置持久化到 localStorage，启动时由 main 读取并应用。

export interface GameSettings {
  volume: number; // 音效音量 0..1
  music: boolean; // 氛围背景音乐
  colorblind: boolean; // 色盲友好配色（线路负载/状态色避开红绿对比）
  uiScale: number; // 界面缩放（0.9/1/1.1/1.25）
  autosave: boolean; // 每游戏日自动存档
}

const KEY = 'powerworld.settings.v1';

export const DEFAULT_SETTINGS: GameSettings = { volume: 0.7, music: false, colorblind: false, uiScale: 1, autosave: true };

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<GameSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: GameSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 忽略 */
  }
}

/** 应用即时生效的全局设置（配色类名 / 界面缩放） */
export function applyGlobalSettings(s: GameSettings): void {
  document.body.classList.toggle('colorblind', s.colorblind);
  (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = s.uiScale === 1 ? '' : String(s.uiScale);
}

const KEYMAP: [string, string][] = [
  ['空格', '暂停 / 继续'],
  ['1-9', '快速切换建造工具'],
  ['Esc', '取消拉线 / 清除品类高亮'],
  ['滚轮', '缩放地图'],
  ['拖拽', '平移地图'],
  ['H', '回到全图视角（适配电网范围）'],
];

export interface SettingsPanelOptions {
  settings: GameSettings;
  onChange: (s: GameSettings) => void; // 任一项变化即回调（已持久化）
  onClose: () => void;
}

export class SettingsPanel {
  private el = document.getElementById('panel')!;

  get isOpen(): boolean {
    return this.el.style.display === 'flex';
  }

  show(o: SettingsPanelOptions): void {
    const s = { ...o.settings };
    this.el.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    panel.innerHTML = `<h1>⚙ 设置</h1><p class="sub">音频 · 显示 · 存档 · 快捷键</p>`;

    const emit = () => { saveSettings(s); applyGlobalSettings(s); o.onChange(s); };

    const rowEl = (label: string, control: HTMLElement): HTMLElement => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--panel-border);gap:12px';
      const lab = document.createElement('span');
      lab.textContent = label;
      lab.style.fontSize = '13px';
      r.appendChild(lab);
      r.appendChild(control);
      return r;
    };

    // 音效音量
    const vol = document.createElement('input');
    vol.type = 'range';
    vol.min = '0'; vol.max = '100'; vol.value = String(Math.round(s.volume * 100));
    vol.style.width = '180px';
    vol.oninput = () => { s.volume = parseInt(vol.value, 10) / 100; emit(); };
    panel.appendChild(rowEl(`🔊 音效音量`, vol));

    const toggle = (value: boolean, fn: (v: boolean) => void): HTMLButtonElement => {
      const b = document.createElement('button');
      const paint = (v: boolean) => {
        b.textContent = v ? '开' : '关';
        b.style.cssText = `background:${v ? 'var(--accent)' : '#182431'};color:${v ? '#04211a' : 'var(--text)'};border:1px solid var(--panel-border);border-radius:6px;padding:6px 18px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700`;
      };
      paint(value);
      let cur = value;
      b.onclick = () => { cur = !cur; paint(cur); fn(cur); };
      return b;
    };

    panel.appendChild(rowEl('🎵 氛围背景音乐（程序化合成）', toggle(s.music, (v) => { s.music = v; emit(); })));
    panel.appendChild(rowEl('🎨 色盲友好配色（负载/状态色避开红绿）', toggle(s.colorblind, (v) => { s.colorblind = v; emit(); })));
    panel.appendChild(rowEl('💾 自动存档（每游戏日，存入"自动存档"槽）', toggle(s.autosave, (v) => { s.autosave = v; emit(); })));

    // UI 缩放
    const scaleWrap = document.createElement('div');
    scaleWrap.style.cssText = 'display:flex;gap:6px';
    for (const sc of [0.9, 1, 1.1, 1.25]) {
      const b = document.createElement('button');
      b.textContent = `${Math.round(sc * 100)}%`;
      const paint = () => {
        const on = Math.abs(s.uiScale - sc) < 0.01;
        b.style.cssText = `background:${on ? 'var(--accent)' : '#182431'};color:${on ? '#04211a' : 'var(--text)'};border:1px solid var(--panel-border);border-radius:6px;padding:6px 10px;cursor:pointer;font-family:inherit;font-size:12px`;
      };
      paint();
      b.onclick = () => { s.uiScale = sc; emit(); this.show({ ...o, settings: s }); };
      scaleWrap.appendChild(b);
    }
    panel.appendChild(rowEl('🖥 界面缩放', scaleWrap));

    // 快捷键一览
    const head = document.createElement('div');
    head.className = 'menu-sec-title';
    head.style.margin = '16px 0 6px';
    head.textContent = '⌨ 快捷键';
    panel.appendChild(head);
    const km = document.createElement('div');
    km.style.cssText = 'font-size:12px;line-height:1.9';
    km.innerHTML = KEYMAP.map(([k, v]) => `<div style="display:flex;justify-content:space-between"><b style="color:var(--accent)">${k}</b><span style="color:var(--text-dim)">${v}</span></div>`).join('');
    panel.appendChild(km);

    const close = document.createElement('button');
    close.className = 'menu-continue';
    close.style.marginTop = '16px';
    close.textContent = '关闭';
    close.onclick = () => o.onClose();
    panel.appendChild(close);

    this.el.appendChild(panel);
    this.el.style.display = 'flex';
  }

  hide(): void {
    this.el.style.display = 'none';
  }
}
