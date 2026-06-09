// 财务报表面板：资产负债 + 每日损益 + 市场行情 + 贷款操作（复用 #panel）。
export interface FinanceData {
  money: number;
  assetValue: number;
  debt: number;
  creditLimit: number;
  netWorth: number;
  dailyRate: number;
  finance: { revenue: number; fuel: number; carbon: number; om: number; interest: number; penalty: number; net: number };
  spotPrice: number;
  reserveMargin: number;
  fuelPrice: Record<'coal' | 'gas' | 'uranium', number>;
}

export interface FinancePanelOptions {
  data: FinanceData;
  onBorrow: (amount: number) => void;
  onRepay: (amount: number) => void;
  onClose: () => void;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
function row(label: string, value: string, cls = ''): string {
  return `<div style="display:flex;justify-content:space-between;padding:3px 0"><span style="color:var(--text-dim)">${label}</span><b class="${cls}">${value}</b></div>`;
}
function section(title: string): string {
  return `<div style="color:var(--accent);font-size:11px;letter-spacing:1px;margin:14px 0 4px">${title}</div>`;
}

export class FinancePanel {
  private el = document.getElementById('panel')!;

  get isOpen(): boolean {
    return this.el.style.display === 'flex';
  }

  show(o: FinancePanelOptions): void {
    const d = o.data;
    const f = d.finance;
    const avail = Math.max(0, d.creditLimit - d.debt);
    this.el.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'menu-panel';

    const sign = (n: number) => (n >= 0 ? '+' : '−');
    const abs = (n: number) => `¥${fmt(Math.abs(n))}`;

    panel.innerHTML = `<h1>📊 财务报表</h1><p class="sub">资产负债 · 每日损益（估算）· 市场行情</p>`
      + section('资产负债表')
      + row('现金', `¥${fmt(d.money)}`)
      + row('资产账面价值', `¥${fmt(d.assetValue)}`)
      + row('负债（贷款）', `¥${fmt(d.debt)}`, d.debt > 0 ? 'freq-warn' : '')
      + row('净资产', `¥${fmt(d.netWorth)}`, d.netWorth < 0 ? 'freq-bad' : 'freq-ok')
      + section('每日损益（按当前运行估算）')
      + row('售电收入', `${sign(f.revenue)}${abs(f.revenue)}/天`, 'freq-ok')
      + row('燃料成本', `−${abs(f.fuel)}/天`)
      + row('碳成本', `−${abs(f.carbon)}/天`)
      + row('运维成本', `−${abs(f.om)}/天`)
      + row('贷款利息', `−${abs(f.interest)}/天`)
      + row('失负荷罚款', `−${abs(f.penalty)}/天`, f.penalty > 1 ? 'freq-bad' : '')
      + row('净现金流', `${sign(f.net)}${abs(f.net)}/天`, f.net < 0 ? 'freq-bad' : 'freq-ok')
      + section('市场行情')
      + row('现货电价', `¥${d.spotPrice.toFixed(0)}/MWh`, d.spotPrice > 120 ? 'freq-bad' : '')
      + row('备用率', `${(d.reserveMargin * 100).toFixed(0)}%`, d.reserveMargin < 1 ? 'freq-bad' : '')
      + row('燃料指数（煤/气/铀）', `${d.fuelPrice.coal.toFixed(2)} / ${d.fuelPrice.gas.toFixed(2)} / ${d.fuelPrice.uranium.toFixed(2)}`)
      + section(`融资（信用额度 ¥${fmt(d.creditLimit)} · 可借 ¥${fmt(avail)} · 日利率 ${(d.dailyRate * 100).toFixed(2)}%）`);

    // 贷款按钮
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px';
    const mkBtn = (text: string, enabled: boolean, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.disabled = !enabled;
      b.style.cssText = 'background:#182431;color:var(--text);border:1px solid var(--panel-border);border-radius:6px;padding:7px 11px;cursor:pointer;font-family:inherit;font-size:12px';
      if (!enabled) b.style.opacity = '0.45';
      else b.onclick = fn;
      btns.appendChild(b);
    };
    mkBtn('借入 ¥100k', avail >= 100_000, () => o.onBorrow(100_000));
    mkBtn('借入可借上限', avail >= 1000, () => o.onBorrow(Math.floor(avail)));
    mkBtn('还款 ¥100k', d.debt > 0 && d.money > 0, () => o.onRepay(Math.min(100_000, d.debt)));
    mkBtn('还清全部', d.debt > 0 && d.money > 0, () => o.onRepay(d.debt));
    panel.appendChild(btns);

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
