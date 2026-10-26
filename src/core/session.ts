import type { GameContent } from '../data/content';
import { GameSimulation } from '../gameplay/GameSimulation';
import { LocalStorageAdapter, SaveService, type LoadResult, type StorageAdapter } from '../gameplay/state/SaveService';
import { SystemClock, type Clock } from './Clock';

export interface SessionOptions {
  /** Map to open; omitted = the map the save was on (default farm). */
  mapId?: string;
  content: GameContent;
  /** false = throwaway session (M1 sandbox, tests); nothing is loaded or saved. */
  persistent: boolean;
  storage?: StorageAdapter;
  clock?: Clock;
}

export interface GameSession {
  sim: GameSimulation;
  saves: SaveService | null;
  /** Why the previous save could not be used (shown to the player), if any. */
  loadProblem: Exclude<LoadResult, { status: 'ok' } | { status: 'empty' }> | null;
  /** True when saving must not happen (e.g. the stored save came from a newer version). */
  saveBlocked: boolean;
}

export function createSession(o: SessionOptions): GameSession {
  const clock = o.clock ?? new SystemClock();
  const mapOf = (id: string) => {
    const m = o.content.maps[id];
    if (!m) throw new Error(`unknown map "${id}"`);
    return structuredClone(m);
  };
  if (!o.persistent) {
    return { sim: new GameSimulation(mapOf(o.mapId ?? 'farm'), o.content, { clock }), saves: null, loadProblem: null, saveBlocked: true };
  }
  const saves = new SaveService(o.storage ?? new LocalStorageAdapter());
  const loaded = saves.load(clock.now());
  const state = loaded.status === 'ok' ? loaded.state : undefined;
  const savedMap = state && o.content.maps[state.player.map] && state.player.map !== 'sandbox' ? state.player.map : 'farm';
  const sim = new GameSimulation(mapOf(o.mapId ?? savedMap), o.content, { clock, ...(state ? { state } : {}) });
  const loadProblem = loaded.status === 'ok' || loaded.status === 'empty' ? null : loaded;
  return { sim, saves, loadProblem, saveBlocked: loaded.status === 'unsupported' };
}

/**
 * Saves after gameplay changes (debounced), periodically, and when the page
 * is hidden or closed. Transient work in progress is never saved half-done:
 * only committed state lives in GameState.
 */
export class Autosave {
  private dirty = false;
  private lastSave = 0;
  private readonly offs: Array<() => void> = [];

  constructor(
    private readonly session: GameSession,
    private readonly minIntervalMs = 2000,
  ) {
    const bus = session.sim.bus;
    const mark = () => (this.dirty = true);
    this.offs.push(bus.on('economy:transaction', mark), bus.on('farm:plotChanged', mark), bus.on('farm:canChanged', mark), bus.on('farm:seedSelected', mark), bus.on('move:arrived', mark), bus.on('decor:changed', mark));
  }

  /** Call every frame with a monotonic time. */
  update(nowMs: number): void {
    if (this.dirty && nowMs - this.lastSave >= this.minIntervalMs) this.saveNow(nowMs);
  }

  saveNow(nowMs = performance.now()): boolean {
    const { saves, sim, saveBlocked } = this.session;
    if (!saves || saveBlocked) return false;
    saves.save(sim.captureState(), sim.clock.now());
    this.dirty = false;
    this.lastSave = nowMs;
    sim.bus.emit('save:written', { at: sim.clock.now() });
    return true;
  }

  destroy(): void {
    for (const off of this.offs) off();
  }
}
