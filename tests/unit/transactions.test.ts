import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/core/Clock';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { CONTENT } from '../../src/data/content';
import { createNewGameState, type GameState } from '../../src/gameplay/state/GameState';
import { TransactionService } from '../../src/systems/economy/TransactionService';

function make(coins = 100, items: Record<string, number> = {}, capacity = 50): { tx: TransactionService; state: GameState; bus: EventBus<GameEvents> } {
  const state = createNewGameState({ now: 0, startingCoins: coins, startingItems: items, wateringCanCapacity: 4, map: 'farm' });
  const bus = new EventBus<GameEvents>();
  const tx = new TransactionService(state, CONTENT.items, { inventoryCapacity: capacity, historyLimit: 5, processedKeyLimit: 1000 }, bus, new FakeClock());
  return { tx, state, bus };
}

describe('TransactionService validation', () => {
  it('never allows a negative balance', () => {
    const { tx, state } = make(50);
    expect(tx.execute({ reason: 'buy', coins: -51 })).toMatchObject({ ok: false, error: 'insufficientCoins' });
    expect(state.economy.coins).toBe(50);
    expect(tx.execute({ reason: 'buy', coins: -50 }).ok).toBe(true);
    expect(state.economy.coins).toBe(0);
  });

  it('never removes more items than owned', () => {
    const { tx } = make(0, { cherry_robusta: 3 });
    expect(tx.execute({ reason: 'sell', items: [{ itemId: 'cherry_robusta', qty: -4 }] })).toMatchObject({ ok: false, error: 'insufficientItems' });
    expect(tx.count('cherry_robusta')).toBe(3);
  });

  it('is all-or-nothing across several deltas', () => {
    const { tx, state } = make(100, { seed_robusta: 1 });
    const r = tx.execute({ reason: 'x', coins: -10, items: [{ itemId: 'seed_arabica', qty: 2 }, { itemId: 'seed_robusta', qty: -5 }] });
    expect(r.ok).toBe(false);
    expect(state.economy.coins).toBe(100);
    expect(tx.count('seed_arabica')).toBe(0);
    expect(tx.count('seed_robusta')).toBe(1);
  });

  it('nets repeated mentions of the same item before checking', () => {
    const { tx } = make(0, { seed_robusta: 1 });
    expect(tx.execute({ reason: 'x', items: [{ itemId: 'seed_robusta', qty: -1 }, { itemId: 'seed_robusta', qty: -1 }] }).ok).toBe(false);
  });

  it('rejects unknown items, fractional or zero quantities, and negative EXP', () => {
    const { tx } = make();
    expect(tx.execute({ reason: 'x', items: [{ itemId: 'gold_bar', qty: 1 }] })).toMatchObject({ error: 'unknownItem' });
    expect(tx.execute({ reason: 'x', items: [{ itemId: 'seed_robusta', qty: 1.5 }] })).toMatchObject({ error: 'invalid' });
    expect(tx.execute({ reason: 'x', items: [{ itemId: 'seed_robusta', qty: 0 }] })).toMatchObject({ error: 'invalid' });
    expect(tx.execute({ reason: 'x', coins: 0.5 })).toMatchObject({ error: 'invalid' });
    expect(tx.execute({ reason: 'x', exp: -1 })).toMatchObject({ error: 'invalid' });
  });

  it('enforces inventory capacity on net additions only', () => {
    const { tx } = make(0, { cherry_robusta: 45 }, 50);
    expect(tx.execute({ reason: 'x', items: [{ itemId: 'cherry_arabica', qty: 6 }] })).toMatchObject({ error: 'capacityExceeded' });
    expect(tx.execute({ reason: 'x', items: [{ itemId: 'cherry_arabica', qty: 5 }] }).ok).toBe(true);
    // removing is always allowed even when full
    expect(tx.execute({ reason: 'x', items: [{ itemId: 'cherry_robusta', qty: -1 }] }).ok).toBe(true);
  });

  it('idempotency key: a reward can only be paid once, also after rebuilding the service from saved state', () => {
    const { tx, state, bus } = make(0);
    expect(tx.execute({ reason: 'harvest', exp: 8, items: [{ itemId: 'cherry_robusta', qty: 10, quality: 55 }], key: 'harvest:p1:1' }).ok).toBe(true);
    expect(tx.execute({ reason: 'harvest', exp: 8, items: [{ itemId: 'cherry_robusta', qty: 10, quality: 55 }], key: 'harvest:p1:1' })).toMatchObject({ error: 'duplicate' });
    const restored = new TransactionService(JSON.parse(JSON.stringify(state)), CONTENT.items, { inventoryCapacity: 50, historyLimit: 5, processedKeyLimit: 1000 }, bus, new FakeClock());
    expect(restored.execute({ reason: 'harvest', items: [{ itemId: 'cherry_robusta', qty: 10 }], key: 'harvest:p1:1' })).toMatchObject({ error: 'duplicate' });
    expect(tx.count('cherry_robusta')).toBe(10);
    expect(state.progression.exp).toBe(8);
  });

  it('averages quality when stacks merge and records bounded history + events', () => {
    const { tx, state, bus } = make(0);
    const seen: number[] = [];
    bus.on('economy:transaction', (r) => seen.push(r.id));
    tx.execute({ reason: 'a', items: [{ itemId: 'cherry_robusta', qty: 10, quality: 50 }] });
    tx.execute({ reason: 'b', items: [{ itemId: 'cherry_robusta', qty: 10, quality: 70 }] });
    expect(tx.stack('cherry_robusta')).toEqual({ qty: 20, quality: 60 });
    for (let i = 0; i < 6; i++) tx.execute({ reason: `c${i}`, coins: 1 });
    expect(state.economy.history).toHaveLength(5);
    expect(state.economy.history.at(-1)!.reason).toBe('c5');
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('removes empty stacks', () => {
    const { tx, state } = make(0, { seed_robusta: 1 });
    tx.execute({ reason: 'plant', items: [{ itemId: 'seed_robusta', qty: -1 }] });
    expect(state.economy.inventory.seed_robusta).toBeUndefined();
  });
});
