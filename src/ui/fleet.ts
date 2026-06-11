// 机队管理 / 网络分析面板：把"数据有但没暴露"的运行信息开给玩家——
// 逐机组出力/成本/役龄排序表、储能状态、线路拥塞排行与 N-1 薄弱点摘要。
import type { Simulation } from '../sim/simulation';
import { PLANTS, STORAGE } from '../config/components';
import { analyzeN1 } from '../sim/contingency';

export interface FleetPanelOptions {
  sim: Simulation;
  onMaintain: (busId: number) => void; // 安排检修
  onClose: () => void;
}

export class FleetPanel {
  private el = document.getElementById('panel')!;

  get isOpen(): boolean {
    return this.el.style.display === 'flex';
  }

  show(o: FleetPanelOptions): void {
    const sim = o.sim;
    this.el.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    panel.innerHTML = `<h1>🏭 机队管理 / 网络分析</h1><p class="sub">逐机组运行台账 · 线路拥塞排行 · N-1 薄弱点</p>`;

    // —— 机组台账（按磨损降序：最该检修的排最前）——
    const gens = [...sim.grid.gens.values()]
      .map((g) => ({ g, bus: sim.grid.buses.get(g.busId) }))
      .filter((x) => x.bus)
      .sort((a, b) => sim.wear(b.g) - sim.wear(a.g));
    const genHead = document.createElement('div');
    genHead.className = 'menu-sec-title';
    genHead.textContent = `⚙ 机组（${gens.length}）—— 按磨损排序`;
    panel.appendChild(genHead);
    const tbl = document.createElement('table');
    tbl.className = 'econ-table';
    const rows = gens.map(({ g, bus }) => {
      const offline = sim.genOffline(g);
      const status = bus!.underConstruction ? '🏗 在建'
        : offline ? '🔧 检修'
          : g.dispatchable ? (g.committed ? '🟢 并网' : '⚪ 解列') : '🌤 看天';
      const wear = sim.wear(g);
      const wearCls = wear > 0.7 ? 'style="color:var(--danger)"' : wear > 0.45 ? 'style="color:var(--warn)"' : '';
      const mc = sim.effMarginalCost(g);
      const maintBtn = !bus!.underConstruction && !offline && g.dispatchable
        ? `<button class="save-mini" data-maint="${bus!.id}" title="安排计划检修（降役龄/故障率）">🛠</button>` : '';
      return `<tr><td>${bus!.name}</td><td>${PLANTS[g.type].label}</td><td>${g.output.toFixed(0)}/${g.capacity}</td>
        <td>¥${mc.toFixed(0)}</td><td ${wearCls}>${(wear * 100).toFixed(0)}%</td><td>${g.age.toFixed(0)}天</td><td>${status}</td><td>${maintBtn}</td></tr>`;
    }).join('');
    tbl.innerHTML = `<thead><tr><th>机组</th><th>类型</th><th>出力MW</th><th>边际成本</th><th>磨损</th><th>役龄</th><th>状态</th><th></th></tr></thead><tbody>${rows}</tbody>`;
    panel.appendChild(tbl);

    // —— 储能台账 ——
    const bats = [...sim.grid.batteries.values()];
    if (bats.length) {
      const bHead = document.createElement('div');
      bHead.className = 'menu-sec-title';
      bHead.style.marginTop = '14px';
      bHead.textContent = `🔋 储能（${bats.length}）`;
      panel.appendChild(bHead);
      const bt = document.createElement('table');
      bt.className = 'econ-table';
      bt.innerHTML = `<thead><tr><th>站点</th><th>类型</th><th>SoC</th><th>功率MW</th><th>状态</th></tr></thead><tbody>${bats.map((b) => {
        const bus = sim.grid.buses.get(b.busId);
        const soc = (b.soc / b.energyCapacity) * 100;
        const act = b.output > 0.1 ? `放电 ${b.output.toFixed(0)}` : b.output < -0.1 ? `充电 ${(-b.output).toFixed(0)}` : '待机';
        return `<tr><td>${bus?.name ?? '?'}</td><td>${STORAGE[b.type].label}</td><td>${soc.toFixed(0)}%</td><td>${b.powerRating}</td><td>${bus?.underConstruction ? '🏗 在建' : act}</td></tr>`;
      }).join('')}</tbody>`;
      panel.appendChild(bt);
    }

    // —— 网络分析：线路拥塞排行（负载率 top8）——
    const lines = [...sim.grid.lines.values()]
      .filter((ln) => sim.grid.lineActive(ln))
      .map((ln) => ({ ln, load: sim.effLineCapacity(ln) > 0 ? Math.abs(ln.flow) / sim.effLineCapacity(ln) : 0 }))
      .sort((a, b) => b.load - a.load)
      .slice(0, 8);
    const nHead = document.createElement('div');
    nHead.className = 'menu-sec-title';
    nHead.style.marginTop = '14px';
    nHead.textContent = '🔌 线路拥塞排行（负载率 Top 8）——70% 以上开始计阻塞费';
    panel.appendChild(nHead);
    const lt = document.createElement('table');
    lt.className = 'econ-table';
    lt.innerHTML = `<thead><tr><th>线路</th><th>等级</th><th>潮流MW</th><th>热极限</th><th>负载率</th></tr></thead><tbody>${lines.map(({ ln, load }) => {
      const a = sim.grid.buses.get(ln.from)?.name ?? '?';
      const b = sim.grid.buses.get(ln.to)?.name ?? '?';
      const cls = load > 0.95 ? 'style="color:var(--danger)"' : load > 0.7 ? 'style="color:var(--warn)"' : '';
      return `<tr><td>${a} ↔ ${b}</td><td>${ln.voltage}</td><td>${Math.abs(ln.flow).toFixed(0)}</td><td>${sim.effLineCapacity(ln).toFixed(0)}</td><td ${cls}>${(load * 100).toFixed(0)}%</td></tr>`;
    }).join('')}</tbody>`;
    panel.appendChild(lt);

    // —— N-1 薄弱点摘要 ——
    const rep = analyzeN1(sim.grid);
    const n1Head = document.createElement('div');
    n1Head.className = 'menu-sec-title';
    n1Head.style.marginTop = '14px';
    n1Head.textContent = `🛡 N-1 冗余：${rep.checked === 0 ? '电网太小暂无可校核项' : rep.secure ? '✅ 安全（任一元件失效不停电）' : `⚠ ${rep.contingencies.length}/${rep.checked} 个薄弱点`}`;
    panel.appendChild(n1Head);
    if (!rep.secure && rep.contingencies.length) {
      const list = document.createElement('div');
      list.style.cssText = 'font-size:12px;color:var(--text-dim);line-height:1.8';
      list.innerHTML = rep.contingencies.slice(0, 5).map((c) => {
        const parts: string[] = [];
        if (c.lostLoadMW > 0.5) parts.push(`失负荷 ${c.lostLoadMW.toFixed(0)}MW`);
        if (c.overloads.length) parts.push(`过载 ${c.overloads.length} 处`);
        return `· 失去「${c.name}」→ ${parts.join('、') || '孤岛'}`;
      }).join('<br>');
      panel.appendChild(list);
    }

    const close = document.createElement('button');
    close.className = 'menu-continue';
    close.style.marginTop = '14px';
    close.textContent = '关闭';
    close.onclick = () => o.onClose();
    panel.appendChild(close);

    this.el.appendChild(panel);
    this.el.style.display = 'flex';
    // 检修按钮事件委托
    panel.querySelectorAll<HTMLButtonElement>('button[data-maint]').forEach((b) => {
      b.onclick = () => o.onMaintain(parseInt(b.dataset.maint!, 10));
    });
  }

  hide(): void {
    this.el.style.display = 'none';
  }
}
