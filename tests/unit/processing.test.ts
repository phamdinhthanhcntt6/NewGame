import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../src/data/content';
import type { GameSimulation } from '../../src/gameplay/GameSimulation';
import { MemoryStorage, SaveService } from '../../src/gameplay/state/SaveService';
import { farmSim, runUntil } from './helpers';

const RACK = 'drying_rack_1';

function use(sim: GameSimulation, id: string): void {
  sim.clickObject(id);
  const ok = runUntil(sim, () => {
    const s = sim.playerInteraction.snapshot();
    return !s.current && s.queue.length === 0 && !s.moveTarget && ['IDLE', 'CARRYING'].includes(sim.player.state);
  });
  if (!ok) throw new Error(`never finished using ${id}`);
}

function give(sim: GameSimulation, itemId: string, qty: number, quality = 55): void {
  const r = sim.tx.execute({ reason: 'test:give', items: [{ itemId, qty, quality }] });
  if (!r.ok) throw new Error(r.error);
}

function failures(sim: GameSimulation): Array<{ objectId: string; detail?: string }> {
  const out: Array<{ objectId: string; detail?: string }> = [];
  sim.bus.on('interaction:failed', (e) => out.push({ objectId: e.objectId, ...(e.detail ? { detail: e.detail } : {}) }));
  return out;
}

describe('processing equipment', () => {
  it('the farm has two drying racks and a roaster, idle at level 1', () => {
    const { sim } = farmSim();
    expect(sim.processing.allViews().map((e) => [e.id, e.status, e.level])).toEqual([
      ['drying_rack_1', 'idle', 1],
      ['drying_rack_2', 'idle', 1],
      ['roaster', 'idle', 1],
    ]);
  });

  it('loading without inputs is refused and changes nothing', () => {
    const { sim } = farmSim();
    const fails = failures(sim);
    use(sim, RACK);
    expect(fails.at(-1)).toEqual({ objectId: RACK, detail: 'noInputs' });
    expect(sim.processing.view(RACK)!.status).toBe('idle');
  });

  it('load consumes inputs immediately; outputs appear only when collected after the time', () => {
    const { sim, clock } = farmSim();
    const fails = failures(sim);
    give(sim, 'cherry_robusta', 12);
    use(sim, RACK);
    expect(sim.tx.count('cherry_robusta')).toBe(2);
    expect(sim.tx.count('green_robusta')).toBe(0);
    expect(sim.processing.view(RACK)!.status).toBe('working');

    use(sim, RACK); // not done yet
    expect(fails.at(-1)).toEqual({ objectId: RACK, detail: 'notDone' });

    clock.advance(90_000);
    expect(sim.processing.view(RACK)!.status).toBe('done');
    use(sim, RACK);
    expect(sim.tx.stack('green_robusta')).toEqual({ qty: 5, quality: 55 });
    expect(sim.tx.exp).toBe(3);
    expect(sim.processing.view(RACK)!.status).toBe('idle');
  });

  it('full chain: cherries → green → roasted, quality carried through (+roast delta)', () => {
    const { sim, clock } = farmSim();
    give(sim, 'cherry_arabica', 8, 70);
    use(sim, RACK);
    clock.advance(90_000);
    use(sim, RACK);
    expect(sim.tx.stack('green_arabica')).toEqual({ qty: 4, quality: 70 });
    use(sim, 'roaster');
    clock.advance(60_000);
    use(sim, 'roaster');
    expect(sim.tx.stack('roasted_arabica')).toEqual({ qty: 4, quality: 72 });
    expect(sim.tx.count('green_arabica')).toBe(0);
  });

  it('a busy machine cannot be loaded again (equipment availability)', () => {
    const { sim } = farmSim();
    give(sim, 'cherry_robusta', 30);
    expect(sim.processing.load(RACK).ok).toBe(true);
    expect(sim.processing.load(RACK)).toMatchObject({ ok: false, reason: 'busy' });
    expect(sim.tx.count('cherry_robusta')).toBe(20);
    // …but the second rack is available.
    expect(sim.processing.load('drying_rack_2').ok).toBe(true);
    expect(sim.tx.count('cherry_robusta')).toBe(10);
  });

  it('the selected recipe is used when possible, else the first runnable one', () => {
    const { sim } = farmSim();
    give(sim, 'cherry_robusta', 10);
    give(sim, 'cherry_arabica', 8);
    sim.processing.selectRecipe('drying_rack', 'dry_arabica');
    expect(sim.processing.nextRecipe(RACK)).toBe('dry_arabica');
    sim.processing.selectRecipe('drying_rack', 'dry_culi'); // no culi cherries
    expect(sim.processing.nextRecipe(RACK)).toBe('dry_robusta');
    expect(sim.processing.selectRecipe('drying_rack', 'roast_robusta')).toMatchObject({ ok: false, reason: 'unknownRecipe' });
  });

  it('a full bag blocks collection cleanly; the output waits in the machine', () => {
    const { sim, clock } = farmSim();
    const fails = failures(sim);
    give(sim, 'cherry_robusta', 10);
    use(sim, RACK);
    clock.advance(90_000);
    give(sim, 'seed_robusta', 298 - sim.tx.totalItems(), 50); // bag at 298/300, output is 5
    use(sim, RACK);
    expect(fails.at(-1)).toEqual({ objectId: RACK, detail: 'capacityExceeded' });
    expect(sim.processing.view(RACK)!.status).toBe('done');
    expect(sim.tx.count('green_robusta')).toBe(0);
  });

  it('collection is idempotent: forcing the job back after collecting pays nothing', () => {
    const { sim, clock } = farmSim();
    give(sim, 'cherry_robusta', 10);
    sim.processing.load(RACK);
    clock.advance(90_000);
    const job = structuredClone(sim.state.processing.equipment[RACK]!.job!);
    expect(sim.processing.collect(RACK).ok).toBe(true);
    sim.state.processing.equipment[RACK]!.job = job; // e.g. a stale save restored over a newer one
    expect(sim.processing.collect(RACK)).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(sim.tx.count('green_robusta')).toBe(5);
  });

  it('upgrades: only when idle, charged once, then bigger and faster batches', () => {
    const { sim, clock } = farmSim();
    sim.state.economy.coins = 5000;
    give(sim, 'cherry_robusta', 40);
    sim.processing.load(RACK);
    expect(sim.processing.upgrade(RACK)).toMatchObject({ ok: false, reason: 'busy' });
    clock.advance(90_000);
    sim.processing.collect(RACK);
    expect(sim.processing.upgrade(RACK).ok).toBe(true);
    expect(sim.tx.coins).toBe(4700);
    sim.processing.load(RACK);
    const job = sim.processing.view(RACK)!.job!;
    expect(job.inputQty).toBe(20);
    expect(job.outputQty).toBe(10);
    expect(job.durationMs).toBe(72_000);
    expect(job.outputQuality).toBe(58);
    clock.advance(72_000);
    sim.processing.collect(RACK);
    expect(sim.processing.upgrade(RACK).ok).toBe(true);
    expect(sim.processing.upgrade(RACK)).toMatchObject({ ok: false, reason: 'maxLevel' });
    expect(sim.tx.coins).toBe(4700 - 800);
  });

  it('jobs finish while the game is closed (wall-clock timestamps survive a save)', () => {
    const { sim, clock } = farmSim();
    give(sim, 'cherry_robusta', 10);
    sim.processing.load(RACK);
    const storage = new MemoryStorage();
    const saves = new SaveService(storage);
    saves.save(sim.captureState(), clock.now());
    clock.advance(5 * 60_000);
    const loaded = saves.load(clock.now());
    if (loaded.status !== 'ok') throw new Error(loaded.status);
    const resumed = farmSim({ state: loaded.state, clock }).sim;
    expect(resumed.processing.view(RACK)!.status).toBe('done');
    expect(resumed.processing.collect(RACK).ok).toBe(true);
    expect(resumed.tx.count('green_robusta')).toBe(5);
  });
});

