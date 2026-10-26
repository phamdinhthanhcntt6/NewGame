import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { CONTENT } from '../../src/data/content';
import type { Customer } from '../../src/gameplay/cafe/CafeService';
import { OrderService } from '../../src/gameplay/cafe/OrderService';
import type { GameSimulation } from '../../src/gameplay/GameSimulation';
import { cafeSim, runUntil } from './helpers';

const cfg = CONTENT.customers;

function cafe(sim: GameSimulation) {
  if (!sim.cafe) throw new Error('no café on this map');
  return sim.cafe;
}

/** Spawn a customer of a given archetype and run until they are ordering at the counter. */
function arriveAtCounter(sim: GameSimulation, archetype = 'student'): Customer {
  const c = cafe(sim).spawn(archetype);
  const ok = runUntil(sim, () => cafe(sim).customerAtCounter()?.id === c.id, 60_000);
  if (!ok) throw new Error(`${c.id} never reached the counter (state ${c.fsm.state})`);
  return c;
}

describe('café map & spawning', () => {
  it('has 8 seats, 4 standing spots, a 5-tile queue', () => {
    const { sim } = cafeSim();
    expect(cafe(sim).freeSpots()).toBe(12);
    expect(cafe(sim).queueTiles).toHaveLength(5);
  });

  it('spawns on schedule at the street spawn point, never above the concurrency cap', () => {
    const { sim } = cafeSim({ autoSpawn: true });
    sim.tick(cfg.spawn.firstDelayMs - 100);
    expect(cafe(sim).count).toBe(0);
    sim.tick(200);
    expect(cafe(sim).count).toBe(1);
    const c = cafe(sim).views()[0]!;
    expect(Math.abs(c.pos.x - 0.5) + Math.abs(c.pos.y - 13.5)).toBeLessThan(0.5);
    let max = 0;
    for (let t = 0; t < 10 * 60_000; t += 100) {
      sim.tick(100);
      max = Math.max(max, cafe(sim).count);
    }
    expect(max).toBeLessThanOrEqual(cfg.spawn.maxConcurrent);
    expect(max).toBeGreaterThan(1);
  });

  it('customers physically walk in: they never move faster than their speed (no teleporting)', () => {
    const { sim } = cafeSim({ seed: 7, autoSpawn: true });
    const last = new Map<string, { x: number; y: number }>();
    for (let t = 0; t < 3 * 60_000; t += 16) {
      sim.tick(16);
      for (const v of cafe(sim).views()) {
        const prev = last.get(v.id);
        const speed = cfg.archetypes[v.archetype]!.speedTilesPerSec;
        if (prev) expect(Math.hypot(v.pos.x - prev.x, v.pos.y - prev.y)).toBeLessThanOrEqual((speed * 16) / 1000 + 1e-9);
        last.set(v.id, v.pos);
      }
    }
  });
});

