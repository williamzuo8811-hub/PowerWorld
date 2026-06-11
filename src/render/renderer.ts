// PixiJS 渲染层：等轴（2:1 isometric）视角，把仿真状态画成可交互的电网世界。
// 只读 Grid 状态、自己维护相机与动画；不改任何仿真数据。
// 建筑使用程序化生成的伪 3D 贴图（见 sprites.ts），地貌按连续海拔/湿度场着色——零素材文件。
import { Application, Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import type { Bus, Line } from '../sim/types';
import { Grid } from '../sim/grid';
import { VOLTAGE } from '../config/components';
import { buildSpriteTextures, type BuildingSprite } from './sprites';

// 等轴瓦片尺寸（2:1 菱形）
const TW = 46; // 菱形宽
const THh = 23; // 菱形高

// 标签样式缓存（避免每帧 new TextStyle 的分配）
const LABEL_STYLE = new TextStyle({ fontFamily: 'monospace', fontSize: 11, fill: 0xcfe3f2 });

/** 煤电烟雾粒子 */
interface Smoke {
  x: number; y: number; // 世界像素（等轴投影后）
  vx: number; vy: number;
  age: number; // 0..1
}

export class Renderer {
  app = new Application();
  private world = new Container();
  private gridLayer = new Container(); // 地形（烘焙成单张纹理的 Sprite，避免每帧重绘 8000+ Graphics 指令）
  private terrainSprite: Sprite | null = null;
  private resourceLayer = new Container(); // 资源热力覆盖（同样烘焙）
  private resourceSprite: Sprite | null = null;
  private lineLayer = new Graphics();
  private flowLayer = new Graphics();
  private groundFx = new Graphics(); // 地面层特效：阴影/状态环/光标地块/连线预览
  private spriteLayer = new Container(); // 建筑贴图（按屏幕 y 深度排序）
  private topFx = new Graphics(); // 建筑之上的特效：风机叶片/SoC 条/徽标
  private smokeLayer = new Graphics();
  private labelLayer = new Container();
  private ambientLayer = new Graphics(); // 屏幕空间：昼夜/天气色调滤镜
  private labels = new Map<number, Text>(); // busId -> Text
  private labelCache = new Map<number, { text: string; fill: number; alpha: number }>(); // 避免每帧触发 Text 重排版
  private sprites = new Map<number, Sprite>(); // busId -> 建筑贴图
  private spriteKind = new Map<number, string>(); // busId -> 贴图键（类型变化时重建）
  private textures = new Map<string, BuildingSprite>();
  private flowPhase = new Map<number, number>(); // lineId -> 0..1
  private smokes: Smoke[] = [];
  private lightningTimer = 0; // 风暴闪电计时

  // 相机
  private camX = 0;
  private camY = 0;
  private zoom = 1;

  // 交互态（由外部 UI 设置，用于绘制高亮/预览）
  pendingFromBus: Bus | null = null;
  cursorTile: { x: number; y: number } | null = null;
  hoverBusId: number | null = null;
  cursorOk: boolean | null = null; // 建造预览合法性：true=绿（可建） false=红（不可建/钱不够） null=中性
  pendingLineOk: boolean | null = null; // 拉线预览：悬停目标是否为合法终点
  // N-1 校核标注的薄弱元件
  n1Lines = new Set<number>();
  n1Subs = new Set<number>();
  categoryFilter: string | null = null; // 能源品类筛选：仅高亮该品类，淡化其余
  lineColorMode: 'load' | 'voltage' | 'congestion' = 'load'; // 线路着色模式（M 键/按钮切换）
  clock = 0; // 当前仿真小时（由外部每帧写入，用于显示建设剩余工期）
  colorblind = false; // 色盲友好配色（负载色阶避开红绿对比）
  hourOfDay = 12; // 当前一天中的小时（昼夜色调用，由外部每帧写入）
  weatherKind = 'clear'; // 当前天气事件种类（天气滤镜用）

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

    this.spriteLayer.sortableChildren = true;
    this.world.addChild(
      this.gridLayer, this.resourceLayer, this.lineLayer, this.flowLayer,
      this.groundFx, this.spriteLayer, this.topFx, this.smokeLayer, this.labelLayer,
    );
    this.app.stage.addChild(this.world);
    this.app.stage.addChild(this.ambientLayer); // 屏幕空间滤镜在最上层（不随相机移动）

    this.textures = buildSpriteTextures(this.app.renderer);

    // 初始相机：让世界大致居中
    this.camX = this.app.screen.width / 2;
    this.camY = 60;
    this.applyCamera();
    this.drawBackgroundGrid();
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  // —— 等轴投影 ——
  /** 瓦片坐标 → 世界像素（等轴 2:1） */
  private projX(x: number, y: number): number {
    return ((x - y) * TW) / 2;
  }
  private projY(x: number, y: number): number {
    return ((x + y) * THh) / 2;
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
    this.zoom = Math.max(0.4, Math.min(2.6, this.zoom * factor));
    this.applyCamera();
    const after = this.screenToTile(clientX, clientY);
    // 缩放后保持光标下的世界点不动（用投影差做通用补偿）
    this.camX += (this.projX(after.x, after.y) - this.projX(before.x, before.y)) * this.zoom;
    this.camY += (this.projY(after.x, after.y) - this.projY(before.x, before.y)) * this.zoom;
    this.applyCamera();
  }

  /** 自动取景：缩放/平移相机让整张电网（含边距）适配屏幕 */
  fitView(): void {
    const buses = [...this.grid.buses.values()];
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    if (!buses.length) { this.camX = w / 2; this.camY = 60; this.zoom = 1; this.applyCamera(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of buses) {
      const px = this.projX(b.x, b.y), py = this.projY(b.x, b.y);
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    const pad = 3.5 * TW; // 边距（像素）
    const bw = maxX - minX + pad * 2;
    const bh = maxY - minY + pad * 2;
    this.zoom = Math.max(0.45, Math.min(1.7, Math.min(w / Math.max(bw, 1), (h - 90) / Math.max(bh, 1))));
    this.camX = w / 2 - ((minX + maxX) / 2) * this.zoom;
    this.camY = (h + 52) / 2 - ((minY + maxY) / 2) * this.zoom; // 顶栏补偿
    this.applyCamera();
  }

  /** 屏幕坐标 → 世界瓦片坐标（等轴逆投影） */
  screenToTile(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    const lx = (clientX - rect.left - this.camX) / this.zoom;
    const ly = (clientY - rect.top - this.camY) / this.zoom;
    return { x: lx / TW + ly / THh, y: ly / THh - lx / TW };
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

  /** 找最近的线路（用于点击重合闸 / 拆除）；瓦片空间判距（仿真坐标，与投影无关） */
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

  /** 当前可视范围（世界像素，含 margin）——视锥剔除用 */
  private viewRect(margin = 90): { x0: number; y0: number; x1: number; y1: number } {
    const w = this.app.screen.width, h = this.app.screen.height;
    return {
      x0: (0 - this.camX) / this.zoom - margin,
      y0: (0 - this.camY) / this.zoom - margin,
      x1: (w - this.camX) / this.zoom + margin,
      y1: (h - this.camY) / this.zoom + margin,
    };
  }

  /** 等轴菱形地块路径（cx,cy 为中心，s 为占瓦片比例） */
  private diamond(g: Graphics, cx: number, cy: number, s: number): Graphics {
    const hw = (TW / 2) * s, hh = (THh / 2) * s;
    return g.poly([cx, cy - hh, cx + hw, cy, cx, cy + hh, cx - hw, cy]);
  }

  /** 把一张画好的 Graphics 烘焙成 Sprite 挂到容器（销毁旧纹理，防显存泄漏） */
  private bakeInto(layer: Container, old: Sprite | null, g: Graphics): Sprite | null {
    if (old) {
      old.texture.destroy(true);
      old.destroy();
    }
    layer.removeChildren();
    const bounds = g.getLocalBounds();
    if (bounds.width <= 0 || bounds.height <= 0) { g.destroy(); return null; }
    const tex = this.app.renderer.generateTexture(g);
    g.destroy();
    const sp = new Sprite(tex);
    sp.position.set(bounds.x, bounds.y);
    layer.addChild(sp);
    return sp;
  }

  private drawBackgroundGrid(): void {
    // 地形只在开局/换种子时变化：画进临时 Graphics 后烘焙成一张纹理，
    // 每帧渲染从 8000+ 矢量指令降为 1 次贴图采样。
    const g = new Graphics();
    const X0 = -2, X1 = 60, Y0 = -2, Y1 = 36;
    const terrain = this.grid.terrain;
    // 1) 陆地底色：整张可玩区域的等轴大菱形，比画布背景略亮——地图有"实体"边界感
    g.poly([
      this.projX(X0, Y0), this.projY(X0, Y0) - THh / 2,
      this.projX(X1, Y0) + TW / 2, this.projY(X1, Y0),
      this.projX(X1, Y1), this.projY(X1, Y1) + THh / 2,
      this.projX(X0, Y1) - TW / 2, this.projY(X0, Y1),
    ]).fill({ color: 0x131c14 });
    // 2) 半瓦片子格采样：连续海拔/湿度场 → 平滑海岸线、水深渐变、山体坡面光照、森林纹理
    const S = 0.5;
    for (let x = X0; x <= X1; x += S) {
      for (let y = Y0; y <= Y1; y += S) {
        const kind = terrain.kind(x, y);
        const cx = this.projX(x, y), cy = this.projY(x, y);
        if (kind === 'plain') {
          // 平原：湿度场调出深浅草色拼布（模拟城市式的田野感）
          const m = terrain.moisture(x, y);
          if (m > 0.45) {
            this.diamond(g, cx, cy, S + 0.04).fill({ color: 0x1b2c1d, alpha: Math.min(0.85, (m - 0.45) * 2.4) });
          }
          continue;
        }
        const e = terrain.elevation(x, y);
        let color: number;
        if (kind === 'water') {
          const depth = Math.max(0, Math.min(1, (0.34 - e) / 0.34)); // 离岸越远越深
          color = lerpColor(0x2a6f9e, 0x0d2a47, depth);
        } else if (kind === 'hill') {
          // 山地：低处带草色、高处裸岩，按坡面光照做明暗（西北受光）
          const rock = lerpColor(0x32402c, 0x4d483c, Math.max(0, Math.min(1, (e - 0.68) / 0.24)));
          const slope = (e - terrain.elevation(x - 0.7, y - 0.7)) * 6;
          color = shadeColor(rock, 1 - Math.max(-0.4, Math.min(0.4, slope)));
        } else {
          color = 0x1d3a22; // 森林底色
        }
        this.diamond(g, cx, cy, S + 0.04).fill({ color });
        // 山顶残雪（只点缀最高峰，避免糊成白斑）/ 森林树丛
        if (kind === 'hill' && e > 0.86) {
          this.diamond(g, cx, cy, S * 0.4).fill({ color: 0xd8e2ea, alpha: Math.min(0.55, (e - 0.86) * 5) });
        }
        if (kind === 'forest') {
          const h = ((x * 2 + 31) * 73856093 ^ (y * 2 + 57) * 19349663) >>> 0;
          if ((h % 100) < 42) {
            const ox = (((h >> 8) % 9) - 4) * 1.1;
            const oy = (((h >> 16) % 9) - 4) * 0.55;
            // 小树：深色伞冠 + 高光
            g.ellipse(cx + ox, cy + oy - 2.4, 3.1, 2).fill({ color: 0x10240f, alpha: 0.95 });
            g.ellipse(cx + ox - 0.9, cy + oy - 3.1, 1.3, 0.8).fill({ color: 0x3f6b33, alpha: 0.9 });
          }
        }
      }
    }
    // 3) 浅滩高亮：水陆交界处描浅色，海岸线立刻清晰
    for (let x = X0; x <= X1; x += S) {
      for (let y = Y0; y <= Y1; y += S) {
        if (terrain.kind(x, y) !== 'water') continue;
        const landNear = terrain.kind(x + S, y) !== 'water' || terrain.kind(x - S, y) !== 'water'
          || terrain.kind(x, y + S) !== 'water' || terrain.kind(x, y - S) !== 'water';
        if (landNear) {
          this.diamond(g, this.projX(x, y), this.projY(x, y), S + 0.04).fill({ color: 0x6fb7d8, alpha: 0.33 });
        }
      }
    }
    // 4) 网格点（建造对齐参考），叠在地形之上但很淡
    for (let x = X0; x <= X1; x++) {
      for (let y = Y0; y <= Y1; y++) {
        g.circle(this.projX(x, y), this.projY(x, y), 0.9).fill({ color: 0xd8e6f0, alpha: 0.12 });
      }
    }
    // 5) 地图边框：圈出可玩区域
    g.poly([
      this.projX(X0, Y0), this.projY(X0, Y0) - THh / 2,
      this.projX(X1, Y0) + TW / 2, this.projY(X1, Y0),
      this.projX(X1, Y1), this.projY(X1, Y1) + THh / 2,
      this.projX(X0, Y1) - TW / 2, this.projY(X0, Y1),
    ]).stroke({ width: 2, color: 0x2a3a4d, alpha: 0.9 });

    this.terrainSprite = this.bakeInto(this.gridLayer, this.terrainSprite, g);
  }

  /** 地形种子变化后（开新局/读档）重绘底图 */
  refreshTerrain(): void {
    this.drawBackgroundGrid();
  }

  /** 资源热力覆盖：选中风/光/水电建造工具时展示对应资源分布（亮=优质场址）；烘焙成纹理 */
  setResourceOverlay(kind: 'wind' | 'solar' | 'hydro' | null): void {
    if (!kind) {
      if (this.resourceSprite) {
        this.resourceSprite.texture.destroy(true);
        this.resourceSprite.destroy();
        this.resourceSprite = null;
      }
      this.resourceLayer.removeChildren();
      return;
    }
    const g = new Graphics();
    const color = kind === 'wind' ? 0x4ade80 : kind === 'solar' ? 0xf2c94c : 0x38bdf8;
    const range: Record<string, [number, number]> = { wind: [0.8, 1.2], solar: [0.85, 1.15], hydro: [0.85, 1.15] };
    const [lo, hi] = range[kind];
    for (let x = 0; x <= 58; x++) {
      for (let y = 0; y <= 34; y++) {
        const q = this.grid.terrain.siteQuality(kind, x, y);
        const t = Math.max(0, Math.min(1, (q - lo) / (hi - lo)));
        if (t > 0.05) this.diamond(g, this.projX(x, y), this.projY(x, y), 1).fill({ color, alpha: 0.04 + t * 0.22 });
      }
    }
    this.resourceSprite = this.bakeInto(this.resourceLayer, this.resourceSprite, g);
  }

  /** 每帧重绘（dtSec 用于流动动画推进） */
  update(dtSec: number): void {
    this.drawLines(dtSec);
    this.syncBuildings();
    this.updateSmoke(dtSec);
    this.syncLabels();
    this.drawAmbient(dtSec);
  }

  /** 昼夜色调 + 天气滤镜（屏幕空间，轻量低饱和） */
  private drawAmbient(dtSec: number): void {
    const g = this.ambientLayer;
    g.clear();
    const w = this.app.screen.width, h = this.app.screen.height;
    const hr = this.hourOfDay;
    const dayness = Math.max(0, Math.min(1, (Math.cos(((hr - 13) / 24) * 2 * Math.PI) + 0.5) * 1.2)); // 13 点最亮
    const nightAlpha = (1 - dayness) * 0.22;
    if (nightAlpha > 0.01) g.rect(0, 0, w, h).fill({ color: 0x0a1228, alpha: nightAlpha });
    const dusk = Math.max(0, 1 - Math.abs(hr - 6.5) / 1.5) + Math.max(0, 1 - Math.abs(hr - 18.5) / 1.5);
    if (dusk > 0.02) g.rect(0, 0, w, h).fill({ color: 0xff9a4d, alpha: dusk * 0.05 });
    const tints: Record<string, [number, number]> = {
      heatwave: [0xff7733, 0.06], coldsnap: [0x9cc8ff, 0.08], overcast: [0x6b7886, 0.12], calm: [0x8896a6, 0.05], storm: [0x4a5666, 0.16],
    };
    const t = tints[this.weatherKind];
    if (t) g.rect(0, 0, w, h).fill({ color: t[0], alpha: t[1] });
    if (this.weatherKind === 'storm') {
      this.lightningTimer -= dtSec;
      if (this.lightningTimer <= 0) this.lightningTimer = 1.5 + Math.random() * 4;
      if (this.lightningTimer < 0.1) g.rect(0, 0, w, h).fill({ color: 0xffffff, alpha: 0.18 });
    }
  }

  /** 煤/燃气电厂烟雾粒子：出力越大烟越多 */
  private updateSmoke(dtSec: number): void {
    for (const gen of this.grid.gens.values()) {
      if (gen.output < 1) continue;
      const co2Heavy = gen.type === 'coal' ? 1 : gen.type === 'gas' ? 0.35 : 0;
      if (co2Heavy === 0) continue;
      const bus = this.grid.buses.get(gen.busId);
      if (!bus || bus.underConstruction) continue;
      const rate = (gen.output / gen.capacity) * co2Heavy * 6;
      if (Math.random() < rate * dtSec && this.smokes.length < 140) {
        this.smokes.push({
          x: this.projX(bus.x, bus.y) - 5 + (Math.random() - 0.5) * 5,
          y: this.projY(bus.x, bus.y) - 26,
          vx: (Math.random() - 0.2) * 6,
          vy: -13 - Math.random() * 8,
          age: 0,
        });
      }
    }
    const g = this.smokeLayer;
    g.clear();
    this.smokes = this.smokes.filter((s) => (s.age += dtSec / 2.6) < 1);
    for (const s of this.smokes) {
      s.x += s.vx * dtSec;
      s.y += s.vy * dtSec;
      g.circle(s.x, s.y, 2 + s.age * 5).fill({ color: 0xaeb6be, alpha: 0.18 * (1 - s.age) });
    }
  }

  private drawLines(dtSec: number): void {
    const lg = this.lineLayer;
    const fg = this.flowLayer;
    lg.clear();
    fg.clear();
    const lineDim = this.categoryFilter && this.categoryFilter !== 'grid' ? 0.16 : 1;
    const view = this.viewRect(40);

    for (const ln of this.grid.lines.values()) {
      const a = this.grid.buses.get(ln.from);
      const b = this.grid.buses.get(ln.to);
      if (!a || !b) continue;
      const ax = this.projX(a.x, a.y), ay = this.projY(a.x, a.y);
      const bx = this.projX(b.x, b.y), by = this.projY(b.x, b.y);
      // 视锥剔除：线段包围盒与视口不相交则跳过
      if (Math.max(ax, bx) < view.x0 || Math.min(ax, bx) > view.x1
        || Math.max(ay, by) < view.y0 || Math.min(ay, by) > view.y1) continue;
      const load = ln.capacity > 0 ? Math.abs(ln.flow) / ln.capacity : 0;
      const isHV = ln.voltage === 'HV';
      const width = (isHV ? 3.2 : 1.8) + Math.min(5, ln.capacity / 30);

      if (!this.grid.lineActive(ln)) {
        const constructing = ln.underConstruction
          || this.grid.buses.get(ln.from)?.underConstruction
          || this.grid.buses.get(ln.to)?.underConstruction;
        drawDashed(lg, ax, ay, bx, by, constructing ? 0x6a7a3a : 0x6b2030, width * 0.7);
        continue;
      }
      if (this.n1Lines.has(ln.id)) {
        lg.moveTo(ax, ay).lineTo(bx, by).stroke({ width: width + 8, color: 0xf2c94c, alpha: 0.32 });
      }
      // 临近过载脉冲预警：负载率 >85% 的线路呼吸式光晕，先于跳闸把危险"喊出来"
      if (load > 0.85) {
        const pulse = 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(this.clock * 9 + ln.id));
        lg.moveTo(ax, ay).lineTo(bx, by).stroke({ width: width + 6, color: load >= 1 ? 0xff3344 : 0xffaa33, alpha: pulse * lineDim });
      }
      // 线路阴影（贴地感）+ 电压等级底色 + 模式着色
      lg.moveTo(ax, ay + 2).lineTo(bx, by + 2).stroke({ width: width + 1, color: 0x000000, alpha: 0.25 * lineDim });
      lg.moveTo(ax, ay).lineTo(bx, by).stroke({ width: width + 3, color: VOLTAGE[ln.voltage].color, alpha: 0.16 * lineDim });
      const color = this.lineColorMode === 'voltage'
        ? voltageColor(Math.min(a.voltage ?? 1, b.voltage ?? 1), this.colorblind)
        : this.lineColorMode === 'congestion'
          ? congestionColor(load, this.colorblind)
          : loadColor(load, this.colorblind);
      lg.moveTo(ax, ay).lineTo(bx, by).stroke({ width, color, alpha: 0.92 * lineDim });
      // 色盲辅助：过载状态额外用"横向刻痕"传达（不只靠颜色）
      if (this.colorblind && load >= 1) {
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const nx = -(by - ay) / len, ny = (bx - ax) / len;
        for (const o of [-10, 0, 10]) {
          const px = mx + ((bx - ax) / len) * o, py = my + ((by - ay) / len) * o;
          lg.moveTo(px - nx * 6, py - ny * 6).lineTo(px + nx * 6, py + ny * 6).stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
        }
      }

      // 流动粒子（潮流方向：正=from→to）
      if (Math.abs(ln.flow) > 0.5) {
        const dir = Math.sign(ln.flow);
        const speed = Math.min(1.5, Math.max(0.08, load * 1.0));
        const phase = ((this.flowPhase.get(ln.id) ?? Math.random()) + dir * speed * dtSec) % 1;
        this.flowPhase.set(ln.id, (phase + 1) % 1);
        const k = Math.max(1, Math.min(7, Math.round(Math.abs(ln.flow) / 11)));
        for (let i = 0; i < k; i++) {
          const t = (((phase + i / k) % 1) + 1) % 1;
          fg.circle(ax + (bx - ax) * t, ay + (by - ay) * t, width * 0.45).fill({ color: 0xffffff, alpha: 0.85 });
        }
      }
    }
  }

  /** 母线 → 建筑贴图键 */
  private spriteKeyOf(bus: Bus): string {
    if (bus.kind === 'plant') return this.grid.gensAtBus(bus.id)[0]?.type ?? 'coal';
    if (bus.kind === 'substation') return 'substation';
    if (bus.kind === 'storage') return this.grid.batteriesAtBus(bus.id)[0]?.type ?? 'battery';
    return this.grid.loadsAtBus(bus.id)[0]?.profile ?? 'residential';
  }

  /** 同步建筑贴图 + 地面状态环 + 顶层特效（叶片/SoC/徽标） */
  private syncBuildings(): void {
    const ground = this.groundFx;
    const top = this.topFx;
    ground.clear();
    top.clear();

    // 光标地块高亮（建造落点预览）：合法=绿、非法/资金不足=红、中性=细线
    if (this.cursorTile) {
      const sx = Math.round(this.cursorTile.x), sy = Math.round(this.cursorTile.y);
      const c = this.cursorOk === false ? 0xef5d60 : 0x38d39f;
      const d = this.diamond(ground, this.projX(sx, sy), this.projY(sx, sy), 1)
        .stroke({ width: this.cursorOk == null ? 1.5 : 2.5, color: c, alpha: this.cursorOk == null ? 0.45 : 0.85 });
      if (this.cursorOk != null) d.fill({ color: c, alpha: 0.10 });
    }
    // 连线预览（拉线工具）：悬停在合法终点=绿、非法终点=红、空地=中性
    if (this.pendingFromBus && this.cursorTile) {
      const a = this.pendingFromBus;
      const c = this.pendingLineOk === false ? 0xef5d60 : 0x38d39f;
      drawDashed(ground, this.projX(a.x, a.y), this.projY(a.x, a.y),
        this.projX(this.cursorTile.x, this.cursorTile.y), this.projY(this.cursorTile.x, this.cursorTile.y), c, this.pendingLineOk == null ? 2 : 3);
    }

    const view = this.viewRect();
    const alive = new Set<number>();
    for (const bus of this.grid.buses.values()) {
      alive.add(bus.id);
      const cx = this.projX(bus.x, bus.y), cy = this.projY(bus.x, bus.y);
      const key = this.spriteKeyOf(bus);
      // —— 贴图生命周期 ——
      let sp = this.sprites.get(bus.id);
      if (sp && this.spriteKind.get(bus.id) !== key) { sp.destroy(); this.spriteLayer.removeChild(sp); sp = undefined; }
      if (!sp) {
        const tex = this.textures.get(key);
        if (!tex) continue;
        sp = new Sprite(tex.texture);
        sp.anchor.set(tex.ax, tex.ay);
        // 建筑不会移动：位置/深度/缩放只在创建时设一次（每帧重设 zIndex 会触发整层重排序）
        sp.x = cx;
        sp.y = cy + 4; // 微微压入地块中心
        sp.zIndex = cy; // 画家算法：南边建筑盖住北边
        sp.scale.set(1.15); // 建筑相对地块略放大，提升可读性
        this.spriteLayer.addChild(sp);
        this.sprites.set(bus.id, sp);
        this.spriteKind.set(bus.id, key);
      }
      // 视锥剔除：屏外建筑跳过状态环/特效计算，并隐藏贴图
      const offscreen = cx < view.x0 || cx > view.x1 || cy < view.y0 || cy > view.y1;
      sp.visible = !offscreen;
      if (offscreen) continue;

      const gen0 = bus.kind === 'plant' ? this.grid.gensAtBus(bus.id)[0] : undefined;
      const inOutage = !!gen0 && gen0.outageUntil != null && gen0.outageUntil > this.clock && !bus.underConstruction;
      const ez = bus.energized ?? 1;
      let alpha = bus.underConstruction ? 0.4 : inOutage ? 0.55 : (bus.kind === 'load' ? 0.45 + 0.55 * ez : 1);
      const matchFilter = !this.categoryFilter || busCategory(this.grid, bus) === this.categoryFilter;
      if (!matchFilter) alpha *= 0.13;
      sp.alpha = alpha;
      sp.tint = bus.underConstruction ? 0xd9c87a : 0xffffff;

      // —— 地面阴影（贴地感） ——
      ground.ellipse(cx, cy + 4, 15, 7).fill({ color: 0x000000, alpha: 0.3 * (matchFilter ? 1 : 0.2) });

      // —— 地面状态环（等轴椭圆） ——
      const ring = (rx: number, color: number, a2: number, w = 2) =>
        ground.ellipse(cx, cy + 4, rx, rx / 2).stroke({ width: w, color, alpha: a2 });
      if (this.categoryFilter && matchFilter) ring(20, 0xffffff, 0.7);
      if (bus.underConstruction) ring(18, 0xf2c94c, 0.85);
      if (inOutage) ring(18, 0xff7043, 0.9);
      if (!bus.underConstruction && (bus.voltage ?? 1) < 0.95 && ez > 0.05) ring(15, 0xeab308, 0.85, 1.5);
      if (bus.blackout) {
        const restoring = ez > 0.05 && ez < 0.95;
        ring(18, restoring ? 0x38bdf8 : 0xef5d60, restoring ? 0.55 + 0.35 * Math.sin(this.clock * 4) : 0.9);
      }
      if (bus.kind === 'substation' && bus.transformerTripped) ring(18, 0xf2994a, 0.95);
      if (this.n1Subs.has(bus.id)) ring(22, 0xf2c94c, 0.8);
      if (bus.id === this.hoverBusId || bus.id === this.pendingFromBus?.id) ring(16, 0x38d39f, 0.9);

      // —— 顶层特效 ——
      if (gen0?.type === 'wind' && !bus.underConstruction) {
        // 旋转叶片：转速 ∝ 风况
        const hubX = cx, hubY = cy + 4 - 30;
        const speed = 0.5 + gen0.availability * 5;
        const ang = (this.clock * speed) % (Math.PI * 2);
        for (let k = 0; k < 3; k++) {
          const a2 = ang + (k * 2 * Math.PI) / 3;
          top.moveTo(hubX, hubY).lineTo(hubX + Math.cos(a2) * 11, hubY + Math.sin(a2) * 11)
            .stroke({ width: 2, color: 0xeef5f9, alpha: 0.95 * alpha });
        }
        top.circle(hubX, hubY, 1.8).fill({ color: 0xf7fbfd, alpha: alpha });
      }
      if (gen0?.type === 'solar' && !bus.underConstruction && gen0.availability > 0.05) {
        top.ellipse(cx, cy - 2, 9 * gen0.availability, 3 * gen0.availability).fill({ color: 0xfff7cc, alpha: 0.25 + 0.3 * gen0.availability });
      }
      if (gen0?.ccs) top.circle(cx + 12, cy - 14, 2.6).fill({ color: 0x4ade80 });
      if (gen0?.dispatchable && gen0.committed && !bus.underConstruction && !inOutage) {
        top.circle(cx - 12, cy - 14, 2.6).fill({ color: 0x38d39f }); // 并网指示
      }
      if (bus.capacitor && !bus.underConstruction) {
        top.rect(cx + 9, cy - 2, 3.4, 3.4).fill({ color: 0xfacc15 });
      }
      if (bus.kind === 'storage' && !bus.underConstruction) {
        const bat = this.grid.batteriesAtBus(bus.id)[0];
        if (bat) {
          const f = Math.max(0, Math.min(1, bat.soc / bat.energyCapacity));
          top.rect(cx - 10, cy + 7, 20, 3).fill({ color: 0x0b1016, alpha: 0.7 });
          top.rect(cx - 9.2, cy + 7.6, 18.4 * f, 1.8).fill({ color: 0x86ffc7 });
        }
      }
    }
    // 清理已拆除建筑的贴图
    for (const [id, sp] of [...this.sprites]) {
      if (!alive.has(id)) {
        sp.destroy();
        this.spriteLayer.removeChild(sp);
        this.sprites.delete(id);
        this.spriteKind.delete(id);
      }
    }
  }

  /** 维护每个母线下方的文字标签（缓存复用，按需增删）。
   *  Text.text / style.fill 的赋值会触发重排版/样式重编译——只在内容真正变化时才写入。 */
  private syncLabels(): void {
    const view = this.viewRect();
    const alive = new Set<number>();
    for (const bus of this.grid.buses.values()) {
      alive.add(bus.id);
      let t = this.labels.get(bus.id);
      if (!t) {
        t = new Text({ text: '', style: LABEL_STYLE.clone() });
        t.anchor.set(0.5, 0);
        // 母线不会移动：位置只设一次
        t.x = this.projX(bus.x, bus.y);
        t.y = this.projY(bus.x, bus.y) + 12;
        this.labelLayer.addChild(t);
        this.labels.set(bus.id, t);
        this.labelCache.set(bus.id, { text: '', fill: -1, alpha: -1 });
      }
      // 视锥剔除：屏外标签直接隐藏，连文本计算都省掉
      const offscreen = t.x < view.x0 || t.x > view.x1 || t.y < view.y0 || t.y > view.y1;
      t.visible = !offscreen;
      if (offscreen) continue;

      const og = bus.kind === 'plant' ? this.grid.gensAtBus(bus.id)[0] : undefined;
      const outage = !!og && og.outageUntil != null && og.outageUntil > this.clock && !bus.underConstruction;
      const text = bus.underConstruction
        ? `${bus.name} 🏗${Math.max(0, ((bus.commissionAt ?? 0) - this.clock) / 24).toFixed(1)}d`
        : outage ? `${bus.name} 🔧检修`
          : busLabel(this.grid, bus);
      const matchFilter = !this.categoryFilter || busCategory(this.grid, bus) === this.categoryFilter;
      const alpha = matchFilter ? 1 : 0.15;
      const fill = bus.blackout ? 0xef5d60 : bus.underConstruction ? 0xf2c94c : outage ? 0xff7043 : 0xb9cbda;
      const cache = this.labelCache.get(bus.id)!;
      if (cache.text !== text) { t.text = text; cache.text = text; }
      if (cache.alpha !== alpha) { t.alpha = alpha; cache.alpha = alpha; }
      if (cache.fill !== fill) { t.style.fill = fill; cache.fill = fill; }
    }
    for (const [id, t] of [...this.labels]) {
      if (!alive.has(id)) {
        t.destroy();
        this.labelLayer.removeChild(t);
        this.labels.delete(id);
        this.labelCache.delete(id);
      }
    }
  }
}

// —— 辅助绘制/着色 ——
/** 两色线性插值（0=a, 1=b） */
function lerpColor(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (Math.round(ar + (br - ar) * k) << 16) | (Math.round(ag + (bg - ag) * k) << 8) | Math.round(ab + (bb - ab) * k);
}

/** 颜色明暗缩放（f<1 变暗、f>1 提亮） */
function shadeColor(c: number, f: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((c >> 16) & 0xff) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((c >> 8) & 0xff) * f)));
  const b = Math.max(0, Math.min(255, Math.round((c & 0xff) * f)));
  return (r << 16) | (g << 8) | b;
}

