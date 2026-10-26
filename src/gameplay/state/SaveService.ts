import { SAVE_MIGRATIONS, SAVE_SCHEMA_VERSION, type GameState } from './GameState';

export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryStorage implements StorageAdapter {
  readonly data = new Map<string, string>();
  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.data.set(key, value);
  }
  remove(key: string): void {
    this.data.delete(key);
  }
}

export class LocalStorageAdapter implements StorageAdapter {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  set(key: string, value: string): void {
    window.localStorage.setItem(key, value);
  }
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* storage unavailable: nothing to remove */
    }
  }
}

export type LoadResult =
  | { status: 'ok'; state: GameState; migratedFrom?: number }
  | { status: 'empty' }
  | { status: 'corrupt' | 'invalid' | 'unsupported'; detail: string; backupKey?: string };

/** Migration from version N to N+1. Register new ones when SAVE_SCHEMA_VERSION increases. */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Structural validation: catches truncated or hand-edited saves before they reach gameplay. */
export function validateState(s: unknown): string[] {
  const p: string[] = [];
  if (!isObj(s)) return ['root is not an object'];
  if (!isNum(s.schemaVersion)) p.push('schemaVersion');
  const eco = s.economy;
  if (!isObj(eco)) p.push('economy');
  else {
    if (!isNum(eco.coins) || eco.coins < 0 || !Number.isInteger(eco.coins)) p.push('economy.coins');
    if (!isObj(eco.inventory)) p.push('economy.inventory');
    else
      for (const [k, v] of Object.entries(eco.inventory)) {
        if (!isObj(v) || !isNum(v.qty) || v.qty <= 0 || !Number.isInteger(v.qty) || !isNum(v.quality)) p.push(`economy.inventory.${k}`);
      }
    if (!Array.isArray(eco.history)) p.push('economy.history');
    if (!Array.isArray(eco.processedKeys)) p.push('economy.processedKeys');
    if (!isNum(eco.nextTxId)) p.push('economy.nextTxId');
  }
  if (!isObj(s.progression) || !isNum(s.progression.exp) || s.progression.exp < 0) p.push('progression.exp');
  const farm = s.farm;
  if (!isObj(farm)) p.push('farm');
  else {
    if (!isObj(farm.plots)) p.push('farm.plots');
    else
      for (const [k, v] of Object.entries(farm.plots)) {
        if (!isObj(v) || typeof v.phase !== 'string' || !isNum(v.growthMs) || !isNum(v.lastUpdateAt) || !isNum(v.waterings)) p.push(`farm.plots.${k}`);
      }
    if (!isObj(farm.wateringCan) || !isNum(farm.wateringCan.water)) p.push('farm.wateringCan');
  }
  if (!isObj(s.player)) p.push('player');
  const proc = s.processing;
  if (!isObj(proc) || !isObj(proc.equipment) || !isObj(proc.selectedRecipe)) p.push('processing');
  else
    for (const [k, v] of Object.entries(proc.equipment)) {
      if (!isObj(v) || typeof v.type !== 'string' || !isNum(v.level)) p.push(`processing.equipment.${k}`);
      else if (v.job !== null) {
        const j = v.job;
        if (!isObj(j) || !isNum(j.startedAt) || !isNum(j.durationMs) || !isNum(j.outputQty) || j.outputQty <= 0 || typeof j.outputItem !== 'string')
          p.push(`processing.equipment.${k}.job`);
      }
    }
  if (!isObj(s.market) || !isObj(s.market.saturation)) p.push('market');
  return p;
}

/**
 * Versioned single-slot save. Never silently destroys data: unreadable or
 * invalid saves are copied to a backup key before the caller starts fresh.
 */
export class SaveService {
  constructor(
    private readonly storage: StorageAdapter,
    readonly key = 'tcss.save.slot1',
    private readonly migrations: Record<number, Migration> = SAVE_MIGRATIONS,
    private readonly currentVersion = SAVE_SCHEMA_VERSION,
  ) {}

  save(state: GameState, now: number): void {
    state.savedAt = now;
    this.storage.set(this.key, JSON.stringify(state));
  }

  load(now: number): LoadResult {
    const raw = this.storage.get(this.key);
    if (raw === null) return { status: 'empty' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { status: 'corrupt', detail: (e as Error).message, backupKey: this.backup(raw, now) };
    }
    if (!isObj(parsed) || !isNum(parsed.schemaVersion)) {
      return { status: 'invalid', detail: 'missing schemaVersion', backupKey: this.backup(raw, now) };
    }
    const from = parsed.schemaVersion;
    if (from > this.currentVersion) {
      // A newer game wrote this. Keep it untouched; the caller must not overwrite it.
      return { status: 'unsupported', detail: `save version ${from} > supported ${this.currentVersion}` };
    }
    let data: Record<string, unknown> = parsed;
    for (let v = from; v < this.currentVersion; v++) {
      const m = this.migrations[v];
      if (!m) return { status: 'invalid', detail: `no migration from v${v}`, backupKey: this.backup(raw, now) };
      data = { ...m(data), schemaVersion: v + 1 };
    }
    const problems = validateState(data);
    if (problems.length) return { status: 'invalid', detail: problems.join(', '), backupKey: this.backup(raw, now) };
    return from === this.currentVersion ? { status: 'ok', state: data as unknown as GameState } : { status: 'ok', state: data as unknown as GameState, migratedFrom: from };
  }

  private backup(raw: string, now: number): string {
    const k = `${this.key}.backup.${now}`;
    this.storage.set(k, raw);
    return k;
  }
}
