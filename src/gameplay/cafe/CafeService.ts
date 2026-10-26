import type { EventBus } from '../../core/EventBus';
import type { GameEvents } from '../../core/events';
import type { Rng } from '../../core/Rng';
import { StateMachine } from '../../core/StateMachine';
import { Actor } from '../../entities/Actor';
import type { NavigationService } from '../../systems/navigation/NavigationService';
import { sameTile, tileCenter, type TilePos, type WorldPos } from '../../utils/tile';
import type { WorldModel } from '../world/WorldModel';
import type { TransactionService } from '../../systems/economy/TransactionService';
import type { Drink } from './BrewingService';
import type { Order, OrderService } from './OrderService';

/** What a served customer pays and how they rate it. M5: base reward; M6 plugs in quality ratings. */
export interface ServiceOutcome {
  coins: number;
  exp: number;
}
export type RatingPolicy = (order: Order, drink: Drink, customer: Customer) => ServiceOutcome;

/** Optional links to progression/reputation (all default to neutral). */
export interface CafeHooks {
  /** > 1 = customers arrive more often (good reputation). */
  trafficFactor?: () => number;
  /** Customers only order recipes the player has unlocked. */
  isRecipeUnlocked?: (recipeId: string) => boolean;
  /** A customer left unhappy without being served. */
  onCustomerFailed?: (reason: string) => void;
}
export const baseRewardPolicy: RatingPolicy = (order) => ({ coins: order.reward.coins, exp: order.reward.exp });

export type CustomerState =
  | 'SPAWNING'
  | 'ENTERING'
  | 'QUEUING'
  | 'WALKING_TO_ORDER'
  | 'ORDERING'
  | 'WAITING'
  | 'RECEIVING'
  | 'TASTING'
  | 'RATING'
  | 'LEAVING';

export const CUSTOMER_TRANSITIONS: Readonly<Record<CustomerState, readonly CustomerState[]>> = {
  SPAWNING: ['ENTERING', 'LEAVING'],
  ENTERING: ['QUEUING', 'WALKING_TO_ORDER', 'LEAVING'],
  QUEUING: ['WALKING_TO_ORDER', 'LEAVING'],
  WALKING_TO_ORDER: ['ORDERING', 'LEAVING'],
  ORDERING: ['WAITING', 'LEAVING'],
  WAITING: ['RECEIVING', 'LEAVING'],
  RECEIVING: ['TASTING'],
  TASTING: ['RATING'],
  RATING: ['LEAVING'],
  LEAVING: [],
};

export interface ArchetypeDef {
  label: string;
  weight: number;
  speedTilesPerSec: number;
  orderPatienceMs: number;
  drinkPatienceMs: number;
  preferences: Record<string, number>;
}

export interface CustomerConfig {
  spawn: { firstDelayMs: number; minIntervalMs: number; maxIntervalMs: number; maxConcurrent: number };
  behaviour: {
    retryPathMs: number;
    giveUpBlockedMs: number;
    stuckCheckMs: number;
    maxRepaths: number;
    tastingMs: number;
    ratingMs: number;
    orderingMs: number;
    receivingMs: number;
  };
  archetypes: Record<string, ArchetypeDef>;
}

interface Spot {
  key: string;
  kind: 'seat' | 'stand';
  objectId: string;
  tile: TilePos;
}

export interface Customer {
  readonly id: string;
  readonly archetype: string;
  readonly def: ArchetypeDef;
  readonly actor: Actor;
  readonly fsm: StateMachine<CustomerState>;
  readonly recipeId: string;
  orderId: number | null;
  spot: Spot | null;
  target: TilePos | null;
  needsPlan: boolean;
  queueWaitMs: number;
  drinkWaitMs: number;
  stateMs: number;
  blockedMs: number;
  retryInMs: number;
  stuckMs: number;
  stuckFrom: WorldPos;
  repaths: number;
  leaveReason: string | null;
  satisfaction: number | null;
  gone: boolean;
  /** The drink handed over (from RECEIVING on). */
  drink: Drink | null;
  outcome: ServiceOutcome | null;
}

export interface CustomerView {
  id: string;
  archetype: string;
  state: CustomerState;
  pos: WorldPos;
  tile: TilePos;
  facing: Actor['facing'];
  recipeId: string;
  orderId: number | null;
  orderStatus: Order['status'] | null;
  /** Remaining patience for the current phase, 0–1 (null when not waiting). */
  patience: number | null;
  spot: string | null;
}

