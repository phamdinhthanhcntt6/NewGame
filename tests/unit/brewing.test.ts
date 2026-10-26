import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../src/data/content';
import { needleAt, timingAccuracy, type BrewStep } from '../../src/gameplay/cafe/BrewingService';
import type { Customer } from '../../src/gameplay/cafe/CafeService';
import type { GameSimulation } from '../../src/gameplay/GameSimulation';
import { cafeSim, runUntil } from './helpers';

function cafe(sim: GameSimulation) {
  return sim.cafe!;
}

function use(sim: GameSimulation, id: string): void {
  sim.clickObject(id);
  const ok = runUntil(sim, () => {
    const s = sim.playerInteraction.snapshot();
    return !s.current && s.queue.length === 0 && !s.moveTarget && ['IDLE', 'CARRYING'].includes(sim.player.state);
  }, 30_000);
  if (!ok) throw new Error(`never finished using ${id}`);
}

function give(sim: GameSimulation, itemId: string, qty: number, quality = 70): void {
  const r = sim.tx.execute({ reason: 'test:give', items: [{ itemId, qty, quality }] });
  if (!r.ok) throw new Error(r.error);
}

/** Customer with a forced drink, order taken, sitting at their seat. */
function seatedCustomer(sim: GameSimulation, recipeId: string, archetype = 'tourist'): Customer {
  const c = cafe(sim).spawn(archetype, recipeId);
  if (!runUntil(sim, () => cafe(sim).customerAtCounter()?.id === c.id, 60_000)) throw new Error('never at counter');
  const r = cafe(sim).takeOrder();
  if (!r.ok) throw new Error(r.reason);
  runUntil(sim, () => c.fsm.is('WAITING') && !c.target, 60_000);
  return c;
}

/** Wait until the needle of the current timing step sits at `value` (rising half), then press. */
function pressAt(sim: GameSimulation, value: number): void {
  const step = sim.brewing.view()!.current as Extract<BrewStep, { kind: 'timing' }>;
  sim.tick(Math.round((value * step.periodMs) / 2));
  const r = sim.brewing.press();
  if (!r.ok) throw new Error(r.reason);
}

const perfect = (sim: GameSimulation) => (sim.brewing.view()!.current as Extract<BrewStep, { kind: 'timing' }>).target;

/** Full hands-on latte: walk to each station, choose, and stop needles at the given offsets from target. */
function brewLatte(sim: GameSimulation, opts: { miss?: number; addition?: string } = {}): void {
  const miss = opts.miss ?? 0;
  use(sim, 'grinder');
  expect(sim.brewing.chooseBean('roasted_arabica')).toEqual({ ok: true });
  pressAt(sim, perfect(sim) + miss); // grind (same station, armed automatically)
  use(sim, 'espresso');
  pressAt(sim, perfect(sim) + miss); // tamp
  pressAt(sim, perfect(sim) - miss); // extract
  use(sim, 'milk_station');
  expect(sim.brewing.chooseAddition(opts.addition ?? 'milk')).toEqual({ ok: true });
  pressAt(sim, perfect(sim) + miss); // pour
}

describe('timing mini-game maths', () => {
  it('needle is a triangle wave 0 → 1 → 0', () => {
    expect(needleAt(0, 1000)).toBe(0);
    expect(needleAt(250, 1000)).toBe(0.5);
    expect(needleAt(500, 1000)).toBe(1);
    expect(needleAt(750, 1000)).toBe(0.5);
    expect(needleAt(1000, 1000)).toBe(0);
  });

  it('accuracy is 1 inside tolerance and falls linearly to 0 at zeroAt beyond it', () => {
    expect(timingAccuracy(0.72, 0.7, 0.06, 0.35)).toBe(1);
    expect(timingAccuracy(0.7 + 0.06 + 0.175, 0.7, 0.06, 0.35)).toBeCloseTo(0.5, 9);
    expect(timingAccuracy(0, 0.7, 0.06, 0.35)).toBe(0);
  });
});

