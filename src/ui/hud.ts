// HUD：用普通 DOM 叠加在画布上，负责状态栏、速度、工具栏、日志、检查器、结束遮罩。
// 渲染与仿真无关，只读快照 + 暴露当前工具/速度给 main 使用。
import type { SimSnapshot, LogEntry } from '../sim/types';
import {
  PLANTS, SUBSTATION_CAPEX, SUBSTATION_BUILD_DAYS, STORAGE, VOLTAGE, TIME_SCALES, FREQ_NOMINAL,
  CAPACITOR_Q, CAPACITOR_CAPEX, BACKUP_CAPEX, CONTRACT_DAYS, CONTRACT_DISCOUNT, KEY_ACCOUNTS,
} from '../config/components';

export type ToolId =
  | 'inspect' | 'line' | 'substation'
  | 'coal' | 'gas' | 'wind' | 'solar' | 'nuclear' | 'hydro' | 'biomass' | 'battery' | 'pumped' | 'hydrogen'
  | 'datacenter' | 'transport' | 'petrochem' | 'mining'
  | 'maintenance' | 'ccs' | 'capacitor' | 'backup' | 'contract' | 'bulldoze';

interface ToolDef { id: ToolId; label: string; sub: string; }

const TOOLS: ToolDef[] = [
  { id: 'inspect', label: '🔍 检查 / 重合闸', sub: '查看·恢复跳闸线路/变压器' },
  { id: 'line', label: '➖ 拉线路', sub: `HV¥${fmt(VOLTAGE.HV.costPerTile)} · MV¥${fmt(VOLTAGE.MV.costPerTile)} /格` },
  { id: 'substation', label: '◆ 变电站', sub: `¥${fmt(SUBSTATION_CAPEX)}·工期${SUBSTATION_BUILD_DAYS}天` },
  { id: 'coal', label: '■ 燃煤 60MW', sub: `¥${fmt(PLANTS.coal.capex)}·工期${PLANTS.coal.buildDays}天·脏` },
  { id: 'gas', label: '■ 燃气 40MW', sub: `¥${fmt(PLANTS.gas.capex)}·工期${PLANTS.gas.buildDays}天·贵` },
  { id: 'wind', label: '■ 风电 30MW', sub: `¥${fmt(PLANTS.wind.capex)}·工期${PLANTS.wind.buildDays}天·看风` },
  { id: 'solar', label: '■ 光伏 30MW', sub: `¥${fmt(PLANTS.solar.capex)}·工期${PLANTS.solar.buildDays}天·白天` },
  { id: 'nuclear', label: '■ 核电 120MW', sub: `¥${fmt(PLANTS.nuclear.capex)}·工期${PLANTS.nuclear.buildDays}天·基荷` },
  { id: 'hydro', label: `■ 水电 ${PLANTS.hydro.capacity}MW`, sub: `¥${fmt(PLANTS.hydro.capex)}·工期${PLANTS.hydro.buildDays}天·清洁可调·看来水` },
  { id: 'biomass', label: `■ 生物质 ${PLANTS.biomass.capacity}MW`, sub: `¥${fmt(PLANTS.biomass.capex)}·工期${PLANTS.biomass.buildDays}天·清洁基荷` },
  { id: 'battery', label: `▰ 电池 ${STORAGE.battery.powerRating}MW`, sub: `¥${fmt(STORAGE.battery.capex)}·4h·工期${STORAGE.battery.buildDays}天` },
  { id: 'pumped', label: `▰ 抽蓄 ${STORAGE.pumped.powerRating}MW`, sub: `¥${fmt(STORAGE.pumped.capex)}·12h·工期${STORAGE.pumped.buildDays}天` },
  { id: 'hydrogen', label: `▰ 氢储 ${STORAGE.hydrogen.powerRating}MW`, sub: `¥${fmt(STORAGE.hydrogen.capex)}·60h·工期${STORAGE.hydrogen.buildDays}天` },
  { id: 'datacenter', label: `${KEY_ACCOUNTS.datacenter.icon} 数据中心 ${KEY_ACCOUNTS.datacenter.baseDemand}MW`, sub: `¥${fmt(KEY_ACCOUNTS.datacenter.connectionCapex)}·溢价·要可靠（SLA）` },
  { id: 'transport', label: `${KEY_ACCOUNTS.transport.icon} 大交通枢纽 ${KEY_ACCOUNTS.transport.baseDemand}MW`, sub: `¥${fmt(KEY_ACCOUNTS.transport.connectionCapex)}·通勤双峰+牵引` },
  { id: 'petrochem', label: `${KEY_ACCOUNTS.petrochem.icon} 石化·LNG ${KEY_ACCOUNTS.petrochem.baseDemand}MW`, sub: `¥${fmt(KEY_ACCOUNTS.petrochem.connectionCapex)}·巨型基荷·可中断` },
  { id: 'mining', label: `${KEY_ACCOUNTS.mining.icon} 矿业 ${KEY_ACCOUNTS.mining.baseDemand}MW`, sub: `¥${fmt(KEY_ACCOUNTS.mining.connectionCapex)}·巨型平稳·常偏远` },
  { id: 'maintenance', label: '🛠 计划检修', sub: '点电厂大修·降役龄/故障率' },
  { id: 'ccs', label: '🌫 碳捕集', sub: '点火电改造·捕碳但成本升' },
  { id: 'capacitor', label: `⚡ 电容器组 ${CAPACITOR_Q}MVAr`, sub: `点变电站·¥${fmt(CAPACITOR_CAPEX)}·补无功支撑电压` },
  { id: 'backup', label: '🔋 自备应急电源', sub: `点大客户·¥${fmt(BACKUP_CAPEX)}·停电兜底防流失` },
  { id: 'contract', label: '📜 大客户长约', sub: `点大客户·${CONTRACT_DAYS}天锁忠诚·电价折让${(CONTRACT_DISCOUNT * 100).toFixed(0)}%` },
  { id: 'bulldoze', label: '✕ 拆除', sub: '退役设备 / 线路(返残值)' },
];

