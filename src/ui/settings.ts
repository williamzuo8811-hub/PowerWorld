// 设置面板：音量/背景音乐/色盲配色/UI 缩放/自动存档/语言 + 快捷键一览（复用 #panel）。
// 设置持久化到 localStorage，启动时由 main 读取并应用。
import { t, getLocale, setLocale, type Locale } from '../i18n';

export interface GameSettings {
  volume: number; // 音效音量 0..1
  music: boolean; // 氛围背景音乐
  colorblind: boolean; // 色盲友好配色（线路负载/状态色避开红绿对比）
  uiScale: number; // 界面缩放（0.9/1/1.1/1.25）
  fontScale: number; // 字体缩放（独立于整体缩放，0.9/1/1.15/1.3）
  autosave: boolean; // 每游戏日自动存档
}

const KEY = 'powerworld.settings.v1';

export const DEFAULT_SETTINGS: GameSettings = { volume: 0.7, music: false, colorblind: false, uiScale: 1, fontScale: 1, autosave: true };

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

/** 应用即时生效的全局设置（配色类名 / 界面缩放 / 字体缩放） */
export function applyGlobalSettings(s: GameSettings): void {
  document.body.classList.toggle('colorblind', s.colorblind);
  (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = s.uiScale === 1 ? '' : String(s.uiScale);
  document.documentElement.style.setProperty('--font-scale', String(s.fontScale ?? 1));
}

const KEYMAP: [string, () => string][] = [
  ['Space', () => t('key_space')],
  ['1-9', () => t('key_nums')],
  ['Esc', () => t('key_esc')],
  ['Wheel', () => t('key_wheel')],
  ['Drag', () => t('key_drag')],
  ['H', () => t('key_home')],
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
    panel.innerHTML = `<h1>${t('set_title')}</h1><p class="sub">${t('set_sub')}</p>`;

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
    panel.appendChild(rowEl(t('set_volume'), vol));

    const toggle = (value: boolean, fn: (v: boolean) => void): HTMLButtonElement => {
      const b = document.createElement('button');
      const paint = (v: boolean) => {
        b.textContent = v ? t('set_on') : t('set_off');
        b.style.cssText = `background:${v ? 'var(--accent)' : '#182431'};color:${v ? '#04211a' : 'var(--text)'};border:1px solid var(--panel-border);border-radius:6px;padding:6px 18px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700`;
      };
      paint(value);
      let cur = value;
      b.onclick = () => { cur = !cur; paint(cur); fn(cur); };
      return b;
    };

    panel.appendChild(rowEl(t('set_music'), toggle(s.music, (v) => { s.music = v; emit(); })));
    panel.appendChild(rowEl(t('set_colorblind'), toggle(s.colorblind, (v) => { s.colorblind = v; emit(); })));
    panel.appendChild(rowEl(t('set_autosave'), toggle(s.autosave, (v) => { s.autosave = v; emit(); })));

    // 语言切换（重新载入后生效；当前覆盖界面框架文案）
    const langWrap = document.createElement('div');
    langWrap.style.cssText = 'display:flex;gap:6px';
    for (const [code, label] of [['zh', '中文'], ['en', 'English']] as [Locale, string][]) {
      const b = document.createElement('button');
      const on = getLocale() === code;
      b.textContent = label;
      b.style.cssText = `background:${on ? 'var(--accent)' : '#182431'};color:${on ? '#04211a' : 'var(--text)'};border:1px solid var(--panel-border);border-radius:6px;padding:6px 14px;cursor:pointer;font-family:inherit;font-size:12px`;
      b.onclick = () => { setLocale(code); this.show(o); };
      langWrap.appendChild(b);
    }
    panel.appendChild(rowEl(t('set_lang'), langWrap));
    const langNote = document.createElement('div');
    langNote.style.cssText = 'color:var(--text-dim);font-size:11px;padding:4px 0 0';
    langNote.textContent = t('set_lang_note');
    panel.appendChild(langNote);

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
    panel.appendChild(rowEl(t('set_uiscale'), scaleWrap));

    // 字体缩放（独立档位：UI 布局不变、只放大文字）
    const fontWrap = document.createElement('div');
    fontWrap.style.cssText = 'display:flex;gap:6px';
    for (const fc of [0.9, 1, 1.15, 1.3]) {
      const b = document.createElement('button');
      b.textContent = `${Math.round(fc * 100)}%`;
      const on = Math.abs((s.fontScale ?? 1) - fc) < 0.01;
      b.style.cssText = `background:${on ? 'var(--accent)' : '#182431'};color:${on ? '#04211a' : 'var(--text)'};border:1px solid var(--panel-border);border-radius:6px;padding:6px 10px;cursor:pointer;font-family:inherit;font-size:12px`;
      b.onclick = () => { s.fontScale = fc; emit(); this.show({ ...o, settings: s }); };
      fontWrap.appendChild(b);
    }
    panel.appendChild(rowEl(t('set_fontscale'), fontWrap));

    // 快捷键一览
    const head = document.createElement('div');
    head.className = 'menu-sec-title';
    head.style.margin = '16px 0 6px';
    head.textContent = t('set_keys');
    panel.appendChild(head);
    const km = document.createElement('div');
    km.style.cssText = 'font-size:12px;line-height:1.9';
    km.innerHTML = KEYMAP.map(([k, v]) => `<div style="display:flex;justify-content:space-between"><b style="color:var(--accent)">${k}</b><span style="color:var(--text-dim)">${v()}</span></div>`).join('');
    panel.appendChild(km);

    const close = document.createElement('button');
    close.className = 'menu-continue';
    close.style.marginTop = '16px';
    close.textContent = t('set_close');
    close.onclick = () => o.onClose();
    panel.appendChild(close);

    this.el.appendChild(panel);
    this.el.style.display = 'flex';
  }

  hide(): void {
    this.el.style.display = 'none';
  }
}
