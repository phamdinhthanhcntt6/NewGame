import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { CONTENT } from '../../src/data/content';
import type { Drink } from '../../src/gameplay/cafe/BrewingService';
import type { Order } from '../../src/gameplay/cafe/OrderService';
import { RatingService, type RatingInput } from '../../src/gameplay/cafe/RatingService';
import { expForLevel, levelForExp } from '../../src/gameplay/progression/ProgressionService';
import { createNewGameState } from '../../src/gameplay/state/GameState';
import { MemoryStorage, SaveService } from '../../src/gameplay/state/SaveService';
import { cafeSim, farmSim, runUntil } from './helpers';

const PATIENCE = 100_000;

function service() {
  const state = createNewGameState({ now: 0, startingCoins: 0, startingItems: {}, wateringCanCapacity: 4, map: 'cafe' });
  const bus = new EventBus<GameEvents>();
  return { rating: new RatingService(state, CONTENT.progression, CONTENT.recipes, bus), state, bus };
}

function order(recipeId = 'latte'): Order {
  const r = CONTENT.recipes[recipeId]!;
  return {
    id: 1,
    customerId: 'c1',
    recipeId,
    ingredients: r.ingredients,
    createdAt: 0,
    timeLimitMs: PATIENCE,
    expectedQuality: r.expectedQuality,
    reward: { coins: r.basePrice, exp: r.expReward },
    status: 'SERVED',
    history: [],
  };
}

function drink(over: Partial<Drink> = {}): Drink {
  return {
    id: 'drink:1',
    orderId: 1,
    recipeId: 'latte',
    beanItem: 'roasted_robusta', // not the latte's preferred bean → no bonus
    beanQuality: 60,
    recipeAccuracy: 1,
    performance: 0.5,
    quality: 0,
    readyAt: 10_000,
    steps: {},
    stepErrors: {},
    choices: [{ step: 'choose_addition', chosen: 'milk', correct: true }],
    ...over,
  };
}

const input = (over: Partial<RatingInput> = {}, d: Partial<Drink> = {}, recipe = 'latte'): RatingInput => ({
  order: order(recipe),
  drink: drink({ recipeId: recipe, ...d }),
  acceptedAt: 0,
  servedAt: 20_000, // 20% of patience → full serving-time marks
  patienceMs: PATIENCE,
  ...over,
});

describe('rating formula (40 / 25 / 20 / 15)', () => {
  it('combines the four components with the brief weights', () => {
    const { rating } = service();
    const r = rating.evaluate(input());
    expect(r.components).toEqual({ recipeAccuracy: 100, beanQuality: 60, brewingPerformance: 50, servingTime: 100 });
    expect(r.score).toBe(Math.round(0.4 * 100 + 0.25 * 60 + 0.2 * 50 + 0.15 * 100)); // 80
    expect(r.stars).toBe(4);
  });

  it('serving time: full marks up to 25% of patience, then falls linearly to 0 at 100%', () => {
    const { rating } = service();
    expect(rating.evaluate(input({ servedAt: 25_000 })).components.servingTime).toBe(100);
    expect(rating.evaluate(input({ servedAt: 62_500 })).components.servingTime).toBe(50);
    expect(rating.evaluate(input({ servedAt: 100_000 })).components.servingTime).toBe(0);
  });

  it('slow service lowers the score by its 15% weight', () => {
    const { rating } = service();
    const fast = rating.evaluate(input({ servedAt: 20_000 }, { readyAt: 19_000 }));
    const slowest = rating.evaluate(input({ servedAt: 100_000 }, { readyAt: 99_000 }));
    expect(fast.score - slowest.score).toBe(15);
  });

  it('the preferred bean adds a quality bonus (capped at 100)', () => {
    const { rating } = service();
    expect(rating.evaluate(input({}, { beanItem: 'roasted_arabica', beanQuality: 60 })).components.beanQuality).toBe(70);
    expect(rating.evaluate(input({}, { beanItem: 'roasted_arabica', beanQuality: 95 })).components.beanQuality).toBe(100);
  });

  it('stars follow the thresholds 0 / 40 / 55 / 70 / 85', () => {
    const { rating } = service();
    const starsFor = (perf: number, acc = 1, bean = 0, served = 20_000) =>
      rating.evaluate(input({ servedAt: served }, { performance: perf, recipeAccuracy: acc, beanQuality: bean, choices: [] }));
    // recipe 40 + time 15 = 55 baseline (bean 0, perf 0)
    expect(starsFor(0).score).toBe(55);
    expect(starsFor(0).stars).toBe(3);
    expect(starsFor(0, 0).stars).toBe(1); // 15
    expect(starsFor(0, 0.625).stars).toBe(2); // 25 + 15 = 40
    expect(starsFor(0.75).stars).toBe(4); // 55 + 15 = 70
    expect(starsFor(1, 1, 60).stars).toBe(5); // 40 + 15 + 20 + 15 = 90
  });

  it('is deterministic: the same brew and service always get the same rating', () => {
    const { rating } = service();
    expect(rating.evaluate(input())).toEqual(rating.evaluate(input()));
  });
});