/** 电压着色（电压模式）：1.0pu 健康 → 0.9pu 深度欠压 */
function voltageColor(v: number, colorblind = false): number {
  if (colorblind) {
    if (v >= 0.98) return 0x38bdf8;
    if (v >= 0.95) return 0xf2c94c;
    if (v >= 0.92) return 0xf97316;
    return 0xffffff;
  }
  if (v >= 0.98) return 0x38d39f;
  if (v >= 0.95) return 0xf2c94c;
  if (v >= 0.92) return 0xf2994a;
  return 0xef5d60;
}

/** 拥堵着色（拥堵模式）：低于阈值置灰，越接近热极限越红——一眼找出"要花阻塞费"的走廊 */
function congestionColor(load: number, colorblind = false): number {
  if (load < 0.7) return 0x44525f; // 阈值以下：不拥堵，置灰
  if (colorblind) {
    if (load < 0.85) return 0xf2c94c;
    if (load < 1.0) return 0xf97316;
    return 0xffffff;
  }
  if (load < 0.85) return 0xf2c94c;
  if (load < 1.0) return 0xf2994a;
  return 0xef5d60;
}

function loadColor(load: number, colorblind = false): number {
  if (colorblind) {
    // 色盲友好：蓝(轻载)→黄(中)→橙(重)→白(过载)，避开红绿对比
    if (load < 0.6) return 0x38bdf8;
    if (load < 0.85) return 0xf2c94c;
    if (load < 1.0) return 0xf97316;
    return 0xffffff;
  }
  if (load < 0.6) return 0x38d39f; // 绿
  if (load < 0.85) return 0xf2c94c; // 黄
  if (load < 1.0) return 0xf2994a; // 橙
  return 0xef5d60; // 红（过载）
}

/** 母线所属能源品类（与品类面板的 key 对应，用于地图筛选高亮） */
function busCategory(grid: Grid, bus: Bus): string | null {
  if (bus.kind === 'plant') {
    const g = grid.gensAtBus(bus.id)[0];
    if (!g) return null;
    if (g.type === 'wind' || g.type === 'solar' || g.type === 'hydro' || g.type === 'biomass') return 'renewable';
    if (g.type === 'nuclear') return 'nuclear';
    return 'thermal';
  }
  if (bus.kind === 'substation') return 'grid';
  if (bus.kind === 'storage') return 'storage';
  const l = grid.loadsAtBus(bus.id)[0];
  if (!l) return null;
  if (l.profile === 'residential' || l.profile === 'commercial' || l.profile === 'industrial') return 'ci';
  return l.profile;
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
