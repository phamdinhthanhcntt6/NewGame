import type { EventBus } from '../../core/EventBus';
import type { GameEvents } from '../../core/events';

export type OrderStatus = 'CREATED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'SERVED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/** An ingredient by exact item, by item category (e.g. any roasted bean), or a free utility (tap water). */
export interface IngredientSpec {
  itemId?: string;
  category?: string;
  utility?: string;
  qty: number;
}

export interface RecipeDef {
  label: string;
  ingredients: IngredientSpec[];
  basePrice: number;
  expReward: number;
  expectedQuality: number;
  preferredBean: string;
}

export type RecipeTable = Record<string, RecipeDef>;

export interface Order {
  id: number;
  customerId: string;
  recipeId: string;
  ingredients: IngredientSpec[];
  /** Simulation time (ms) when created. */
  createdAt: number;
  /** How long the customer will wait for the drink once the order is accepted. */
  timeLimitMs: number;
  expectedQuality: number;
  reward: { coins: number; exp: number };
  status: OrderStatus;
  history: Array<{ status: OrderStatus; at: number; reason?: string }>;
}

export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  CREATED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'FAILED', 'CANCELLED'],
  // PREPARING → ACCEPTED: the barista abandoned the drink; the order waits to be brewed again.
  PREPARING: ['READY', 'ACCEPTED', 'FAILED', 'CANCELLED'],
  READY: ['SERVED', 'FAILED', 'CANCELLED'],
  SERVED: ['COMPLETED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export const isTerminal = (s: OrderStatus): boolean => ORDER_TRANSITIONS[s].length === 0;

export type OrderResult = { ok: true; order: Order } | { ok: false; reason: 'unknownOrder' | 'unknownRecipe' | 'illegalTransition' };

/**
 * Order lifecycle with an explicit transition table. Every transition is
 * validated; illegal ones are refused (not thrown) so game rules can react.
 * Orders are transient café state: they live while their customer is present.
 */
export class OrderService {
  private readonly active = new Map<number, Order>();
  private readonly archive: Order[] = [];
  private nextId = 1;

  constructor(
    readonly recipes: RecipeTable,
    private readonly bus: EventBus<GameEvents>,
    private readonly now: () => number,
    private readonly archiveLimit = 30,
  ) {}

  create(customerId: string, recipeId: string, timeLimitMs: number): OrderResult {
    const r = this.recipes[recipeId];
    if (!r) return { ok: false, reason: 'unknownRecipe' };
    const at = this.now();
    const order: Order = {
      id: this.nextId++,
      customerId,
      recipeId,
      ingredients: r.ingredients.map((i) => ({ ...i })),
      createdAt: at,
      timeLimitMs,
      expectedQuality: r.expectedQuality,
      reward: { coins: r.basePrice, exp: r.expReward },
      status: 'CREATED',
      history: [{ status: 'CREATED', at }],
    };
    this.active.set(order.id, order);
    this.bus.emit('order:changed', { orderId: order.id, customerId, recipeId, from: null, to: 'CREATED' });
    return { ok: true, order };
  }

  get(id: number): Order | undefined {
    return this.active.get(id) ?? this.archive.find((o) => o.id === id);
  }

  canTransition(id: number, to: OrderStatus): boolean {
    const o = this.active.get(id);
    return !!o && ORDER_TRANSITIONS[o.status].includes(to);
  }

  transition(id: number, to: OrderStatus, reason?: string): OrderResult {
    const o = this.active.get(id);
    if (!o) return { ok: false, reason: this.get(id) ? 'illegalTransition' : 'unknownOrder' };
    if (!ORDER_TRANSITIONS[o.status].includes(to)) return { ok: false, reason: 'illegalTransition' };
    const from = o.status;
    o.status = to;
    o.history.push({ status: to, at: this.now(), ...(reason ? { reason } : {}) });
    if (isTerminal(to)) {
      this.active.delete(id);
      this.archive.push(o);
      if (this.archive.length > this.archiveLimit) this.archive.shift();
    }
    this.bus.emit('order:changed', { orderId: id, customerId: o.customerId, recipeId: o.recipeId, from, to, ...(reason ? { reason } : {}) });
    return { ok: true, order: o };
  }

  activeOrders(): Order[] {
    return [...this.active.values()];
  }

  recent(): Order[] {
    return [...this.archive].reverse();
  }
}
