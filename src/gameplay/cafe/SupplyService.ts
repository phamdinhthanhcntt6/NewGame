import type { TransactionService } from '../../systems/economy/TransactionService';
import type { ShopSessionService } from '../../systems/shop/ShopSessionService';

export type SupplyResult = { ok: true } | { ok: false; reason: string };

/** Café supplier shelf: buy non-farm ingredients (milk, condensed milk) while standing at it. */
export class SupplyService {
  constructor(
    readonly prices: Record<string, number>,
    private readonly tx: TransactionService,
    private readonly shops: ShopSessionService,
  ) {}

  buy(itemId: string, qty: number): SupplyResult {
    if (!this.shops.isOpen('supplies')) return { ok: false, reason: 'suppliesClosed' };
    const price = this.prices[itemId];
    if (price === undefined) return { ok: false, reason: 'notSupplied' };
    if (!Number.isInteger(qty) || qty <= 0) return { ok: false, reason: 'invalidQuantity' };
    const r = this.tx.execute({ reason: `supply:${itemId}`, coins: -price * qty, items: [{ itemId, qty, quality: 70 }] });
    return r.ok ? { ok: true } : { ok: false, reason: r.error };
  }
}
