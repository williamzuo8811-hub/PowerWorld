// 长期规划压力测试面板（IRP）：在现有机队上跑 what-if 情景，显示充裕度与经济韧性。
import type { StressResult, ExpansionAdvice, YearPlan } from '../sim/simulation';

export interface IRPPanelOptions {
  results: StressResult[];
  advice: ExpansionAdvice;
  trajectory: YearPlan[];
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

    // —— 投资建议 ——
    const a = o.advice;
    const deficitTxt = Number.isFinite(a.deficitDay)
      ? `第 ${a.deficitDay.toFixed(0)} 天（约还有 ${Math.max(0, a.deficitDay - a.curDay).toFixed(0)} 天）`
      : '基准增长下短期不会出现';
    let adviceHtml = '';
    if (a.option) {
      const o2 = a.option;
      const overdue = o2.startByDay <= a.curDay;
      adviceHtml = `<div style="border-top:1px solid var(--panel-border);padding:8px 0;font-size:12px;line-height:1.7">`
        + `<div>约束情景：<b class="freq-warn">${a.bindingScenario}</b> · 可信容量缺口 <b class="freq-bad">${fmt(a.gapMW)}MW</b></div>`
        + `<div>最低成本补强：<b class="freq-ok">${o2.units} × ${o2.label}</b>（每台 ${o2.firmPerUnit.toFixed(0)}MW 可信）· 投资约 <b>¥${fmt(o2.capex)}</b> · 工期 ${o2.buildDays} 天</div>`
        + `<div>赤字日：${deficitTxt}</div>`
        + `<div>建议开工：<b class="${overdue ? 'freq-bad' : 'freq-warn'}">${overdue ? '⚠ 应立即开工（已临近/逾期）' : `不晚于第 ${o2.startByDay.toFixed(0)} 天`}</b></div>`
        + `</div>`;
    } else {
      adviceHtml = `<div style="border-top:1px solid var(--panel-border);padding:8px 0;font-size:12px;line-height:1.7">`
        + `<div><b class="freq-ok">各情景均充裕，暂无补强缺口</b></div>`
        + `<div>赤字日：${deficitTxt}</div>`
        + `</div>`;
    }

    // —— 多年滚动规划轨迹（不新建基线）——
    const firstDeficit = o.trajectory.find((p) => p.verdict === 'shortfall');
    let trajHtml = '<div style="display:flex;flex-direction:column;gap:3px;font-size:12px">';
    for (const p of o.trajectory) {
      const mPct = (p.reserveMargin * 100).toFixed(0);
      const cls = p.verdict === 'shortfall' ? 'freq-bad' : p.verdict === 'tight' ? 'freq-warn' : 'freq-ok';
      const barW = Math.max(2, Math.min(100, (p.reserveMargin + 0.5) * 100)); // -50%..+50% → 0..100
      const barColor = p.verdict === 'shortfall' ? '#ef4444' : p.verdict === 'tight' ? '#f59e0b' : '#22c55e';
      trajHtml += `<div style="display:flex;align-items:center;gap:6px">`
        + `<span style="color:var(--text-dim);width:46px">第${p.year}年</span>`
        + `<span style="width:62px">峰 ${fmt(p.peakDemand)}MW</span>`
        + `<div style="flex:1;height:8px;background:#182431;border-radius:4px;overflow:hidden"><div style="width:${barW}%;height:100%;background:${barColor}"></div></div>`
        + `<b class="${cls}" style="width:46px;text-align:right">${mPct}%</b>`
        + `</div>`;
    }
    trajHtml += '</div>';
    const deficitYearTxt = firstDeficit
      ? `<b class="freq-bad">第 ${firstDeficit.year} 年首现容量缺口</b>（不新建·基准增长下）`
      : `<b class="freq-ok">规划期内（不新建）暂无缺口</b>`;

    panel.innerHTML = `<h1>🧭 长期规划压力测试</h1>`
      + `<p class="sub">在当前机队上模拟 what-if 情景 · 评估夏季晚峰的容量充裕度与经济韧性</p>`
      + rows
      + `<div style="margin-top:12px;font-size:12px;line-height:1.6">${summary}</div>`
      + `<div style="color:var(--accent);font-size:11px;letter-spacing:1px;margin:14px 0 4px">📅 多年滚动规划（不新建 · 备用率）</div>`
      + trajHtml
      + `<div style="margin-top:6px;font-size:12px">${deficitYearTxt}</div>`
      + `<div style="color:var(--accent);font-size:11px;letter-spacing:1px;margin:14px 0 2px">📐 扩容投资建议</div>`
      + adviceHtml
      + `<p class="sub" style="margin-top:6px">「可信容量」= 可调机组 + 储能容量信用 + 新能源极低的尖峰信用。光伏在晚峰几乎不可信，故高比例新能源系统在「新能源枯竭」情景下尤其脆弱。补强方案按"每可信 MW 造价"择优，并扣除工期前置赤字日得出开工时点。</p>`;

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