export type CafeResult = { ok: true } | { ok: false; reason: string; applicable?: boolean };

const FAILURES = new Set(['impatient', 'timeout', 'queueFull', 'blocked', 'noSeat']);
/** Departures that hurt reputation (a blocked path is a map problem, not service). */
const UNHAPPY = new Set(['impatient', 'timeout', 'queueFull']);

/**
 * Café floor simulation: spawns customers on a schedule, walks them in from
 * the street (never teleports), manages the order queue, seat/standing-spot
 * reservations, patience and departure. Customers are transient (not saved).
 */
export class CafeService {
  private readonly customers = new Map<string, Customer>();
  private readonly queue: string[] = [];
  private readonly reserved = new Map<string, string>(); // spot key → customer id
  private readonly spots: Spot[];
  private nextSpawnAt: number;
  private nextId = 1;
  open = true;

  readonly spawnTile: TilePos;
  readonly exitTile: TilePos;
  readonly doorTile: TilePos;
  readonly orderPoint: TilePos;
  readonly queueTiles: TilePos[];

  constructor(
    private readonly world: WorldModel,
    private readonly nav: NavigationService,
    readonly orders: OrderService,
    readonly config: CustomerConfig,
    private readonly bus: EventBus<GameEvents>,
    private readonly rng: Rng,
    private readonly now: () => number,
    private readonly bodyRadius: number,
    private readonly tx: TransactionService,
    private readonly rate: RatingPolicy = baseRewardPolicy,
    private readonly hooks: CafeHooks = {},
  ) {
    const one = (name: string): TilePos => {
      const m = world.markers(name)[0];
      if (!m) throw new Error(`café map needs a "${name}" marker`);
      return m;
    };
    this.spawnTile = one('spawn');
    this.exitTile = one('exit');
    this.doorTile = one('door');
    this.orderPoint = one('orderPoint');
    this.queueTiles = world.markers('queue');
    const spotsOf = (type: string, kind: Spot['kind']): Spot[] =>
      world
        .allObjects()
        .filter((o) => o.type === type)
        .map((o) => ({ key: `${kind}:${o.id}`, kind, objectId: o.id, tile: { x: o.footprint.x, y: o.footprint.y } }));
    // Seats first, then standing spots.
    this.spots = [...spotsOf('chair', 'seat'), ...spotsOf('standing_spot', 'stand')];
    this.nextSpawnAt = now() + config.spawn.firstDelayMs;
  }

  // ── queries ─────────────────────────────────────────────────────────────

  get count(): number {
    return this.customers.size;
  }

  customer(id: string): Customer | undefined {
    return this.customers.get(id);
  }

  queueOrder(): readonly string[] {
    return this.queue;
  }

  freeSpots(): number {
    return this.spots.length - this.reserved.size;
  }

  /** The customer at the order point waiting for the player to take their order. */
  customerAtCounter(): Customer | undefined {
    const id = this.queue[0];
    const c = id ? this.customers.get(id) : undefined;
    if (!c || !c.fsm.is('ORDERING') || c.orderId === null) return undefined;
    const o = this.orders.get(c.orderId);
    return o?.status === 'CREATED' ? c : undefined;
  }

  views(): CustomerView[] {
    return [...this.customers.values()].map((c) => {
      const order = c.orderId !== null ? this.orders.get(c.orderId) : undefined;
      const s = c.fsm.state;
      const patience = ['QUEUING', 'WALKING_TO_ORDER', 'ORDERING'].includes(s)
        ? 1 - c.queueWaitMs / c.def.orderPatienceMs
        : s === 'WAITING'
          ? 1 - c.drinkWaitMs / c.def.drinkPatienceMs
          : null;
      return {
        id: c.id,
        archetype: c.archetype,
        state: s,
        pos: { ...c.actor.pos },
        tile: c.actor.tile,
        facing: c.actor.facing,
        recipeId: c.recipeId,
        orderId: c.orderId,
        orderStatus: order?.status ?? null,
        patience: patience === null ? null : Math.max(0, Math.min(1, patience)),
        spot: c.spot?.key ?? null,
      };
    });
  }

