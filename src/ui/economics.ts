// 投资对比面板：按当前电价/燃料价展示各机组的工期 / 度电成本 / 日均毛利 / 回本（复用 #panel）。
import { genEconomics } from '../game/economics';
import type { FuelType } from '../config/components';

export interface EconPanelOptions {
  tariff: number;
  fuelPrice: Record<FuelType, number>;
  onClose: () => void;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export class EconomicsPanel {
  private el = document.getElementById('panel')!;

  get isOpen(): boolean {
    return this.el.style.display === 'flex';
  }

  show(o: EconPanelOptions): void {
    const rows = genEconomics(o.tariff, o.fuelPrice);
    this.el.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    const fp = o.fuelPrice;
    panel.innerHTML = `<h1>💹 投资对比</h1><p class="sub">理想满发估算（未计间歇/弃风）· 电价 ¥${o.tariff}/MWh · 燃料指数 煤${fp.coal.toFixed(2)}/气${fp.gas.toFixed(2)}/铀${fp.uranium.toFixed(2)} · 回本含工期</p>`;

    const head = `<tr><th>类型</th><th>工期</th><th>容量</th><th>造价</th><th>燃料</th><th>运维/天</th><th>度电成本</th><th>日均毛利</th><th>回本</th></tr>`;
    const body = rows.map((r) => {
      const payback = isFinite(r.paybackDays) ? `${r.paybackDays.toFixed(0)} 天` : '—';
      return `<tr>
        <td>${r.label}${r.co2 === 0 ? ' 🌱' : ''}</td>
        <td>${r.buildDays} 天</td>
        <td>${r.capacity}MW</td>
        <td>¥${fmt(r.capex)}</td>
        <td>${r.fuel === 0 ? '0' : '¥' + r.fuel}/MWh</td>
        <td>¥${fmt(r.omPerDay)}</td>
        <td>¥${r.lcoe.toFixed(1)}/MWh</td>
        <td>¥${fmt(r.dailyProfit)}</td>
        <td>${payback}</td>
      </tr>`;
    }).join('');
    const table = document.createElement('div');
    table.innerHTML = `<table class="econ-table">${head}${body}</table>`;
    panel.appendChild(table);

    const note = document.createElement('p');
    note.className = 'sub';
    note.style.marginTop = '12px';
    note.textContent = '读法：燃气工期短、上手快但燃料贵、毛利薄；风/光🌱工期较长、前期投入高，但零燃料，长期度电成本与毛利更优——代价是靠天吃饭、需调峰/储能兜底。';
    panel.appendChild(note);

    const close = document.createElement('button');
    close.className = 'menu-continue';
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
