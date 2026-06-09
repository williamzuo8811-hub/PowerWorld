// 财务报表面板：资产负债 + 每日损益 + 市场行情 + 贷款操作（复用 #panel）。
import { INTERCONNECTOR_CAPACITY, MARKET_FEE_PER_DAY } from '../config/components';

export interface FinanceData {
  money: number;
  assetValue: number;
  debt: number;
  creditLimit: number;
  netWorth: number;
  dailyRate: number;
  finance: {
    revenue: number; fuel: number; carbon: number; om: number; interest: number; penalty: number; hedge: number; rec: number; insurance: number; market: number; net: number;
    byClass: { residential: number; commercial: number; industrial: number };
  };
  insured: boolean;
  premiumPerDay: number;
  creditRating: string;
  creditScore: number;
  marketEnabled: boolean;
  marketImport: number;
  marketShare: number;
  clearingPrice: number;
  regionalDemand: number;
  competitors: { name: string; capacity: number; marginalCost: number }[];
  spotPrice: number;
  reserveMargin: number;
  fuelPrice: Record<'coal' | 'gas' | 'uranium', number>;
  fuelContracts: Partial<Record<'coal' | 'gas' | 'uranium', { index: number; endClock: number }>>;
  carbon: { intensity: number; benchmark: number; price: number };
  recPrice: number;
  avgSpot: number;
  clock: number;
  hedges: { volume: number; strike: number; endClock: number }[];
}

export interface FinancePanelOptions {
  data: FinanceData;
  onBorrow: (amount: number) => void;
  onRepay: (amount: number) => void;
  onHedge: (volume: number, days: number) => void;
  onFuelContract: (fuel: 'coal' | 'gas' | 'uranium', days: number) => void;
  onToggleInsurance: () => void;
  onToggleMarket: () => void;
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
      + row('信用评级', `${d.creditRating}（${d.creditScore.toFixed(0)}）`,
        d.creditScore >= 70 ? 'freq-ok' : d.creditScore >= 40 ? 'freq-warn' : 'freq-bad')
      + section('每日损益（按当前运行估算）')
      + row('售电收入', `${sign(f.revenue)}${abs(f.revenue)}/天`, 'freq-ok')
      + row('· 居民 / 商业 / 工业', `${abs(f.byClass.residential)} / ${abs(f.byClass.commercial)} / ${abs(f.byClass.industrial)}`)
      + row('燃料成本', `−${abs(f.fuel)}/天`)
      + row('碳配额', `${f.carbon >= 0 ? '−' : '+'}${abs(f.carbon)}/天`, f.carbon < 0 ? 'freq-ok' : '')
      + row('运维成本', `−${abs(f.om)}/天`)
      + row('贷款利息', `−${abs(f.interest)}/天`)
      + row('失负荷罚款', `−${abs(f.penalty)}/天`, f.penalty > 1 ? 'freq-bad' : '')
      + row('套保差价', `${f.hedge >= 0 ? '+' : '−'}${abs(f.hedge)}/天`, f.hedge < 0 ? '' : 'freq-ok')
      + row('绿证收入', `+${abs(f.rec)}/天`, f.rec > 1 ? 'freq-ok' : '')
      + row('保险(净)', `${f.insurance >= 0 ? '+' : '−'}${abs(f.insurance)}/天`, f.insurance < 0 ? '' : 'freq-ok')
      + row('市场购电', `${f.market >= 0 ? '+' : '−'}${abs(f.market)}/天`, f.market < -1 ? 'freq-warn' : '')
      + row('净现金流', `${sign(f.net)}${abs(f.net)}/天`, f.net < 0 ? 'freq-bad' : 'freq-ok')
      + section('市场行情')
      + row('现货电价', `¥${d.spotPrice.toFixed(0)}/MWh`, d.spotPrice > 120 ? 'freq-bad' : '')
      + row('备用率', `${(d.reserveMargin * 100).toFixed(0)}%`, d.reserveMargin < 1 ? 'freq-bad' : '')
      + row('燃料指数（煤/气/铀）', `${d.fuelPrice.coal.toFixed(2)} / ${d.fuelPrice.gas.toFixed(2)} / ${d.fuelPrice.uranium.toFixed(2)}`)
      + section('碳 / 绿色市场')
      + row('排放强度 / 基准', `${d.carbon.intensity.toFixed(2)} / ${d.carbon.benchmark.toFixed(2)} t/MWh`,
        d.carbon.intensity > d.carbon.benchmark ? 'freq-warn' : 'freq-ok')
      + row('配额价', `¥${d.carbon.price.toFixed(1)}/吨`)
      + row('绿证价', `¥${d.recPrice.toFixed(1)}/MWh`, 'freq-ok')
      + section('区域市场（含竞争对手）')
      + row('区域需求', `${d.regionalDemand.toFixed(0)} MW`)
      + row('出清价 / 你的市占', `¥${d.clearingPrice.toFixed(0)} · ${(d.marketShare * 100).toFixed(0)}%`,
        d.marketShare > 0.25 ? 'freq-ok' : d.marketShare < 0.1 ? 'freq-warn' : '')
      + d.competitors.map((c) => row(`· ${c.name}`, `${c.capacity}MW @¥${c.marginalCost}/MWh`)).join('');

