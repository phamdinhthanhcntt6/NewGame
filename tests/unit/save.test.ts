import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/core/Clock';
import { MemoryStorage, SaveService } from '../../src/gameplay/state/SaveService';
import type { GameSimulation } from '../../src/gameplay/GameSimulation';
import { farmSim, runUntil } from './helpers';

const P = 'plot_r0_c0';

function use(sim: GameSimulation, id: string): void {
  sim.clickObject(id);
  runUntil(sim, () => {
    const s = sim.playerInteraction.snapshot();
    return !s.current && s.queue.length === 0 && !s.moveTarget && ['IDLE', 'CARRYING'].includes(sim.player.state);
  });
}

function reload(sim: GameSimulation, storage: MemoryStorage, clock: FakeClock): GameSimulation {
  const saves = new SaveService(storage);
  saves.save(sim.captureState(), clock.now());
  const loaded = saves.load(clock.now());
  if (loaded.status !== 'ok') throw new Error(`load failed: ${loaded.status}`);
  return farmSim({ state: loaded.state, clock }).sim;
}

describe('save / load', () => {
  it('round-trips economy, farm and player position exactly', () => {
    const { sim, clock } = farmSim();
    const storage = new MemoryStorage();
    use(sim, P);
    use(sim, P);
    use(sim, P);
    const before = sim.snapshot();
    const again = reload(sim, storage, clock);
    const after = again.snapshot();
    expect(after.economy).toEqual(before.economy);
    expect(after.farm.plots).toEqual(before.farm.plots);
    expect(after.player.tile).toEqual(before.player.tile);
  });

  it('crops keep growing while the game is closed (timestamps restored)', () => {
    const { sim, clock } = farmSim();
    const storage = new MemoryStorage();
    use(sim, P);
    use(sim, P);
    use(sim, P); // watered once: 60 s of growth unlocked
    const saves = new SaveService(storage);
    saves.save(sim.captureState(), clock.now());

    clock.advance(10 * 60_000); // closed for 10 minutes
    const loaded = saves.load(clock.now());
    if (loaded.status !== 'ok') throw new Error(loaded.status);
    const resumed = farmSim({ state: loaded.state, clock }).sim;
    const p = resumed.farm.plotView(P)!;
    expect(p.growthMs).toBe(60_000); // grew through the watered segment only
    expect(p.needsWater).toBe(true);
    expect(p.dryMs).toBeGreaterThan(8 * 60_000);
  });

  it('reloading cannot duplicate a harvest', () => {
    const { sim, clock } = farmSim();
    const storage = new MemoryStorage();
    use(sim, P);
    use(sim, P);
    use(sim, P);
    clock.advance(60_000);
    sim.tick(16);
    use(sim, P);
    clock.advance(60_000);
    sim.tick(16);
    use(sim, P);
    expect(sim.tx.count('cherry_robusta')).toBe(10);
    const again = reload(sim, storage, clock);
    expect(again.farm.harvest(P).ok).toBe(false);
    // Even forcing the plot back to READY cannot re-pay the same crop (idempotency key).
    again.state.farm.plots[P]!.phase = 'READY';
    expect(again.farm.harvest(P)).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(again.tx.count('cherry_robusta')).toBe(10);
  });

  it('saving mid-action keeps nothing half-done: the action simply did not happen', () => {
    const { sim, clock } = farmSim();
    const storage = new MemoryStorage();
    sim.clickObject(P);
    runUntil(sim, () => sim.player.state === 'WORKING');
    const again = reload(sim, storage, clock);
    expect(again.farm.plot(P)!.phase).toBe('EMPTY');
    expect(again.player.state).toBe('IDLE');
  });

  it('corrupt JSON is backed up and reported, never parsed into the game', () => {
    const storage = new MemoryStorage();
    storage.set('tcss.save.slot1', '{"schemaVersion":1, "economy": {');
    const r = new SaveService(storage).load(123);
    expect(r.status).toBe('corrupt');
    if (r.status !== 'corrupt') return;
    expect(storage.get(r.backupKey!)).toBe('{"schemaVersion":1, "economy": {');
  });

  it('structurally invalid saves (negative coins, bad plots) are rejected', () => {
    const { sim, clock } = farmSim();
    const storage = new MemoryStorage();
    const saves = new SaveService(storage);
    const state = structuredClone(sim.captureState());
    state.economy.coins = -5;
    storage.set(saves.key, JSON.stringify(state));
    expect(saves.load(clock.now())).toMatchObject({ status: 'invalid' });
    const state2 = structuredClone(sim.captureState());
    (state2.farm.plots[P] as unknown as Record<string, unknown>).growthMs = 'lots';
    storage.set(saves.key, JSON.stringify(state2));
    expect(saves.load(clock.now())).toMatchObject({ status: 'invalid', detail: expect.stringContaining(`farm.plots.${P}`) });
  });

  it('a save from a newer version is refused and left untouched', () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify({ schemaVersion: 99 });
    storage.set('tcss.save.slot1', raw);
    expect(new SaveService(storage).load(1)).toMatchObject({ status: 'unsupported' });
    expect(storage.get('tcss.save.slot1')).toBe(raw);
  });

  it('runs registered migrations in order up to the current version', () => {
    const { sim, clock } = farmSim();
    const storage = new MemoryStorage();
    const v1 = structuredClone(sim.captureState());
    storage.set('tcss.save.slot1', JSON.stringify(v1));
    const saves = new SaveService(storage, 'tcss.save.slot1', { 1: (raw) => ({ ...raw, migratedNote: 'v2' }) }, 2);
    const r = saves.load(clock.now());
    expect(r).toMatchObject({ status: 'ok', migratedFrom: 1 });
    if (r.status === 'ok') {
      expect(r.state.schemaVersion).toBe(2);
      expect((r.state as unknown as Record<string, unknown>).migratedNote).toBe('v2');
    }
  });
});
