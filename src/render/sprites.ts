// 程序化建筑贴图工厂：用 Graphics 一次性绘制每种建筑的"伪 3D 等轴小模型"，
// generateTexture 成纹理后由 Sprite 复用——零素材文件，却有模拟城市/异星工厂式的实体感。
// 约定：每个建筑以 (0,0) 为"地面锚点"绘制，返回纹理 + 锚点比例，Sprite 直接落在等轴地块上。
import { Graphics, Container, type Renderer, type Texture } from 'pixi.js';

export interface BuildingSprite {
  texture: Texture;
  ax: number; // 锚点 x（0..1）
  ay: number; // 锚点 y（0..1）
}

function shade(c: number, f: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((c >> 16) & 0xff) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((c >> 8) & 0xff) * f)));
  const b = Math.max(0, Math.min(255, Math.round((c & 0xff) * f)));
  return (r << 16) | (g << 8) | b;
}

/**
 * 等轴长方体：地面锚点 (cx,gy)，右棱半宽 a、左棱半宽 b（px，2:1 斜率），高 h。
 * 三面着色：顶面亮、右面中、左面暗——经典等轴体积感。
 */
function isoBox(g: Graphics, cx: number, gy: number, a: number, b: number, h: number, color: number): void {
  const F = [cx, gy]; // 前角
  const R = [cx + a, gy - a / 2]; // 右角
  const L = [cx - b, gy - b / 2]; // 左角
  const B = [cx + a - b, gy - a / 2 - b / 2]; // 后角
  // 右面
  g.poly([F[0], F[1], R[0], R[1], R[0], R[1] - h, F[0], F[1] - h]).fill({ color: shade(color, 0.78) });
  // 左面
  g.poly([F[0], F[1], L[0], L[1], L[0], L[1] - h, F[0], F[1] - h]).fill({ color: shade(color, 0.55) });
  // 顶面
  g.poly([F[0], F[1] - h, R[0], R[1] - h, B[0], B[1] - h, L[0], L[1] - h]).fill({ color: shade(color, 1.18) });
}

/** 圆柱（烟囱/储罐/筒仓）：底面 (cx,gy)，半径 r，高 h；顶面椭圆更亮 */
function cylinder(g: Graphics, cx: number, gy: number, r: number, h: number, color: number): void {
  g.rect(cx - r, gy - h, r, h).fill({ color: shade(color, 0.85) }); // 左半
  g.rect(cx, gy - h, r, h).fill({ color: shade(color, 0.62) }); // 右半（背光）
  g.ellipse(cx, gy, r, r / 2).fill({ color: shade(color, 0.5) }); // 底
  g.ellipse(cx, gy - h, r, r / 2).fill({ color: shade(color, 1.2) }); // 顶
}

/** 等轴双坡屋顶（民居）：压在 isoBox 顶上 */
function roof(g: Graphics, cx: number, gy: number, a: number, b: number, boxH: number, rise: number, color: number): void {
  const topF = [cx, gy - boxH];
  const topR = [cx + a, gy - a / 2 - boxH];
  const topL = [cx - b, gy - b / 2 - boxH];
  const topB = [cx + a - b, gy - a / 2 - b / 2 - boxH];
  const ridgeF = [cx + a / 2, gy - a / 4 - boxH - rise]; // 屋脊沿右棱方向
  const ridgeB = [cx + a / 2 - b, gy - a / 4 - b / 2 - boxH - rise];
  g.poly([topF[0], topF[1], topR[0], topR[1], ridgeF[0], ridgeF[1]]).fill({ color: shade(color, 1.1) });
  g.poly([topF[0], topF[1], topL[0], topL[1], ridgeB[0], ridgeB[1], ridgeF[0], ridgeF[1]]).fill({ color: shade(color, 0.7) });
  g.poly([topL[0], topL[1], topB[0], topB[1], ridgeB[0], ridgeB[1]]).fill({ color: shade(color, 0.9) });
}