  // ── player commands ─────────────────────────────────────────────────────

  canTakeOrder(): CafeResult {
    if (!this.customerAtCounter()) return { ok: false, reason: 'noCustomer' };
    if (this.freeSpots() === 0) return { ok: false, reason: 'noSeat' };
    return { ok: true };
  }

  /** Accept the order of the customer at the counter; they go to a reserved seat (or standing spot). */
  takeOrder(): CafeResult {
    const can = this.canTakeOrder();
    if (!can.ok) return can;
    const c = this.customerAtCounter()!;
    const spot = this.spots.find((s) => !this.reserved.has(s.key))!;
    const r = this.orders.transition(c.orderId!, 'ACCEPTED');
    if (!r.ok) return { ok: false, reason: r.reason };
    this.removeFromQueue(c.id);
    this.reserved.set(spot.key, c.id);
    c.spot = spot;
    this.setState(c, 'WAITING');
    this.setTarget(c, spot.tile);
    return { ok: true };
  }

  /** Customer who reserved the seat / standing spot object, if any. */
  customerAtSpot(objectId: string): Customer | undefined {
    const spot = this.spots.find((s) => s.objectId === objectId);
    const id = spot ? this.reserved.get(spot.key) : undefined;
    return id ? this.customers.get(id) : undefined;
  }

  /** Validate handing a drink to whoever sits at this spot. */
  canServe(objectId: string, drink: Drink | undefined): CafeResult {
    if (!drink) return { ok: false, reason: 'noDrink' };
    const c = this.customerAtSpot(objectId);
    if (!c) return { ok: false, reason: 'noCustomerHere' };
    if (c.orderId !== drink.orderId) return { ok: false, reason: 'wrongCustomer' };
    if (!c.fsm.is('WAITING')) return { ok: false, reason: 'notWaiting' };
    if (c.target) return { ok: false, reason: 'notSeatedYet' };
    if (this.orders.get(drink.orderId)?.status !== 'READY') return { ok: false, reason: 'orderNotReady' };
    return { ok: true };
  }

  /** The customer takes the drink: order SERVED, then they taste, rate and pay. */
  receive(objectId: string, drink: Drink): CafeResult {
    const can = this.canServe(objectId, drink);
    if (!can.ok) return can;
    const c = this.customerAtSpot(objectId)!;
    const r = this.orders.transition(drink.orderId, 'SERVED');
    if (!r.ok) return { ok: false, reason: r.reason };
    c.drink = drink;
    this.setState(c, 'RECEIVING');
    return { ok: true };
  }

  /** Pay exactly once (idempotency key) and complete the order. */
  private settle(c: Customer): void {
    const order = c.orderId !== null ? this.orders.get(c.orderId) : undefined;
    if (!order || !c.drink || order.status !== 'SERVED') return;
    const outcome = this.rate(order, c.drink, c);
    const paid = this.tx.execute({ reason: `order:${order.id}:${order.recipeId}`, coins: outcome.coins, exp: outcome.exp, key: `order:${order.id}:paid` });
    c.outcome = outcome;
    this.orders.transition(order.id, 'COMPLETED');
    if (paid.ok) this.bus.emit('cafe:paid', { orderId: order.id, coins: outcome.coins, exp: outcome.exp });
  }

  // ── simulation ──────────────────────────────────────────────────────────

  tick(dtMs: number): void {
    const t = this.now();
    if (this.open && t >= this.nextSpawnAt) {
      if (this.customers.size < this.config.spawn.maxConcurrent) this.spawn();
      const s = this.config.spawn;
      this.nextSpawnAt = t + this.rng.range(s.minIntervalMs, s.maxIntervalMs) / Math.max(0.1, this.hooks.trafficFactor?.() ?? 1);
    }
    for (const c of [...this.customers.values()]) this.update(c, dtMs);
    for (const [id, c] of this.customers) if (c.gone) this.customers.delete(id);
  }

