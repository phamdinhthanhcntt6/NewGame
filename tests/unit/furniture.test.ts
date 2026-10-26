import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/Rng';
import { CONTENT, validateContent, type GameContent } from '../../src/data/content';
import type { Customer } from '../../src/gameplay/cafe/CafeService';
import type { GameSimulation } from '../../src/gameplay/GameSimulation';
import type { GameState } from '../../src/gameplay/state/GameState';
import { MemoryStorage, SaveService } from '../../src/gameplay/state/SaveService';
import { reachableSet } from '../../src/systems/navigation/astar';
import { footprintTiles, tileKey, type TilePos } from '../../src/utils/tile';
import vi from '../../src/data/locales/vi.json';
import type { DecorFailReason } from '../../src/gameplay/decor/FurnitureService';
import { cafeSim, farmSim, runUntil } from './helpers';

const catalog = CONTENT.furniture.catalog;
const ok = { ok: true };
const no = (reason: string) => ({ ok: false, reason });

/** Coins + EXP for tests that aren't about prices or levels (300 EXP = level 3, everything unlocked). */
function rich(sim: GameSimulation, exp = 300): void {
  expect(sim.tx.execute({ reason: 'test:grant', coins: 5000, exp }).ok).toBe(true);
}

function buyPlace(sim: GameSimulation, type: string, at: TilePos, rotation = 0): string {
  expect(sim.decor.buy(type)).toEqual(ok);
  expect(sim.decor.place(type, at, rotation)).toEqual(ok);
  return sim.decor.layout().at(-1)!.id;
}

const walkable = (sim: GameSimulation, x: number, y: number) => sim.world.grid.isWalkable({ x, y });

function cafe(sim: GameSimulation) {
  if (!sim.cafe) throw new Error('no café');
  return sim.cafe;
}

function arriveAtCounter(sim: GameSimulation, archetype = 'student'): Customer {
  const c = cafe(sim).spawn(archetype);
  if (!runUntil(sim, () => cafe(sim).customerAtCounter()?.id === c.id, 60_000)) throw new Error(`${c.id} never reached the counter`);
  return c;
}

/** Every tile's walkability must equal terrain + footprints of blocking objects (no leaked blocker counts). */
function expectGridMatchesObjects(sim: GameSimulation): void {
  const blocked = new Set<string>();
  for (const o of sim.world.allObjects()) if (o.def.blocking) for (const t of footprintTiles(o.footprint)) blocked.add(tileKey(t));
  for (let y = 0; y < sim.world.height; y++) {
    for (let x = 0; x < sim.world.width; x++) {
      const terrain = sim.map.legend[sim.map.terrain[y]![x]!]!.walkable;
      expect(walkable(sim, x, y), `tile ${x},${y}`).toBe(terrain && !blocked.has(`${x},${y}`));
    }
  }
}