// 工具分类（可折叠）：把 20+ 工具按用途归组，缩短建造栏
const TOOL_GROUPS: { label: string; ids: ToolId[]; collapsed?: boolean }[] = [
  { label: '电网', ids: ['line', 'substation', 'capacitor'] },
  { label: '电源', ids: ['coal', 'gas', 'wind', 'solar', 'nuclear', 'hydro', 'biomass'] },
  { label: '储能', ids: ['battery', 'pumped', 'hydrogen'], collapsed: true },
  { label: '大客户', ids: ['datacenter', 'transport', 'petrochem', 'mining'], collapsed: true },
  { label: '改造 / 合约', ids: ['ccs', 'backup', 'contract', 'maintenance'], collapsed: true },
  { label: '其他', ids: ['inspect', 'bulldoze'] },
];
const TOOL_BY_ID = new Map(TOOLS.map((t) => [t.id, t]));

export class Hud {
  currentTool: ToolId = 'line';
  onSave?: () => void; // 存档按钮回调
  onMenu?: () => void; // 菜单按钮回调
  onN1?: () => void; // N-1 校核按钮回调
  onResearch?: () => void; // 研发面板按钮回调
  onAchievements?: () => void; // 成就面板按钮回调
  onEconomics?: () => void; // 投资对比面板按钮回调
  onFinance?: () => void; // 财务报表面板按钮回调
  onHistory?: () => void; // 走势面板按钮回调
  onIRP?: () => void; // 长期规划压力测试面板按钮回调
  onPortfolio?: () => void; // 能源品类统计面板按钮回调
  onToggleSound?: () => void; // 静音切换回调
  onContinueAfterWin?: () => void; // 通关后"继续经营"回调（转入无尽模式）
  private soundBtn?: HTMLButtonElement;
  private speedIndex = 0; // 默认暂停，先让玩家布网