describe('feedback', () => {
  const fb = (over: Partial<RatingInput> = {}, d: Partial<Drink> = {}, recipe = 'latte') => service().rating.evaluate(input(over, d, recipe)).feedback;

  it('wrong order when an ingredient choice was wrong', () => {
    expect(fb({}, { recipeAccuracy: 0, choices: [{ step: 'choose_addition', chosen: 'water', correct: false }] })).toContain('wrongOrder');
  });

  it('too bitter when extraction overshoots', () => {
    expect(fb({}, { stepErrors: { extract: 0.12 } })).toContain('tooBitter');
    expect(fb({}, { stepErrors: { extract: 0.05 } })).not.toContain('tooBitter');
  });

  it('too sweet: condensed milk by mistake, or over-poured condensed milk in a sweet recipe', () => {
    expect(fb({}, { recipeAccuracy: 0, choices: [{ step: 'choose_addition', chosen: 'condensed_milk', correct: false }] })).toContain('tooSweet');
    expect(fb({}, { recipeId: 'vn_milk_coffee', stepErrors: { pour: 0.15 } }, 'vn_milk_coffee')).toContain('tooSweet');
    expect(fb({}, { stepErrors: { pour: 0.15 } }, 'latte')).not.toContain('tooSweet');
  });

  it('coffee is cold when it waited too long after brewing', () => {
    expect(fb({ servedAt: 60_000 }, { readyAt: 10_000 })).toContain('cold');
    expect(fb({ servedAt: 20_000 }, { readyAt: 10_000 })).not.toContain('cold');
  });

  it('slow service past 60% of patience', () => {
    expect(fb({ servedAt: 70_000 }, { readyAt: 65_000 })).toContain('slowService');
  });

  it('excellent aroma for a high-quality preferred bean; delicious only for 4★+ without complaints', () => {
    const great = fb({}, { beanItem: 'roasted_arabica', beanQuality: 85, performance: 1 });
    expect(great).toEqual(['excellentAroma', 'delicious']);
    const bitter = fb({}, { beanItem: 'roasted_arabica', beanQuality: 85, performance: 1, stepErrors: { extract: 0.12 } });
    expect(bitter).toContain('tooBitter');
    expect(bitter).not.toContain('delicious');
  });
});

describe('rewards', () => {
  it('price multiplier, tip and EXP scale with stars', () => {
    const { rating } = service();
    const five = rating.evaluate(input({}, { beanItem: 'roasted_arabica', beanQuality: 85, performance: 1 }));
    expect(five.stars).toBe(5);
    expect(five.coins).toBe(Math.round(60 * 1.3));
    expect(five.tip).toBe(Math.round(60 * 0.25));
    expect(five.exp).toBe(Math.round(10 * 1.5));
    const one = rating.evaluate(input({}, { recipeAccuracy: 0, performance: 0, beanQuality: 0, choices: [] }));
    expect(one.stars).toBe(1);
    expect(one.coins).toBe(Math.round(60 * 0.6));
    expect(one.tip).toBe(0);
  });
});

describe('reputation', () => {
  it('is the average of the last 20 ratings; failures count as 1★; it drives traffic and tips', () => {
    const { rating, state } = service();
    expect(rating.reputation).toBe(3);
    expect(rating.trafficFactor).toBe(1);
    state.cafe.ratings = Array(20).fill(5);
    expect(rating.trafficFactor).toBeCloseTo(1.3, 9);
    const tipAt5 = rating.evaluate(input({}, { beanItem: 'roasted_arabica', beanQuality: 85, performance: 1 })).tip;
    for (let i = 0; i < 20; i++) rating.recordFailure('impatient');
    expect(rating.reputation).toBe(1);
    expect(rating.trafficFactor).toBeCloseTo(0.7, 9);
    const tipAt1 = rating.evaluate(input({}, { beanItem: 'roasted_arabica', beanQuality: 85, performance: 1 })).tip;
    expect(tipAt5).toBeGreaterThan(tipAt1);
    expect(state.cafe.ratings).toHaveLength(20);
    expect(state.cafe.stats.failed).toBe(20);
  });

  it('good reputation brings more customers in the same time (same seed)', () => {
    const count = (stars: number) => {
      const { sim } = cafeSim({ seed: 3, autoSpawn: true });
      sim.state.cafe.ratings = Array(20).fill(stars);
      let spawned = 0;
      sim.bus.on('customer:spawned', () => spawned++);
      for (let t = 0; t < 15 * 60_000; t += 200) sim.tick(200);
      return spawned;
    };
    expect(count(5)).toBeGreaterThan(count(1));
  });

  it('unhappy departures lower reputation through the café', () => {
    const { sim } = cafeSim();
    const c = sim.cafe!.spawn('office');
    runUntil(sim, () => c.fsm.is('LEAVING'), CONTENT.customers.archetypes.office!.orderPatienceMs + 60_000);
    expect(sim.state.cafe.ratings).toEqual([1]);
    expect(sim.rating.reputation).toBe(1);
  });
});