describe('brewing a latte hands-on', () => {
  it('perfect play: ingredients consumed once, drink in hands, order READY, quality from bean + performance', () => {
    const { sim } = cafeSim();
    give(sim, 'roasted_arabica', 3, 70);
    give(sim, 'milk', 2);
    const c = seatedCustomer(sim, 'latte');
    brewLatte(sim);
    const d = sim.brewing.heldDrink()!;
    expect(d).toMatchObject({ recipeId: 'latte', orderId: c.orderId, beanItem: 'roasted_arabica', beanQuality: 70, recipeAccuracy: 1, performance: 1, quality: 85 });
    expect(sim.player.state).toBe('CARRYING');
    expect(sim.orders.get(c.orderId!)!.status).toBe('READY');
    expect(sim.tx.count('roasted_arabica')).toBe(2);
    expect(sim.tx.count('milk')).toBe(1);
  });

  it('sloppy timing lowers performance and quality (deterministic, not random)', () => {
    const run = (miss: number) => {
      const { sim } = cafeSim();
      give(sim, 'roasted_arabica', 1, 70);
      give(sim, 'milk', 1);
      seatedCustomer(sim, 'latte');
      brewLatte(sim, { miss });
      return sim.brewing.heldDrink()!;
    };
    const ok = run(0);
    const meh = run(0.15);
    const bad = run(0.25);
    expect(meh.performance).toBeLessThan(ok.performance);
    expect(bad.performance).toBeLessThan(meh.performance);
    expect(bad.quality).toBeLessThan(meh.quality);
    expect(run(0.15)).toMatchObject({ performance: meh.performance, quality: meh.quality });
  });

  it('a wrong addition (condensed milk in a latte) is recorded as recipe inaccuracy', () => {
    const { sim } = cafeSim();
    give(sim, 'roasted_arabica', 1);
    give(sim, 'condensed_milk', 1);
    seatedCustomer(sim, 'latte');
    brewLatte(sim, { addition: 'condensed_milk' });
    expect(sim.brewing.heldDrink()!.recipeAccuracy).toBe(0);
    expect(sim.tx.count('condensed_milk')).toBe(0);
  });

  it('missing milk: the addition is refused (noIngredient); water is free but wrong', () => {
    const { sim } = cafeSim();
    give(sim, 'roasted_arabica', 1);
    seatedCustomer(sim, 'latte');
    use(sim, 'grinder');
    sim.brewing.chooseBean('roasted_arabica');
    pressAt(sim, perfect(sim));
    use(sim, 'espresso');
    pressAt(sim, perfect(sim));
    pressAt(sim, perfect(sim));
    use(sim, 'milk_station');
    expect(sim.brewing.chooseAddition('milk')).toMatchObject({ ok: false, reason: 'noIngredient' });
    expect(sim.brewing.chooseAddition('water').ok).toBe(true);
  });
});

describe('brewing rules', () => {
  it('needs an accepted order, roasted beans, empty hands and the right station', () => {
    const { sim } = cafeSim();
    const fails: string[] = [];
    sim.bus.on('interaction:failed', (e) => fails.push(e.detail ?? e.reason));
    use(sim, 'grinder');
    expect(fails.at(-1)).toBe('noOrderToBrew');
    seatedCustomer(sim, 'espresso');
    use(sim, 'grinder');
    expect(fails.at(-1)).toBe('noBeans');
    give(sim, 'roasted_robusta', 1);
    use(sim, 'espresso');
    expect(fails.at(-1)).toBe('wrongStation');
    use(sim, 'grinder');
    expect(sim.brewing.view()!.current!.kind).toBe('choose_bean');
  });

  it('steps only work while standing at their station', () => {
    const { sim } = cafeSim();
    give(sim, 'roasted_arabica', 1);
    seatedCustomer(sim, 'espresso');
    use(sim, 'grinder');
    sim.clickTile({ x: 10, y: 3 });
    runUntil(sim, () => sim.player.state === 'IDLE');
    expect(sim.brewing.chooseBean('roasted_arabica')).toMatchObject({ ok: false, reason: 'notAtStation' });
    expect(sim.tx.count('roasted_arabica')).toBe(1);
  });

  it('cancelling loses the used bean and puts the order back to be brewed again', () => {
    const { sim } = cafeSim();
    give(sim, 'roasted_arabica', 2);
    const c = seatedCustomer(sim, 'espresso');
    use(sim, 'grinder');
    sim.brewing.chooseBean('roasted_arabica');
    expect(sim.orders.get(c.orderId!)!.status).toBe('PREPARING');
    expect(sim.brewing.cancel().ok).toBe(true);
    expect(sim.orders.get(c.orderId!)!.status).toBe('ACCEPTED');
    expect(sim.tx.count('roasted_arabica')).toBe(1);
    expect(sim.brewing.nextOrderToBrew()).toBe(c.orderId);
  });
});