describe('café furniture: starting layout and bonuses', () => {
  it('the map furniture is the starting layout: 4 tables, 8 chairs, 2 plants, all movable', () => {
    const { sim } = cafeSim();
    const types = sim.decor.layout().map((f) => f.type);
    expect(types.filter((t) => t === 'cafe_table')).toHaveLength(4);
    expect(types.filter((t) => t === 'chair')).toHaveLength(8);
    expect(types.filter((t) => t === 'plant')).toHaveLength(2);
    expect(sim.decor.isFurniture('chair_1')).toBe(true);
    expect(sim.decor.isFurniture('grinder')).toBe(false);
    expect(sim.snapshot().decor).toMatchObject({ active: false, selection: null, preview: null });
  });

  it('bonuses come from the furniture actually placed', () => {
    const { sim } = cafeSim();
    expect(sim.decor.bonuses()).toEqual({ comfort: 0, decor: 8, spots: 12, patienceFactor: 1, trafficFactor: 1 + 8 * 0.005 });
    rich(sim);
    buyPlace(sim, 'armchair', { x: 7, y: 7 });
    buyPlace(sim, 'bookshelf', { x: 7, y: 9 });
    const b = sim.decor.bonuses();
    expect(b.comfort).toBe(catalog.armchair!.comfort + catalog.bookshelf!.comfort);
    expect(b.decor).toBe(8 + catalog.armchair!.decor + catalog.bookshelf!.decor);
    expect(b.spots).toBe(13);
    expect(b.patienceFactor).toBeCloseTo(1 + b.comfort * 0.005);
  });

  it('comfort and decor are capped', () => {
    const { sim } = cafeSim();
    rich(sim);
    for (const at of [{ x: 7, y: 5 }, { x: 7, y: 6 }, { x: 7, y: 7 }, { x: 7, y: 8 }, { x: 7, y: 9 }, { x: 7, y: 10 }, { x: 8, y: 5 }]) buyPlace(sim, 'armchair', at);
    expect(sim.decor.bonuses().comfort).toBe(CONTENT.furniture.bonuses.comfortCap);
  });

  it('comfort makes new customers more patient (existing ones keep their terms), and orders get the longer time limit', () => {
    const { sim } = cafeSim();
    const before = arriveAtCounter(sim, 'office');
    rich(sim);
    buyPlace(sim, 'armchair', { x: 7, y: 7 });
    const f = sim.decor.bonuses().patienceFactor;
    expect(f).toBeCloseTo(1.05);
    const base = CONTENT.customers.archetypes.office!;
    expect(before.def.orderPatienceMs).toBe(base.orderPatienceMs);
    cafe(sim).takeOrder();
    const after = arriveAtCounter(sim, 'office');
    expect(after.def.orderPatienceMs).toBe(Math.round(base.orderPatienceMs * f));
    expect(after.def.drinkPatienceMs).toBe(Math.round(base.drinkPatienceMs * f));
    expect(sim.orders.get(after.orderId!)!.timeLimitMs).toBe(Math.round(base.drinkPatienceMs * f));
  });

  it('decor brings customers more often: arrival intervals shrink by the traffic factor', () => {
    const spawnTimes = (decorate: boolean): number[] => {
      const { sim } = cafeSim({ seed: 11 });
      rich(sim);
      if (decorate) buyPlace(sim, 'bookshelf', { x: 7, y: 9 });
      cafe(sim).open = true;
      const times: number[] = [];
      sim.bus.on('customer:spawned', () => times.push(sim.now));
      runUntil(sim, () => times.length >= 3, 120_000, 10);
      return times;
    };
    const plain = spawnTimes(false);
    const decorated = spawnTimes(true);
    expect(decorated[0]).toBe(plain[0]); // the first arrival is fixed
    const ratio = (1 + 8 * 0.005) / (1 + 20 * 0.005);
    expect(decorated[1]! - decorated[0]!).toBeCloseTo((plain[1]! - plain[0]!) * ratio, -2);
    expect(decorated[1]! - decorated[0]!).toBeLessThan(plain[1]! - plain[0]!);
  });
});

describe('buying furniture', () => {
  it('coins out and the piece into the shared inventory, in one transaction', () => {
    const { sim } = cafeSim();
    const coins = sim.tx.coins;
    const txs = sim.state.economy.history.length;
    expect(sim.decor.buy('plant')).toEqual(ok);
    expect(sim.tx.coins).toBe(coins - catalog.plant!.price);
    expect(sim.tx.count('furn_plant')).toBe(1);
    expect(sim.state.economy.history).toHaveLength(txs + 1);
    expect(sim.state.economy.history.at(-1)).toMatchObject({ reason: 'buyFurniture:plant', coins: -catalog.plant!.price, items: [{ itemId: 'furn_plant', qty: 1 }] });
  });

  it('refuses without enough coins, above the player level, or for unknown furniture — and changes nothing', () => {
    const { sim } = cafeSim();
    const coins = sim.tx.coins;
    expect(sim.decor.buy('armchair')).toEqual(no('locked'));
    expect(sim.decor.buy('counter')).toEqual(no('unknownFurniture'));
    expect(sim.decor.buy('chair', 99)).toEqual(no('insufficientCoins'));
    expect(sim.tx.coins).toBe(coins);
    expect(sim.tx.count('furn_chair') + sim.tx.count('furn_armchair')).toBe(0);
    sim.tx.execute({ reason: 'test:exp', exp: 100 }); // level 2
    expect(sim.progression.level).toBe(2);
    expect(sim.decor.buy('armchair')).toEqual(ok);
    expect(sim.decor.buy('bookshelf')).toEqual(no('locked'));
  });
});

