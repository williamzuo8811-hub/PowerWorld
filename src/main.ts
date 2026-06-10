// 入口：组装仿真 + 渲染 + HUD + 菜单，接好交互，跑起主循环。
import { Simulation } from './sim/simulation';
import { Renderer } from './render/renderer';
import { Hud, type ToolId } from './ui/hud';
import { Menu } from './ui/menu';
import { ResearchPanel } from './ui/research';
import { AchievementsPanel } from './ui/achievements';
import { EconomicsPanel } from './ui/economics';
import { FinancePanel } from './ui/finance';
import { HistoryPanel } from './ui/history';
import { IRPPanel } from './ui/irp';
import { PortfolioPanel } from './ui/portfolio';
import { Sound } from './ui/sound';
import { analyzeN1 } from './sim/contingency';
import { Achievements } from './sim/achievements';
import { ALL_TECH_COUNT } from './config/achievements';
import { Tutorial } from './game/tutorial';
import { Advisor } from './game/advisor';
import { SCENARIOS, scenarioById, type Scenario } from './game/scenarios';
import { saveGame, loadGame, listSaves, deleteSave, exportSave, importSave, type SlotId } from './game/save';
import { TECHS, type TechId } from './config/tech';
import type { Bus } from './sim/types';
import {
  PLANTS, SUBSTATION_CAPEX, SUBSTATION_BUILD_DAYS, STORAGE, VOLTAGE, TARIFF, TARIFF_CLASS,
  LINE_BUILD_DAYS_BASE, LINE_BUILD_DAYS_PER_TILE, BLACKSTART_TYPES, CAPACITOR_Q, KEY_ACCOUNTS, RELIABILITY_WEIGHT,
} from './config/components';

const PLANT_TOOLS: Record<string, keyof typeof PLANTS> = {
  coal: 'coal', gas: 'gas', wind: 'wind', solar: 'solar', nuclear: 'nuclear', hydro: 'hydro', biomass: 'biomass',
};
const TOOL_ORDER: ToolId[] = ['inspect', 'line', 'substation', 'coal', 'gas', 'wind', 'solar', 'nuclear', 'hydro', 'biomass', 'battery', 'pumped', 'hydrogen', 'datacenter', 'transport', 'petrochem', 'mining', 'maintenance', 'ccs', 'capacitor', 'backup', 'contract', 'bulldoze'];

const sim = new Simulation();
const renderer = new Renderer(sim.grid);
const hud = new Hud();
const menu = new Menu();
const research = new ResearchPanel();
const achvPanel = new AchievementsPanel();
const econPanel = new EconomicsPanel();
const finPanel = new FinancePanel();
const historyPanel = new HistoryPanel();
const irpPanel = new IRPPanel();
const portfolioPanel = new PortfolioPanel();
const achievements = new Achievements();
achievements.load();
const sound = new Sound();
const tutorial = new Tutorial();
const advisor = new Advisor();
let lastBadEvents = 0; // 上一帧的严重事件计数，用于触发报警音
let wasGameOver = false; // 用于检测输赢瞬间

let menuOpen = true; // 主菜单打开时暂停仿真与建造
let panelOpen = false; // 研发/成就面板打开时暂停仿真与建造
let currentScenarioId = SCENARIOS[0].id;
let gameActive = false; // 是否有进行中的对局（菜单"返回对局"/"另存"用）
let lastAutosaveDay = -1; // 上次自动存档的游戏天

// ——————————————————— 关卡 / 存档流程 ———————————————————
function newGame(scenario: Scenario): void {
  sim.reset();
  renderer.categoryFilter = null;
  scenario.setup(sim);
  currentScenarioId = scenario.id;
  lastAutosaveDay = sim.day;
  advisor.reset();
  enterGame();
  if (scenario.id === 'tutorial') tutorial.start();
  else { tutorial.stop(); hud.setTutorial(null); }
  hud.setHint(scenario.hint);
}

function continueGame(slot: SlotId = 'quick'): void {
  const data = loadGame(slot);
  if (!data) return;
  sim.deserialize(data.save);
  currentScenarioId = data.scenarioId;
  lastAutosaveDay = sim.day;
  enterGame();
  tutorial.stop();
  hud.setTutorial(null);
}

function enterGame(): void {
  setPending(null);
  invalidateN1();
  research.hide();
  achvPanel.hide();
  econPanel.hide();
  finPanel.hide();
  historyPanel.hide();
  irpPanel.hide();
  portfolioPanel.hide();
  panelOpen = false;
  lastBadEvents = sim.badEventCount;
  wasGameOver = sim.gameOver;
  hud.setSpeed(0);
  menu.hide();
  menuOpen = false;
  gameActive = true;
  const ov = document.getElementById('overlay');
  if (ov) ov.style.display = 'none';
}

