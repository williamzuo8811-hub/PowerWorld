// 长期规划压力测试面板（IRP）：在现有机队上跑 what-if 情景，显示充裕度与经济韧性。
import type { StressResult } from '../sim/simulation';

export interface IRPPanelOptions {
  results: StressResult[];
  onClose: () => void;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export class IRPPanel {
  private el = document.getElementById('panel')!;

  get isOpen(): boolean {
    return this.el.style.display === 'flex';
  }

  show(o: IRPPanelOptions): void {
    this.el.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'menu-panel';

    const verdictTag = (v: StressResult['verdict']): string =>
      v === 'adequate' ? '<b class="freq-ok">充裕</b>'
        : v === 'tight' ? '<b class="freq-warn">偏紧</b>'
          : '<b class="freq-bad">缺口</b>';

    const shortfalls = o.results.filter((r) => r.verdict === 'shortfall').length;
    const tights = o.results.filter((r) => r.verdict === 'tight').length;

    let rows = '';
    for (const r of o.results) {
      const mPct = (r.reserveMargin * 100).toFixed(0);
      const mSign = r.reserveMargin >= 0 ? '+' : '';
      const mCls = r.reserveMargin < 0 ? 'freq-bad' : r.reserveMargin < 0.15 ? 'freq-warn' : 'freq-ok';
      rows += `<div style="border-top:1px solid var(--panel-border);padding:7px 0">`
        + `<div style="display:flex;justify-content:space-between;align-items:center"><b>${r.name}</b>${verdictTag(r.verdict)}</div>`
        + `<div style="display:flex;justify-content:space-between;color:var(--text-dim);font-size:12px"><span>峰值 ${fmt(r.peakDemand)}MW · 可信容量 ${fmt(r.firmSupply)}MW</span><b class="${mCls}">备用 ${mSign}${mPct}%</b></div>`
        + `<div style="display:flex;justify-content:space-between;color:var(--text-dim);font-size:12px"><span>粗估日净现金流</span><b class="${r.dailyNet < 0 ? 'freq-bad' : 'freq-ok'}">${r.dailyNet >= 0 ? '+' : '−'}¥${fmt(Math.abs(r.dailyNet))}/天</b></div>`
        + `</div>`;
    }

    const summary = shortfalls > 0
      ? `<b class="freq-bad">${shortfalls} 个情景容量缺口</b> · 建议提前规划可调容量（火电/储能）或加快新能源并网`
      : tights > 0
        ? `<b class="freq-warn">${tights} 个情景备用偏紧</b> · 留意需求增长与新能源出力波动`
        : `<b class="freq-ok">全部情景容量充裕</b> · 机队具备较好韧性`;

    panel.innerHTML = `<h1>🧭 长期规划压力测试</h1>`
      + `<p class="sub">在当前机队上模拟 what-if 情景 · 评估夏季晚峰的容量充裕度与经济韧性</p>`
      + rows
      + `<div style="margin-top:12px;font-size:12px;line-height:1.6">${summary}</div>`
      + `<p class="sub" style="margin-top:8px">「可信容量」= 可调机组 + 储能容量信用 + 新能源极低的尖峰信用。光伏在晚峰几乎不可信，故高比例新能源系统在「新能源枯竭」情景下尤其脆弱。</p>`;

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
