// 入口：组装仿真 + 渲染 + HUD + 菜单，接好交互，跑起主循环。
import { Simulation } from './sim/simulation';
import { Renderer } from './render/renderer';
import { Hud, type ToolId } from './ui/hud';
import { Menu } from './ui/menu';
import { ResearchPanel } from './ui/research';
import { analyzeN1 } from './sim/contingency';
import { SCENARIOS, scenarioById, type Scenario } from './game/scenarios';
import { saveGame, loadGame, hasSave } from './game/save';
import { TECHS, type TechId } from './config/tech';
import type { Bus } from './sim/types';
import { PLANTS, SUBSTATION_CAPEX, BATTERY, VOLTAGE } from './config/components';

const PLANT_TOOLS: Record<string, keyof typeof PLANTS> = {
  coal: 'coal', gas: 'gas', wind: 'wind', solar: 'solar', nuclear: 'nuclear',
};
const TOOL_ORDER: ToolId[] = ['inspect', 'line', 'substation', 'coal', 'gas', 'wind', 'solar', 'nuclear', 'battery', 'bulldoze'];

const sim = new Simulation();
const renderer = new Renderer(sim.grid);
const hud = new Hud();
const menu = new Menu();
const research = new ResearchPanel();

let menuOpen = true; // 主菜单打开时暂停仿真与建造
let panelOpen = false; // 研发面板打开时暂停仿真与建造
let currentScenarioId = SCENARIOS[0].id;

// ——————————————————— 关卡 / 存档流程 ———————————————————
function newGame(scenario: Scenario): void {
  sim.reset();
  scenario.setup(sim);
  currentScenarioId = scenario.id;
  enterGame();
  hud.setHint(scenario.hint);
}

function continueGame(): void {
  const data = loadGame();
  if (!data) return;
  sim.deserialize(data.save);
  currentScenarioId = data.scenarioId;
  enterGame();
}

function enterGame(): void {
  setPending(null);
  invalidateN1();
  research.hide();
  panelOpen = false;
  hud.setSpeed(0);
  menu.hide();
  menuOpen = false;
  const ov = document.getElementById('overlay');
  if (ov) ov.style.display = 'none';
}

function openMenu(): void {
  menuOpen = true;
  hud.setSpeed(0);
  const data = loadGame();
  const label = data
    ? `${scenarioById(data.scenarioId)?.name ?? '关卡'} · 第${Math.floor((data.save.clock ?? 0) / 24) + 1}天`
    : undefined;
  menu.show({
    scenarios: SCENARIOS,
    hasSave: hasSave(),
    saveLabel: label,
    onStart: (s) => newGame(s),
    onContinue: () => continueGame(),
  });
}

function doSave(): void {
  flashHint(saveGame(sim, currentScenarioId) ? '已存档 💾' : '存档失败');
}

/** 运行 N-1 冗余校核并把薄弱元件标注到画面 */
function runN1(): void {
  const rep = analyzeN1(sim.grid);
  renderer.n1Lines = rep.vulnerableLineIds;
  renderer.n1Subs = rep.vulnerableSubIds;
  if (rep.checked === 0) { flashHint('先建好电网再做 N-1 校核'); return; }
  if (rep.secure) {
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
    onUnlock: (id) => doUnlock(id),
    onClose: () => { research.hide(); panelOpen = false; },
  });
}