describe('placement validation', () => {
  it('places an owned piece: item consumed, object added, tiles blocked, layout saved', () => {
    const { sim } = cafeSim();
    const events: unknown[] = [];
    sim.bus.on('decor:changed', (e) => events.push(e));
    expect(sim.decor.place('plant', { x: 7, y: 7 })).toEqual(no('notOwned'));
    sim.decor.buy('plant');
    expect(sim.decor.place('plant', { x: 7, y: 7 })).toEqual(ok);
    const id = sim.decor.layout().at(-1)!.id;
    expect(sim.world.getObject(id)).toMatchObject({ type: 'plant', footprint: { x: 7, y: 7, w: 1, h: 1 } });
    expect(sim.tx.count('furn_plant')).toBe(0);
    expect(walkable(sim, 7, 7)).toBe(false);
    expect(events).toEqual([{ action: 'placed', objectId: id, type: 'plant' }]);
    expect(sim.state.decor.layouts.cafe).toEqual(sim.decor.layout());
  });

  it('rejects each invalid spot with a specific reason, and a rejected placement changes nothing', () => {
    const { sim } = cafeSim();
    rich(sim);
    sim.decor.buy('plant');
    sim.decor.buy('cafe_table_long');
    const check = (type: string, x: number, y: number, rot = 0) => {
      const r = sim.decor.check(type, { x, y }, rot);
      return r.ok ? 'ok' : r.reason;
    };
    expect(check('plant', 5, 2)).toBe('outOfArea'); // behind the counter
    expect(check('plant', 0, 7)).toBe('outOfArea'); // wall
    expect(check('plant', 40, 40)).toBe('outOfArea');
    expect(check('cafe_table_long', 12, 7)).toBe('outOfArea'); // second tile in the wall
    expect(check('cafe_table_long', 12, 7, 1)).toBe('ok'); // rotated it fits
    expect(check('plant', 9, 6)).toBe('overlap'); // table
    expect(check('plant', 9, 5)).toBe('overlap'); // chair (not blocking, still occupied)
    expect(check('plant', 2, 8)).toBe('overlap'); // standing spot
    expect(check('plant', 5, 7)).toBe('reservedTile'); // queue
    expect(check('plant', 5, 5)).toBe('reservedTile'); // order point
    expect(check('plant', 6, 11)).toBe('reservedTile'); // door
    expect(check('plant', 7, 7, 4)).toBe('invalidRotation');
    expect(check('counter', 7, 7)).toBe('unknownFurniture');
    const before = sim.decor.layout();
    expect(sim.decor.place('plant', { x: 9, y: 6 })).toEqual(no('overlap'));
    expect(sim.decor.layout()).toEqual(before);
    expect(sim.tx.count('furn_plant')).toBe(1);
  });

  it('never on a person', () => {
    const { sim } = cafeSim();
    rich(sim);
    sim.playerInteraction.moveTo({ x: 8, y: 8 });
    runUntil(sim, () => sim.player.state === 'IDLE' && sim.player.remainingWaypoints.length === 0);
    sim.decor.buy('plant');
    expect(sim.decor.place('plant', { x: 8, y: 8 })).toEqual(no('occupied'));
    const c = arriveAtCounter(sim);
    cafe(sim).takeOrder();
    runUntil(sim, () => c.target === null && c.fsm.is('WAITING'));
    expect(sim.decor.place('plant', c.actor.tile)).toEqual(no('overlap')); // they sit on a chair
  });

  it('blocking the door path is rejected', () => {
    const { sim } = cafeSim();
    rich(sim);
    buyPlace(sim, 'floor_lamp', { x: 5, y: 11 });
    buyPlace(sim, 'floor_lamp', { x: 7, y: 11 });
    sim.decor.buy('floor_lamp');
    // With (6,10) blocked too, nobody could get from the door to the queue.
    expect(sim.decor.place('floor_lamp', { x: 6, y: 10 })).toEqual(no('blocksPath'));
    expect(walkable(sim, 6, 10)).toBe(true);
    expect(sim.tx.count('furn_lamp')).toBe(1);
  });

  it('a seat must stay reachable, and so must the stations', () => {
    const { sim } = cafeSim();
    rich(sim);
    // Wall chair_8 (11,10) in: plant (12,11) and table (11,9) are already there.
    buyPlace(sim, 'floor_lamp', { x: 12, y: 10 });
    buyPlace(sim, 'floor_lamp', { x: 10, y: 11 });
    buyPlace(sim, 'floor_lamp', { x: 11, y: 11 });
    buyPlace(sim, 'floor_lamp', { x: 12, y: 9 });
    buyPlace(sim, 'floor_lamp', { x: 10, y: 9 });
    sim.decor.buy('floor_lamp');
    expect(sim.decor.place('floor_lamp', { x: 10, y: 10 })).toEqual(no('blocksPath'));
  });
});