describe('levels & unlocks', () => {
  it('level thresholds: 0, 100, 300, 600, 1000 EXP', () => {
    expect([1, 2, 3, 4, 5].map((l) => expForLevel(l, 50))).toEqual([0, 100, 300, 600, 1000]);
    expect(levelForExp(0, 50)).toBe(1);
    expect(levelForExp(99, 50)).toBe(1);
    expect(levelForExp(100, 50)).toBe(2);
    expect(levelForExp(1000, 50)).toBe(5);
  });

  it('a level-up is announced exactly once per level', () => {
    const { sim } = farmSim();
    const ups: number[] = [];
    sim.bus.on('progression:levelUp', (e) => ups.push(e.to));
    sim.tx.execute({ reason: 'test', exp: 99 });
    sim.tx.execute({ reason: 'test', exp: 1 });
    sim.tx.execute({ reason: 'test', exp: 50 });
    sim.tx.execute({ reason: 'test', exp: 450 });
    expect(ups).toEqual([2, 4]);
    expect(sim.progression.level).toBe(4);
  });

  it('Culi seeds unlock at level 3', () => {
    const { sim } = farmSim();
    sim.state.economy.coins = 1000;
    sim.clickObject('seed_stall');
    runUntil(sim, () => sim.shops.current === 'seeds');
    expect(sim.farm.buySeeds('culi', 1)).toMatchObject({ ok: false, reason: 'levelTooLow' });
    sim.tx.execute({ reason: 'test', exp: 300 });
    expect(sim.farm.buySeeds('culi', 1).ok).toBe(true);
  });

  it('customers only order unlocked recipes; the menu grows with level', () => {
    const recipesOrdered = (exp: number) => {
      const { sim } = cafeSim({ seed: 11 });
      if (exp) sim.tx.execute({ reason: 'test', exp });
      const seen = new Set<string>();
      for (let i = 0; i < 60; i++) seen.add(sim.cafe!.spawn().recipeId);
      return seen;
    };
    const l1 = recipesOrdered(0);
    expect([...l1].every((r) => CONTENT.progression.recipeUnlockLevel[r]! <= 1)).toBe(true);
    const l3 = recipesOrdered(300);
    expect(l3.has('latte') || l3.has('cappuccino')).toBe(true);
  });
});

describe('persistence', () => {
  it('reputation, stats and feedback history survive save/load', () => {
    const { sim, clock } = farmSim();
    const customer = { id: 'c', def: { drinkPatienceMs: PATIENCE } } as never;
    sim.rating.policy(order(), drink({ beanItem: 'roasted_arabica', beanQuality: 85, performance: 1 }), customer); // 5★
    sim.rating.policy(order(), drink(), customer); // 4★
    sim.rating.recordFailure('timeout'); // 1★
    const saves = new SaveService(new MemoryStorage());
    saves.save(sim.captureState(), clock.now());
    const loaded = saves.load(clock.now());
    if (loaded.status !== 'ok') throw new Error(loaded.status);
    const again = farmSim({ state: loaded.state, clock }).sim;
    expect(again.state.cafe.ratings).toEqual([5, 4, 1]);
    expect(again.rating.reputation).toBeCloseTo(10 / 3, 9);
    expect(again.state.cafe.stats).toEqual({ served: 2, failed: 1 });
    expect(again.rating.history().map((h) => h.stars)).toEqual([4, 5]);
  });

  it('feedback history is capped when ratings are recorded', () => {
    const { rating, state } = service();
    for (let i = 0; i < 60; i++) rating.policy(order(), drink(), { id: 'c', def: { drinkPatienceMs: PATIENCE } } as never);
    expect(state.cafe.feedback).toHaveLength(CONTENT.progression.feedbackHistoryLimit);
    expect(state.cafe.stats.served).toBe(60);
  });
});