  private statVals = new Map<string, HTMLElement>();
  private toolBtns = new Map<ToolId, HTMLButtonElement>();
  private collapsedGroups = new Set<number>(TOOL_GROUPS.map((g, i) => (g.collapsed ? i : -1)).filter((i) => i >= 0));
  private speedBtns: HTMLButtonElement[] = [];
  private logEl!: HTMLElement;
  private inspectorEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private tutorialEl!: HTMLElement;

  get timeScale(): number {
    return TIME_SCALES[this.speedIndex];
  }
  get paused(): boolean {
    return this.speedIndex === 0;
  }

  build(): void {
    this.buildTopbar();
    this.buildToolbar();
    this.logEl = document.getElementById('log')!;
    this.logEl.innerHTML = `<div class="title">事件日志</div><div id="log-body"></div>`;
    this.inspectorEl = document.getElementById('inspector')!;
    this.hintEl = document.getElementById('hint')!;
    this.tutorialEl = document.getElementById('tutorial')!;
  }

  setTutorial(text: string | null): void {
    this.tutorialEl.style.display = text ? 'block' : 'none';
    if (text) this.tutorialEl.textContent = text;
  }

  private buildTopbar(): void {
    const bar = document.getElementById('topbar')!;
    bar.innerHTML = '';
    const add = (key: string, label: string) => {
      const wrap = document.createElement('div');
      wrap.className = 'stat';
      wrap.innerHTML = `<span class="k">${label}</span><span class="v" id="stat-${key}">—</span>`;
      bar.appendChild(wrap);
      this.statVals.set(key, wrap.querySelector('.v')!);
    };
    add('money', '资金');
    add('networth', '净资产');
    add('time', '时间');
    add('freq', '频率');
    add('volt', '电压');
    add('balance', '发电 / 需求');
    add('price', '现货电价');
    add('loss', '线损');
    add('reliab', '可靠性');
    add('co2', '碳排');
    add('green', '清洁占比');
    add('rep', '口碑');
    add('share', '市占');
    add('commit', '机组');
    add('resil', '韧性');
    add('cycle', '景气');
    add('season', '季节');
    add('weather', '天气');
    add('forecast', '预报');
    add('policy', '政策');
    add('rp', '研发点');
    add('grade', '评级');
    add('goal', '目标');

    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    bar.appendChild(spacer);

    const speed = document.createElement('div');
    speed.id = 'speed';
    const labels = ['⏸', '▶', '▶▶', '▶▶▶'];
    labels.forEach((lab, i) => {
      const b = document.createElement('button');
      b.textContent = lab;
      b.onclick = () => this.setSpeed(i);
      speed.appendChild(b);
      this.speedBtns.push(b);
    });
    bar.appendChild(speed);

    // N-1 校核 / 存档 / 菜单
    const sys = document.createElement('div');
    sys.id = 'speed';
    const researchBtn = document.createElement('button');
    researchBtn.textContent = '🔬'; researchBtn.title = '研发 / 科技树'; researchBtn.onclick = () => this.onResearch?.();
    const achvBtn = document.createElement('button');
    achvBtn.textContent = '🏆'; achvBtn.title = '成就'; achvBtn.onclick = () => this.onAchievements?.();
    const econBtn = document.createElement('button');
    econBtn.textContent = '💹'; econBtn.title = '投资对比（工期/度电成本/回本）'; econBtn.onclick = () => this.onEconomics?.();
    const finBtn = document.createElement('button');
    finBtn.textContent = '📊'; finBtn.title = '财务报表 / 贷款'; finBtn.onclick = () => this.onFinance?.();
    const histBtn = document.createElement('button');
    histBtn.textContent = '📈'; histBtn.title = '市场 / 财务走势'; histBtn.onclick = () => this.onHistory?.();
    const irpBtn = document.createElement('button');
    irpBtn.textContent = '🧭'; irpBtn.title = '长期规划压力测试（IRP）'; irpBtn.onclick = () => this.onIRP?.();
    const portfolioBtn = document.createElement('button');
    portfolioBtn.textContent = '🗂'; portfolioBtn.title = '能源品类统计（资产组合）'; portfolioBtn.onclick = () => this.onPortfolio?.();
    const n1Btn = document.createElement('button');
    n1Btn.textContent = 'N-1'; n1Btn.title = 'N-1 冗余校核'; n1Btn.onclick = () => this.onN1?.();
    const soundBtn = document.createElement('button');
    soundBtn.textContent = '🔊'; soundBtn.title = '音效开关'; soundBtn.onclick = () => this.onToggleSound?.();
    this.soundBtn = soundBtn;
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '💾'; saveBtn.title = '存档'; saveBtn.onclick = () => this.onSave?.();
    const menuBtn = document.createElement('button');
    menuBtn.textContent = '☰'; menuBtn.title = '菜单 / 关卡'; menuBtn.onclick = () => this.onMenu?.();
    sys.appendChild(researchBtn);
    sys.appendChild(achvBtn);
    sys.appendChild(econBtn);
    sys.appendChild(finBtn);
    sys.appendChild(histBtn);
    sys.appendChild(irpBtn);
    sys.appendChild(portfolioBtn);
    sys.appendChild(n1Btn);
    sys.appendChild(soundBtn);
    sys.appendChild(saveBtn);
    sys.appendChild(menuBtn);
    bar.appendChild(sys);

    this.refreshSpeedButtons();
  }