describe('moving, rotating and storing', () => {
  it('moves a piece: old tiles free, new tiles blocked, same id', () => {
    const { sim } = cafeSim();
    expect(walkable(sim, 1, 11)).toBe(false);
    expect(sim.decor.move('plant_c1', { x: 7, y: 7 }, 0)).toEqual(ok);
    expect(walkable(sim, 1, 11)).toBe(true);
    expect(walkable(sim, 7, 7)).toBe(false);
    expect(sim.world.getObject('plant_c1')!.footprint).toMatchObject({ x: 7, y: 7 });
    expect(sim.decor.move('grinder', { x: 7, y: 8 }, 0)).toEqual(no('notFurniture'));
    expectGridMatchesObjects(sim);
  });

  it('rotation swaps a 2×1 footprint, and a piece may rotate in place', () => {
    const { sim } = cafeSim();
    rich(sim);
    const id = buyPlace(sim, 'cafe_table_long', { x: 7, y: 6 });
    expect(walkable(sim, 8, 6)).toBe(false);
    expect(sim.decor.move(id, { x: 7, y: 6 }, 1)).toEqual(ok);
    expect(sim.world.getObject(id)).toMatchObject({ rotation: 1, footprint: { x: 7, y: 6, w: 1, h: 2 } });
    expect(walkable(sim, 8, 6)).toBe(true);
    expect(walkable(sim, 7, 7)).toBe(false);
    expectGridMatchesObjects(sim);
  });

  it('stores a piece back into the inventory; seats follow (fewer spots)', () => {
    const { sim } = cafeSim();
    expect(cafe(sim).freeSpots()).toBe(12);
    expect(sim.decor.store('chair_8')).toEqual(ok);
    expect(sim.world.getObject('chair_8')).toBeUndefined();
    expect(sim.tx.count('furn_chair')).toBe(1);
    expect(cafe(sim).freeSpots()).toBe(11);
    expect(sim.decor.store('order_counter')).toEqual(no('notFurniture'));
  });

  it('a new chair is a real seat: customers are seated on it; then it can\'t be moved or stored', () => {
    const { sim } = cafeSim();
    rich(sim);
    for (let i = 1; i <= 8; i++) expect(sim.decor.store(`chair_${i}`)).toEqual(ok);
    expect(cafe(sim).freeSpots()).toBe(4); // standing spots only
    expect(sim.decor.place('chair', { x: 7, y: 7 })).toEqual(ok);
    const chair = sim.decor.layout().at(-1)!.id;
    expect(cafe(sim).freeSpots()).toBe(5);
    const c = arriveAtCounter(sim);
    expect(cafe(sim).takeOrder()).toEqual(ok);
    expect(c.spot?.objectId).toBe(chair);
    expect(runUntil(sim, () => c.target === null, 20_000)).toBe(true);
    expect(c.actor.tile).toEqual({ x: 7, y: 7 });
    expect(sim.decor.store(chair)).toEqual(no('seatInUse'));
    expect(sim.decor.move(chair, { x: 8, y: 8 }, 0)).toEqual(no('seatInUse'));
    expect(sim.decor.enter()).toEqual(ok);
    expect(sim.decor.pick(chair)).toEqual(no('seatInUse'));
  });
});