  /** Spawn now (also used by tests and the debug bridge). `recipeId` forces the order (tests/debug). */
  spawn(archetype?: string, recipeId?: string): Customer {
    const archetypes = this.config.archetypes;
    const key = archetype && archetypes[archetype] ? archetype : this.rng.weighted(Object.fromEntries(Object.entries(archetypes).map(([k, a]) => [k, a.weight])));
    const def = archetypes[key]!;
    const unlocked = (rid: string) => !!this.orders.recipes[rid] && (this.hooks.isRecipeUnlocked?.(rid) ?? true);
    let recipes = Object.fromEntries(Object.entries(def.preferences).filter(([rid]) => unlocked(rid)));
    // Nothing they like is on the menu yet: they order something that is.
    if (Object.keys(recipes).length === 0) recipes = Object.fromEntries(Object.keys(this.orders.recipes).filter(unlocked).map((rid) => [rid, 1]));
    const chosen = recipeId && this.orders.recipes[recipeId] ? recipeId : this.rng.weighted(recipes);
    const id = `c${this.nextId++}`;
    const now = this.now;
    const actor = new Actor(id, tileCenter(this.spawnTile), { speedTilesPerSec: def.speedTilesPerSec, bodyRadius: this.bodyRadius }, now);
    const c: Customer = {
      id,
      archetype: key,
      def,
      actor,
      fsm: new StateMachine<CustomerState>(`customer:${id}`, 'SPAWNING', CUSTOMER_TRANSITIONS, now),
      recipeId: chosen,
      orderId: null,
      spot: null,
      target: null,
      needsPlan: false,
      queueWaitMs: 0,
      drinkWaitMs: 0,
      stateMs: 0,
      blockedMs: 0,
      retryInMs: 0,
      stuckMs: 0,
      stuckFrom: { ...actor.pos },
      repaths: 0,
      leaveReason: null,
      satisfaction: null,
      gone: false,
      drink: null,
      outcome: null,
    };
    c.fsm.onTransition((from, to) => this.bus.emit('customer:stateChanged', { customerId: id, from, to }));
    this.customers.set(id, c);
    this.bus.emit('customer:spawned', { customerId: id, archetype: key });
    return c;
  }

  private update(c: Customer, dt: number): void {
    c.stateMs += dt;
    const s = c.fsm.state;
    if (s === 'QUEUING' || s === 'WALKING_TO_ORDER' || s === 'ORDERING') {
      c.queueWaitMs += dt;
      if (c.queueWaitMs > c.def.orderPatienceMs) return this.leave(c, 'impatient');
    } else if (s === 'WAITING') {
      c.drinkWaitMs += dt;
      if (c.drinkWaitMs > c.def.drinkPatienceMs) return this.leave(c, 'timeout');
    }

    const move = this.move(c, dt);
    if (move === 'blocked') return this.onBlocked(c);

    switch (c.fsm.state) {
      case 'SPAWNING':
        this.setState(c, 'ENTERING');
        this.setTarget(c, this.doorTile);
        break;
      case 'ENTERING':
        if (move === 'arrived') this.joinQueue(c);
        break;
      case 'QUEUING': {
        const idx = this.queue.indexOf(c.id);
        if (idx === 0) {
          this.setState(c, 'WALKING_TO_ORDER');
          this.setTarget(c, this.orderPoint);
        } else {
          const want = this.queueTiles[idx - 1]!;
          if (!c.target && !sameTile(c.actor.tile, want)) this.setTarget(c, want);
          else if (c.target && !sameTile(c.target, want)) this.setTarget(c, want);
        }
        break;
      }
      case 'WALKING_TO_ORDER':
        if (move === 'arrived') {
          this.setState(c, 'ORDERING');
          const r = this.orders.create(c.id, c.recipeId, c.def.drinkPatienceMs);
          if (r.ok) c.orderId = r.order.id;
          c.actor.faceTowards({ x: this.orderPoint.x + 0.5, y: this.orderPoint.y - 0.5 });
        }
        break;
      case 'RECEIVING':
        if (c.stateMs >= this.config.behaviour.receivingMs) this.setState(c, 'TASTING');
        break;
      case 'TASTING':
        if (c.stateMs >= this.config.behaviour.tastingMs) this.setState(c, 'RATING');
        break;
      case 'RATING':
        if (c.stateMs >= this.config.behaviour.ratingMs) {
          this.settle(c);
          this.leave(c, 'served');
        }
        break;
      case 'LEAVING':
        if (move === 'arrived' || (!c.target && sameTile(c.actor.tile, this.exitTile))) c.gone = true;
        break;
      default:
        break;
    }
  }

