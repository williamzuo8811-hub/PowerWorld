// 历史走势面板：用内联 SVG 折线图展示现货电价 / 净资产 / 系统需求（复用 #panel）。
import type { HistorySample } from '../sim/simulation';

export interface HistoryPanelOptions {
  history: HistorySample[];
  onClose: () => void;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** 生成一段折线图（自适应数据范围） */
function chart(title: string, values: number[], color: string, unit: string): string {
  const w = 360, h = 60;
  if (values.length < 2) {
    return `<div style="color:var(--accent);font-size:11px;letter-spacing:1px;margin:12px 0 4px">${title}</div><div style="color:var(--text-dim);font-size:12px">数据不足（继续运行以积累）</div>`;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const cur = values[values.length - 1];
  return `<div style="color:var(--accent);font-size:11px;letter-spacing:1px;margin:12px 0 2px">${title}`
    + `<span style="float:right;color:var(--text-dim);font-weight:400">当前 ${fmt(cur)}${unit} · 区间 ${fmt(min)}~${fmt(max)}</span></div>`
    + `<svg width="${w}" height="${h}" style="display:block;background:#0e1620;border:1px solid var(--panel-border);border-radius:6px">`
    + `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}

export class HistoryPanel {
  private el = document.getElementById('panel')!;

  get isOpen(): boolean {
    return this.el.style.display === 'flex';
  }

  show(o: HistoryPanelOptions): void {
    const h = o.history;
    this.el.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    panel.innerHTML = `<h1>📈 走势</h1><p class="sub">近期市场与财务走势（每 2 小时采样，约 ${(h.length * 2 / 24).toFixed(0)} 天）</p>`
      + chart('现货电价 ¥/MWh', h.map((s) => s.spot), '#f2c94c', '')
      + chart('净资产 ¥', h.map((s) => s.netWorth), '#38d39f', '')
      + chart('系统需求 MW', h.map((s) => s.demand), '#56ccf2', '');

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
