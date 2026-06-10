// 本地排行榜与成绩分享：每个关卡记录个人最佳（每日挑战按种子区分），
// 并生成可一键复制的战绩文本（Wordle 式分享，无需后端）。
const KEY = 'powerworld.scores.v1';
const HISTORY_MAX = 60;

export interface ScoreRecord {
  scenarioId: string;
  seed?: number; // 每日挑战的日期种子（区分"哪一天的题"）
  ts: number; // 真实时间戳
  day: number; // 通关时的游戏天
  score: number;
  grade: string;
  reliability: number; // 0..1
  clean: number; // 0..1
  marketShare: number; // 0..1
  netWorth: number;
}

interface ScoreStore {
  history: ScoreRecord[];
}

function load(): ScoreStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as ScoreStore;
  } catch {
    /* 忽略 */
  }
  return { history: [] };
}

function save(s: ScoreStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 忽略 */
  }
}

function sameBoard(a: ScoreRecord, scenarioId: string, seed?: number): boolean {
  return a.scenarioId === scenarioId && (a.seed ?? null) === (seed ?? null);
}

/** 记录一次通关成绩；返回是否刷新了该关卡（/该日题面）的个人最佳 */
export function recordScore(rec: ScoreRecord): { isBest: boolean; best: ScoreRecord } {
  const s = load();
  const prev = bestFor(rec.scenarioId, rec.seed, s);
  s.history.push(rec);
  if (s.history.length > HISTORY_MAX) s.history.splice(0, s.history.length - HISTORY_MAX);
  save(s);
  const isBest = !prev || rec.score > prev.score;
  return { isBest, best: isBest ? rec : prev! };
}

/** 某关卡（每日挑战按种子）的个人最佳 */
export function bestFor(scenarioId: string, seed?: number, store?: ScoreStore): ScoreRecord | null {
  const s = store ?? load();
  let best: ScoreRecord | null = null;
  for (const r of s.history) {
    if (!sameBoard(r, scenarioId, seed)) continue;
    if (!best || r.score > best.score) best = r;
  }
  return best;
}

/** 全部关卡的个人最佳（菜单徽章用）：scenarioId → 最佳记录（每日挑战取任意日最高） */
export function allBests(): Record<string, ScoreRecord> {
  const s = load();
  const out: Record<string, ScoreRecord> = {};
  for (const r of s.history) {
    if (!out[r.scenarioId] || r.score > out[r.scenarioId].score) out[r.scenarioId] = r;
  }
  return out;
}

const GRADE_EMOJI: Record<string, string> = { S: '🌟', A: '🏆', B: '🥈', C: '🥉', D: '😅' };

/** 生成可分享的战绩文本（复制到剪贴板/粘贴到群里） */
export function shareText(rec: ScoreRecord, scenarioName: string): string {
  const seedNote = rec.seed != null ? ` #${rec.seed}` : '';
  return [
    `⚡ 电力世界 · ${scenarioName}${seedNote}`,
    `${GRADE_EMOJI[rec.grade] ?? '🏅'} 评级 ${rec.grade}（${rec.score.toFixed(0)} 分）· 第 ${rec.day} 天通关`,
    `🔌 可靠性 ${(rec.reliability * 100).toFixed(1)}% | 🌱 清洁 ${(rec.clean * 100).toFixed(0)}% | 📊 市占 ${(rec.marketShare * 100).toFixed(0)}%`,
    `💰 净资产 ¥${Math.round(rec.netWorth).toLocaleString('en-US')}`,
  ].join('\n');
}
