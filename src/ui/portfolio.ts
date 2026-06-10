// 能源品类统计面板（资产组合）：按品类汇总当前资产，呼应"能源品类"筛选器。
import type { PortfolioCategory } from '../sim/simulation';

export interface PortfolioPanelOptions {
  categories: PortfolioCategory[];
  customerSatisfaction: number;
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

    let rows = '';
    for (const c of o.categories) {
      const hex = '#' + c.color.toString(16).padStart(6, '0');
      const dim = c.count === 0;
      rows += `<div style="display:flex;align-items:center;gap:10px;border-top:1px solid var(--panel-border);padding:8px 0;${dim ? 'opacity:0.4' : ''}">`
        + `<span style="width:8px;height:8px;border-radius:50%;background:${hex};flex:none"></span>`
        + `<span style="font-size:16px;width:22px;text-align:center">${c.icon}</span>`
        + `<div style="flex:1;min-width:0"><div style="font-size:13px">${c.label}</div><div style="font-size:11px;color:var(--text-dim)">${c.value}</div></div>`
        + `<b style="font-size:18px;min-width:34px;text-align:right">${c.count}</b>`
        + `</div>`;
    }

    const sat = o.customerSatisfaction;
    const satCls = sat >= 0.85 ? 'freq-ok' : sat >= 0.6 ? 'freq-warn' : 'freq-bad';

    panel.innerHTML = `<h1>🗂 能源品类</h1>`
      + `<p class="sub">按品类汇总你的资产组合：发电 / 电网 / 储能 / 各类大客户</p>`
      + `<div style="display:flex;justify-content:space-between;padding:4px 0">`
      + `<span style="color:var(--text-dim)">大客户加权满意度</span><b class="${satCls}">${(sat * 100).toFixed(0)}%</b></div>`
      + rows
      + `<p class="sub" style="margin-top:10px">提示：服务高要求大客户（数据中心等）需稳定保供，满意度过低会有流失风险。</p>`;

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