function doUnlock(id: TechId): void {
  const t = TECHS.find((x) => x.id === id);
  if (!t || sim.tech.unlocked.has(id) || sim.tech.points < t.cost) return;
  sim.tech.points -= t.cost;
  sim.tech.unlocked.add(id);
  sim.log('good', `🔬 已研发：${t.name}`);
  openResearch(); // 刷新面板
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
            flashHint(chk.reason ?? '无法连接');
          } else {
            const cost = sim.grid.lineCost(pendingFrom.id, bus.id);
            if (sim.spend(cost)) {
              sim.grid.addLine(pendingFrom.id, bus.id);
              invalidateN1();
              sim.log('info', `架设${VOLTAGE[chk.voltage!].label}线路 ¥${cost.toLocaleString('en-US')}`);
            } else {
              flashHint('资金不足，无法架线');
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
      if (renderer.nearestBus(p.x, p.y, 0.7)) { flashHint('此处已有设备'); return; }
      if (sim.spend(SUBSTATION_CAPEX)) {
        sim.grid.addSubstation(p.x, p.y);
        invalidateN1();
        sim.log('info', '新建变电站');
      } else flashHint('资金不足');
      return;
    }
    case 'battery': {
      const p = snap(tile);
      if (renderer.nearestBus(p.x, p.y, 0.7)) { flashHint('此处已有设备'); return; }
      if (sim.spend(BATTERY.capex)) {
        sim.grid.addBattery(p.x, p.y);
        invalidateN1();
        sim.log('info', `新建储能 ${BATTERY.powerRating}MW/${BATTERY.energyCapacity}MWh（需经变电站接入）`);
      } else flashHint('资金不足');
      return;
    }
    case 'bulldoze': {
      if (bus) {
        sim.grid.removeBus(bus.id);
        invalidateN1();
        sim.log('warn', `拆除 ${bus.name}`);
        return;
      }
      const ln = renderer.nearestLine(tile.x, tile.y);
      if (ln) { sim.grid.removeLine(ln.id); invalidateN1(); sim.log('warn', '拆除线路'); }
      return;
    }
    default: {
      // 建电厂
      const type = PLANT_TOOLS[tool];
      if (!type) return;
      const p = snap(tile);
      if (renderer.nearestBus(p.x, p.y, 0.7)) { flashHint('此处已有设备'); return; }
      const spec = PLANTS[type];
      if (sim.spend(spec.capex)) {
        sim.grid.addPlant(type, p.x, p.y);
        invalidateN1();
        sim.log('info', `新建${spec.label}电厂 (${spec.capacity}MW)`);
      } else flashHint('资金不足');
      return;
    }
  }
}

let hintTimer = 0;
function flashHint(text: string): void {
  hud.setHint(text);
  hintTimer = 1.6;
}

function busInspectorHtml(bus: Bus): string {
  const rows: string[] = [`<div class="h">${bus.name}</div>`];
  if (bus.kind === 'plant') {
    const gen = sim.grid.gensAtBus(bus.id)[0];
    if (gen) {
      const spec = PLANTS[gen.type];
      rows.push(row('出力', `${gen.output.toFixed(1)} / ${gen.capacity} MW`));
      rows.push(row('边际成本', `¥${gen.marginalCost}/MWh`));
      rows.push(row('可调度', gen.dispatchable ? '是' : `否(可用${(gen.availability * 100).toFixed(0)}%)`));
      rows.push(row('排放', `${spec.co2} t/MWh`));
    }
  } else if (bus.kind === 'load') {
    const l = sim.grid.loadsAtBus(bus.id)[0];
    if (l) {
      rows.push(row('需求', `${l.demand.toFixed(1)} MW`));
      rows.push(row('已供', `${l.served.toFixed(1)} MW`));
      rows.push(row('状态', bus.blackout ? '⚠ 停电/欠供' : '正常'));
    }
  } else if (bus.kind === 'substation') {
    rows.push(row('变压器', `${(bus.throughput ?? 0).toFixed(1)} / ${bus.rating ?? 0} MW`));
    rows.push(row('状态', bus.transformerTripped ? '⚠ 跳闸(点此重合闸)' : '正常'));
    const n = [...sim.grid.lines.values()].filter((ln) => ln.from === bus.id || ln.to === bus.id).length;
    rows.push(row('接入线路', `${n} 条`));
  } else if (bus.kind === 'storage') {
    const b = sim.grid.batteriesAtBus(bus.id)[0];
    if (b) {
      rows.push(row('电量', `${b.soc.toFixed(0)} / ${b.energyCapacity} MWh (${((b.soc / b.energyCapacity) * 100).toFixed(0)}%)`));
      rows.push(row('功率', `${b.powerRating} MW`));
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
    if (e.code === 'Escape') { setPending(null); hud.setHint(null); return; }
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
  bindInput();
  openMenu(); // 开局先进主菜单选关

  renderer.app.ticker.add(() => {
    const dt = Math.min(0.05, renderer.app.ticker.deltaMS / 1000);
    if (!menuOpen && !panelOpen) {
      sim.tick(dt, hud.timeScale);
      hud.update(sim.snapshot(), sim.logs);
    }
    renderer.update(dt);
    if (hintTimer > 0) {
      hintTimer -= dt;
      if (hintTimer <= 0 && !pendingFrom) hud.setHint(null);
    }
  });
}

start();
