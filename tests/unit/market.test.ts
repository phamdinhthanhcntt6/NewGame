import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../src/data/content';
import type { GameSimulation } from '../../src/gameplay/GameSimulation';
import { MemoryStorage, SaveService } from '../../src/gameplay/state/SaveService';
import { farmSim, runUntil } from './helpers';

function use(sim: GameSimulation, id: string): void {
  sim.clickObject(id);
  runUntil(sim, () => {
    const s = sim.playerInteraction.snapshot();
    return !s.current && s.queue.length === 0 && !s.moveTarget && ['IDLE', 'CARRYING'].includes(sim.player.state);
  });
}

function give(sim: GameSimulation, itemId: string, qty: number, quality = 50): void {
  const r = sim.tx.execute({ reason: 'test:give', items: [{ itemId, qty, quality }] });
  if (!r.ok) throw new Error(r.error);
}

function atMarket(): { sim: GameSimulation; clock: ReturnType<typeof farmSim>['clock'] } {
  const r = farmSim();
  use(r.sim, 'market');
  if (r.sim.shops.current !== 'market') throw new Error('market did not open');
  return r;
}

describe('market', () => {
  it('selling requires standing at the market', () => {
    const { sim } = farmSim();
    give(sim, 'cherry_robusta', 10);
    expect(sim.market.sell('cherry_robusta', 1)).toMatchObject({ ok: false, reason: 'marketClosed' });
    expect(sim.tx.count('cherry_robusta')).toBe(10);
  });

  it('a sale pays exactly the quote and removes exactly the quantity', () => {
    const { sim } = atMarket();
    give(sim, 'roasted_arabica', 6, 72);
    const q = sim.market.quote('roasted_arabica', 4);
    if (!q.ok) throw new Error(q.reason);
    const before = sim.tx.coins;
    expect(sim.market.sell('roasted_arabica', 4)).toEqual({ ok: true, coins: q.total });
    expect(sim.tx.coins).toBe(before + q.total);
    expect(sim.tx.count('roasted_arabica')).toBe(2);
    expect(sim.state.economy.history.at(-1)).toMatchObject({ reason: 'sell:roasted_arabica', coins: q.total, items: [{ itemId: 'roasted_arabica', qty: -4 }] });
  });

  it('validates: no overselling, no zero/fractional quantity, unsellable items rejected', () => {
    const { sim } = atMarket();
    give(sim, 'cherry_robusta', 3);
    const coins = sim.tx.coins;
    expect(sim.market.sell('cherry_robusta', 4)).toMatchObject({ ok: false, reason: 'insufficientItems' });
    expect(sim.market.sell('cherry_robusta', 0)).toMatchObject({ ok: false, reason: 'invalidQuantity' });
    expect(sim.market.sell('cherry_robusta', 1.5)).toMatchObject({ ok: false, reason: 'invalidQuantity' });
    expect(sim.market.sell('seed_robusta', 1)).toMatchObject({ ok: false, reason: 'notSellable' });
    expect(sim.tx.coins).toBe(coins);
    expect(sim.tx.count('cherry_robusta')).toBe(3);
  });

  it('price follows quality: base × (0.5 + 0.01 × quality)', () => {
    const { sim } = atMarket();
    give(sim, 'green_culi', 1, 50);
    expect(sim.market.quote('green_culi', 1)).toMatchObject({ unitNow: 28, total: 28 });
    sim.market.sell('green_culi', 1);
    sim.state.market.saturation = {};
    give(sim, 'green_culi', 1, 90);
    expect(sim.market.quote('green_culi', 1)).toMatchObject({ unitNow: 39.2, total: 39 });
  });

  it('dumping lowers the price (saturation), which recovers over time', () => {
    const { sim, clock } = atMarket();
    give(sim, 'cherry_robusta', 60);
    const fresh = (sim.market.quote('cherry_robusta', 1) as { unitNow: number }).unitNow;
    sim.market.sell('cherry_robusta', 30);
    const after = (sim.market.quote('cherry_robusta', 1) as { unitNow: number }).unitNow;
    expect(after).toBeLessThan(fresh);
    expect(after).toBeCloseTo(fresh * 0.7, 6);
    clock.advance(6 * 60_000); // recovers 0.05 per minute
    expect((sim.market.quote('cherry_robusta', 1) as { unitNow: number }).unitNow).toBeCloseTo(fresh, 6);
  });

  it('a multi-unit quote prices each unit at its own saturation (selling 30 at once = 30 one by one)', () => {
    const a = atMarket().sim;
    const b = atMarket().sim;
    give(a, 'cherry_robusta', 30);
    give(b, 'cherry_robusta', 30);
    const bulk = a.market.sell('cherry_robusta', 30);
    let single = 0;
    for (let i = 0; i < 30; i++) {
      const r = b.market.sell('cherry_robusta', 1);
      if (r.ok) single += r.coins;
    }
    expect(bulk.ok && bulk.coins).toBeGreaterThan(0);
    // Floor rounding per sale can only make the one-by-one route cheaper, never richer.
    expect(single).toBeLessThanOrEqual((bulk as { coins: number }).coins);
    expect((bulk as { coins: number }).coins - single).toBeLessThanOrEqual(30);
  });

  it('saturation persists through save/load', () => {
    const { sim, clock } = atMarket();
    give(sim, 'cherry_robusta', 40);
    sim.market.sell('cherry_robusta', 40);
    const storage = new MemoryStorage();
    const saves = new SaveService(storage);
    saves.save(sim.captureState(), clock.now());
    const loaded = saves.load(clock.now());
    if (loaded.status !== 'ok') throw new Error(loaded.status);
    const resumed = farmSim({ state: loaded.state, clock }).sim;
    expect(resumed.market.saturation('cherry_robusta')).toBeCloseTo(0.4, 6);
  });

  it('recent sales come from the central history, newest first', () => {
    const { sim } = atMarket();
    give(sim, 'cherry_robusta', 5);
    give(sim, 'cherry_arabica', 5);
    sim.market.sell('cherry_robusta', 2);
    sim.market.sell('cherry_arabica', 3);
    expect(sim.market.recentSales().map((h) => h.reason)).toEqual(['sell:cherry_arabica', 'sell:cherry_robusta']);
  });

  it('walking away closes the market', () => {
    const { sim } = atMarket();
    sim.clickTile({ x: 14, y: 11 });
    runUntil(sim, () => sim.player.state === 'IDLE');
    expect(sim.shops.current).toBeNull();
  });
});

describe('economy design invariant (data)', () => {
  it('for every variety, each processing step increases total sale value of one harvest', () => {
    const m = CONTENT.market;
    for (const [v, seed] of Object.entries(CONTENT.seeds)) {
      const dry = CONTENT.processing.recipes[`dry_${v}`]!;
      const roast = CONTENT.processing.recipes[`roast_${v}`]!;
      const cherries = seed.yield;
      const rawValue = cherries * seed.sellPrice;
      const green = (cherries / dry.input.qty) * dry.output.qty;
      const greenValue = green * m.basePrices[dry.output.itemId]!;
      const roastedValue = (green / roast.input.qty) * roast.output.qty * m.basePrices[roast.output.itemId]!;
      expect(greenValue, `${v} green`).toBeGreaterThan(rawValue);
      expect(roastedValue, `${v} roasted`).toBeGreaterThan(greenValue);
      expect(rawValue, `${v} raw sale covers the seed`).toBeGreaterThanOrEqual(seed.purchaseCost * 0.8);
    }
  });
});
