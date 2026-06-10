// 存档读写：基于 localStorage，单槽位。
import type { Simulation, SimSaveState } from '../sim/simulation';

const KEY = 'powerworld.save.v1';

interface SaveBlob {
  version: number;
  scenarioId: string;
  ts: number;
  save: SimSaveState;
}

export function saveGame(sim: Simulation, scenarioId: string): boolean {
  try {
    const blob: SaveBlob = { version: 1, scenarioId, ts: Date.now(), save: sim.serialize() };
    localStorage.setItem(KEY, JSON.stringify(blob));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(): { scenarioId: string; save: SimSaveState; ts: number } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const blob = JSON.parse(raw) as SaveBlob;
    if (blob.version !== 1) return null;
    return { scenarioId: blob.scenarioId, save: blob.save, ts: blob.ts };
  } catch {
    return null;
  }
}

export function hasSave(): boolean {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
}
