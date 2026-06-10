// 主菜单 / 关卡选择界面（纯 DOM 覆盖层）。
import type { Scenario } from '../game/scenarios';

export interface MenuOptions {
  scenarios: Scenario[];
  hasSave: boolean;
  saveLabel?: string;
  onStart: (s: Scenario) => void;
  onContinue: () => void;
}

export class Menu {
  private el = document.getElementById('menu')!;

  get isOpen(): boolean {
    return this.el.style.display === 'flex';
  }

  show(opts: MenuOptions): void {
    this.el.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    panel.innerHTML = `<h1>⚡ 电力世界</h1><p class="sub">硬核电网建造经营 · 发电 / 输电 / 变电 / 配电 — 选择关卡</p>`;

    if (opts.hasSave) {
      const cont = document.createElement('button');
      cont.className = 'menu-continue';
      cont.textContent = '▶ 继续上次存档' + (opts.saveLabel ? `（${opts.saveLabel}）` : '');
      cont.onclick = () => opts.onContinue();
      panel.appendChild(cont);
    }

    const grid = document.createElement('div');
    grid.className = 'menu-grid';
    for (const s of opts.scenarios) {
      const card = document.createElement('button');
      card.className = 'menu-card';
      const goalsHtml = s.goals ? `<div class="mc-goals" style="margin-top:6px;font-size:11px;color:var(--accent)">🎯 ${s.goals}</div>` : '';
      card.innerHTML = `<div class="mc-name">${s.name}</div><div class="mc-brief">${s.brief}</div>${goalsHtml}`;
      card.onclick = () => opts.onStart(s);
      grid.appendChild(card);
    }
    panel.appendChild(grid);

    this.el.appendChild(panel);
    this.el.style.display = 'flex';
  }

  hide(): void {
    this.el.style.display = 'none';
  }
}