describe('ordering & queue', () => {
  it('a customer walks to the counter and creates a complete order', () => {
    const { sim } = cafeSim();
    const c = arriveAtCounter(sim, 'office');
    expect(c.actor.tile).toEqual(cafe(sim).orderPoint);
    const o = sim.orders.get(c.orderId!)!;
    const recipe = CONTENT.recipes[o.recipeId]!;
    expect(o).toMatchObject({ customerId: c.id, status: 'CREATED', timeLimitMs: cfg.archetypes.office!.drinkPatienceMs, expectedQuality: recipe.expectedQuality, reward: { coins: recipe.basePrice, exp: recipe.expReward } });
    expect(Object.keys(cfg.archetypes.office!.preferences)).toContain(o.recipeId);
    expect(o.ingredients).toEqual(recipe.ingredients);
  });

  it('others queue behind in order and advance when the order is taken', () => {
    const { sim } = cafeSim();
    const a = arriveAtCounter(sim);
    const b = cafe(sim).spawn('student');
    const c = cafe(sim).spawn('student');
    runUntil(sim, () => b.fsm.is('QUEUING') && c.fsm.is('QUEUING') && !b.target && !c.target, 60_000);
    expect(b.actor.tile).toEqual(cafe(sim).queueTiles[0]);
    expect(c.actor.tile).toEqual(cafe(sim).queueTiles[1]);
    expect(cafe(sim).takeOrder().ok).toBe(true);
    expect(a.fsm.state).toBe('WAITING');
    runUntil(sim, () => cafe(sim).customerAtCounter()?.id === b.id, 60_000);
    runUntil(sim, () => !c.target, 60_000);
    expect(c.actor.tile).toEqual(cafe(sim).queueTiles[0]);
  });

  it('accepted customers get unique seats', () => {
    const { sim } = cafeSim();
    const seats = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const c = arriveAtCounter(sim);
      expect(cafe(sim).takeOrder().ok).toBe(true);
      seats.add(c.spot!.key);
    }
    expect(seats.size).toBe(5);
    expect(cafe(sim).freeSpots()).toBe(7);
  });

  it('when every seat and standing spot is taken, the order cannot be taken (noSeat)', () => {
    const { sim } = cafeSim();
    for (let i = 0; i < 12; i++) {
      arriveAtCounter(sim, 'tourist');
      expect(cafe(sim).takeOrder().ok).toBe(true);
    }
    arriveAtCounter(sim, 'tourist');
    expect(cafe(sim).canTakeOrder()).toMatchObject({ ok: false, reason: 'noSeat' });
  });

  it('a full queue turns new customers away (queueFull)', () => {
    const { sim } = cafeSim();
    const left: string[] = [];
    sim.bus.on('customer:left', (e) => left.push(e.reason));
    const crowd = Array.from({ length: 7 }, () => cafe(sim).spawn('office'));
    runUntil(sim, () => left.includes('queueFull'), 60_000);
    expect(left).toEqual(['queueFull']);
    expect(cafe(sim).queueOrder()).toHaveLength(6);
    void crowd;
  });
});

describe('patience & departure', () => {
  it('nobody takes the order → CANCELLED (impatient), leaves via the exit, queue advances', () => {
    const { sim } = cafeSim();
    const a = arriveAtCounter(sim, 'office');
    const b = cafe(sim).spawn('tourist');
    const orderId = a.orderId!;
    runUntil(sim, () => a.fsm.is('LEAVING'), cfg.archetypes.office!.orderPatienceMs + 5000);
    expect(sim.orders.get(orderId)!.status).toBe('CANCELLED');
    expect(sim.orders.get(orderId)!.history.at(-1)!.reason).toBe('impatient');
    expect(a.satisfaction).toBe(10);
    runUntil(sim, () => !cafe(sim).customer(a.id), 60_000);
    expect(cafe(sim).customer(a.id)).toBeUndefined();
    runUntil(sim, () => cafe(sim).customerAtCounter()?.id === b.id, 60_000);
  });

  it('accepted but never served → FAILED (timeout) and the seat is released', () => {
    const { sim } = cafeSim();
    const a = arriveAtCounter(sim, 'office');
    cafe(sim).takeOrder();
    const free = cafe(sim).freeSpots();
    runUntil(sim, () => a.fsm.is('LEAVING'), cfg.archetypes.office!.drinkPatienceMs + 5000);
    expect(sim.orders.get(a.orderId!)!.status).toBe('FAILED');
    expect(cafe(sim).freeSpots()).toBe(free + 1);
  });

  it('blocked door: customers give up (blocked) instead of standing forever', () => {
    const { sim } = cafeSim();
    const left: string[] = [];
    sim.bus.on('customer:left', (e) => left.push(e.reason));
    sim.world.addObject('blocker', 'crate', cafe(sim).doorTile); // furniture placed in the doorway
    sim.world.addObject('blocker2', 'crate', { x: 6, y: 12 });
    sim.world.addObject('blocker3', 'crate', { x: 7, y: 12 });
    const c = cafe(sim).spawn('student');
    runUntil(sim, () => left.length > 0, 30_000);
    expect(left).toEqual(['blocked']);
    runUntil(sim, () => !cafe(sim).customer(c.id), 60_000);
    expect(cafe(sim).customer(c.id)).toBeUndefined();
  });

  it('if even the exit is unreachable, the customer is removed (never stuck forever)', () => {
    const { sim } = cafeSim();
    const removed: string[] = [];
    sim.bus.on('customer:removed', (e) => removed.push(e.customerId));
    const c = arriveAtCounter(sim);
    // Seal the café in.
    sim.world.addObject('b1', 'crate', { x: 6, y: 12 });
    sim.world.addObject('b2', 'crate', { x: 7, y: 12 });
    runUntil(sim, () => removed.includes(c.id), cfg.archetypes.student!.orderPatienceMs + 30_000);
    expect(removed).toContain(c.id);
  });
});

