import type { EventBus } from '../../core/EventBus';
import type { GameEvents } from '../../core/events';
import type { Actor } from '../../entities/Actor';
import type { TransactionService, ItemTable } from '../../systems/economy/TransactionService';
import type { NavigationService } from '../../systems/navigation/NavigationService';
import type { WorldModel } from '../world/WorldModel';
import type { OrderService, RecipeTable } from './OrderService';

export type BrewStep =
  | { id: string; kind: 'choose_bean'; station: string }
  | { id: string; kind: 'choose_addition'; station: string; correct: string }
  | { id: string; kind: 'timing'; station: string; target: number; tolerance: number; periodMs: number };

export interface BrewingConfig {
  additions: Record<string, { label: string; itemId: string | null }>;
  /** Timing accuracy falls from 1 (inside tolerance) to 0 at `zeroAt` beyond it. */
  scoring: { zeroAt: number; beanWeight: number; performanceWeight: number };
  supplies: Record<string, number>;
}

export interface Drink {
  id: string;
  orderId: number;
  recipeId: string;
  beanItem: string;
  beanQuality: number;
  /** 1 when every ingredient choice was right, else the share of right choices. */
  recipeAccuracy: number;
  /** Mean accuracy of the timing steps (0–1). */
  performance: number;
  /** 0–100: bean quality and brewing performance combined. */
  quality: number;
  /** Simulation time the drink was finished (serving-time / temperature in M6). */
  readyAt: number;
  steps: Record<string, number>;
}

interface Session {
  orderId: number;
  recipeId: string;
  stepIndex: number;
  /** Simulation time the current step became active (its needle starts at 0). */
  armedAt: number | null;
  bean: { itemId: string; quality: number } | null;
  choices: Array<{ step: string; chosen: string; correct: boolean }>;
  scores: Record<string, number>;
}

export type BrewResult = { ok: true } | { ok: false; reason: string; applicable?: boolean };

export interface BrewView {
  orderId: number;
  recipeId: string;
  stepIndex: number;
  steps: BrewStep[];
  current: BrewStep | null;
  armed: boolean;
  /** Current needle value 0–1 for timing steps. */
  needle: number | null;
  scores: Record<string, number>;
}

const OK: BrewResult = { ok: true };
const no = (reason: string, applicable = true): BrewResult => ({ ok: false, reason, applicable });

/** Triangle wave 0 → 1 → 0 over one period. */
export const needleAt = (elapsedMs: number, periodMs: number): number => {
  const phase = (((elapsedMs % periodMs) + periodMs) % periodMs) / periodMs;
  return phase < 0.5 ? phase * 2 : 2 - phase * 2;
};

export const timingAccuracy = (value: number, target: number, tolerance: number, zeroAt: number): number => {
  const miss = Math.max(0, Math.abs(value - target) - tolerance);
  return Math.max(0, 1 - miss / zeroAt);
};

/**
 * Hands-on brewing. A session belongs to one accepted order and walks through
 * the recipe's steps; each step happens at a specific station the player
 * must stand at. Ingredients are consumed when chosen (never twice). The
 * finished drink goes into the player's hands; the order becomes READY.
 */
export class BrewingService {
  private session: Session | null = null;
  private readonly drinks = new Map<string, Drink>();
  private nextDrink = 1;

  constructor(
    private readonly world: WorldModel,
    private readonly nav: NavigationService,
    private readonly player: Actor,
    private readonly orders: OrderService,
    private readonly recipes: RecipeTable,
    readonly config: BrewingConfig,
    private readonly items: ItemTable,
    private readonly tx: TransactionService,
    private readonly bus: EventBus<GameEvents>,
    private readonly now: () => number,
  ) {
    // An order that ends while brewing (customer gave up) aborts the session;
    // a finished drink for it is discarded so the player's hands never get stuck.
    bus.on('order:changed', (e) => {
      if (e.to !== 'FAILED' && e.to !== 'CANCELLED') return;
      if (this.session?.orderId === e.orderId) {
        this.session = null;
        bus.emit('brew:aborted', { orderId: e.orderId, reason: 'orderEnded' });
      }
      for (const d of this.drinks.values()) {
        if (d.orderId !== e.orderId) continue;
        this.drinks.delete(d.id);
        if (this.player.heldItem === d.id) {
          this.player.heldItem = null;
          bus.emit('actor:heldChanged', { actorId: this.player.id, item: null });
          this.player.syncRestState();
        }
        bus.emit('brew:discarded', { drinkId: d.id, orderId: e.orderId });
      }
    });
  }

