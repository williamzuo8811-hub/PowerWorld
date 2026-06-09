// 研发面板：列出科技、显示研发点、解锁科技（纯 DOM 覆盖层）。
import type { TechSpec, TechId } from '../config/tech';

export interface ResearchOptions {
  techs: TechSpec[];
  unlocked: Set<TechId>;
  points: number;
  onUnlock: (id: TechId) => void;
  onClose: () => void;
}

export class ResearchPanel {
  private el = document.getElementById('panel')!;

  get isOpen(): boolean {
    return this.el.style.display === 'flex';
  }

  show(o: ResearchOptions): void {
    this.el.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    panel.innerHTML = `<h1>🔬 研发</h1><p class="sub">研发点 ${o.points.toFixed(0)} · 持续供电即可积累，解锁全局增益</p>`;

    const grid = document.createElement('div');
    grid.className = 'menu-grid';
    for (const t of o.techs) {
      const got = o.unlocked.has(t.id);
      const afford = o.points >= t.cost;
      const card = document.createElement('button');
      card.className = 'menu-card';
      card.disabled = got || !afford;
      const tag = got ? '✅ 已研发' : `${afford ? '可研发' : '点数不足'} · ${t.cost} 点`;
      card.innerHTML = `<div class="mc-name">${t.name} <span style="float:right;font-weight:400;color:var(--text-dim)">${tag}</span></div><div class="mc-brief">${t.desc}</div>`;
      if (!got && afford) card.onclick = () => o.onUnlock(t.id);
      grid.appendChild(card);
    }
    panel.appendChild(grid);

    const close = document.createElement('button');
    close.className = 'menu-continue';
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