  private buildToolbar(): void {
    const tb = document.getElementById('toolbar')!;
    tb.innerHTML = '<div class="title">建造工具（数字键 1-9 · 点分类标题折叠）</div>';
    this.toolBtns.clear();
    TOOL_GROUPS.forEach((grp, gi) => {
      const collapsed = this.collapsedGroups.has(gi);
      const header = document.createElement('div');
      header.className = 'tool-group';
      header.textContent = `${collapsed ? '▸' : '▾'} ${grp.label}`;
      header.onclick = () => {
        if (this.collapsedGroups.has(gi)) this.collapsedGroups.delete(gi);
        else this.collapsedGroups.add(gi);
        this.buildToolbar();
      };
      tb.appendChild(header);
      if (collapsed) return;
      for (const id of grp.ids) {
        const t = TOOL_BY_ID.get(id);
        if (!t) continue;
        const b = document.createElement('button');
        b.innerHTML = `${t.label}<span class="cost">${t.sub}</span>`;
        b.onclick = () => this.setTool(id);
        tb.appendChild(b);
        this.toolBtns.set(id, b);
      }
    });
    this.refreshToolButtons();
  }

  setTool(id: ToolId): void {
    this.currentTool = id;
    // 若所选工具在折叠分类内，展开它以便看到高亮
    const gi = TOOL_GROUPS.findIndex((g) => g.ids.includes(id));
    if (gi >= 0 && this.collapsedGroups.has(gi)) {
      this.collapsedGroups.delete(gi);
      this.buildToolbar();
    } else {
      this.refreshToolButtons();
    }
  }
  setSpeed(i: number): void {
    this.speedIndex = Math.max(0, Math.min(TIME_SCALES.length - 1, i));
    this.refreshSpeedButtons();
  }
  togglePause(): void {
    this.setSpeed(this.speedIndex === 0 ? 1 : 0);
  }

  private refreshToolButtons(): void {
    for (const [id, b] of this.toolBtns) b.classList.toggle('active', id === this.currentTool);
  }
  private refreshSpeedButtons(): void {
    this.speedBtns.forEach((b, i) => b.classList.toggle('active', i === this.speedIndex));
  }

  setSoundLabel(muted: boolean): void {
    if (this.soundBtn) this.soundBtn.textContent = muted ? '🔇' : '🔊';
  }

