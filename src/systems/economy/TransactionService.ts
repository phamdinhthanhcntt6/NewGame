import type { Clock } from '../../core/Clock';
import type { EventBus } from '../../core/EventBus';
import type { GameEvents } from '../../core/events';
import type { GameState, ItemStack, TxItemDelta, TxRecord } from '../../gameplay/state/GameState';

export interface ItemDef {
  label: string;
  category: string;
}

export type ItemTable = Record<string, ItemDef>;

export interface TransactionRequest {
  /** Human/debug reason, e.g. "buySeeds:robusta". */
  reason: string;
  coins?: number;
  exp?: number;
  items?: TxItemDelta[];
  /**
   * Idempotency key for one-off effects (harvest reward, land purchase).
   * A key that already succeeded is rejected as `duplicate`.
   */
  key?: string;
}

export type TransactionError = 'invalid' | 'unknownItem' | 'insufficientCoins' | 'insufficientItems' | 'capacityExceeded' | 'duplicate';

export type TransactionResult = { ok: true; record: TxRecord } | { ok: false; error: TransactionError; detail?: string };

export interface EconomyLimits {
  inventoryCapacity: number;
  historyLimit: number;
  processedKeyLimit: number;
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/**
 * The single gateway for coins, items and EXP. Every change is validated as
 * a whole before anything is applied (all-or-nothing), recorded in history
 * and announced on the bus. Nothing else may write `state.economy` or
 * `state.progression.exp`.
 */
export class TransactionService {
  private readonly processed: Set<string>;

  constructor(
    private readonly state: GameState,
    private readonly items: ItemTable,
    private readonly limits: EconomyLimits,
    private readonly bus: EventBus<GameEvents>,
    private readonly clock: Clock,
  ) {
    this.processed = new Set(state.economy.processedKeys);
  }

  get coins(): number {
    return this.state.economy.coins;
  }

  get exp(): number {
    return this.state.progression.exp;
  }

  count(itemId: string): number {
    return this.state.economy.inventory[itemId]?.qty ?? 0;
  }

  stack(itemId: string): ItemStack | undefined {
    const s = this.state.economy.inventory[itemId];
    return s ? { ...s } : undefined;
  }

  totalItems(): number {
    let n = 0;
    for (const s of Object.values(this.state.economy.inventory)) n += s.qty;
    return n;
  }

  hasProcessed(key: string): boolean {
    return this.processed.has(key);
  }

  /** Validate without applying. */
  check(req: TransactionRequest): { ok: true } | { ok: false; error: TransactionError; detail?: string } {
    const coins = req.coins ?? 0;
    const exp = req.exp ?? 0;
    if (!isInt(coins) || !isInt(exp) || exp < 0) return { ok: false, error: 'invalid', detail: 'coins/exp must be integers, exp ≥ 0' };
    if (req.key !== undefined && this.processed.has(req.key)) return { ok: false, error: 'duplicate', detail: req.key };
    if (this.state.economy.coins + coins < 0) return { ok: false, error: 'insufficientCoins' };

    // Net change per item (a request may mention the same item twice).
    const net = new Map<string, number>();
    for (const d of req.items ?? []) {
      if (!isInt(d.qty) || d.qty === 0) return { ok: false, error: 'invalid', detail: `qty for ${d.itemId}` };
      if (!this.items[d.itemId]) return { ok: false, error: 'unknownItem', detail: d.itemId };
      if (d.quality !== undefined && !(d.quality >= 0 && d.quality <= 100)) return { ok: false, error: 'invalid', detail: `quality for ${d.itemId}` };
      net.set(d.itemId, (net.get(d.itemId) ?? 0) + d.qty);
    }
    let added = 0;
    for (const [itemId, delta] of net) {
      if (this.count(itemId) + delta < 0) return { ok: false, error: 'insufficientItems', detail: itemId };
      added += delta;
    }
    if (added > 0 && this.totalItems() + added > this.limits.inventoryCapacity) return { ok: false, error: 'capacityExceeded' };
    return { ok: true };
  }

  execute(req: TransactionRequest): TransactionResult {
    const v = this.check(req);
    if (!v.ok) return v;
    const eco = this.state.economy;
    eco.coins += req.coins ?? 0;
    this.state.progression.exp += req.exp ?? 0;
    for (const d of req.items ?? []) this.applyItem(d);
    const record: TxRecord = {
      id: eco.nextTxId++,
      at: this.clock.now(),
      reason: req.reason,
      coins: req.coins ?? 0,
      exp: req.exp ?? 0,
      items: (req.items ?? []).map((d) => ({ ...d })),
      ...(req.key !== undefined ? { key: req.key } : {}),
    };
    eco.history.push(record);
    if (eco.history.length > this.limits.historyLimit) eco.history.splice(0, eco.history.length - this.limits.historyLimit);
    if (req.key !== undefined) {
      this.processed.add(req.key);
      eco.processedKeys.push(req.key);
      if (eco.processedKeys.length > this.limits.processedKeyLimit) {
        const dropped = eco.processedKeys.splice(0, eco.processedKeys.length - this.limits.processedKeyLimit);
        for (const k of dropped) this.processed.delete(k);
      }
    }
    this.bus.emit('economy:transaction', record);
    return { ok: true, record };
  }

  private applyItem(d: TxItemDelta): void {
    const inv = this.state.economy.inventory;
    const cur = inv[d.itemId] ?? { qty: 0, quality: 0 };
    if (d.qty > 0) {
      const q = d.quality ?? 50;
      const total = cur.qty + d.qty;
      cur.quality = Math.round(((cur.qty * cur.quality + d.qty * q) / total) * 100) / 100;
      cur.qty = total;
    } else {
      cur.qty += d.qty;
    }
    if (cur.qty === 0) delete inv[d.itemId];
    else inv[d.itemId] = cur;
  }
}