describe('navigation rebuild', () => {
  it('a customer walking to their seat re-plans around a piece placed on their path', () => {
    const { sim } = cafeSim();
    rich(sim);
    const c = arriveAtCounter(sim);
    cafe(sim).takeOrder(); // seat chair_1 at (9,5): straight along row 5
    expect(c.spot?.objectId).toBe('chair_1');
    sim.tick(16);
    buyPlace(sim, 'floor_lamp', { x: 7, y: 5 });
    let enteredBlocked = false;
    const ok = runUntil(sim, () => {
      if (!walkable(sim, c.actor.tile.x, c.actor.tile.y) && !(c.actor.tile.x === 9 && c.actor.tile.y === 5)) enteredBlocked = true;
      return c.target === null;
    }, 20_000);
    expect(ok).toBe(true);
    expect(enteredBlocked).toBe(false);
    expect(c.actor.tile).toEqual({ x: 9, y: 5 });
  });

  it('the player walking across the floor re-plans too', () => {
    const { sim } = cafeSim();
    rich(sim);
    sim.playerInteraction.moveTo({ x: 8, y: 10 });
    runUntil(sim, () => sim.player.state === 'IDLE' && sim.player.remainingWaypoints.length === 0);
    sim.playerInteraction.moveTo({ x: 8, y: 5 }); // straight up column 8
    sim.tick(16);
    buyPlace(sim, 'floor_lamp', { x: 8, y: 7 });
    let enteredBlocked = false;
    runUntil(sim, () => {
      if (!walkable(sim, sim.player.tile.x, sim.player.tile.y)) enteredBlocked = true;
      return sim.player.state === 'IDLE' && sim.player.remainingWaypoints.length === 0;
    });
    expect(enteredBlocked).toBe(false);
    expect(sim.player.tile).toEqual({ x: 8, y: 5 });
  });

  it('fuzz: 300 random buy/place/move/rotate/store operations keep the café consistent', () => {
    const { sim } = cafeSim({ seed: 5 });
    rich(sim);
    sim.tx.execute({ reason: 'test:grant', coins: 100_000 });
    const rng = new Rng(99);
    const int = (lo: number, hi: number) => lo + Math.floor(rng.next() * (hi - lo + 1));
    const types = Object.keys(catalog);
    const startCount = new Map<string, number>();
    for (const f of sim.decor.layout()) startCount.set(f.type, (startCount.get(f.type) ?? 0) + 1);
    const bought = new Map<string, number>();
    const spawn = sim.world.markers('spawn')[0]!;
    const done = new Map<string, number>();
    for (let i = 0; i < 300; i++) {
      const op = int(0, 3);
      const type = types[int(0, types.length - 1)]!;
      const at = { x: int(0, 13), y: int(3, 12) };
      const rot = int(0, 3);
      const placed = sim.decor.layout();
      const count = (r: { ok: boolean }, name: string) => r.ok && done.set(name, (done.get(name) ?? 0) + 1);
      if (op === 0) {
        const r = sim.decor.buy(type);
        count(r, 'buy');
        if (r.ok) bought.set(type, (bought.get(type) ?? 0) + 1);
      } else if (op === 1) count(sim.decor.place(type, at, rot), 'place');
      else if (op === 2 && placed.length) count(sim.decor.move(placed[int(0, placed.length - 1)]!.id, at, rot), 'move');
      else if (op === 3 && placed.length) count(sim.decor.store(placed[int(0, placed.length - 1)]!.id), 'store');
      sim.tick(50);
      // Conservation: every piece is either placed or in the bag.
      for (const t of types) {
        const onMap = sim.decor.layout().filter((f) => f.type === t).length;
        expect(onMap + sim.decor.owned(t)).toBe((startCount.get(t) ?? 0) + (bought.get(t) ?? 0));
      }
      // Markers and the player start stay reachable from the street.
      const reach = reachableSet(sim.world.grid, spawn);
      for (const m of Object.values(sim.map.markers ?? {}).flat()) expect(reach.has(tileKey(m))).toBe(true);
      expect(reach.has(tileKey(sim.player.tile))).toBe(true);
    }
    expectGridMatchesObjects(sim);
    expect(sim.state.decor.layouts.cafe).toEqual(sim.decor.layout());
    // The run must exercise every command, not just rejections.
    for (const name of ['buy', 'place', 'move', 'store']) expect(done.get(name) ?? 0, name).toBeGreaterThanOrEqual(10);
  });
});

