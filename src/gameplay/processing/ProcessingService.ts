import type { Clock } from '../../core/Clock';
import type { EventBus } from '../../core/EventBus';
import type { GameEvents } from '../../core/events';
import type { TransactionRequest, TransactionService } from '../../systems/economy/TransactionService';
import type { EquipmentState, GameState, ProcessingJob } from '../state/GameState';
import type { WorldModel } from '../world/WorldModel';

export interface EquipmentLevelDef {
  level: number;
  cost: number;
  speedBonus: number;
  qualityBonus: number;
  batchMultiplier: number;
}

export interface ProcessingRecipe {
  label: string;
  equipment: string;
  input: { itemId: string; qty: number };
  output: { itemId: string; qty: number };
  durationMs: number;
  qualityDelta: number;
  expReward: number;
}

export interface ProcessingConfig {
  equipment: Record<string, { label: string; levels: EquipmentLevelDef[] }>;
  recipes: Record<string, ProcessingRecipe>;
}

export type ProcResult = { ok: true } | { ok: false; reason: string; applicable?: boolean };

export interface EquipmentView extends EquipmentState {
  label: string;
  status: 'idle' | 'working' | 'done';
  progress: number;
  /** Recipe a load would use right now (null = no inputs available). */
  nextRecipe: string | null;
  nextUpgradeCost: number | null;
}

const OK: ProcResult = { ok: true };
const no = (reason: string, applicable = true): ProcResult => ({ ok: false, reason, applicable });

/**
 * Turns farm products into processed goods on equipment. Conservation rule:
 * a job is created in the same step that removes its inputs, and outputs
 * enter the inventory only by collecting that job (once, idempotency key).
 * Jobs run on wall-clock time, so they finish while the game is closed.
 */
export class ProcessingService {
  constructor(
    private readonly state: GameState,
    private readonly world: WorldModel,
    readonly config: ProcessingConfig,
    private readonly tx: TransactionService,
    private readonly bus: EventBus<GameEvents>,
    private readonly clock: Clock,
  ) {
    for (const o of world.allObjects()) {
      if (!config.equipment[o.type] || state.processing.equipment[o.id]) continue;
      state.processing.equipment[o.id] = { id: o.id, type: o.type, level: 1, job: null };
    }
  }

  isEquipment(objectId: string): boolean {
    return !!this.state.processing.equipment[objectId];
  }

  private eq(id: string): EquipmentState | undefined {
    return this.state.processing.equipment[id];
  }

  private levelDef(e: EquipmentState): EquipmentLevelDef {
    const levels = this.config.equipment[e.type]!.levels;
    return levels.find((l) => l.level === e.level) ?? levels[0]!;
  }

  private isDone(job: ProcessingJob): boolean {
    return this.clock.now() >= job.startedAt + job.durationMs;
  }

  recipesFor(type: string): string[] {
    return Object.entries(this.config.recipes)
      .filter(([, r]) => r.equipment === type)
      .map(([id]) => id);
  }

  /** The recipe a load would run: the selected one if its inputs are available, else the first runnable. */
  nextRecipe(id: string): string | null {
    const e = this.eq(id);
    if (!e) return null;
    const batch = this.levelDef(e).batchMultiplier;
    const runnable = (rid: string) => this.tx.count(this.config.recipes[rid]!.input.itemId) >= this.config.recipes[rid]!.input.qty * batch;
    const sel = this.state.processing.selectedRecipe[e.type];
    if (sel && this.config.recipes[sel]?.equipment === e.type && runnable(sel)) return sel;
    return this.recipesFor(e.type).find(runnable) ?? null;
  }

  selectRecipe(type: string, recipeId: string | null): ProcResult {
    if (!this.config.equipment[type]) return no('unknownEquipment');
    if (recipeId !== null && this.config.recipes[recipeId]?.equipment !== type) return no('unknownRecipe');
    this.state.processing.selectedRecipe[type] = recipeId;
    return OK;
  }

  // ── load ────────────────────────────────────────────────────────────────

  canLoad(id: string): ProcResult {
    const e = this.eq(id);
    if (!e) return no('notEquipment');
    if (e.job) return no('busy', false);
    return this.nextRecipe(id) ? OK : no('noInputs');
  }

