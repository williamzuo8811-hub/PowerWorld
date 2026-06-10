// 能源品类统计面板（资产组合）：按品类汇总当前资产，点击品类→地图高亮（呼应"能源品类"筛选器）。
import type { PortfolioCategory } from '../sim/simulation';

export interface PortfolioPanelOptions {
  categories: PortfolioCategory[];
  customerSatisfaction: number;
  activeFilter: string | null;
  onFilter: (key: string | null) => void; // 点击品类→设置地图高亮筛选（再次点击同项=清除）
  onClose: () => void;
}

export class PortfolioPanel {
  private el = document.getElementById('panel')!;

  get isOpen(): boolean {
    return this.el.style.display === 'flex';
  }

  show(o: PortfolioPanelOptions): void {
    this.el.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'menu-panel';

    const sat = o.customerSatisfaction;
    const satCls = sat >= 0.85 ? 'freq-ok' : sat >= 0.6 ? 'freq-warn' : 'freq-bad';
    panel.innerHTML = `<h1>🗂 能源品类</h1>`
      + `<p class="sub">点击品类 → 地图高亮该类资产、淡化其余（再次点击或 Esc 清除）</p>`
      + `<div style="display:flex;justify-content:space-between;padding:4px 0">`
      + `<span style="color:var(--text-dim)">大客户加权满意度</span><b class="${satCls}">${(sat * 100).toFixed(0)}%</b></div>`;

    for (const c of o.categories) {
      const hex = '#' + c.color.toString(16).padStart(6, '0');
      const dim = c.count === 0;
      const active = o.activeFilter === c.key;
      const rowEl = document.createElement('div');
      rowEl.style.cssText = `display:flex;align-items:center;gap:10px;border-top:1px solid var(--panel-border);padding:8px 4px;`
        + (dim ? 'opacity:0.4;' : 'cursor:pointer;')
        + (active ? 'background:rgba(56,211,159,0.12);border-radius:6px;' : '');
      rowEl.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${hex};flex:none"></span>`
        + `<span style="font-size:16px;width:22px;text-align:center">${c.icon}</span>`
        + `<div style="flex:1;min-width:0"><div style="font-size:13px">${c.label}${active ? ' ·已高亮' : ''}</div><div style="font-size:11px;color:var(--text-dim)">${c.value}</div></div>`
        + `<b style="font-size:18px;min-width:34px;text-align:right">${c.count}</b>`;
      if (!dim) rowEl.onclick = () => o.onFilter(active ? null : c.key);
      panel.appendChild(rowEl);
    }

    const hint = document.createElement('p');
    hint.className = 'sub';
    hint.style.marginTop = '10px';
    hint.textContent = '提示：服务高要求大客户（数据中心等）需稳定保供，满意度过低会有流失风险。';
    panel.appendChild(hint);

    const close = document.createElement('button');
    close.className = 'menu-continue';
    close.style.marginTop = '12px';
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
