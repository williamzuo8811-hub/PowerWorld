// 用电曲线与天气模型：把"一天的节奏"和"靠天吃饭的新能源"注入仿真。
import type { LoadProfile, PlantType } from './types';

/** 高斯钟形函数，用来拼出日内曲线 */
function gauss(x: number, mu: number, sigma: number): number {
  return Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));
}

/**
 * 给定一天中的小时（0..24），返回该类负荷的需求系数（约 0.3 ~ 1.6）。
 * - 居民：双峰（早高峰 + 更强的晚高峰）
 * - 商业：白天单峰
 * - 工业：基本平稳、略有日间抬升
 */
export function demandMultiplier(hour: number, profile: LoadProfile): number {
  const h = ((hour % 24) + 24) % 24;
  switch (profile) {
    case 'residential':
      return 0.42 + gauss(h, 7.5, 1.6) * 0.5 + gauss(h, 20, 2.4) * 1.0;
    case 'commercial':
      return 0.3 + gauss(h, 14, 4) * 1.0;
    case 'industrial':
      return 0.72 + gauss(h, 13, 6) * 0.3;
  }
}

/**
 * 新能源可用系数（0..1）。
 * @param hour    一天中的小时
 * @param windBase 当日风况基准（由仿真用慢变噪声给出）
 */
export function renewableAvailability(type: PlantType, hour: number, windBase: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (type === 'solar') {
    // 只在 6 点~18 点发电，正午最强
    if (h < 6 || h > 18) return 0;
    return Math.max(0, Math.sin(((h - 6) / 12) * Math.PI)) ** 1.1;
  }
  if (type === 'wind') {
    // 以当日风况为中心，叠加日内小幅起伏；夜间往往更大
    const diurnal = 0.85 + 0.3 * Math.sin(((h + 4) / 24) * 2 * Math.PI);
    return Math.min(1, Math.max(0.02, windBase * diurnal));
  }
  return 1;
}

/**
 * 季节强度：把年内相位 phase∈[0,1) 映射为 {summer, winter}∈[0,1]。
 * - phase 0：春（中性，summer=winter=0）
 * - phase 0.25：盛夏（summer=1）
 * - phase 0.5：秋（中性）
 * - phase 0.75：深冬（winter=1）
 */
export function seasonIntensity(phase: number): { summer: number; winter: number } {
  const s = Math.sin(((phase % 1) + 1) % 1 * 2 * Math.PI);
  return { summer: Math.max(0, s), winter: Math.max(0, -s) };
}