  load(id: string): ProcResult {
    const c = this.canLoad(id);
    if (!c.ok) return c;
    const e = this.eq(id)!;
    const recipeId = this.nextRecipe(id)!;
    const r = this.config.recipes[recipeId]!;
    const lv = this.levelDef(e);
    const inputQty = r.input.qty * lv.batchMultiplier;
    const inputQuality = this.tx.stack(r.input.itemId)?.quality ?? 50;
    const now = this.clock.now();
    const res = this.tx.execute({ reason: `process:load:${recipeId}`, items: [{ itemId: r.input.itemId, qty: -inputQty }] });
    if (!res.ok) return no(res.error);
    e.job = {
      recipeId,
      startedAt: now,
      durationMs: Math.round(r.durationMs / (1 + lv.speedBonus)),
      inputItem: r.input.itemId,
      inputQty,
      outputItem: r.output.itemId,
      outputQty: r.output.qty * lv.batchMultiplier,
      outputQuality: Math.max(1, Math.min(100, Math.round(inputQuality + r.qualityDelta + lv.qualityBonus))),
      expReward: r.expReward * lv.batchMultiplier,
    };
    this.bus.emit('processing:changed', { equipmentId: id, status: 'working' });
    return OK;
  }

  // ── collect ─────────────────────────────────────────────────────────────

  private collectRequest(id: string, job: ProcessingJob): TransactionRequest {
    return {
      reason: `process:collect:${job.recipeId}`,
      items: [{ itemId: job.outputItem, qty: job.outputQty, quality: job.outputQuality }],
      exp: job.expReward,
      key: `process:${id}:${job.startedAt}`,
    };
  }

  canCollect(id: string): ProcResult {
    const e = this.eq(id);
    if (!e) return no('notEquipment');
    if (!e.job) return no('idle', false);
    if (!this.isDone(e.job)) return no('notDone');
    const check = this.tx.check(this.collectRequest(id, e.job));
    return check.ok ? OK : no(check.error);
  }

  collect(id: string): ProcResult {
    const c = this.canCollect(id);
    if (!c.ok) return c;
    const e = this.eq(id)!;
    const res = this.tx.execute(this.collectRequest(id, e.job!));
    if (!res.ok) return no(res.error);
    e.job = null;
    this.bus.emit('processing:changed', { equipmentId: id, status: 'idle' });
    return OK;
  }

  // ── upgrades ────────────────────────────────────────────────────────────

  nextUpgradeCost(id: string): number | null {
    const e = this.eq(id);
    if (!e) return null;
    const next = this.config.equipment[e.type]!.levels.find((l) => l.level === e.level + 1);
    return next ? next.cost : null;
  }

  /** Only idle equipment can be upgraded, so a running job's terms never change. */
  upgrade(id: string): ProcResult {
    const e = this.eq(id);
    if (!e) return no('notEquipment');
    if (e.job) return no('busy');
    const next = this.config.equipment[e.type]!.levels.find((l) => l.level === e.level + 1);
    if (!next) return no('maxLevel');
    const res = this.tx.execute({ reason: `upgradeEquipment:${id}:${next.level}`, coins: -next.cost, key: `upgradeEquipment:${id}:${next.level}` });
    if (!res.ok) return no(res.error);
    e.level = next.level;
    this.bus.emit('processing:changed', { equipmentId: id, status: 'idle' });
    return OK;
  }

  // ── views ───────────────────────────────────────────────────────────────

  view(id: string): EquipmentView | undefined {
    const e = this.eq(id);
    if (!e) return undefined;
    const job = e.job;
    const elapsed = job ? this.clock.now() - job.startedAt : 0;
    return {
      ...e,
      job: job ? { ...job } : null,
      label: this.config.equipment[e.type]!.label,
      status: !job ? 'idle' : this.isDone(job) ? 'done' : 'working',
      progress: job ? Math.max(0, Math.min(1, elapsed / job.durationMs)) : 0,
      nextRecipe: job ? null : this.nextRecipe(id),
      nextUpgradeCost: this.nextUpgradeCost(id),
    };
  }

  allViews(): EquipmentView[] {
    return Object.keys(this.state.processing.equipment)
      .filter((id) => this.world.getObject(id))
      .map((id) => this.view(id)!);
  }
}
