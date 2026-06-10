// 地理资源图层：确定性值噪声生成的地形与资源禀赋。
// 让"选址"成为真实决策：风带/光照分区决定风光出力质量，山地/水域抬高建设造价；
// 同一种子永远生成同一张图（每日挑战/关卡可复现，存档可恢复）。
export type TerrainKind = 'plain' | 'forest' | 'hill' | 'water';

/** 地形建设造价系数（线路按路径采样、场站按落点） */
export const TERRAIN_BUILD_FACTOR: Record<TerrainKind, number> = {
  plain: 1.0,
  forest: 1.2, // 清表/通道
  hill: 1.45, // 山地施工
  water: 1.8, // 跨河/滩涂基础
};

/** 资源系数范围（温和差异：好址收益明显但不至于一票否决） */
const WIND_MIN = 0.8, WIND_MAX = 1.2;
const SOLAR_MIN = 0.85, SOLAR_MAX = 1.15;
const HYDRO_MIN = 0.85, HYDRO_MAX = 1.15;

/** 整数坐标确定性哈希 → [0,1) */
function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 平滑值噪声（双线性 + smoothstep） */
function valueNoise(x: number, y: number, scale: number, seed: number): number {
  const gx = x / scale, gy = y / scale;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = smooth(gx - x0), fy = smooth(gy - y0);
  const v00 = hash2(x0, y0, seed), v10 = hash2(x0 + 1, y0, seed);
  const v01 = hash2(x0, y0 + 1, seed), v11 = hash2(x0 + 1, y0 + 1, seed);
  return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
}

export class Terrain {
  constructor(public seed = 1) {}

  /** 地形种类：大尺度噪声分水域/山地/森林/平原 */
  kind(x: number, y: number): TerrainKind {
    const n = valueNoise(x, y, 9, this.seed * 7 + 1);
    if (n < 0.18) return 'water';
    if (n > 0.78) return 'hill';
    const f = valueNoise(x, y, 5, this.seed * 7 + 2);
    if (f > 0.72) return 'forest';
    return 'plain';
  }

  /** 风资源质量（0.8~1.2）：大尺度风带 + 山地略增益（山口效应） */
  windQuality(x: number, y: number): number {
    const band = valueNoise(x, y, 14, this.seed * 7 + 3);
    let q = WIND_MIN + (WIND_MAX - WIND_MIN) * band;
    if (this.kind(x, y) === 'hill') q = Math.min(WIND_MAX, q + 0.06);
    return Math.round(q * 100) / 100;
  }

  /** 光照资源质量（0.85~1.15）：纬度梯度（南强北弱）+ 局地云量噪声 */
  solarQuality(x: number, y: number): number {
    const lat = Math.max(0, Math.min(1, y / 36)); // y 越大越靠南
    const cloud = valueNoise(x, y, 11, this.seed * 7 + 4);
    const q = SOLAR_MIN + (SOLAR_MAX - SOLAR_MIN) * (0.55 * lat + 0.45 * cloud);
    return Math.round(q * 100) / 100;
  }

  /** 水力资源质量（0.85~1.15）：临近水域则高（取 5 格内最近水距） */
  hydroQuality(x: number, y: number): number {
    let best = 6;
    for (let dx = -5; dx <= 5; dx += 1) {
      for (let dy = -5; dy <= 5; dy += 1) {
        if (this.kind(Math.round(x + dx), Math.round(y + dy)) === 'water') {
          best = Math.min(best, Math.hypot(dx, dy));
        }
      }
    }
    const t = Math.max(0, 1 - best / 6); // 0=远离水，1=贴着水
    return Math.round((HYDRO_MIN + (HYDRO_MAX - HYDRO_MIN) * t) * 100) / 100;
  }

  /** 某机组类型在该点的资源系数（非风/光/水返回 1） */
  siteQuality(type: string, x: number, y: number): number {
    if (type === 'wind') return this.windQuality(x, y);
    if (type === 'solar') return this.solarQuality(x, y);
    if (type === 'hydro') return this.hydroQuality(x, y);
    return 1;
  }

  /** 落点建设造价系数（场站/变电站/储能/大客户接入） */
  buildFactor(x: number, y: number): number {
    return TERRAIN_BUILD_FACTOR[this.kind(Math.round(x), Math.round(y))];
  }

  /** 线路路径造价系数：沿线采样取均值（跨山过水的线更贵） */
  lineFactor(x1: number, y1: number, x2: number, y2: number): number {
    const len = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
    const steps = Math.max(2, Math.ceil(len));
    let sum = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      sum += TERRAIN_BUILD_FACTOR[this.kind(Math.round(x1 + (x2 - x1) * t), Math.round(y1 + (y2 - y1) * t))];
    }
    return Math.round((sum / (steps + 1)) * 100) / 100;
  }
}
