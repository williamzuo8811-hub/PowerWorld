// 研发面板：按分支展示科技树（前置依赖、锁定状态），解锁科技（纯 DOM 覆盖层）。
import { TECH_BRANCHES, type TechSpec, type TechId } from '../config/tech';

export interface ResearchOptions {
  techs: TechSpec[];
  unlocked: Set<TechId>;
  points: number;
  canUnlock: (id: TechId) => boolean; // 前置是否满足
  onUnlock: (id: TechId) => void;
  onClose: () => void;
}

const BRANCH_ICON: Record<string, string> = {
  输电: '🗼', 发电: '🏭', 储能: '🔋', 智能电网: '🧠', 市场经营: '💼',
};

export class ResearchPanel {
  private el = document.getElementById('panel')!;

  get isOpen(): boolean {
    return this.el.style.display === 'flex';
  }

  show(o: ResearchOptions): void {
    this.el.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    const got = o.techs.filter((t) => o.unlocked.has(t.id)).length;
    panel.innerHTML = `<h1>🔬 研发</h1><p class="sub">研发点 ${o.points.toFixed(0)} · 已解锁 ${got}/${o.techs.length} · 持续供电积累研发点；高阶科技需先解锁前置（五条专精路线）</p>`;

    const nameOf = (id: TechId) => o.techs.find((t) => t.id === id)?.name ?? id;

    for (const branch of TECH_BRANCHES) {
      const techs = o.techs.filter((t) => t.branch === branch);
      if (!techs.length) continue;
      const head = document.createElement('div');
      head.className = 'menu-sec-title';
      head.style.margin = '12px 0 6px';
      head.textContent = `${BRANCH_ICON[branch] ?? ''} ${branch}`;
      panel.appendChild(head);

      const grid = document.createElement('div');
      grid.className = 'menu-grid';
      for (const t of techs) {
        const owned = o.unlocked.has(t.id);
        const prereqOk = o.canUnlock(t.id);
        const afford = o.points >= t.cost;
        const card = document.createElement('button');
        card.className = 'menu-card';
        card.disabled = owned || !prereqOk || !afford;
        let tag: string;
        if (owned) tag = '✅ 已研发';
        else if (!prereqOk) tag = `🔒 需先研发：${(t.requires ?? []).filter((r) => !o.unlocked.has(r)).map(nameOf).join('、')}`;
        else tag = `${afford ? '可研发' : '点数不足'} · ${t.cost} 点`;
        const reqNote = t.requires?.length && !owned && prereqOk
          ? `<span style="color:var(--text-dim)">（前置：${t.requires.map(nameOf).join('、')} ✓）</span>` : '';
        const fitNote = t.fit ? `<div style="margin-top:4px;font-size:11px;color:var(--accent)">🎯 适配：${t.fit}</div>` : '';
        card.title = t.fit ? `适配场景：${t.fit}` : '';
        card.innerHTML = `<div class="mc-name">${t.name} <span style="float:right;font-weight:400;color:var(--text-dim)">${tag}</span></div><div class="mc-brief">${t.desc} ${reqNote}</div>${fitNote}`;
        if (!owned && prereqOk && afford) card.onclick = () => o.onUnlock(t.id);
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
