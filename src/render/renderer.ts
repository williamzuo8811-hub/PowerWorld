// PixiJS 渲染层：把仿真状态画成可交互的电网图。
// 只读 Grid 状态、自己维护相机与流动动画；不改任何仿真数据。
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Bus, Line } from '../sim/types';
import { Grid } from '../sim/grid';
import { PLANTS, VOLTAGE, STORAGE } from '../config/components';

const TILE = 30; // 每瓦片像素

export class Renderer {
  app = new Application();
  private world = new Container();
  private gridLayer = new Graphics();
  private lineLayer = new Graphics();
  private flowLayer = new Graphics();
  private busLayer = new Graphics();
  private labelLayer = new Container();
  private labels = new Map<number, Text>(); // busId -> Text
  private flowPhase = new Map<number, number>(); // lineId -> 0..1

  // 相机
  private camX = 0;
  private camY = 0;
  private zoom = 1;

  // 交互态（由外部 UI 设置，用于绘制高亮/预览）
  pendingFromBus: Bus | null = null;
  cursorTile: { x: number; y: number } | null = null;
  hoverBusId: number | null = null;
  // N-1 校核标注的薄弱元件
  n1Lines = new Set<number>();
  n1Subs = new Set<number>();
  clock = 0; // 当前仿真小时（由外部每帧写入，用于显示建设剩余工期）