describe('conservation: no resources appear from nowhere', () => {
  it('after 300 random loads/collects/upgrades/time jumps, an independent ledger balances exactly', () => {
    const { sim, clock } = farmSim();
    sim.state.economy.coins = 100_000;
    // Independent ledger of every committed transaction (history in state is bounded; this is not).
    const ledger: Array<{ reason: string; items: Array<{ itemId: string; qty: number }> }> = [];
    sim.bus.on('economy:transaction', (r) => ledger.push({ reason: r.reason, items: r.items.map((d) => ({ itemId: d.itemId, qty: d.qty })) }));
    const start = structuredClone(sim.state.economy.inventory);
    give(sim, 'cherry_robusta', 100);
    give(sim, 'cherry_arabica', 80, 70);
    let seed = 99;
    const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    const machines = ['drying_rack_1', 'drying_rack_2', 'roaster'];
    for (let i = 0; i < 300; i++) {
      const m = machines[Math.floor(rnd() * machines.length)]!;
      const r = rnd();
      if (r < 0.4) sim.processing.load(m);
      else if (r < 0.8) sim.processing.collect(m);
      else if (r < 0.85) sim.processing.upgrade(m);
      else clock.advance(Math.floor(rnd() * 120_000));
    }
    // 1) Inventory == starting inventory + every ledger delta (nothing changed items outside transactions).
    const items = new Set([...Object.keys(start), ...ledger.flatMap((l) => l.items.map((d) => d.itemId))]);
    for (const id of items) {
      const expected = (start[id]?.qty ?? 0) + ledger.reduce((n, l) => n + l.items.filter((d) => d.itemId === id).reduce((a, d) => a + d.qty, 0), 0);
      expect(sim.tx.count(id)).toBe(expected);
    }
    // 2) Per recipe: inputs consumed → outputs (collected + still pending in machines), at the recipe ratio.
    let activity = 0;
    for (const [rid, r] of Object.entries(CONTENT.processing.recipes)) {
      const consumed = 0 - ledger.filter((l) => l.reason === `process:load:${rid}`).flatMap((l) => l.items).reduce((n, d) => n + d.qty, 0);
      const collected = ledger.filter((l) => l.reason === `process:collect:${rid}`).flatMap((l) => l.items).reduce((n, d) => n + d.qty, 0);
      const pending = sim.processing.allViews().reduce((n, e) => n + (e.job?.recipeId === rid ? e.job.outputQty : 0), 0);
      expect(consumed % r.input.qty).toBe(0);
      expect(collected + pending).toBe((consumed / r.input.qty) * r.output.qty);
      activity += consumed;
    }
    expect(activity).toBeGreaterThan(50); // the fuzz actually exercised the machines
  });
});
