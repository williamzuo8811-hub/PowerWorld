// 能源品类统计面板（资产组合）：按品类汇总当前资产，点击品类→地图高亮（呼应"能源品类"筛选器）。
import type { PortfolioCategory } from '../sim/simulation';

function fmtK(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : Math.round(n).toString();
}

/** 清洁占比趋势迷你折线图（0..100 固定纵轴） */
function cleanTrend(values: number[]): string {
  if (values.length < 2) return '';
  const w = 320, h = 42;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - (Math.max(0, Math.min(100, v)) / 100) * (h - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const cur = values[values.length - 1];
  return `<div style="color:var(--accent);font-size:11px;letter-spacing:1px;margin:12px 0 2px">📈 清洁占比趋势`
    + `<span style="float:right;color:var(--text-dim);font-weight:400">当前 ${cur.toFixed(0)}%</span></div>`
    + `<svg width="${w}" height="${h}" style="display:block;background:#0e1620;border:1px solid var(--panel-border);border-radius:6px">`
    + `<polyline points="${pts}" fill="none" stroke="#4ade80" stroke-width="1.5"/></svg>`;
}

export interface PortfolioPanelOptions {
  categories: PortfolioCategory[];
  customerSatisfaction: number;
  companyStanding: number;
  marketContestation: number;
  lead: { icon: string; label: string; daysLeft: number; poach: boolean } | null;
  cleanHistory: number[]; // 清洁占比历史（%）
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
    const leadBanner = o.lead
      ? `<div style="margin:6px 0;padding:8px 10px;border-radius:8px;background:${o.lead.poach ? 'rgba(251,191,36,0.16)' : 'rgba(74,222,128,0.14)'};border:1px solid ${o.lead.poach ? 'rgba(251,191,36,0.5)' : 'rgba(74,222,128,0.4)'};font-size:12px">${o.lead.poach ? '🏆 竞品客户机会' : '🎯 招商机会'}：${o.lead.icon}${o.lead.label} · 剩 ${o.lead.daysLeft.toFixed(1)} 天 · ${o.lead.poach ? '接入即从对手赢得（削弱对手）' : '接入享折扣'}</div>`
      : '';
    panel.innerHTML = `<h1>🗂 能源品类</h1>`
      + `<p class="sub">点击品类 → 地图高亮该类资产、淡化其余（再次点击或 Esc 清除）</p>`
      + leadBanner
      + `<div style="display:flex;justify-content:space-between;padding:4px 0">`
      + `<span style="color:var(--text-dim)">大客户加权满意度</span><b class="${satCls}">${(sat * 100).toFixed(0)}%</b></div>`
      + `<div style="display:flex;justify-content:space-between;padding:4px 0">`
      + `<span style="color:var(--text-dim)">招商竞争力（口碑+可靠+满意）</span><b class="${o.companyStanding >= 0.6 ? 'freq-ok' : o.companyStanding >= 0.35 ? 'freq-warn' : 'freq-bad'}">${(o.companyStanding * 100).toFixed(0)}%</b></div>`
      + `<div style="display:flex;justify-content:space-between;padding:4px 0">`
      + `<span style="color:var(--text-dim)">市场招商激烈度（对手抢客）</span><b class="${o.marketContestation > 0.7 ? 'freq-warn' : ''}">${(o.marketContestation * 100).toFixed(0)}%</b></div>`;

    for (const c of o.categories) {
      const hex = '#' + c.color.toString(16).padStart(6, '0');
      const dim = c.count === 0;
      const active = o.activeFilter === c.key;
      const rowEl = document.createElement('div');
      rowEl.style.cssText = `display:flex;align-items:center;gap:10px;border-top:1px solid var(--panel-border);padding:8px 4px;`
        + (dim ? 'opacity:0.4;' : 'cursor:pointer;')
        + (active ? 'background:rgba(56,211,159,0.12);border-radius:6px;' : '');
      const bar = c.share > 0.001
        ? `<div style="height:4px;background:#182431;border-radius:2px;margin-top:3px;overflow:hidden"><div style="width:${Math.min(100, c.share * 100).toFixed(0)}%;height:100%;background:${hex}"></div></div>`
        : '';
      const econ = c.revenueRate > 1
        ? `<span style="color:var(--accent)"> · 售电 ¥${fmtK(c.revenueRate)}/h</span>`
        : c.co2Rate > 0.05
          ? `<span style="color:#f2994a"> · 碳 ${c.co2Rate.toFixed(1)} t/h</span>`
          : '';
      rowEl.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${hex};flex:none"></span>`
        + `<span style="font-size:16px;width:22px;text-align:center">${c.icon}</span>`
        + `<div style="flex:1;min-width:0"><div style="font-size:13px">${c.label}${active ? ' ·已高亮' : ''}</div><div style="font-size:11px;color:var(--text-dim)">${c.value}${econ}</div>${bar}</div>`
        + `<b style="font-size:18px;min-width:34px;text-align:right">${c.count}</b>`;
      if (!dim) rowEl.onclick = () => o.onFilter(active ? null : c.key);
      panel.appendChild(rowEl);
    }

    panel.insertAdjacentHTML('beforeend', cleanTrend(o.cleanHistory));

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