/** 窗带：在右面上画发光窗点（建筑有"人气"） */
function windows(g: Graphics, cx: number, gy: number, a: number, h: number, rows: number, color = 0xffe9a8): void {
  for (let r = 1; r <= rows; r++) {
    for (let i = 1; i < 4; i++) {
      g.rect(cx + (a * i) / 4 - 1, gy - (h * r) / (rows + 1) - (a * i) / 8, 2, 2.6).fill({ color, alpha: 0.85 });
    }
  }
}

type Painter = (g: Graphics) => void;

const PAINTERS: Record<string, Painter> = {
  // —— 电源 ——
  coal: (g) => {
    isoBox(g, 0, 0, 16, 12, 13, 0x6b7280);
    isoBox(g, -2, -2, 8, 6, 4, 0x4b5563); // 输煤廊
    cylinder(g, -8, -7, 3.2, 26, 0x9aa4ad);
    cylinder(g, -2, -10, 3.2, 30, 0x9aa4ad);
    g.rect(-9.6, -30, 3.2, 3).fill({ color: 0xb45309 }); // 烟囱红箍
    g.rect(-3.6, -34, 3.2, 3).fill({ color: 0xb45309 });
  },
  gas: (g) => {
    isoBox(g, 0, 0, 14, 9, 10, 0x8a8f98);
    cylinder(g, 8, -4, 5, 7, 0xd1d5db); // 燃机罩
    cylinder(g, -6, -6, 2.4, 20, 0xf2994a); // 排气塔
    g.ellipse(-6, -27, 2.6, 1.6).fill({ color: 0xffd29a, alpha: 0.9 }); // 焰口
  },
  nuclear: (g) => {
    // 冷却塔（双曲线剪影）+ 反应堆穹顶
    g.poly([-14, 0, -10, -14, -12, -26, -2, -26, -4, -14, 0, 0]).fill({ color: 0xcdd3dc });
    g.poly([-14, 0, -10, -14, -7, -14, -9, 0]).fill({ color: 0x9aa3b0 }); // 背光侧
    g.ellipse(-7, -26, 5, 2.2).fill({ color: 0xf3f6fa });
    g.ellipse(-7, -26, 3.4, 1.4).fill({ color: 0x8b93a0 }); // 塔口
    isoBox(g, 8, 0, 9, 7, 7, 0xa78bfa);
    g.ellipse(8, -7, 7, 4.6).fill({ color: 0xc4b5fd }); // 穹顶
    g.ellipse(6.6, -8.4, 2.6, 1.6).fill({ color: 0xe9e2ff, alpha: 0.8 });
  },
  wind: (g) => {
    g.ellipse(0, 0, 5, 2.5).fill({ color: 0x3a4654 }); // 基座
    g.poly([-1.6, 0, 1.6, 0, 0.9, -30, -0.9, -30]).fill({ color: 0xe7edf3 }); // 塔筒
    g.poly([-1.6, 0, 0, 0, -0.4, -30, -0.9, -30]).fill({ color: 0xaeb9c4 }); // 背光
    g.ellipse(0, -30, 2.6, 1.8).fill({ color: 0xf3f7fa }); // 机舱（叶片运行时另画）
  },
  solar: (g) => {
    for (const [ox, oy] of [[-9, -2], [0, 2.5], [9, 7]] as const) {
      g.poly([ox - 8, oy, ox + 4, oy - 6, ox + 10, oy - 3, ox - 2, oy + 3]).fill({ color: 0x1d4ed8 });
      g.poly([ox - 8, oy, ox + 4, oy - 6, ox + 4.8, oy - 4.6, ox - 7.2, oy + 1.4]).fill({ color: 0x60a5fa, alpha: 0.9 });
      g.poly([ox - 8, oy, ox - 2, oy + 3, ox - 2, oy + 4.6, ox - 8, oy + 1.6]).fill({ color: 0x1e3a8a }); // 支架侧
    }
  },
  hydro: (g) => {
    // 重力坝弧段 + 泄洪水花
    g.poly([-16, 0, -12, -14, 12, -14, 16, 0]).fill({ color: 0xb9c4cf });
    g.poly([-16, 0, -12, -14, -6, -14, -9, 0]).fill({ color: 0x8694a3 });
    g.rect(-10, -13, 20, 2.4).fill({ color: 0x6b7886 }); // 坝顶公路
    for (const x of [-6, 0, 6]) g.rect(x - 1.4, -10, 2.8, 8).fill({ color: 0x2dd4bf, alpha: 0.85 }); // 泄洪
    g.ellipse(0, 1.5, 13, 3).fill({ color: 0x38bdf8, alpha: 0.5 }); // 水雾
  },
  biomass: (g) => {
    isoBox(g, 2, 0, 12, 8, 9, 0x7c8a5a);
    cylinder(g, -9, -3, 4, 16, 0xb6c29a); // 筒仓
    g.ellipse(-9, -19, 4, 2).fill({ color: 0x84cc16 });
    cylinder(g, 11, -5, 1.8, 14, 0x9aa4ad); // 小烟囱
  },
  // —— 电网 ——
  substation: (g) => {
    g.poly([0, 4, 16, -4, 0, -12, -16, -4]).fill({ color: 0x3c4856 }); // 场坪
    g.poly([0, 4, 16, -4, 16, -2, 0, 6]).fill({ color: 0x2b343f });
    isoBox(g, -5, -4, 5, 4, 6, 0x64748b); // 主变
    isoBox(g, 5, -1, 4, 3, 5, 0x64748b);
    // 构架（龙门架）
    g.rect(-12, -16, 1.2, 12).fill({ color: 0x94a3b8 });
    g.rect(-2, -20, 1.2, 16).fill({ color: 0x94a3b8 });
    g.rect(-13, -16, 13, 1.1).fill({ color: 0x94a3b8 });
    g.circle(-6.5, -13, 1.1).fill({ color: 0x67e8f9 }); // 绝缘子
  },
  // —— 储能 ——
  battery: (g) => {
    isoBox(g, -4, 0, 9, 6, 7, 0x166534);
    isoBox(g, 4, -5, 9, 6, 7, 0x15803d);
    g.rect(2, -3.5, 5, 2).fill({ color: 0x4ade80 }); // 集装箱门标
    g.rect(-6, -8.5, 5, 2).fill({ color: 0x4ade80 });
  },
  pumped: (g) => {
    g.ellipse(-4, -8, 12, 5).fill({ color: 0x1e5f8a }); // 上库
    g.ellipse(-4, -8, 9.5, 3.8).fill({ color: 0x38bdf8, alpha: 0.85 });
    g.poly([-14, -6, 10, -6, 14, 2, -10, 2]).fill({ color: 0x55606d }); // 坝坡
    isoBox(g, 8, 4, 6, 4, 5, 0x7d8794); // 厂房
  },
  hydrogen: (g) => {
    for (const [ox, r] of [[-7, 6.5], [5, 6.5]] as const) {
      g.circle(ox, -r - 1, r).fill({ color: 0xcabffa });
      g.circle(ox - r * 0.3, -r - 1 - r * 0.3, r * 0.32).fill({ color: 0xefeaff, alpha: 0.9 }); // 高光
      g.ellipse(ox, 0.5, r * 0.8, r * 0.32).fill({ color: 0x3a3f55 }); // 底座
    }
    g.rect(-1.4, -16, 2.8, 4).fill({ color: 0xa78bfa }); // H2 阀组
  },
  // —— 城区负荷 ——
  residential: (g) => {
    for (const [ox, oy, s] of [[-8, 2, 1], [4, -2, 1.15], [-1, 6, 0.9]] as const) {
      isoBox(g, ox, oy, 6 * s, 4.5 * s, 5 * s, 0xc9b896);
      roof(g, ox, oy, 6 * s, 4.5 * s, 5 * s, 4 * s, 0xb0563d);
      g.rect(ox + 1.5 * s, oy - 3.5 * s, 1.6, 2).fill({ color: 0xffe9a8, alpha: 0.9 }); // 窗
    }
  },
  commercial: (g) => {
    isoBox(g, -6, 1, 7, 5.5, 22, 0x5b86a8);
    windows(g, -6, 1, 7, 22, 4);
    isoBox(g, 6, 4, 6, 4.5, 14, 0x6f9bb8);
    windows(g, 6, 4, 6, 14, 3);
    g.rect(-7, -24.5, 2, 2.5).fill({ color: 0x9adcff }); // 楼顶设备
  },
  industrial: (g) => {
    isoBox(g, 0, 0, 15, 10, 9, 0xa8826b);
    // 锯齿厂房顶
    for (const k of [0, 1, 2]) {
      const bx = 1 + k * 4.4, by = -9 - (1 + k * 4.4) / 2;
      g.poly([bx, by, bx + 3, by - 1.5 - 3, bx + 4.4, by - 2.2, bx + 1.4, by - 0.7 + 3 - 3]).fill({ color: 0xd6b39a });
      g.poly([bx + 3, by - 4.5, bx + 4.4, by - 2.2, bx + 4.4, by - 0.4]).fill({ color: 0x7fc8e8, alpha: 0.9 }); // 天窗
    }
    cylinder(g, -10, -4, 2.2, 18, 0x8d99a6);
  },
  // —— 大客户 ——
  datacenter: (g) => {
    isoBox(g, 0, 0, 17, 11, 8, 0x4d5d75);
    g.poly([0, -8, 17, -16.5, 17 - 11, -22, -11, -13.5]).fill({ color: 0x3a4757 }); // 顶板重描
    for (let i = 0; i < 5; i++) g.rect(2 + i * 2.6, -3 - (2 + i * 2.6) / 2, 1.2, 1.8).fill({ color: 0xec4899, alpha: 0.95 }); // 状态灯带
    for (let i = 0; i < 3; i++) g.ellipse(-2 - i * 4, -10 - (-2 - i * 4) / 2 - 8, 1.8, 1).fill({ color: 0x8fa3bd }); // 屋顶空调
  },
  transport: (g) => {
    isoBox(g, 0, 2, 18, 8, 6, 0x7c8ea0);
    // 拱形站房顶
    g.ellipse(0, -8, 16, 6).fill({ color: 0x9fc4e0 });
    g.ellipse(0, -7, 16, 5).fill({ color: 0x60a5fa, alpha: 0.55 });
    g.rect(-14, 4, 28, 1.6).fill({ color: 0xcbd5e1 }); // 站台
    g.rect(-12, 6.5, 24, 1).fill({ color: 0x475569 }); // 轨道
  },
  petrochem: (g) => {
    cylinder(g, -8, 0, 6, 9, 0xe5e7eb);
    cylinder(g, 5, 3, 6, 9, 0xe5e7eb);
    cylinder(g, 12, -6, 2, 24, 0xb9c2cc); // 精馏塔
    g.circle(12, -25.5, 1.6).fill({ color: 0xfb923c }); // 火炬
    g.rect(-8, -4.5, 13, 1).fill({ color: 0x94a3b8 }); // 连廊管线
  },
  mining: (g) => {
    isoBox(g, 6, 2, 9, 6, 6, 0x6d6a63);
    // 井架（A 字形）
    g.poly([-12, 2, -10.6, 2, -5.4, -22, -6.8, -22]).fill({ color: 0x8b8678 });
    g.poly([-1, 2, -2.4, 2, -7.6, -22, -6.2, -22]).fill({ color: 0x6f6b5f });
    g.rect(-9.5, -23.5, 5, 2).fill({ color: 0x9ca3af }); // 天轮台
    g.circle(-7, -24.5, 1.8).stroke({ width: 1.2, color: 0xd1d5db }); // 天轮
    g.poly([4, -4, 14, -9, 17, -2, 7, 3]).fill({ color: 0x57534e }); // 矿堆
  },
};

/** 生成全部建筑纹理（init 后调用一次） */
export function buildSpriteTextures(renderer: Renderer): Map<string, BuildingSprite> {
  const out = new Map<string, BuildingSprite>();
  for (const [key, paint] of Object.entries(PAINTERS)) {
    const wrap = new Container();
    const g = new Graphics();
    paint(g);
    wrap.addChild(g);
    const bounds = wrap.getLocalBounds();
    const texture = renderer.generateTexture({ target: wrap, resolution: 2 });
    out.set(key, {
      texture,
      ax: bounds.width > 0 ? -bounds.x / bounds.width : 0.5,
      ay: bounds.height > 0 ? -bounds.y / bounds.height : 1,
    });
    wrap.destroy({ children: true });
  }
  return out;
}