/** 下载存档为 JSON 文件 */
function downloadSave(slot: SlotId): void {
  const json = exportSave(slot);
  if (!json) return;
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `powerworld-${slot}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function openMenu(): void {
  menuOpen = true;
  hud.setSpeed(0);
  menu.show({
    scenarios: SCENARIOS,
    saves: listSaves(),
    scenarioName: (id) => scenarioById(id)?.name ?? '关卡',
    gameActive: gameActive && !sim.gameOver,
    onStart: (s) => newGame(s),
    onLoad: (slot) => continueGame(slot),
    onDelete: (slot) => { deleteSave(slot); openMenu(); },
    onExport: (slot) => downloadSave(slot),
    onImport: (json) => { const ok = importSave(json, 'quick'); if (ok) openMenu(); return ok; },
    onSaveTo: (slot) => { saveGame(sim, currentScenarioId, slot); openMenu(); },
    onResume: () => { menu.hide(); menuOpen = false; },
  });
}

function doSave(): void {
  flashHint(saveGame(sim, currentScenarioId, 'quick') ? '已存档 💾' : '存档失败');
}

/** 每个游戏日自动存档一次（静默，菜单中可见/可载入） */
function autosaveTick(): void {
  if (sim.gameOver || sim.day === lastAutosaveDay) return;
  lastAutosaveDay = sim.day;
  saveGame(sim, currentScenarioId, 'auto');
}

/** 运行 N-1 冗余校核并把薄弱元件标注到画面 */
function runN1(): void {
  const rep = analyzeN1(sim.grid);
  renderer.n1Lines = rep.vulnerableLineIds;
  renderer.n1Subs = rep.vulnerableSubIds;
  if (rep.checked === 0) { flashHint('先建好电网再做 N-1 校核'); return; }
  if (rep.secure) {
    sim.n1Secure = true; // 解锁「坚强电网」成就
    sim.log('good', `✅ N-1 校核通过：任一元件单独失效都不会停电（已校核 ${rep.checked} 个）`);
    flashHint('N-1 安全 ✅');
    return;
  }
  sim.log('warn', `⚠ N-1 校核：${rep.contingencies.length}/${rep.checked} 个薄弱点（黄圈标注，建冗余线路/变电站）`);
  for (const c of rep.contingencies.slice(0, 3)) {
    const parts: string[] = [];
    if (c.lostLoadMW > 0.5) parts.push(`失负荷${c.lostLoadMW.toFixed(0)}MW`);
    if (c.overloads.length) parts.push(`过载${c.overloads.length}处`);
    sim.log('warn', `· 失去「${c.name}」→ ${parts.join('、')}`);
  }
  flashHint(`N-1 发现 ${rep.contingencies.length} 个薄弱点 ⚠`);
}

/** 打开研发面板 */
function openResearch(): void {
  panelOpen = true;
  hud.setSpeed(0);
  research.show({
    techs: TECHS,
    unlocked: sim.tech.unlocked,
    points: sim.tech.points,
    canUnlock: (id) => sim.tech.canUnlock(id),
    onUnlock: (id) => doUnlock(id),
    onClose: () => { research.hide(); panelOpen = false; },
  });
}

function doUnlock(id: TechId): void {
  const t = TECHS.find((x) => x.id === id);
  if (!t || sim.tech.unlocked.has(id) || sim.tech.points < t.cost || !sim.tech.canUnlock(id)) return;
  sim.tech.points -= t.cost;
  sim.tech.unlocked.add(id);
  sound.unlock();
  sim.log('good', `🔬 已研发：${t.name}`);
  openResearch(); // 刷新面板
}

/** 打开走势面板 */
function openHistory(): void {
  panelOpen = true;
  hud.setSpeed(0);
  historyPanel.show({ history: sim.history, onClose: () => { historyPanel.hide(); panelOpen = false; } });
}

/** 打开长期规划压力测试面板（IRP） */
function openIRP(): void {
  panelOpen = true;
  hud.setSpeed(0);
  irpPanel.show({ results: sim.stressTest(), advice: sim.recommendExpansion(), trajectory: sim.planningTrajectory(), onClose: () => { irpPanel.hide(); panelOpen = false; } });
}

/** 打开能源品类统计面板（资产组合） */
function openPortfolio(): void {
  panelOpen = true;
  hud.setSpeed(0);
  portfolioPanel.show({
    categories: sim.portfolio(),
    customerSatisfaction: sim.customerSatisfaction,
    companyStanding: sim.companyStanding,
    marketContestation: sim.marketContestation,
    lead: sim.keyAccountLead ? { icon: KEY_ACCOUNTS[sim.keyAccountLead.profile].icon, label: KEY_ACCOUNTS[sim.keyAccountLead.profile].label, daysLeft: Math.max(0, (sim.keyAccountLead.endClock - sim.clock) / 24), poach: sim.keyAccountLead.poach } : null,
    cleanHistory: sim.history.map((h) => h.cleanShare * 100),
    marketFeed: sim.logs.filter((l) => /🎯|🏆|📉|招商|挖角|并购/.test(l.msg)).slice(-6).reverse(),
    activeFilter: renderer.categoryFilter,
    onFilter: (key) => {
      renderer.categoryFilter = key;
      portfolioPanel.hide();
      panelOpen = false;
      sound.click();
      flashHint(key ? `品类高亮：点 🗂 切换 · Esc 清除` : '已清除品类高亮');
    },
    onClose: () => { portfolioPanel.hide(); panelOpen = false; },
  });
}

/** 打开成就面板 */
function openAchievements(): void {
  panelOpen = true;
  hud.setSpeed(0);
  achvPanel.show({
    unlocked: achievements.unlocked,
    onClose: () => { achvPanel.hide(); panelOpen = false; },
  });
}

/** 打开投资对比面板 */
function openEconomics(): void {
  panelOpen = true;
  hud.setSpeed(0);
  econPanel.show({
    tariff: TARIFF,
    fuelPrice: sim.fuelPrice,
    onClose: () => { econPanel.hide(); panelOpen = false; },
  });
}

/** 打开财务报表 / 贷款面板 */
function openFinance(): void {
  panelOpen = true;
  hud.setSpeed(0);
  const snap = sim.snapshot();
  finPanel.show({
    data: {
      money: sim.money, assetValue: sim.assetValue, debt: sim.debt, creditLimit: sim.creditLimit,
      netWorth: sim.netWorth, dailyRate: sim.loanDailyRate, finance: sim.finance,
      spotPrice: sim.spotPrice, reserveMargin: sim.reserveMargin, fuelPrice: sim.fuelPrice,
      fuelContracts: sim.fuelContracts,
      carbon: {
        intensity: snap.co2 / Math.max(snap.totalServed, 1),
        benchmark: sim.benchmarkIntensity,
        price: sim.carbonPrice,
      },
      recPrice: sim.recPrice,
      avgSpot: sim.avgSpot,
      clock: sim.clock,
      hedges: sim.hedges,
      insured: sim.insured,
      premiumPerDay: sim.insurancePremiumPerDay,
      grade: sim.gradeScore(),
      creditRating: sim.creditRating,
      creditScore: sim.creditScore,
      esgRating: sim.esgRating,
      esgScore: sim.esgScore,
      marketEnabled: sim.marketEnabled,
      marketImport: sim.marketImportMW,
      marketExport: sim.marketExportMW,
      demandResponse: sim.demandResponse,
      drCurtailed: sim.drCurtailedMW,
      interruptibleMW: sim.interruptibleMW,
      interruptibleRate: sim.interruptiblePremiumRate,
      marketShare: sim.marketShare,
      clearingPrice: sim.marketClearingPrice,
      regionalDemand: sim.regionalDemand,
      competitors: sim.competitors.map((c, i) => {
        const q = sim.acquisitionQuote(i)!;
        return { name: c.name, capacity: c.capacity, marginalCost: c.marginalCost, style: c.style, acqTotal: q.total, acqRemedy: q.remedy, acqBlocked: q.blocked, postShare: q.postShare };
      }),
      capacityPrice: sim.capacityPrice,
      capacityAdequacy: sim.capacityAdequacy,
      regPrice: sim.regPrice,
      reservePrice: sim.reservePrice,
      reserveReqMult: sim.reserveReqMult,
      flexPrice: sim.flexPrice,
      storageArbDay: sim.storageArbDay,
      storageStrategy: sim.storageStrategy,
      startupsTotal: sim.startupsTotal,
      policy: sim.policy.label(sim.clock),
      capCommitMW: sim.capCommitments.reduce((s, c) => s + c.mw, 0),
      zoneNorth: sim.zoneNorthPrice,
      zoneSouth: sim.zoneSouthPrice,
      zoneArbMW: sim.zoneArbMW,
      ftrMW: sim.ftrs.reduce((s, f) => s + f.mw, 0),
    },
    onBorrow: (amt) => { if (sim.borrow(amt)) sound.build(); else sound.error(); openFinance(); },
    onRepay: (amt) => { sim.repay(amt); sound.click(); openFinance(); },
    onHedge: (vol, days) => { if (sim.addHedge(vol, days)) sound.build(); else sound.error(); openFinance(); },
    onOption: (kind, vol, days) => { if (sim.addOption(kind, vol, days)) sound.build(); else sound.error(); openFinance(); },
    onFuelContract: (fuel, days) => { if (sim.signFuelContract(fuel, days)) sound.build(); else sound.error(); openFinance(); },
    onCapacityCommit: (mw, days) => { if (sim.addCapacityCommitment(mw, days)) sound.build(); else sound.error(); openFinance(); },
    onFTR: (mw, days) => { if (sim.addFTR(mw, days)) sound.build(); else sound.error(); openFinance(); },
    onAcquire: (index) => { if (sim.acquireCompetitor(index)) sound.build(); else sound.error(); openFinance(); },
    onToggleInsurance: () => { sim.insured = !sim.insured; sim.log('info', sim.insured ? '🛡 已投保设备保险' : '已退保'); sound.click(); openFinance(); },
    onToggleMarket: () => { sim.marketEnabled = !sim.marketEnabled; sim.log('info', sim.marketEnabled ? '🔌 已接入批发市场' : '已断开联络线'); sound.click(); openFinance(); },
    onToggleDR: () => { sim.demandResponse = !sim.demandResponse; sim.log('info', sim.demandResponse ? '📉 已启用需求响应' : '已退出需求响应'); sound.click(); openFinance(); },
    onToggleStorageStrategy: () => {
      sim.storageStrategy = sim.storageStrategy === 'arb' ? 'reg' : 'arb';
      sim.log('info', sim.storageStrategy === 'arb' ? '💹 储能切换为专注套利（退出调频市场）' : '📡 储能切换为投标调频（套利捕获减半）');
      sound.click(); openFinance();
    },
    onInterruptible: (mw, days) => {
      if (mw <= 0) { sim.interruptibleMW = 0; sim.interruptibleEndClock = 0; sim.log('info', '已解约可中断负荷'); sound.click(); }
      else if (sim.signInterruptible(mw, days)) sound.build(); else sound.error();
      openFinance();
    },
    onClose: () => { finPanel.hide(); panelOpen = false; },
  });
}

/** 评估成就并弹出新解锁的提示 */
function pollAchievements(): void {
  const techCount = sim.tech.unlocked.size;
  const kaKinds = new Set([...sim.grid.loads.values()].filter((l) => KEY_ACCOUNTS[l.profile] && !sim.grid.buses.get(l.busId)?.underConstruction).map((l) => l.profile)).size;
  achievements.evaluate({
    peakServed: sim.peakServed,
    totalEnergyServed: sim.totalEnergyServed,
    renewableShare: sim.renewableShare,
    reputation: sim.reputation,
    techCount,
    allTech: techCount >= ALL_TECH_COUNT,
    won: sim.win,
    n1Secure: sim.n1Secure,
    grade: sim.gradeScore().grade,
    outageEnergyTotal: sim.outageEnergyTotal,
    netWorth: sim.netWorth,
    debt: sim.debt,
    marketShare: sim.marketShare,
    day: sim.day,
    keyAccountKinds: kaKinds,
  });
  for (const a of achievements.drain()) { hud.toast(`🏆 成就解锁：${a.name}`); sound.unlock(); }
}

/** 电网结构变化后，清除过期的 N-1 标注 */
function invalidateN1(): void {
  if (renderer.n1Lines.size || renderer.n1Subs.size) {
    renderer.n1Lines = new Set();
    renderer.n1Subs = new Set();
  }
}

// ——————————————————— 交互 ———————————————————
let dragging = false;
let moved = false;
let lastX = 0, lastY = 0;
let pendingFrom: Bus | null = null;

function setPending(b: Bus | null): void {
  pendingFrom = b;
  renderer.pendingFromBus = b;
}

function snap(t: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(t.x), y: Math.round(t.y) };
}

/** 把刚下单的资产置为"在建中"：已付 capex，工期结束后才投运 */
function startBuild(target: { underConstruction?: boolean; commissionAt?: number }, days: number): void {
  target.underConstruction = true;
  target.commissionAt = sim.clock + days * 24;
}

function handleClick(clientX: number, clientY: number): void {
  if (menuOpen || panelOpen || sim.gameOver) return;
  const tile = renderer.screenToTile(clientX, clientY);
  const tool = hud.currentTool;
  const bus = renderer.nearestBus(tile.x, tile.y);

  switch (tool) {
    case 'inspect': {
      // 优先：点击跳闸变电站 = 变压器重合闸
      if (bus && bus.kind === 'substation' && bus.transformerTripped) {
        bus.transformerTripped = false;
        bus.transformerTimer = 0;
        sim.log('good', `🔧 变电站「${bus.name}」变压器已恢复`);
        flashHint('变压器已恢复');
        return;
      }
      // 其次：点击跳闸线路 = 重合闸
      const ln = renderer.nearestLine(tile.x, tile.y);
      if (ln && ln.tripped) {
        ln.tripped = false;
        ln.overloadTimer = 0;
        sim.log('good', '🔧 线路已重合闸恢复送电');
        flashHint('线路已恢复');
        return;
      }
      flashHint(bus ? `选中 ${bus.name}` : (ln ? '线路（正常运行）' : '空白处'));
      return;
    }
    case 'line': {
      if (!pendingFrom) {
        if (bus) {
          setPending(bus);
          hud.setHint('已选起点，点击另一个母线完成连接（Esc 取消）');
        } else {
          flashHint('请先点击一个母线作为起点');
        }
      } else {
        if (bus && bus.id !== pendingFrom.id) {
          const chk = sim.grid.canConnect(pendingFrom.id, bus.id);
          if (!chk.ok) {
            flashHint(chk.reason ?? '无法连接'); sound.error();
          } else {
            const cost = sim.grid.lineCost(pendingFrom.id, bus.id);
            if (sim.spend(cost)) {
              const ln = sim.grid.addLine(pendingFrom.id, bus.id);
              startBuild(ln, LINE_BUILD_DAYS_BASE + LINE_BUILD_DAYS_PER_TILE * ln.length);
              invalidateN1();
              sound.build();
              sim.log('info', `架设${VOLTAGE[chk.voltage!].label}线路开工 ¥${cost.toLocaleString('en-US')}`);
            } else {
              flashHint('资金不足，无法架线'); sound.error();
            }
          }
        }
        setPending(null);
        hud.setHint(null);
      }
      return;
    }
    case 'substation': {
      const p = snap(tile);
      if (renderer.nearestBus(p.x, p.y, 0.7)) { flashHint('此处已有设备'); sound.error(); return; }
      if (sim.spend(SUBSTATION_CAPEX)) {
        const sub = sim.grid.addSubstation(p.x, p.y);
        startBuild(sub, SUBSTATION_BUILD_DAYS);
        invalidateN1();
        sound.build();
        sim.log('info', `变电站开工（工期${SUBSTATION_BUILD_DAYS}天）`);
      } else { flashHint('资金不足'); sound.error(); }
      return;
    }
    case 'battery':
    case 'pumped':
    case 'hydrogen': {
      const p = snap(tile);
      if (renderer.nearestBus(p.x, p.y, 0.7)) { flashHint('此处已有设备'); sound.error(); return; }
      const spec = STORAGE[tool];
      if (sim.spend(spec.capex)) {
        const { bus: bbus } = sim.grid.addBattery(p.x, p.y, tool);
        startBuild(bbus, spec.buildDays);
        invalidateN1();
        sound.build();
        sim.log('info', `${spec.label}开工 ${spec.powerRating}MW/${spec.energyCapacity}MWh（工期${spec.buildDays}天，需经变电站接入）`);
      } else { flashHint('资金不足'); sound.error(); }
      return;
    }
    case 'datacenter':
    case 'transport':
    case 'petrochem':
    case 'mining': {
      const spec = KEY_ACCOUNTS[tool];
      const acqCost = sim.keyAccountAcquireCost(spec.profile);
      if (acqCost < 0) { flashHint('招商竞争力过低，大客户拒绝入驻——先改善口碑/可靠性/满意度'); sound.error(); return; }
      const p = snap(tile);
      if (renderer.nearestBus(p.x, p.y, 0.7)) { flashHint('此处已有设备'); sound.error(); return; }
      if (sim.spend(acqCost)) {
        const { bus: lbus } = sim.grid.addLoad(p.x, p.y, spec.profile, spec.baseDemand, spec.label, spec.growthPerHour);
        startBuild(lbus, spec.buildDays);
        sim.onKeyAccountAcquired(spec.profile); // 消费招商机会/反向挖角
        invalidateN1();
        sound.build();
        const factor = acqCost / spec.connectionCapex;
        sim.log('info', `${spec.icon} ${spec.label}招商成功 ${spec.baseDemand}MW（接入 ¥${acqCost.toLocaleString('en-US')}·竞争力系数 ${factor.toFixed(2)}，工期${spec.buildDays}天）`);
      } else { flashHint('资金不足'); sound.error(); }
      return;
    }
    case 'maintenance': {
      if (!bus || bus.kind !== 'plant') { flashHint('请点击一座电厂安排检修'); return; }
      if (sim.scheduleMaintenance(bus.id)) sound.build();
      else { flashHint('无法检修（已离线/在建/资金不足）'); sound.error(); }
      return;
    }
    case 'ccs': {
      if (!bus || bus.kind !== 'plant') { flashHint('请点击一座火电厂改造'); return; }
      if (sim.retrofitCCS(bus.id)) sound.build();
      else { flashHint('无法改造（非火电/已改造/资金不足）'); sound.error(); }
      return;
    }
    case 'capacitor': {
      if (!bus || bus.kind !== 'substation') { flashHint('请点击一座变电站加装'); return; }
      if (sim.addCapacitor(bus.id)) sound.build();
      else { flashHint('无法加装（非变电站/已装/资金不足）'); sound.error(); }
      return;
    }
    case 'backup': {
      if (!bus || bus.kind !== 'load') { flashHint('请点击一个大客户加装'); return; }
      if (sim.addBackup(bus.id)) sound.build();
      else { flashHint('无法加装（非大客户/已装/资金不足）'); sound.error(); }
      return;
    }
    case 'contract': {
      if (!bus || bus.kind !== 'load') { flashHint('请点击一个大客户签约'); return; }
      if (sim.signKeyAccountContract(bus.id)) sound.build();
      else { flashHint('无法签约（非大客户/已有有效长约）'); sound.error(); }
      return;
    }
    case 'bulldoze': {
      if (bus) {
        // 在建工程：取消即全额退款（反悔/撤销，无需确认）
        const cancel = sim.cancelRefund(bus.id);
        if (cancel != null) {
          sim.grid.removeBus(bus.id);
          if (cancel > 0) sim.refund(cancel);
          invalidateN1();
          sound.build();
          sim.log('info', `🏗 取消在建工程 ${bus.name}，全额退款 ¥${cancel.toLocaleString('en-US')}`);
          return;
        }
        // 已投运资产：双击确认，防误拆
        if (!confirmDemolish('bus', bus.id, `再次点击确认退役「${bus.name}」（按残值返还）`)) return;
        const salvage = sim.salvageValue(bus.id); // 退役前计算残值
        sim.grid.removeBus(bus.id);
        if (salvage > 0) sim.refund(salvage);
        invalidateN1();
        sound.build();
        sim.log('warn', `退役 ${bus.name}${salvage > 0 ? `（残值 ¥${salvage.toLocaleString('en-US')}）` : ''}`);
        return;
      }
      const ln = renderer.nearestLine(tile.x, tile.y);
      if (ln) {
        const cancel = sim.lineCancelRefund(ln);
        if (cancel != null) {
          sim.grid.removeLine(ln.id);
          if (cancel > 0) sim.refund(cancel);
          invalidateN1();
          sound.build();
          sim.log('info', `🏗 取消在建线路，全额退款 ¥${cancel.toLocaleString('en-US')}`);
          return;
        }
        if (!confirmDemolish('line', ln.id, '再次点击确认拆除该线路（按残值返还）')) return;
        const s = sim.lineSalvage(ln);
        sim.grid.removeLine(ln.id);
        if (s > 0) sim.refund(s);
        invalidateN1();
        sound.build();
        sim.log('warn', `拆除线路${s > 0 ? `（残值 ¥${s.toLocaleString('en-US')}）` : ''}`);
      }
      return;
    }
    default: {
      // 建电厂
      const type = PLANT_TOOLS[tool];
      if (!type) return;
      const p = snap(tile);
      if (renderer.nearestBus(p.x, p.y, 0.7)) { flashHint('此处已有设备'); sound.error(); return; }
      const spec = PLANTS[type];
      if (sim.spend(spec.capex)) {
        const { bus: pbus } = sim.grid.addPlant(type, p.x, p.y);
        startBuild(pbus, spec.buildDays);
        invalidateN1();
        sound.build();
        sim.log('info', `${spec.label}电厂开工 (${spec.capacity}MW·工期${spec.buildDays}天)`);
      } else { flashHint('资金不足'); sound.error(); }
      return;
    }
  }
}

let hintTimer = 0;
function flashHint(text: string): void {
  hud.setHint(text);
  hintTimer = 1.6;
}

// 拆除二次确认：3 秒内再点同一目标才执行（在建工程取消除外）
let pendingDemolish: { kind: 'bus' | 'line'; id: number; expire: number } | null = null;
function confirmDemolish(kind: 'bus' | 'line', id: number, prompt: string): boolean {
  const now = performance.now();
  if (pendingDemolish && pendingDemolish.kind === kind && pendingDemolish.id === id && now < pendingDemolish.expire) {
    pendingDemolish = null;
    return true;
  }
  pendingDemolish = { kind, id, expire: now + 3000 };
  flashHint(prompt);
  sound.click();
  return false;
}

function busInspectorHtml(bus: Bus): string {
  const rows: string[] = [`<div class="h">${bus.name}</div>`];
  if (bus.underConstruction) {
    const remDays = Math.max(0, ((bus.commissionAt ?? 0) - sim.clock) / 24);
    rows.push(row('状态', `🏗 建设中 · 剩 ${remDays.toFixed(1)} 天`));
  }
  if (bus.kind === 'plant') {
    const gen = sim.grid.gensAtBus(bus.id)[0];
    if (gen) {
      const spec = PLANTS[gen.type];
      rows.push(row('出力', `${gen.output.toFixed(1)} / ${gen.capacity} MW`));
      rows.push(row('边际成本(现)', `¥${sim.effMarginalCost(gen).toFixed(0)}/MWh`));
      rows.push(row('可调度', gen.dispatchable ? '是' : `否(可用${(gen.availability * 100).toFixed(0)}%)`));
      if (gen.dispatchable) rows.push(row('机组状态', `${gen.committed ? '🟢 并网' : '⚪ 解列'} · 启停${gen.startups ?? 0}次 · 启动费 ¥${spec.startupCost.toLocaleString('en-US')}`));
      if (BLACKSTART_TYPES[gen.type]) rows.push(row('黑启动', '🔌 可作黑启动种子'));
      rows.push(row('排放', `${sim.effCo2(gen).toFixed(2)} t/MWh${gen.ccs ? ' 🌫CCS' : ''}`));
      rows.push(row('役龄 / 磨损', `${gen.age.toFixed(1)}天 / ${(sim.wear(gen) * 100).toFixed(0)}%`));
      if (sim.genOffline(gen) && !bus.underConstruction) {
        rows.push(row('状态', '🔧 检修中'));
      } else {
        const mc = sim.maintenanceCost(bus.id);
        if (mc != null) {
          const f = sim.seasonMaintFactor;
          const tag = f < 0.95 ? '淡季优惠' : f > 1.05 ? '旺季加价' : '';
          rows.push(row('检修费(本季)', `¥${mc.toLocaleString('en-US')}${tag ? ' · ' + tag : ''}`));
        }
      }
    }
  } else if (bus.kind === 'load') {
    const l = sim.grid.loadsAtBus(bus.id)[0];
    if (l) {
      const CLASS_NAME: Record<string, string> = { residential: '居民', commercial: '商业', industrial: '工业', datacenter: '💻数据中心', transport: '🚄大交通', petrochem: '🛢石化·LNG', mining: '⛏矿业' };
      const clsName = CLASS_NAME[l.profile] ?? l.profile;
      rows.push(row('客户类别', clsName));
      rows.push(row('需求', `${l.demand.toFixed(1)} MW`));
      rows.push(row('已供', `${l.served.toFixed(1)} MW`));
      rows.push(row('电价系数', `×${TARIFF_CLASS[l.profile].toFixed(2)} · ¥${(sim.spotPrice * TARIFF_CLASS[l.profile]).toFixed(0)}/MWh`));
      const rw = RELIABILITY_WEIGHT[l.profile];
      if (rw > 1) rows.push(row('保供要求', `SLA ×${rw.toFixed(1)}（停电罚款更重）`));
      if (KEY_ACCOUNTS[l.profile]) {
        rows.push(row('满意度', `${((l.satisfaction ?? 1) * 100).toFixed(0)}%${(l.satisfaction ?? 1) < 0.55 ? ' ⚠流失风险' : ''}`));
        rows.push(row('自备应急', l.backup ? '🔋 已加装（停电兜底）' : '未加装（可用应急电源工具）'));
        const contracted = l.contractEndClock != null && sim.clock < l.contractEndClock;
        rows.push(row('长约', contracted ? `📜 锁定中 · 剩 ${((l.contractEndClock! - sim.clock) / 24).toFixed(1)}天` : '未签约（可用长约工具锁忠诚）'));
      }
      const ez = bus.energized ?? 1;
      rows.push(row('状态', bus.blackout && ez > 0.05 && ez < 0.95 ? `🔌 黑启动恢复中 ${(ez * 100).toFixed(0)}%` : bus.blackout ? '⚠ 停电/欠供' : '正常'));
    }
  } else if (bus.kind === 'substation') {
    rows.push(row('变压器', `${(bus.throughput ?? 0).toFixed(1)} / ${bus.rating ?? 0} MW`));
    const v = bus.voltage ?? 1;
    rows.push(row('电压', `${v.toFixed(2)} pu${v < 0.95 ? ' ⚠欠压' : ''}`));
    rows.push(row('无功补偿', bus.capacitor ? `⚡ 电容器组 +${CAPACITOR_Q}MVAr` : '未加装（可用电容器组工具）'));
    rows.push(row('状态', bus.transformerTripped ? '⚠ 跳闸(点此重合闸)' : '正常'));
    const n = [...sim.grid.lines.values()].filter((ln) => ln.from === bus.id || ln.to === bus.id).length;
    rows.push(row('接入线路', `${n} 条`));
  } else if (bus.kind === 'storage') {
    const b = sim.grid.batteriesAtBus(bus.id)[0];
    if (b) {
      rows.push(row('类型', `${STORAGE[b.type].label}（${(b.energyCapacity / b.powerRating).toFixed(0)}h）`));
      rows.push(row('电量', `${b.soc.toFixed(0)} / ${b.energyCapacity} MWh (${((b.soc / b.energyCapacity) * 100).toFixed(0)}%)`));
      rows.push(row('功率', `${b.powerRating} MW · 效率 ${(b.roundTrip * 100).toFixed(0)}%`));
      rows.push(row('黑启动', b.soc > 1 ? '🔌 可作黑启动种子' : '需充电后可黑启动'));
      rows.push(row('状态', b.output > 0.1 ? `放电 ${b.output.toFixed(1)}MW` : b.output < -0.1 ? `充电 ${(-b.output).toFixed(1)}MW` : '待机'));
    }
  }
  return rows.join('');
}
function row(k: string, v: string): string {
  return `<div class="row"><span>${k}</span><b>${v}</b></div>`;
}

function bindInput(): void {
  const c = renderer.canvas;
  // 首个手势解除浏览器音频自动播放限制
  window.addEventListener('pointerdown', () => sound.resume(), { once: true });
  window.addEventListener('keydown', () => sound.resume(), { once: true });
  c.addEventListener('pointerdown', (e) => {
    dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('pointermove', (e) => {
    const tile = renderer.screenToTile(e.clientX, e.clientY);
    renderer.cursorTile = tile;
    const hover = renderer.nearestBus(tile.x, tile.y);
    renderer.hoverBusId = hover?.id ?? null;
    hud.setInspector(hover ? busInspectorHtml(hover) : null);
    if (dragging) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      renderer.pan(dx, dy);
      lastX = e.clientX; lastY = e.clientY;
    }
  });
  window.addEventListener('pointerup', (e) => {
    if (dragging && !moved) handleClick(e.clientX, e.clientY);
    dragging = false;
  });
  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    renderer.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (menuOpen || panelOpen) return;
    if (e.code === 'Space') { e.preventDefault(); hud.togglePause(); return; }
    if (e.code === 'Escape') {
      setPending(null); hud.setHint(null);
      if (renderer.categoryFilter) { renderer.categoryFilter = null; flashHint('已清除品类高亮'); }
      return;
    }
    const n = parseInt(e.key, 10);
    if (!isNaN(n) && n >= 1 && n <= TOOL_ORDER.length) hud.setTool(TOOL_ORDER[n - 1]);
  });
}

// ——————————————————— 启动 ———————————————————
async function start(): Promise<void> {
  await renderer.init(document.getElementById('app')!);
  hud.build();
  hud.onSave = doSave;
  hud.onMenu = openMenu;
  hud.onN1 = runN1;
  hud.onResearch = openResearch;
  hud.onAchievements = openAchievements;
  hud.onEconomics = openEconomics;
  hud.onFinance = openFinance;
  hud.onHistory = openHistory;
  hud.onIRP = openIRP;
  hud.onPortfolio = openPortfolio;
  hud.onToggleSound = () => { sound.setMuted(!sound.muted); hud.setSoundLabel(sound.muted); if (!sound.muted) sound.click(); };
  hud.onContinueAfterWin = () => {
    sim.gameOver = false;
    sim.goalDay = Infinity; // 转入无尽经营：不再有通关日，但仍可破产
    wasGameOver = false;
    hud.setSpeed(1);
    hud.toast('∞ 继续经营——目标已解除，城市继续成长，年报照常发布');
  };
  hud.setSoundLabel(sound.muted);
  bindInput();
  openMenu(); // 开局先进主菜单选关

  renderer.app.ticker.add(() => {
    const dt = Math.min(0.05, renderer.app.ticker.deltaMS / 1000);
    if (!menuOpen && !panelOpen) {
      sim.tick(dt, hud.timeScale);
      autosaveTick();
      hud.update(sim.snapshot(), sim.logs);
      pollAchievements();
      // 新手教程引导
      if (tutorial.active) hud.setTutorial(tutorial.update(sim));
      if (tutorial.takeCompleted()) { hud.setTutorial(null); hud.toast('🎓 教程完成！进入自由建造'); sound.win(); }
      // 顾问提示：在玩家需要某个系统的时刻情境化教学
      if (!tutorial.active) {
        const tip = advisor.update(sim);
        if (tip) { hud.toast(tip); sound.click(); }
      }
      // 严重事件（跳闸/破产）触发报警音
      if (sim.badEventCount > lastBadEvents) sound.trip();
      lastBadEvents = sim.badEventCount;
      // 输赢瞬间音效
      if (sim.gameOver && !wasGameOver) (sim.win ? sound.win() : sound.lose());
      wasGameOver = sim.gameOver;
    }
    renderer.clock = sim.clock;
    renderer.update(dt);
    if (hintTimer > 0) {
      hintTimer -= dt;
      if (hintTimer <= 0 && !pendingFrom) hud.setHint(null);
    }
  });
}

start();