describe('persistence', () => {
  function edited(): GameSimulation {
    const { sim } = cafeSim();
    rich(sim);
    sim.decor.move('plant_c1', { x: 7, y: 7 }, 0);
    sim.decor.store('chair_8');
    buyPlace(sim, 'cafe_table_long', { x: 7, y: 9 }, 1);
    return sim;
  }

  it('the layout survives save → load exactly, and the map\'s own furniture is not added back', () => {
    const a = edited();
    const storage = new MemoryStorage();
    const saves = new SaveService(storage);
    saves.save(a.captureState(), 1);
    const r = saves.load(2);
    expect(r.status).toBe('ok');
    const { sim: b } = cafeSim({ state: (r as { state: GameState }).state });
    expect(b.decor.layout()).toEqual(a.decor.layout());
    expect(b.world.getObject('chair_8')).toBeUndefined();
    expect(b.tx.count('furn_chair')).toBe(1);
    expect(walkable(b, 1, 11)).toBe(true);
    expect(walkable(b, 7, 7)).toBe(false);
    expect(walkable(b, 7, 10)).toBe(false);
    expect(cafe(b).freeSpots()).toBe(11);
    expectGridMatchesObjects(b);
    // New ids continue after the saved counter.
    b.decor.buy('plant');
    b.decor.place('plant', { x: 8, y: 5 });
    expect(new Set(b.decor.layout().map((f) => f.id)).size).toBe(b.decor.layout().length);
  });

  it('a saved piece that no longer fits goes back to the inventory instead of vanishing', () => {
    const a = edited();
    const state = structuredClone(a.captureState());
    state.decor.layouts.cafe!.push({ id: 'bad1', type: 'plant', x: 5, y: 4, rotation: 0 }, { id: 'bad2', type: 'plant', x: 9, y: 6, rotation: 0 }, { id: 'gone', type: 'statue_of_nothing', x: 8, y: 8, rotation: 0 });
    const plants = a.tx.count('furn_plant');
    const { sim: b } = cafeSim({ state });
    expect(b.world.getObject('bad1')).toBeUndefined();
    expect(b.world.getObject('bad2')).toBeUndefined();
    expect(b.world.getObject('gone')).toBeUndefined();
    expect(b.tx.count('furn_plant')).toBe(plants + 2);
    expect(b.state.decor.layouts.cafe).toEqual(b.decor.layout());
    expectGridMatchesObjects(b);
  });

  it('a v3 save (before furniture) loads with the starting café', () => {
    const { sim, clock } = cafeSim();
    const v3 = structuredClone(sim.captureState()) as unknown as Record<string, unknown>;
    delete v3.decor;
    v3.schemaVersion = 3;
    const storage = new MemoryStorage();
    storage.set('tcss.save.slot1', JSON.stringify(v3));
    const r = new SaveService(storage).load(clock.now());
    expect(r).toMatchObject({ status: 'ok', migratedFrom: 3 });
    const { sim: b } = cafeSim({ state: (r as { state: GameState }).state });
    expect(b.decor.layout()).toEqual(sim.decor.layout());
  });

  it('a corrupted layout entry makes the save invalid (backed up, not loaded)', () => {
    const { sim } = cafeSim();
    const s = structuredClone(sim.captureState()) as unknown as { decor: { layouts: Record<string, unknown> } };
    s.decor.layouts.cafe = [{ id: 'x', type: 'plant', x: 'left' }];
    const storage = new MemoryStorage();
    storage.set('tcss.save.slot1', JSON.stringify(s));
    expect(new SaveService(storage).load(5)).toMatchObject({ status: 'invalid', detail: expect.stringContaining('decor.layouts.cafe') });
  });
});