  setHint(text: string | null): void {
    this.hintEl.style.display = text ? 'block' : 'none';
    if (text) this.hintEl.textContent = text;
  }

  setInspector(html: string | null): void {
    this.inspectorEl.style.display = html ? 'block' : 'none';
    if (html) this.inspectorEl.innerHTML = html;
  }

  /** 弹出一条短暂的提示气泡（成就解锁等） */
  toast(msg: string): void {
    const root = document.getElementById('toast');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast-item';
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .4s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 400);
    }, 3000);
  }

  /** 每帧刷新状态栏与日志 */
  update(s: SimSnapshot, logs: LogEntry[]): void {
    this.set('money', `¥${fmt(s.money)}`, !s.sandbox && s.money < 50_000 ? 'freq-bad' : '');
    this.set('networth', `¥${fmt(s.netWorth)}${s.debt > 0 ? ` (负债${fmt(s.debt)})` : ''}`,
      s.netWorth < 0 ? 'freq-bad' : '');
    const hh = Math.floor(s.hourOfDay).toString().padStart(2, '0');
    const mm = Math.floor((s.hourOfDay % 1) * 60).toString().padStart(2, '0');
    this.set('time', `第${s.day + 1}天 ${hh}:${mm}`);
    this.set('freq', `${s.frequency.toFixed(2)} Hz`, freqClass(s.frequency));
    this.set('volt', `${s.voltage.toFixed(2)} pu`, s.voltage < 0.92 ? 'freq-bad' : s.voltage < 0.95 ? 'freq-warn' : 'freq-ok');
    this.set('balance', `${s.totalGen.toFixed(0)} / ${s.totalDemand.toFixed(0)} MW`,
      s.totalServed < s.totalDemand - 0.5 ? 'freq-warn' : '');
    this.set('price', `¥${s.spotPrice.toFixed(0)}`, s.spotPrice > 120 ? 'freq-bad' : s.spotPrice > 90 ? 'freq-warn' : 'freq-ok');
    this.set('loss', `${s.totalLoss.toFixed(1)} MW`);
    this.set('reliab', `${(s.reliability * 100).toFixed(1)}%`,
      s.reliability < s.goalReliability ? 'freq-warn' : 'freq-ok');
    this.set('co2', `${s.co2.toFixed(1)} t/h`);
    this.set('green', `${(s.renewableShare * 100).toFixed(0)}%`, s.renewableShare > 0.5 ? 'freq-ok' : '');
    this.set('rep', `${s.reputation.toFixed(0)}`, s.reputation < 40 ? 'freq-bad' : s.reputation < 60 ? 'freq-warn' : 'freq-ok');
    this.set('share', `${(s.marketShare * 100).toFixed(0)}%`, s.marketShare > 0.25 ? 'freq-ok' : s.marketShare < 0.1 ? 'freq-warn' : '');
    this.set('cycle', `${s.cycle} ${(s.cycleFactor * 100 - 100 >= 0 ? '+' : '')}${(s.cycleFactor * 100 - 100).toFixed(0)}%`,
      s.cycle === '繁荣' ? 'freq-ok' : s.cycle === '衰退' ? 'freq-warn' : '');
    this.set('commit', `${s.committedUnits}/${s.dispatchableUnits} 并网`, s.dispatchableUnits > 0 && s.committedUnits === 0 ? 'freq-warn' : '');
    if (s.gridEnergized < 0.999) {
      this.set('resil', `🔌 恢复 ${(s.gridEnergized * 100).toFixed(0)}%`, 'freq-bad');
    } else {
      this.set('resil', s.blackStartCapable ? '黑启动 ✓' : '黑启动 ✗', s.blackStartCapable ? 'freq-ok' : 'freq-warn');
    }
    const seasonIcon: Record<string, string> = { 春: '🌱', 夏: '☀️', 秋: '🍂', 冬: '❄️' };
    this.set('season', `${seasonIcon[s.season] ?? ''}${s.season} +${(s.seasonFactor * 100 - 100).toFixed(0)}%`,
      s.season === '夏' || s.season === '冬' ? 'freq-warn' : '');
    this.set('weather', s.weather, s.demandFactor > 1.05 ? 'freq-warn' : '');
    this.set('forecast', s.forecast ?? '—', s.forecast && !s.forecast.startsWith('☀') ? 'freq-warn' : '');
    this.set('policy', s.policy ?? '常态', s.policy ? 'freq-warn' : '');
    this.set('rp', `${s.researchPoints.toFixed(0)}`);
    this.set('grade', `${s.grade} · ${s.gradeScore.toFixed(0)}`,
      s.gradeScore >= 75 ? 'freq-ok' : s.gradeScore >= 45 ? 'freq-warn' : 'freq-bad');
    this.set('goal', s.sandbox ? '★ 沙盒模式'
      : !isFinite(s.goalDay) ? '∞ 无尽经营 · 别破产'
        : `撑到第${s.goalDay}天·可靠性≥${(s.goalReliability * 100).toFixed(0)}%`);

    const body = document.getElementById('log-body');
    if (body) {
      body.innerHTML = logs.slice(-7).reverse().map((l) => {
        const hh2 = Math.floor(l.time % 24).toString().padStart(2, '0');
        const mm2 = Math.floor((l.time % 1) * 60).toString().padStart(2, '0');
        return `<div class="entry e-${l.level}">[${hh2}:${mm2}] ${l.msg}</div>`;
      }).join('');
    }

    if (s.gameOver) this.showOverlay(s);
  }

  private set(key: string, value: string, cls = ''): void {
    const el = this.statVals.get(key);
    if (!el) return;
    el.textContent = value;
    el.className = 'v ' + cls;
  }

  private showOverlay(s: SimSnapshot): void {
    const ov = document.getElementById('overlay')!;
    if (ov.style.display === 'flex') return;
    ov.style.display = 'flex';
    document.getElementById('overlay-title')!.textContent = s.win ? '🏆 通关！' : '💸 破产了';
    // 胜利后可选择转入无尽模式继续经营
    const cont = document.getElementById('overlay-continue') as HTMLButtonElement | null;
    if (cont) {
      cont.style.display = s.win ? 'inline-block' : 'none';
      cont.onclick = () => { ov.style.display = 'none'; this.onContinueAfterWin?.(); };
    }
    const gradeEl = document.getElementById('overlay-grade');
    if (gradeEl) {
      const gradeColor: Record<string, string> = { S: '#fbbf24', A: '#34d399', B: '#38bdf8', C: '#a3a3a3', D: '#f87171' };
      gradeEl.textContent = s.win ? `评级 ${s.grade}　（${s.gradeScore.toFixed(0)} 分）` : '';
      gradeEl.style.color = gradeColor[s.grade] ?? '#fff';
    }
    const summary = `经营摘要 · 可靠性 ${(s.reliability * 100).toFixed(1)}% · 市占 ${(s.marketShare * 100).toFixed(0)}% · 清洁 ${(s.renewableShare * 100).toFixed(0)}% · 大客户满意 ${(s.customerSatisfaction * 100).toFixed(0)}%`;
    document.getElementById('overlay-text')!.textContent = s.win
      ? `你把电网平稳地带过了 ${s.goalDay} 天，坚强可靠、灯火通明。${summary}。综合评级由可靠性、财务、清洁占比与口碑决定，挑战 S 级吧！`
      : '电力公司资金耗尽。停电罚款、燃料与碳成本压垮了现金流——下次更早布局电源与冗余线路。';
  }
}

function freqClass(f: number): string {
  const d = Math.abs(f - FREQ_NOMINAL);
  if (d <= 0.2) return 'freq-ok';
  if (d <= 0.7) return 'freq-warn';
  return 'freq-bad';
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