describe('player takes orders at the counter', () => {
  it('clicking the order counter walks behind it and accepts the order', () => {
    const { sim } = cafeSim();
    const c = arriveAtCounter(sim);
    sim.clickObject('order_counter');
    runUntil(sim, () => c.fsm.is('WAITING'), 20_000);
    expect(sim.orders.get(c.orderId!)!.status).toBe('ACCEPTED');
    expect(sim.player.tile.y).toBe(3); // north side, behind the counter
  });

  it('with nobody at the counter the player is told so', () => {
    const { sim } = cafeSim();
    const fails: string[] = [];
    sim.bus.on('interaction:failed', (e) => fails.push(e.detail ?? e.reason));
    sim.clickObject('order_counter');
    runUntil(sim, () => fails.length > 0, 20_000);
    expect(fails).toEqual(['noCustomer']);
  });
});

describe('robustness', () => {
  it('20 simulated minutes with random order taking: invariants hold and nobody lingers', () => {
    const { sim } = cafeSim({ seed: 42, autoSpawn: true });
    let seed = 5;
    const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    const born = new Map<string, number>();
    sim.bus.on('customer:spawned', (e) => born.set(e.customerId, sim.now));
    const maxLife = Math.max(...Object.values(cfg.archetypes).map((a) => a.orderPatienceMs + a.drinkPatienceMs)) + 60_000;
    for (let t = 0; t < 20 * 60_000; t += 100) {
      sim.tick(100);
      if (rnd() < 0.02) cafe(sim).takeOrder();
      const views = cafe(sim).views();
      // unique reservations
      const spots = views.map((v) => v.spot).filter((s): s is string => s !== null);
      expect(new Set(spots).size).toBe(spots.length);
      // queue members are in queue states
      for (const id of cafe(sim).queueOrder()) expect(['QUEUING', 'WALKING_TO_ORDER', 'ORDERING']).toContain(cafe(sim).customer(id)!.fsm.state);
      // nobody lives longer than their patience allows
      for (const v of views) expect(sim.now - born.get(v.id)!).toBeLessThan(maxLife);
    }
    // every order whose customer is gone is terminal
    for (const o of sim.orders.activeOrders()) expect(cafe(sim).customer(o.customerId)).toBeDefined();
  });
});

describe('OrderService transitions', () => {
  const make = () => new OrderService(CONTENT.recipes, new EventBus<GameEvents>(), () => 0);

  it('follows CREATED → ACCEPTED → PREPARING → READY → SERVED → COMPLETED', () => {
    const s = make();
    const o = (s.create('c1', 'latte', 1000) as { ok: true; order: { id: number } }).order;
    for (const to of ['ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED'] as const) expect(s.transition(o.id, to).ok).toBe(true);
    expect(s.get(o.id)!.history.map((h) => h.status)).toEqual(['CREATED', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED']);
    expect(s.activeOrders()).toHaveLength(0);
  });

  it('refuses illegal jumps and any change after a terminal state', () => {
    const s = make();
    const o = (s.create('c1', 'espresso', 1000) as { ok: true; order: { id: number } }).order;
    expect(s.transition(o.id, 'SERVED')).toMatchObject({ ok: false, reason: 'illegalTransition' });
    expect(s.transition(o.id, 'COMPLETED')).toMatchObject({ ok: false, reason: 'illegalTransition' });
    expect(s.transition(o.id, 'CANCELLED').ok).toBe(true);
    expect(s.transition(o.id, 'ACCEPTED')).toMatchObject({ ok: false, reason: 'illegalTransition' });
    expect(s.transition(999, 'ACCEPTED')).toMatchObject({ ok: false, reason: 'unknownOrder' });
    expect(s.create('c2', 'mocha_unknown', 1000)).toMatchObject({ ok: false, reason: 'unknownRecipe' });
  });
});

describe('travel', () => {
  it('the farm door requests travel to the farm', () => {
    const { sim } = cafeSim();
    const req: string[] = [];
    sim.bus.on('world:travelRequested', (e) => req.push(e.map));
    sim.clickObject('farm_door');
    runUntil(sim, () => req.length > 0, 20_000);
    expect(req).toEqual(['farm']);
  });
});