describe('decorate mode', () => {
  it('select → preview (red/green) → confirm; pick → rotate → move; Esc drops the selection, then exits', () => {
    const { sim } = cafeSim();
    rich(sim);
    sim.decor.buy('plant');
    expect(sim.decor.enter()).toEqual(ok);
    expect(sim.snapshot().decor!.active).toBe(true);
    expect(sim.decor.selectToPlace('chair')).toEqual(no('notOwned'));
    expect(sim.decor.selectToPlace('plant')).toEqual(ok);
    sim.decor.hover({ x: 5, y: 7 });
    expect(sim.snapshot().decor!.preview).toEqual({ footprint: { x: 5, y: 7, w: 1, h: 1 }, valid: false, reason: 'reservedTile' });
    sim.decor.hover({ x: 7, y: 7 });
    expect(sim.snapshot().decor!.preview).toMatchObject({ valid: true, reason: null });
    sim.clickTile({ x: 7, y: 7 });
    expect(sim.world.objectAt({ x: 7, y: 7 })?.type).toBe('plant');
    expect(sim.snapshot().decor!.selection).toBeNull();

    sim.clickObject('table_1');
    expect(sim.snapshot().decor!.selection).toEqual({ kind: 'move', type: 'cafe_table', objectId: 'table_1', rotation: 0 });
    expect(sim.decor.rotate()).toEqual(ok);
    expect(sim.snapshot().decor!.selection!.rotation).toBe(1);
    sim.clickTile({ x: 8, y: 9 });
    expect(sim.world.getObject('table_1')!.footprint).toMatchObject({ x: 8, y: 9 });

    sim.clickObject('grinder');
    expect(sim.snapshot().decor!.selection).toBeNull();
    sim.clickObject('plant_c2');
    expect(sim.decor.storeSelected()).toEqual(ok);
    expect(sim.tx.count('furn_plant')).toBe(1);

    sim.decor.selectToPlace('plant');
    sim.cancel(); // Esc / right click
    expect(sim.snapshot().decor).toMatchObject({ active: true, selection: null });
    sim.cancel();
    expect(sim.snapshot().decor!.active).toBe(false);
  });

  it('world clicks never move the player or serve customers while decorating', () => {
    const { sim } = cafeSim();
    sim.decor.enter();
    sim.clickTile({ x: 8, y: 8 });
    sim.clickObject('grinder');
    sim.tick(500);
    expect(sim.player.tile).toEqual(sim.map.playerStart);
    expect(sim.playerInteraction.snapshot().current).toBeNull();
  });

  it('entering needs a free player: a running interaction refuses, a plain walk is stopped', () => {
    const { sim } = cafeSim();
    const rejected: unknown[] = [];
    sim.bus.on('decor:rejected', (e) => rejected.push(e));
    sim.playerInteraction.request('supply_shelf');
    expect(sim.decor.enter()).toEqual(no('playerBusy'));
    expect(rejected).toEqual([{ reason: 'playerBusy', tile: null }]);
    sim.cancel();
    sim.playerInteraction.moveTo({ x: 10, y: 2 });
    sim.tick(50);
    expect(sim.decor.enter()).toEqual(ok);
    expect(sim.player.remainingWaypoints).toHaveLength(0);
    expect(sim.player.state).toBe('IDLE');
  });

  it('a failed confirm is reported with the reason and keeps the selection', () => {
    const { sim } = cafeSim();
    const rejected: unknown[] = [];
    sim.bus.on('decor:rejected', (e) => rejected.push(e));
    sim.decor.buy('plant');
    sim.decor.enter();
    sim.decor.selectToPlace('plant');
    sim.clickTile({ x: 6, y: 11 });
    expect(rejected).toEqual([{ reason: 'reservedTile', tile: { x: 6, y: 11 } }]);
    expect(sim.snapshot().decor!.selection).toMatchObject({ kind: 'place', type: 'plant' });
  });

  it('travel leaves decorate mode', () => {
    const { sim } = cafeSim();
    sim.decor.enter();
    sim.prepareTravel('farm');
    expect(sim.decor.isActive).toBe(false);
  });
});

