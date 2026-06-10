// 成就面板：按分类展示全部成就的已解锁/未解锁状态（复用 #panel 覆盖层）。
import { ACHIEVEMENTS, ACHV_CATEGORIES } from '../config/achievements';

export interface AchvPanelOptions {
  unlocked: Set<string>;
  onClose: () => void;
}

const CAT_ICON: Record<string, string> = { 里程碑: '🚩', 清洁转型: '🌱', 经营: '💼', 挑战: '🔥' };

export class AchievementsPanel {
  private el = document.getElementById('panel')!;

  get isOpen(): boolean {
    return this.el.style.display === 'flex';
  }

  show(o: AchvPanelOptions): void {
    this.el.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    const got = ACHIEVEMENTS.filter((a) => o.unlocked.has(a.id)).length;
    panel.innerHTML = `<h1>🏆 成就</h1><p class="sub">已解锁 ${got} / ${ACHIEVEMENTS.length} · 跨存档持久化</p>`;

    for (const cat of ACHV_CATEGORIES) {
      const items = ACHIEVEMENTS.filter((a) => a.category === cat);
      if (!items.length) continue;
      const catGot = items.filter((a) => o.unlocked.has(a.id)).length;
      const head = document.createElement('div');
      head.className = 'menu-sec-title';
      head.style.margin = '12px 0 6px';
      head.textContent = `${CAT_ICON[cat] ?? ''} ${cat}（${catGot}/${items.length}）`;
      panel.appendChild(head);

      const grid = document.createElement('div');
      grid.className = 'menu-grid';
      for (const a of items) {
        const has = o.unlocked.has(a.id);
        const card = document.createElement('div');
        card.className = 'menu-card';
        card.style.cursor = 'default';
        if (!has) card.style.opacity = '0.45';
        const mark = has ? '🏆' : '🔒';
        card.innerHTML = `<div class="mc-name">${mark} ${has ? a.name : '？？？'}</div><div class="mc-brief">${a.desc}</div>`;
        grid.appendChild(card);
      }
      panel.appendChild(grid);
    }

    const close = document.createElement('button');
    close.className = 'menu-continue';
    close.style.marginTop = '14px';
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