  // ── queries ─────────────────────────────────────────────────────────────

  drink(id: string | null): Drink | undefined {
    return id ? this.drinks.get(id) : undefined;
  }

  heldDrink(): Drink | undefined {
    return this.drink(this.player.heldItem);
  }

  /** Oldest accepted order (FIFO) that is not being brewed yet. */
  nextOrderToBrew(): number | null {
    const o = this.orders
      .activeOrders()
      .filter((x) => x.status === 'ACCEPTED')
      .sort((a, b) => a.id - b.id)[0];
    return o?.id ?? null;
  }

  private steps(recipeId: string): BrewStep[] {
    return ((this.recipes[recipeId] as unknown as { steps?: BrewStep[] }).steps ?? []) as BrewStep[];
  }

  private currentStep(): BrewStep | null {
    const s = this.session;
    return s ? this.steps(s.recipeId)[s.stepIndex] ?? null : null;
  }

  view(): BrewView | null {
    const s = this.session;
    if (!s) return null;
    const step = this.currentStep();
    return {
      orderId: s.orderId,
      recipeId: s.recipeId,
      stepIndex: s.stepIndex,
      steps: this.steps(s.recipeId),
      current: step,
      armed: s.armedAt !== null,
      needle: step?.kind === 'timing' && s.armedAt !== null ? needleAt(this.now() - s.armedAt, step.periodMs) : null,
      scores: { ...s.scores },
    };
  }

  ownedBeans(): Array<{ itemId: string; qty: number; quality: number }> {
    return Object.entries(this.items)
      .filter(([, d]) => d.category === 'roasted')
      .map(([itemId]) => ({ itemId, stack: this.tx.stack(itemId) }))
      .filter((b) => b.stack)
      .map((b) => ({ itemId: b.itemId, qty: b.stack!.qty, quality: b.stack!.quality }));
  }

  // ── stations ────────────────────────────────────────────────────────────

  canUseStation(stationType: string): BrewResult {
    const s = this.session;
    if (!s) {
      if (this.player.heldItem) return no('handsFull');
      const orderId = this.nextOrderToBrew();
      if (orderId === null) return no('noOrderToBrew');
      const first = this.steps(this.orders.get(orderId)!.recipeId)[0];
      if (!first) return no('noSteps');
      if (first.station !== stationType) return no('wrongStation');
      if (first.kind === 'choose_bean' && this.ownedBeans().length === 0) return no('noBeans');
      return OK;
    }
    const step = this.currentStep();
    if (!step) return no('noSteps');
    return step.station === stationType ? OK : no('wrongStation');
  }

  /** Called when the player finishes the "use station" interaction: start a session or arm the next step. */
  useStation(stationType: string): BrewResult {
    const c = this.canUseStation(stationType);
    if (!c.ok) return c;
    if (!this.session) {
      const orderId = this.nextOrderToBrew()!;
      const order = this.orders.get(orderId)!;
      const t = this.orders.transition(orderId, 'PREPARING');
      if (!t.ok) return no(t.reason);
      this.session = { orderId, recipeId: order.recipeId, stepIndex: 0, armedAt: null, bean: null, choices: [], scores: {} };
      this.bus.emit('brew:started', { orderId, recipeId: order.recipeId });
    }
    this.session!.armedAt = this.now();
    return OK;
  }

  private atStation(step: BrewStep): boolean {
    const o = this.world.allObjects().find((x) => x.type === step.station);
    return !!o && this.nav.isWithinReach(this.player.tile, { footprint: o.footprint, radius: o.def.interaction?.radius ?? 1, sides: o.sides });
  }

  private activeStep(kind: BrewStep['kind']): { step: BrewStep } | { fail: BrewResult } {
    const s = this.session;
    const step = this.currentStep();
    if (!s || !step) return { fail: no('noSession') };
    if (step.kind !== kind) return { fail: no('wrongStep') };
    if (s.armedAt === null) return { fail: no('notArmed') };
    if (!this.atStation(step)) return { fail: no('notAtStation') };
    return { step };
  }

  // ── step commands (UI) ──────────────────────────────────────────────────