describe('maps without a decor area', () => {
  it('the farm cannot be decorated and gets neutral bonuses', () => {
    const { sim } = farmSim();
    expect(sim.snapshot().decor).toBeNull();
    expect(sim.decor.enter()).toEqual(no('notDecoratable'));
    expect(sim.decor.place('plant', { x: 3, y: 3 })).toEqual(no('notDecoratable'));
    expect(sim.decor.bonuses()).toMatchObject({ patienceFactor: 1, trafficFactor: 1 });
  });
});

describe('furniture data', () => {
  it('the shipped catalog is valid', () => {
    expect(validateContent(CONTENT)).toEqual([]);
  });

  it('every refusal reason has a Vietnamese message', () => {
    const reasons: Record<DecorFailReason, true> = {
      notDecoratable: true, locked: true, notActive: true, playerBusy: true, unknownFurniture: true, notFurniture: true, notOwned: true,
      noSelection: true, invalidRotation: true, outOfArea: true, overlap: true, reservedTile: true, occupied: true, seatInUse: true,
      blocksPath: true, invalid: true, unknownItem: true, insufficientCoins: true, insufficientItems: true, capacityExceeded: true, duplicate: true,
    };
    const missing = Object.keys(reasons).filter((r) => !(`decor.fail.${r}` in vi));
    expect(missing).toEqual([]);
  });

  it('catches broken catalog entries', () => {
    const c = structuredClone(CONTENT) as GameContent;
    c.furniture.catalog.ghost = { itemId: 'furn_plant', price: 10, comfort: 0, decor: 0, unlockLevel: 1 };
    c.furniture.catalog.plant!.itemId = 'milk';
    c.furniture.catalog.chair!.unlockLevel = 0;
    c.objectTypes.floor_lamp!.blocking = false;
    const p = validateContent(c).join('\n');
    expect(p).toContain('furniture ghost: no object type');
    expect(p).toContain('furniture plant: item milk');
    expect(p).toContain('furniture chair: unlockLevel');
    expect(p).toContain('furniture floor_lamp: non-blocking furniture must be a seat');
  });
});

