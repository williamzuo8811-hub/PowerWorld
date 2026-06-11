// 全局元进度：跨对局持久的"指挥官档案"。
// 通关/失败都给经验——失败还有下局研发点加成（roguelike 式"再来一局"动力）；
// 全局等级解锁变体玩法（困难/竞速/无贷款/极限），见 modes.ts。
const KEY = 'powerworld.meta.v1';

export interface MetaProfile {
  xp: number; // 累计经验
  wins: number;
  losses: number;
  runs: number; // 开局总数
  pendingRpBonus: number; // 下一局的研发点加成（失败补偿，0.1 = +10%）
}

const DEFAULTS: MetaProfile = { xp: 0, wins: 0, losses: 0, runs: 0, pendingRpBonus: 0 };

/** 各等级所需累计 XP（索引 = 等级-1）；超出表尾后每级 +400 */
const LEVEL_XP = [0, 100, 260, 480, 760, 1100, 1500, 1960, 2480, 3060];

/** 失败补偿：下一局研发点 +10% */
export const LOSS_RP_BONUS = 0.1;

/** 通关经验：按评级（失败也给少量——每一局都算数） */
export const XP_BY_GRADE: Record<string, number> = { S: 130, A: 100, B: 75, C: 55, D: 40 };
export const XP_LOSS = 18;

export function loadMeta(): MetaProfile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<MetaProfile>) };
  } catch {
    /* 忽略 */
  }
  return { ...DEFAULTS };
}

export function saveMeta(m: MetaProfile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* 忽略 */
  }
}

/** 由累计 XP 推算全局等级（1 起） */
export function levelOf(xp: number): number {
  let lv = 1;
  for (let i = 1; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) lv = i + 1;
  if (xp >= LEVEL_XP[LEVEL_XP.length - 1]) {
    lv = LEVEL_XP.length + Math.floor((xp - LEVEL_XP[LEVEL_XP.length - 1]) / 400);
  }
  return lv;
}

/** 当前等级的进度（0..1）与下一级所需 XP（满级语义不存在——可无限升级） */
export function levelProgress(xp: number): { level: number; cur: number; next: number; frac: number } {
  const level = levelOf(xp);
  const base = level - 1 < LEVEL_XP.length ? LEVEL_XP[level - 1] : LEVEL_XP[LEVEL_XP.length - 1] + (level - LEVEL_XP.length) * 400;
  const next = level < LEVEL_XP.length ? LEVEL_XP[level] : base + 400;
  return { level, cur: xp - base, next: next - base, frac: Math.min(1, (xp - base) / Math.max(next - base, 1)) };
}

export interface MetaResult {
  leveledUp: boolean;
  level: number;
  gainedXp: number;
  lossBonusArmed: boolean; // 本次失败是否武装了下局 RP 补偿
}

/** 记录一局结果（胜/负、评级），返回升级信息；失败会武装下局 +10% 研发点 */
export function recordRunResult(win: boolean, grade: string): MetaResult {
  const m = loadMeta();
  const before = levelOf(m.xp);
  const gainedXp = win ? (XP_BY_GRADE[grade] ?? 50) : XP_LOSS;
  m.xp += gainedXp;
  if (win) m.wins++;
  else {
    m.losses++;
    m.pendingRpBonus = LOSS_RP_BONUS;
  }
  saveMeta(m);
  const after = levelOf(m.xp);
  return { leveledUp: after > before, level: after, gainedXp, lossBonusArmed: !win };
}

/** 开新局时调用：消耗待发的失败补偿，返回本局研发点倍率（1 或 1.1） */
export function consumeRpBonus(): number {
  const m = loadMeta();
  if (m.pendingRpBonus > 0) {
    const bonus = m.pendingRpBonus;
    m.pendingRpBonus = 0;
    m.runs++;
    saveMeta(m);
    return 1 + bonus;
  }
  m.runs++;
  saveMeta(m);
  return 1;
}