  chooseBean(itemId: string): BrewResult {
    const a = this.activeStep('choose_bean');
    if ('fail' in a) return a.fail;
    if (this.items[itemId]?.category !== 'roasted') return no('notABean');
    const quality = this.tx.stack(itemId)?.quality ?? 0;
    const res = this.tx.execute({ reason: `brew:bean:${this.session!.orderId}`, items: [{ itemId, qty: -1 }] });
    if (!res.ok) return no(res.error);
    this.session!.bean = { itemId, quality };
    return this.advance();
  }

  chooseAddition(additionId: string): BrewResult {
    const a = this.activeStep('choose_addition');
    if ('fail' in a) return a.fail;
    const add = this.config.additions[additionId];
    if (!add) return no('unknownAddition');
    if (add.itemId) {
      const res = this.tx.execute({ reason: `brew:addition:${this.session!.orderId}`, items: [{ itemId: add.itemId, qty: -1 }] });
      if (!res.ok) return no(res.error === 'insufficientItems' ? 'noIngredient' : res.error);
    }
    const step = a.step as Extract<BrewStep, { kind: 'choose_addition' }>;
    this.session!.choices.push({ step: step.id, chosen: additionId, correct: additionId === step.correct });
    return this.advance();
  }

  /** Stop the needle of the current timing step. */
  press(): BrewResult {
    const a = this.activeStep('timing');
    if ('fail' in a) return a.fail;
    const step = a.step as Extract<BrewStep, { kind: 'timing' }>;
    const value = needleAt(this.now() - this.session!.armedAt!, step.periodMs);
    this.session!.scores[step.id] = timingAccuracy(value, step.target, step.tolerance, this.config.scoring.zeroAt);
    return this.advance();
  }

  /** Abandon the drink. Ingredients already used are lost; the order goes back to the queue of orders to brew. */
  cancel(): BrewResult {
    const s = this.session;
    if (!s) return no('noSession');
    this.session = null;
    this.orders.transition(s.orderId, 'ACCEPTED', 'brewCancelled');
    this.bus.emit('brew:aborted', { orderId: s.orderId, reason: 'cancelled' });
    return OK;
  }

  private advance(): BrewResult {
    const s = this.session!;
    const prev = this.currentStep()!;
    s.stepIndex++;
    const next = this.currentStep();
    if (!next) return this.finish();
    // Consecutive steps at the same station continue without walking away.
    s.armedAt = next.station === prev.station ? this.now() : null;
    this.bus.emit('brew:step', { orderId: s.orderId, stepIndex: s.stepIndex });
    return OK;
  }

  private finish(): BrewResult {
    const s = this.session!;
    const timings = Object.values(s.scores);
    const performance = timings.length ? timings.reduce((a, b) => a + b, 0) / timings.length : 1;
    const recipeAccuracy = s.choices.length ? s.choices.filter((c) => c.correct).length / s.choices.length : 1;
    const { beanWeight, performanceWeight } = this.config.scoring;
    const beanQuality = s.bean?.quality ?? 0;
    const drink: Drink = {
      id: `drink:${this.nextDrink++}`,
      orderId: s.orderId,
      recipeId: s.recipeId,
      beanItem: s.bean?.itemId ?? '',
      beanQuality,
      recipeAccuracy,
      performance,
      quality: Math.round(beanWeight * beanQuality + performanceWeight * performance * 100),
      readyAt: this.now(),
      steps: { ...s.scores },
    };
    const t = this.orders.transition(s.orderId, 'READY');
    if (!t.ok) return no(t.reason);
    this.session = null;
    this.drinks.set(drink.id, drink);
    this.player.heldItem = drink.id;
    this.bus.emit('actor:heldChanged', { actorId: this.player.id, item: drink.id });
    this.player.syncRestState();
    this.bus.emit('brew:finished', { orderId: s.orderId, drinkId: drink.id, quality: drink.quality });
    return OK;
  }

  /** The drink leaves the player's hands into a customer's (once). */
  handOver(drinkId: string): Drink | undefined {
    const d = this.drinks.get(drinkId);
    if (!d || this.player.heldItem !== drinkId) return undefined;
    this.drinks.delete(drinkId);
    this.player.heldItem = null;
    this.bus.emit('actor:heldChanged', { actorId: this.player.id, item: null });
    return d;
  }

  // ── supplies (milk etc.) ────────────────────────────────────────────────

  supplyPrice(itemId: string): number | undefined {
    return this.config.supplies[itemId];
  }
}
