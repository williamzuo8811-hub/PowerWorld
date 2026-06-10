// 存档读写：基于 localStorage，多槽位（快速/自动/三个手动槽）+ 版本迁移 + 导入导出。
import type { Simulation, SimSaveState } from '../sim/simulation';

const PREFIX = 'powerworld.save2.'; // 每个槽位一个 key：powerworld.save2.<slot>
const LEGACY_KEY = 'powerworld.save.v1'; // 旧版单槽存档（自动迁移到 quick 槽）
export const SAVE_VERSION = 2;

export type SlotId = 'quick' | 'auto' | 'slot1' | 'slot2' | 'slot3';
export const SLOT_IDS: SlotId[] = ['quick', 'auto', 'slot1', 'slot2', 'slot3'];
export const SLOT_LABEL: Record<SlotId, string> = {
  quick: '快速存档', auto: '自动存档', slot1: '存档槽 1', slot2: '存档槽 2', slot3: '存档槽 3',
};

export interface SaveBlob {
  version: number;
  scenarioId: string;
  ts: number; // 真实时间戳（毫秒）
  save: SimSaveState;
}

export interface SaveMeta {
  slot: SlotId;
  scenarioId: string;
  ts: number;
  day: number; // 游戏内天数（展示用）
}

/** 版本迁移链：把任意旧版本 blob 升级到当前版本；无法识别返回 null */
export function migrateSave(blob: unknown): SaveBlob | null {
  if (!blob || typeof blob !== 'object') return null;
  const b = blob as Partial<SaveBlob>;
  if (typeof b.version !== 'number' || !b.save || typeof b.scenarioId !== 'string') return null;
  let v = b.version;
  // v1 → v2：结构兼容（deserialize 对新增字段都有 ?? 兜底），仅升版本号
  if (v === 1) v = 2;
  if (v !== SAVE_VERSION) return null; // 来自更新版本的存档：拒绝（避免静默丢数据）
  // 基本完整性校验
  const s = b.save as Partial<SimSaveState>;
  if (typeof s.money !== 'number' || typeof s.clock !== 'number' || !s.grid) return null;
  return { version: SAVE_VERSION, scenarioId: b.scenarioId, ts: b.ts ?? Date.now(), save: b.save as SimSaveState };
}

function readSlot(slot: SlotId): SaveBlob | null {
  try {
    const raw = localStorage.getItem(PREFIX + slot);
    if (raw) return migrateSave(JSON.parse(raw));
    // 旧版单槽存档：透明迁移到 quick 槽
    if (slot === 'quick') {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const blob = migrateSave(JSON.parse(legacy));
        if (blob) {
          localStorage.setItem(PREFIX + 'quick', JSON.stringify(blob));
          localStorage.removeItem(LEGACY_KEY);
          return blob;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function saveGame(sim: Simulation, scenarioId: string, slot: SlotId = 'quick'): boolean {
  try {
    const blob: SaveBlob = { version: SAVE_VERSION, scenarioId, ts: Date.now(), save: sim.serialize() };
    localStorage.setItem(PREFIX + slot, JSON.stringify(blob));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(slot: SlotId = 'quick'): { scenarioId: string; save: SimSaveState; ts: number } | null {
  const blob = readSlot(slot);
  return blob ? { scenarioId: blob.scenarioId, save: blob.save, ts: blob.ts } : null;
}

/** 列出所有已有存档（按时间倒序） */
export function listSaves(): SaveMeta[] {
  const out: SaveMeta[] = [];
  for (const slot of SLOT_IDS) {
    const blob = readSlot(slot);
    if (blob) out.push({ slot, scenarioId: blob.scenarioId, ts: blob.ts, day: Math.floor((blob.save.clock ?? 0) / 24) + 1 });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

export function deleteSave(slot: SlotId): void {
  try {
    localStorage.removeItem(PREFIX + slot);
  } catch {
    /* 忽略 */
  }
}

export function hasSave(slot: SlotId = 'quick'): boolean {
  return readSlot(slot) != null;
}

export function hasAnySave(): boolean {
  return listSaves().length > 0;
}

/** 导出存档为 JSON 字符串（可下载/分享/跨设备迁移） */
export function exportSave(slot: SlotId): string | null {
  const blob = readSlot(slot);
  return blob ? JSON.stringify(blob) : null;
}

/** 从 JSON 字符串导入存档（校验 + 迁移后写入指定槽位） */
export function importSave(json: string, slot: SlotId = 'quick'): boolean {
  try {
    const blob = migrateSave(JSON.parse(json));
    if (!blob) return false;
    localStorage.setItem(PREFIX + slot, JSON.stringify(blob));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(slot: SlotId = 'quick'): void {
  deleteSave(slot);
}