  private joinQueue(c: Customer): void {
    if (this.queue.length >= 1 + this.queueTiles.length) return this.leave(c, 'queueFull');
    this.queue.push(c.id);
    if (this.queue.length === 1) {
      this.setState(c, 'WALKING_TO_ORDER');
      this.setTarget(c, this.orderPoint);
    } else {
      this.setState(c, 'QUEUING');
      this.setTarget(c, this.queueTiles[this.queue.length - 2]!);
    }
  }

  private removeFromQueue(id: string): void {
    const i = this.queue.indexOf(id);
    if (i >= 0) this.queue.splice(i, 1);
  }

  private leave(c: Customer, reason: string): void {
    if (c.fsm.is('LEAVING')) return;
    if (c.orderId !== null) {
      const o = this.orders.get(c.orderId);
      if (o && o.status === 'CREATED') this.orders.transition(o.id, 'CANCELLED', reason);
      else if (o && ['ACCEPTED', 'PREPARING', 'READY'].includes(o.status)) this.orders.transition(o.id, 'FAILED', reason);
    }
    this.removeFromQueue(c.id);
    if (c.spot) {
      this.reserved.delete(c.spot.key);
      c.spot = null;
    }
    c.leaveReason = reason;
    c.satisfaction = this.satisfaction(c, reason);
    if (UNHAPPY.has(reason)) this.hooks.onCustomerFailed?.(reason);
    this.setState(c, 'LEAVING');
    this.setTarget(c, this.exitTile);
    this.bus.emit('customer:left', { customerId: c.id, reason, satisfaction: c.satisfaction });
  }

  /** Placeholder until M6 ratings: 100 minus waiting penalties; failures score low. */
  private satisfaction(c: Customer, reason: string): number {
    if (FAILURES.has(reason)) return 10;
    const q = Math.min(1, c.queueWaitMs / c.def.orderPatienceMs);
    const d = Math.min(1, c.drinkWaitMs / c.def.drinkPatienceMs);
    return Math.round(Math.max(0, 100 - 40 * q - 40 * d));
  }

  private onBlocked(c: Customer): void {
    if (!c.fsm.is('LEAVING')) return this.leave(c, 'blocked');
    // Can't even reach the exit: remove rather than leave an NPC stuck forever.
    c.gone = true;
    this.bus.emit('customer:removed', { customerId: c.id, reason: 'stuck' });
  }

  private setState(c: Customer, s: CustomerState): void {
    c.fsm.transition(s);
    c.stateMs = 0;
  }

  private setTarget(c: Customer, tile: TilePos): void {
    c.target = { ...tile };
    c.needsPlan = true;
    c.retryInMs = 0;
    c.blockedMs = 0;
    c.repaths = 0;
    c.stuckMs = 0;
    c.stuckFrom = { ...c.actor.pos };
  }

  /** Walk towards c.target. Never moves faster than the customer's speed (no teleporting). */
  private move(c: Customer, dt: number): 'idle' | 'moving' | 'arrived' | 'blocked' {
    if (!c.target) return 'idle';
    const b = this.config.behaviour;
    if (c.needsPlan) {
      c.retryInMs -= dt;
      if (c.retryInMs > 0) {
        c.blockedMs += dt;
        return c.blockedMs > b.giveUpBlockedMs ? 'blocked' : 'moving';
      }
      const plan = this.nav.planTo(c.actor.pos, [c.target]);
      if (!plan) {
        c.blockedMs += dt;
        c.retryInMs = b.retryPathMs;
        return c.blockedMs > b.giveUpBlockedMs ? 'blocked' : 'moving';
      }
      c.actor.setWaypoints(plan.waypoints);
      c.needsPlan = false;
      c.blockedMs = 0;
    }
    const arrived = c.actor.stepMovement(dt);
    if (arrived) {
      c.target = null;
      return 'arrived';
    }
    c.stuckMs += dt;
    if (c.stuckMs >= b.stuckCheckMs) {
      const moved = Math.hypot(c.actor.pos.x - c.stuckFrom.x, c.actor.pos.y - c.stuckFrom.y);
      c.stuckMs = 0;
      c.stuckFrom = { ...c.actor.pos };
      if (moved < 0.05) {
        c.repaths++;
        if (c.repaths > b.maxRepaths) return 'blocked';
        c.needsPlan = true;
      }
    }
    return 'moving';
  }
}
