import type { Clock } from '../../core/Clock';
import type { EventBus } from '../../core/EventBus';
import type { GameEvents } from '../../core/events';
import type { TransactionService } from '../../systems/economy/TransactionService';
import type { ShopSessionService } from '../../systems/shop/ShopSessionService';
import type { SeedTable } from '../farm/plotModel';
import type { GameState, TxRecord } from '../state/GameState';

export interface MarketConfig {
  /** Base price per unit at quality 50 and no saturation. Cherry prices come from seeds.json (sellPrice). */
  basePrices: Record<string, number>;
  quality: { atZero: number; perPoint: number };
  demand: { saturationPerUnit: number; minFactor: number; recoveryPerMinute: number };
  historyShown: number;
}

export type Quote = { ok: true; itemId: string; qty: number; total: number; unitNow: number; quality: number } | { ok: false; reason: string };

export type MarketResult = { ok: true; coins: number } | { ok: false; reason: string };

/**
 * Sells inventory for coins at a dynamic price:
 *   unit = base × (atZero + perPoint × quality) × max(minFactor, 1 − saturation)
 * Every unit sold adds saturation (so dumping lowers the price); saturation
 * recovers over wall-clock time. The quote is exactly what a sale pays.
 */
export class MarketService {
  private readonly prices: Record<string, number>;

  constructor(
    private readonly state: GameState,
    readonly config: MarketConfig,
    seeds: SeedTable,
    private readonly tx: TransactionService,
    private readonly shops: ShopSessionService,
    private readonly bus: EventBus<GameEvents>,
    private readonly clock: Clock,
  ) {
    const fromSeeds = Object.fromEntries(Object.values(seeds).map((s) => [s.productItem, s.sellPrice]));
    this.prices = { ...fromSeeds, ...config.basePrices };
  }

  isSellable(itemId: string): boolean {
    return this.prices[itemId] !== undefined;
  }

  basePrice(itemId: string): number | undefined {
    return this.prices[itemId];
  }

  /** Current saturation after time-based recovery. */
  saturation(itemId: string): number {
    const s = this.state.market.saturation[itemId];
    if (!s) return 0;
    const minutes = Math.max(0, this.clock.now() - s.at) / 60_000;
    return Math.max(0, s.value - minutes * this.config.demand.recoveryPerMinute);
  }

  quote(itemId: string, qty: number): Quote {
    const base = this.prices[itemId];
    if (base === undefined) return { ok: false, reason: 'notSellable' };
    if (!Number.isInteger(qty) || qty <= 0) return { ok: false, reason: 'invalidQuantity' };
    const stack = this.tx.stack(itemId);
    if (!stack || stack.qty < qty) return { ok: false, reason: 'insufficientItems' };
    const { quality: qc, demand } = this.config;
    const qf = qc.atZero + qc.perPoint * stack.quality;
    const sat = this.saturation(itemId);
    let total = 0;
    for (let i = 0; i < qty; i++) total += base * qf * Math.max(demand.minFactor, 1 - (sat + i * demand.saturationPerUnit));
    const unitNow = base * qf * Math.max(demand.minFactor, 1 - sat);
    return { ok: true, itemId, qty, total: Math.floor(total), unitNow: Math.round(unitNow * 100) / 100, quality: stack.quality };
  }

  sell(itemId: string, qty: number): MarketResult {
    if (!this.shops.isOpen('market')) return { ok: false, reason: 'marketClosed' };
    const q = this.quote(itemId, qty);
    if (!q.ok) return q;
    const res = this.tx.execute({ reason: `sell:${itemId}`, coins: q.total, items: [{ itemId, qty: -qty }] });
    if (!res.ok) return { ok: false, reason: res.error };
    this.state.market.saturation[itemId] = { value: this.saturation(itemId) + qty * this.config.demand.saturationPerUnit, at: this.clock.now() };
    this.bus.emit('market:sold', { itemId, qty, coins: q.total });
    return { ok: true, coins: q.total };
  }

  /** Recent sales, newest first (from the central transaction history). */
  recentSales(): TxRecord[] {
    return this.state.economy.history
      .filter((h) => h.reason.startsWith('sell:'))
      .slice(-this.config.historyShown)
      .reverse();
  }
}