    const mkBtn = (parent: HTMLElement, text: string, enabled: boolean, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.disabled = !enabled;
      b.style.cssText = 'background:#182431;color:var(--text);border:1px solid var(--panel-border);border-radius:6px;padding:7px 11px;cursor:pointer;font-family:inherit;font-size:12px';
      if (!enabled) b.style.opacity = '0.45';
      else b.onclick = fn;
      parent.appendChild(b);
    };

    // 燃料长约
    panel.insertAdjacentHTML('beforeend', section('燃料长约（锁定燃料价格指数，对冲涨价）'));
    const fuels = ['coal', 'gas', 'uranium'] as const;
    const fuelLabel: Record<typeof fuels[number], string> = { coal: '煤', gas: '气', uranium: '铀' };
    const fuelInfo = document.createElement('div');
    fuelInfo.style.cssText = 'font-size:12px;margin:2px 0 6px';
    fuelInfo.innerHTML = fuels.map((fu) => {
      const c = d.fuelContracts[fu];
      const active = !!c && d.clock < c.endClock;
      const status = active
        ? `锁定 ${c!.index.toFixed(2)} · 剩 ${((c!.endClock - d.clock) / 24).toFixed(1)}天`
        : `现货 ${d.fuelPrice[fu].toFixed(2)}`;
      return `<div style="display:flex;justify-content:space-between"><span style="color:var(--text-dim)">${fuelLabel[fu]}</span><b class="${active ? 'freq-ok' : ''}">${status}</b></div>`;
    }).join('');
    panel.appendChild(fuelInfo);
    const fuelBtns = document.createElement('div');
    fuelBtns.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px';
    mkBtn(fuelBtns, '锁定煤 15天', d.money > 0, () => o.onFuelContract('coal', 15));
    mkBtn(fuelBtns, '锁定气 15天', d.money > 0, () => o.onFuelContract('gas', 15));
    mkBtn(fuelBtns, '锁定铀 15天', d.money > 0, () => o.onFuelContract('uranium', 15));
    panel.appendChild(fuelBtns);

    // 套期保值
    panel.insertAdjacentHTML('beforeend', section(`套期保值（远期报价 ¥${d.avgSpot.toFixed(0)}/MWh · 锁价以平抑现货波动）`));

    // 活跃套保合约列表
    const hedgeList = document.createElement('div');
    hedgeList.style.cssText = 'font-size:12px;margin:2px 0 8px';
    if (d.hedges.length === 0) {
      hedgeList.innerHTML = `<span style="color:var(--text-dim)">暂无活跃合约</span>`;
    } else {
      hedgeList.innerHTML = d.hedges.map((h) => {
        const daysLeft = Math.max(0, (h.endClock - d.clock) / 24);
        const plDay = (h.strike - d.spotPrice) * h.volume * 24;
        return `<div style="display:flex;justify-content:space-between"><span style="color:var(--text-dim)">${h.volume}MW @ ¥${h.strike} · 剩 ${daysLeft.toFixed(1)}天</span><b class="${plDay >= 0 ? 'freq-ok' : 'freq-bad'}">${plDay >= 0 ? '+' : '−'}¥${fmt(Math.abs(plDay))}/天</b></div>`;
      }).join('');
    }
    panel.appendChild(hedgeList);

    const hedgeBtns = document.createElement('div');
    hedgeBtns.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px';
    mkBtn(hedgeBtns, '锁定 20MW×5天', d.money > 0, () => o.onHedge(20, 5));
    mkBtn(hedgeBtns, '锁定 50MW×10天', d.money > 0, () => o.onHedge(50, 10));
    panel.appendChild(hedgeBtns);

    // 设备保险
    panel.insertAdjacentHTML('beforeend', section(`设备保险（${d.insured ? '已投保' : '未投保'} · 日保费 ¥${fmt(d.premiumPerDay)} · 赔付 80%）`));
    const insBtns = document.createElement('div');
    insBtns.style.cssText = 'display:flex;gap:6px;margin-bottom:6px';
    mkBtn(insBtns, d.insured ? '退保' : '投保', true, () => o.onToggleInsurance());
    panel.appendChild(insBtns);

    // 批发市场互联
    panel.insertAdjacentHTML('beforeend', section(`批发市场（${d.marketEnabled ? '已接入' : '未接入'} · 联络线 ${INTERCONNECTOR_CAPACITY}MW · 当前购电 ${d.marketImport.toFixed(0)}MW · 日费 ¥${fmt(MARKET_FEE_PER_DAY)}）`));
    const mktBtns = document.createElement('div');
    mktBtns.style.cssText = 'display:flex;gap:6px;margin-bottom:6px';
    mkBtn(mktBtns, d.marketEnabled ? '断开联络线' : '接入市场', true, () => o.onToggleMarket());
    panel.appendChild(mktBtns);

    panel.insertAdjacentHTML('beforeend', section(`融资（信用额度 ¥${fmt(d.creditLimit)} · 可借 ¥${fmt(avail)} · 日利率 ${(d.dailyRate * 100).toFixed(2)}%）`));

    // 贷款按钮
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px';
    mkBtn(btns, '借入 ¥100k', avail >= 100_000, () => o.onBorrow(100_000));
    mkBtn(btns, '借入可借上限', avail >= 1000, () => o.onBorrow(Math.floor(avail)));
    mkBtn(btns, '还款 ¥100k', d.debt > 0 && d.money > 0, () => o.onRepay(Math.min(100_000, d.debt)));
    mkBtn(btns, '还清全部', d.debt > 0 && d.money > 0, () => o.onRepay(d.debt));
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