  constructor(private grid: Grid) {}

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({
      background: 0x0b1016,
      resizeTo: window,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    parent.appendChild(this.app.canvas);

    this.world.addChild(this.gridLayer, this.lineLayer, this.flowLayer, this.busLayer, this.labelLayer);
    this.app.stage.addChild(this.world);

    // 初始相机：让世界大致居中
    this.camX = 80;
    this.camY = 90;
    this.applyCamera();
    this.drawBackgroundGrid();
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  // —— 相机 ——
  private applyCamera(): void {
    this.world.x = this.camX;
    this.world.y = this.camY;
    this.world.scale.set(this.zoom);
  }
  pan(dx: number, dy: number): void {
    this.camX += dx;
    this.camY += dy;
    this.applyCamera();
  }
  zoomAt(clientX: number, clientY: number, factor: number): void {
    const before = this.screenToTile(clientX, clientY);
    this.zoom = Math.max(0.4, Math.min(2.4, this.zoom * factor));
    this.applyCamera();
    const after = this.screenToTile(clientX, clientY);
    // 缩放后保持光标下的世界点不动
    this.camX += (after.x - before.x) * TILE * this.zoom;
    this.camY += (after.y - before.y) * TILE * this.zoom;
    this.applyCamera();
  }

  /** 屏幕坐标 → 世界瓦片坐标 */
  screenToTile(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    const lx = (clientX - rect.left - this.camX) / this.zoom;
    const ly = (clientY - rect.top - this.camY) / this.zoom;
    return { x: lx / TILE, y: ly / TILE };
  }

  /** 找最近的母线（瓦片距离 < maxDist） */
  nearestBus(tileX: number, tileY: number, maxDist = 0.9): Bus | null {
    let best: Bus | null = null;
    let bestD = maxDist;
    for (const b of this.grid.buses.values()) {
      const d = Math.hypot(b.x - tileX, b.y - tileY);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** 找最近的线路（用于点击重合闸 / 拆除） */
  nearestLine(tileX: number, tileY: number, maxDist = 0.45): Line | null {
    let best: Line | null = null;
    let bestD = maxDist;
    for (const ln of this.grid.lines.values()) {
      const a = this.grid.buses.get(ln.from);
      const b = this.grid.buses.get(ln.to);
      if (!a || !b) continue;
      const d = pointToSegment(tileX, tileY, a.x, a.y, b.x, b.y);
      if (d < bestD) {
        bestD = d;
        best = ln;
      }
    }
    return best;
  }

  private drawBackgroundGrid(): void {
    const g = this.gridLayer;
    g.clear();
    for (let x = -2; x <= 60; x++) {
      for (let y = -2; y <= 36; y++) {
        g.circle(x * TILE, y * TILE, 1).fill({ color: 0x16212d, alpha: 0.8 });
      }
    }
  }

  /** 每帧重绘（dtSec 用于流动动画推进） */
  update(dtSec: number): void {
    this.drawLines(dtSec);
    this.drawBuses();
    this.syncLabels();
  }

  private drawLines(dtSec: number): void {
    const lg = this.lineLayer;
    const fg = this.flowLayer;
    lg.clear();
    fg.clear();

    for (const ln of this.grid.lines.values()) {
      const a = this.grid.buses.get(ln.from);
      const b = this.grid.buses.get(ln.to);
      if (!a || !b) continue;
      const ax = a.x * TILE, ay = a.y * TILE, bx = b.x * TILE, by = b.y * TILE;
      const load = ln.capacity > 0 ? Math.abs(ln.flow) / ln.capacity : 0;
      const isHV = ln.voltage === 'HV';
      const width = (isHV ? 3.4 : 1.9) + Math.min(5, ln.capacity / 30);

      if (!this.grid.lineActive(ln)) {
        const constructing = ln.underConstruction
          || this.grid.buses.get(ln.from)?.underConstruction
          || this.grid.buses.get(ln.to)?.underConstruction;
        // 建设中：暗黄绿虚线；跳闸/断开：暗红虚线
        drawDashed(lg, ax, ay, bx, by, constructing ? 0x6a7a3a : 0x6b2030, width * 0.7);
        continue;
      }
      // N-1 薄弱线路：黄色光晕
      if (this.n1Lines.has(ln.id)) {
        lg.moveTo(ax, ay).lineTo(bx, by).stroke({ width: width + 8, color: 0xf2c94c, alpha: 0.32 });
      }
      // 底层用电压等级配色描边（区分 HV/MV），上层用负载率配色
      lg.moveTo(ax, ay).lineTo(bx, by).stroke({ width: width + 3, color: VOLTAGE[ln.voltage].color, alpha: 0.16 });
      const color = loadColor(load);
      lg.moveTo(ax, ay).lineTo(bx, by).stroke({ width, color, alpha: 0.92 });

      // 流动粒子（潮流方向：正=from→to）
      if (Math.abs(ln.flow) > 0.5) {
        const dir = Math.sign(ln.flow);
        const speed = Math.min(1.5, Math.max(0.08, load * 1.0));
        const phase = ((this.flowPhase.get(ln.id) ?? Math.random()) + dir * speed * dtSec) % 1;
        this.flowPhase.set(ln.id, (phase + 1) % 1);
        const k = Math.max(1, Math.min(7, Math.round(Math.abs(ln.flow) / 11)));
        for (let i = 0; i < k; i++) {
          let t = (((phase + i / k) % 1) + 1) % 1;
          const px = ax + (bx - ax) * t;
          const py = ay + (by - ay) * t;
          fg.circle(px, py, width * 0.45).fill({ color: 0xffffff, alpha: 0.85 });
        }
      }
    }

    // 连线预览（拉线工具）
    if (this.pendingFromBus && this.cursorTile) {
      const a = this.pendingFromBus;
      drawDashed(lg, a.x * TILE, a.y * TILE, this.cursorTile.x * TILE, this.cursorTile.y * TILE, 0x38d39f, 2);
    }
  }

  private drawBuses(): void {
    const g = this.busLayer;
    g.clear();
    for (const bus of this.grid.buses.values()) {
      const cx = bus.x * TILE, cy = bus.y * TILE;
      const r = bus.kind === 'substation' ? 7 : 11;
      const color = busColor(this.grid, bus);
      const gen0 = bus.kind === 'plant' ? this.grid.gensAtBus(bus.id)[0] : undefined;
      const inOutage = !!gen0 && gen0.outageUntil != null && gen0.outageUntil > this.clock && !bus.underConstruction;
      const alpha = bus.underConstruction ? 0.3 : inOutage ? 0.5 : 1; // 在建/检修半透明

      // 建设中黄环
      if (bus.underConstruction) g.circle(cx, cy, r + 5).stroke({ width: 2, color: 0xf2c94c, alpha: 0.85 });
      // 强迫停运检修：橙红环
      if (inOutage) g.circle(cx, cy, r + 5).stroke({ width: 2, color: 0xff7043, alpha: 0.9 });
      // 碳捕集改造：绿色小点
      if (gen0?.ccs) g.circle(cx + r * 0.7, cy - r * 0.7, 2.6).fill({ color: 0x4ade80 });
      // 停电红环
      if (bus.blackout) g.circle(cx, cy, r + 5).stroke({ width: 2, color: 0xef5d60, alpha: 0.9 });
      // 变电站变压器跳闸：橙色警示环
      if (bus.kind === 'substation' && bus.transformerTripped) g.circle(cx, cy, r + 5).stroke({ width: 2, color: 0xf2994a, alpha: 0.95 });
      // N-1 薄弱变电站：黄色虚警环
      if (this.n1Subs.has(bus.id)) g.circle(cx, cy, r + 8).stroke({ width: 2, color: 0xf2c94c, alpha: 0.8 });
      // 悬停高亮 / 拉线起点高亮
      if (bus.id === this.hoverBusId || bus.id === this.pendingFromBus?.id) {
        g.circle(cx, cy, r + 3).stroke({ width: 2, color: 0x38d39f, alpha: 0.9 });
      }

      if (bus.kind === 'plant') {
        g.rect(cx - r, cy - r, r * 2, r * 2).fill({ color, alpha }).stroke({ width: 1.5, color: 0x0b1016 });
      } else if (bus.kind === 'load') {
        // 用一个房子状的多边形表示负荷
        g.poly([cx - r, cy + r, cx - r, cy - r * 0.3, cx, cy - r, cx + r, cy - r * 0.3, cx + r, cy + r])
          .fill({ color, alpha }).stroke({ width: 1.5, color: 0x0b1016 });
      } else if (bus.kind === 'storage') {
        // 储能：圆角矩形 + 底部 SoC 电量条
        g.roundRect(cx - r, cy - r * 0.85, r * 2, r * 1.7, 3).fill({ color, alpha }).stroke({ width: 1.5, color: 0x0b1016 });
        const bat = this.grid.batteriesAtBus(bus.id)[0];
        if (bat && !bus.underConstruction) {
          const f = Math.max(0, Math.min(1, bat.soc / bat.energyCapacity));
          g.rect(cx - r + 1.5, cy + r * 0.5, (r * 2 - 3) * f, 3).fill({ color: 0xeafff2 });
        }
      } else {
        // 变电站：菱形
        g.poly([cx, cy - r, cx + r, cy, cx, cy + r, cx - r, cy]).fill({ color, alpha }).stroke({ width: 1.5, color: 0x0b1016 });
      }
    }
  }

  /** 维护每个母线下方的文字标签（缓存复用，按需增删） */
  private syncLabels(): void {
    const style = new TextStyle({ fontFamily: 'monospace', fontSize: 11, fill: 0xcfe3f2 });
    const alive = new Set<number>();
    for (const bus of this.grid.buses.values()) {
      alive.add(bus.id);
      let t = this.labels.get(bus.id);
      if (!t) {
        t = new Text({ text: '', style });
        t.anchor.set(0.5, 0);
        this.labelLayer.addChild(t);
        this.labels.set(bus.id, t);
      }
      const og = bus.kind === 'plant' ? this.grid.gensAtBus(bus.id)[0] : undefined;
      const outage = !!og && og.outageUntil != null && og.outageUntil > this.clock && !bus.underConstruction;
      t.text = bus.underConstruction
        ? `${bus.name} 🏗${Math.max(0, ((bus.commissionAt ?? 0) - this.clock) / 24).toFixed(1)}d`
        : outage ? `${bus.name} 🔧检修`
          : busLabel(this.grid, bus);
      t.x = bus.x * TILE;
      t.y = bus.y * TILE + 14;
      t.style.fill = bus.blackout ? 0xef5d60 : bus.underConstruction ? 0xf2c94c : outage ? 0xff7043 : 0x9bb0c2;
    }
    // 清理已删除的母线标签
    for (const [id, t] of [...this.labels]) {
      if (!alive.has(id)) {
        t.destroy();
        this.labelLayer.removeChild(t);
        this.labels.delete(id);
      }
    }
  }
}

// —— 辅助绘制/着色 ——
function loadColor(load: number): number {
  if (load < 0.6) return 0x38d39f; // 绿
  if (load < 0.85) return 0xf2c94c; // 黄
  if (load < 1.0) return 0xf2994a; // 橙
  return 0xef5d60; // 红（过载）
}

function busColor(grid: Grid, bus: Bus): number {
  if (bus.kind === 'plant') {
    const gen = grid.gensAtBus(bus.id)[0];
    return gen ? PLANTS[gen.type].color : 0x9aa4ad;
  }
  if (bus.kind === 'substation') return 0x4f6b82;
  if (bus.kind === 'storage') {
    const bat = grid.batteriesAtBus(bus.id)[0];
    return bat ? STORAGE[bat.type].color : STORAGE.battery.color;
  }
  // 负荷按画像着色
  const load = grid.loadsAtBus(bus.id)[0];
  if (load?.profile === 'industrial') return 0xc98b6b;
  if (load?.profile === 'commercial') return 0x6b9bc9;
  return 0x8fb98f;
}

function busLabel(grid: Grid, bus: Bus): string {
  if (bus.kind === 'plant') {
    const g = grid.gensAtBus(bus.id)[0];
    return g ? `${bus.name} ${g.output.toFixed(0)}/${g.capacity}` : bus.name;
  }
  if (bus.kind === 'load') {
    const l = grid.loadsAtBus(bus.id)[0];
    return l ? `${bus.name} ${l.served.toFixed(0)}/${l.demand.toFixed(0)}MW` : bus.name;
  }
  if (bus.kind === 'substation') {
    if (bus.transformerTripped) return `${bus.name} ⚠跳闸`;
    return `${bus.name} ${(bus.throughput ?? 0).toFixed(0)}/${bus.rating ?? 0}`;
  }
  if (bus.kind === 'storage') {
    const b = grid.batteriesAtBus(bus.id)[0];
    if (b) {
      const pct = ((b.soc / b.energyCapacity) * 100).toFixed(0);
      const act = b.output > 0.1 ? `放${b.output.toFixed(0)}` : b.output < -0.1 ? `充${(-b.output).toFixed(0)}` : '待机';
      return `${bus.name} ${pct}% ${act}`;
    }
  }
  return bus.name;
}

function drawDashed(g: Graphics, x1: number, y1: number, x2: number, y2: number, color: number, width: number): void {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const dash = 8, gap = 6;
  const steps = Math.floor(len / (dash + gap));
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  for (let i = 0; i < steps; i++) {
    const s = i * (dash + gap);
    g.moveTo(x1 + ux * s, y1 + uy * s).lineTo(x1 + ux * (s + dash), y1 + uy * (s + dash)).stroke({ width, color, alpha: 0.8 });
  }
}

/** 点到线段距离（瓦片单位） */
function pointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