describe('serving', () => {
  it('serve by clicking the seat: customer receives, tastes, rates, pays the rated amount exactly once, leaves', () => {
    const { sim } = cafeSim();
    give(sim, 'roasted_arabica', 1);
    give(sim, 'milk', 1);
    const c = seatedCustomer(sim, 'latte');
    brewLatte(sim);
    const coins = sim.tx.coins;
    const paid: number[] = [];
    const rated: Array<{ coins: number; tip: number; stars: number }> = [];
    sim.bus.on('cafe:paid', (e) => paid.push(e.coins));
    sim.bus.on('cafe:rated', (e) => rated.push(e));
    use(sim, c.spot!.objectId);
    expect(sim.player.heldItem).toBeNull();
    expect(sim.player.state).toBe('IDLE');
    expect(['RECEIVING', 'TASTING', 'RATING', 'LEAVING']).toContain(c.fsm.state);
    runUntil(sim, () => c.fsm.is('LEAVING'), 20_000);
    expect(sim.orders.get(c.orderId!)!.status).toBe('COMPLETED');
    expect(rated).toHaveLength(1);
    const r = rated[0]!;
    expect(r.stars).toBe(5); // perfect brew with the preferred bean, served fast
    expect(r.coins).toBe(Math.round(CONTENT.recipes.latte!.basePrice * 1.3));
    expect(paid).toEqual([r.coins + r.tip]);
    expect(sim.tx.coins).toBe(coins + r.coins + r.tip);
    expect(c.leaveReason).toBe('served');
  });

  it('a drink can only go to its own customer, and only once', () => {
    const { sim } = cafeSim();
    const fails: string[] = [];
    sim.bus.on('interaction:failed', (e) => fails.push(e.detail ?? e.reason));
    give(sim, 'roasted_arabica', 2);
    give(sim, 'milk', 2);
    const a = seatedCustomer(sim, 'latte');
    const b = seatedCustomer(sim, 'latte');
    brewLatte(sim); // brews the oldest accepted order: a's
    expect(sim.brewing.heldDrink()!.orderId).toBe(a.orderId);
    use(sim, b.spot!.objectId);
    expect(fails.at(-1)).toBe('wrongCustomer');
    use(sim, a.spot!.objectId);
    expect(sim.player.heldItem).toBeNull();
    use(sim, a.spot!.objectId);
    expect(fails.at(-1)).toBe('noDrink');
    runUntil(sim, () => a.fsm.is('LEAVING'), 20_000);
    expect(sim.state.economy.history.filter((h) => h.reason.startsWith(`order:${a.orderId}:`))).toHaveLength(1);
  });

  it('if the customer gives up while their drink is being made, the session aborts; a finished drink is discarded', () => {
    const { sim } = cafeSim();
    give(sim, 'roasted_arabica', 2);
    give(sim, 'milk', 2);
    const a = seatedCustomer(sim, 'latte', 'office');
    use(sim, 'grinder');
    sim.brewing.chooseBean('roasted_arabica');
    runUntil(sim, () => a.fsm.is('LEAVING'), CONTENT.customers.archetypes.office!.drinkPatienceMs + 5000);
    expect(sim.brewing.view()).toBeNull();
    // Second case: drink already in hand when the customer leaves.
    const b = seatedCustomer(sim, 'latte', 'office');
    brewLatte(sim);
    expect(sim.player.heldItem).not.toBeNull();
    runUntil(sim, () => b.fsm.is('LEAVING'), CONTENT.customers.archetypes.office!.drinkPatienceMs + 5000);
    expect(sim.player.heldItem).toBeNull();
    expect(sim.player.state).toBe('IDLE');
  });
});

describe('supplies', () => {
  it('milk is bought at the supply shelf only, for its price', () => {
    const { sim } = cafeSim();
    expect(sim.supplies.buy('milk', 1)).toMatchObject({ ok: false, reason: 'suppliesClosed' });
    use(sim, 'supply_shelf');
    const coins = sim.tx.coins;
    expect(sim.supplies.buy('milk', 3).ok).toBe(true);
    expect(sim.tx.coins).toBe(coins - 3 * CONTENT.brewing.supplies.milk!);
    expect(sim.tx.count('milk')).toBe(3);
    expect(sim.supplies.buy('roasted_arabica', 1)).toMatchObject({ ok: false, reason: 'notSupplied' });
  });
});
