import { describe, expect, it } from 'vitest';
import { hasClearance } from '../../src/systems/navigation/smoothing';
import { CONFIG, collectEvents, runUntil, sandboxSim } from './helpers';

const counters = (sim: ReturnType<typeof sandboxSim>, id: string) => sim.world.getObject(id)!.counters;

describe('player movement (click-to-move)', () => {
  it('walks to a clicked floor tile and stops on it, never overlapping blocked tiles', () => {
    const sim = sandboxSim();
    const grid = sim.world.grid;
    sim.clickTile({ x: 13, y: 6 });
    expect(sim.player.state).toBe('MOVING');
    let prev = { ...sim.player.pos };
    const arrived = runUntil(sim, () => {
      // body corners must stay on walkable tiles every frame
      expect(hasClearance(grid, prev, sim.player.pos, CONFIG.player.bodyRadius)).toBe(true);
      prev = { ...sim.player.pos };
      return sim.player.state === 'IDLE';
    });
    expect(arrived).toBe(true);
    expect(sim.player.tile).toEqual({ x: 13, y: 6 });
    expect(sim.player.pos).toEqual({ x: 13.5, y: 6.5 });
  });

  it('a click on a non-interactive obstacle walks to the nearest reachable tile', () => {
    const sim = sandboxSim();
    sim.clickTile({ x: 7, y: 6 }); // plant
    runUntil(sim, () => sim.player.state === 'IDLE' && sim.player.remainingWaypoints.length === 0);
    const t = sim.player.tile;
    expect(sim.world.grid.isWalkable(t)).toBe(true);
    expect(Math.hypot(t.x - 7, t.y - 6)).toBe(1);
  });

  it('re-targets smoothly when clicked again mid-walk', () => {
    const sim = sandboxSim();
    sim.clickTile({ x: 13, y: 6 });
    sim.tick(400);
    sim.clickTile({ x: 2, y: 2 });
    expect(sim.player.state).toBe('MOVING');
    runUntil(sim, () => sim.player.state === 'IDLE');
    expect(sim.player.tile).toEqual({ x: 2, y: 2 });
  });
});

describe('object interactions', () => {
  it('walks to the only valid side of the machine, works, then carries the cup', () => {
    const sim = sandboxSim();
    const ev = collectEvents(sim);
    sim.clickTile({ x: 8, y: 3 });
    runUntil(sim, () => sim.player.state === 'WORKING');
    expect(sim.player.tile).toEqual({ x: 8, y: 4 });
    expect(sim.player.facing).toBe('N');
    runUntil(sim, () => sim.player.state === 'CARRYING');
    expect(sim.player.heldItem).toBe('test_cup');
    const states = ev.filter((e) => e.type === 'actor:stateChanged').map((e) => (e.payload as { to: string }).to);
    expect(states).toEqual(['MOVING', 'INTERACTING', 'WORKING', 'CARRYING']);
  });

  it('runs queued interactions in order (brew → place on table)', () => {
    const sim = sandboxSim();
    sim.clickTile({ x: 8, y: 3 }); // machine
    sim.clickTile({ x: 3, y: 7 }); // table_a (queued)
    expect(sim.playerInteraction.snapshot().queue).toHaveLength(1);
    runUntil(sim, () => counters(sim, 'table_a').cupsPlaced === 1);
    runUntil(sim, () => sim.player.state === 'IDLE');
    expect(sim.player.heldItem).toBeNull();
    expect(counters(sim, 'table_a').cupsPlaced).toBe(1);
  });

  it('fails cleanly when requirements are not met (empty hands at the table)', () => {
    const sim = sandboxSim();
    const ev = collectEvents(sim);
    sim.clickTile({ x: 3, y: 7 });
    runUntil(sim, () => ev.some((e) => e.type === 'interaction:failed'));
    const fail = ev.find((e) => e.type === 'interaction:failed')!.payload as { reason: string; detail: string };
    expect(fail).toMatchObject({ reason: 'requirementsNotMet', detail: 'needsItem' });
    expect(sim.player.state).toBe('IDLE');
    expect(counters(sim, 'table_a').cupsPlaced).toBeUndefined();
  });

  it('an enclosed object is unreachable: player does not move and stays IDLE', () => {
    const sim = sandboxSim();
    const ev = collectEvents(sim);
    const start = { ...sim.player.pos };
    sim.clickTile({ x: 13, y: 9 }); // fenced statue
    sim.tick(1000);
    expect(ev.find((e) => e.type === 'interaction:failed')?.payload).toMatchObject({ reason: 'unreachable', objectId: 'statue' });
    expect(sim.player.pos).toEqual(start);
    expect(sim.player.state).toBe('IDLE');
  });

  it('interacts immediately without moving when already in reach', () => {
    const sim = sandboxSim();
    sim.clickTile({ x: 13, y: 5 });
    runUntil(sim, () => sim.player.state === 'IDLE');
    const before = { ...sim.player.pos };
    sim.clickTile({ x: 14, y: 5 }); // sign, adjacent
    expect(sim.player.state).toBe('INTERACTING');
    runUntil(sim, () => sim.player.state === 'IDLE');
    expect(sim.player.pos).toEqual(before);
    expect(counters(sim, 'sign').inspected).toBe(1);
  });
});

describe('cancellation & duplication guards', () => {
  it('cancel during WORKING yields nothing and reports progress', () => {
    const sim = sandboxSim();
    const ev = collectEvents(sim);
    sim.clickTile({ x: 8, y: 3 });
    runUntil(sim, () => sim.player.state === 'WORKING');
    sim.tick(500);
    sim.cancel();
    expect(sim.player.state).toBe('IDLE');
    expect(sim.player.heldItem).toBeNull();
    const c = ev.find((e) => e.type === 'interaction:cancelled')!.payload as { progress: number; reason: string };
    expect(c.reason).toBe('playerCancelled');
    expect(c.progress).toBeGreaterThan(0.2);
    expect(c.progress).toBeLessThan(0.6);
    sim.tick(5000);
    expect(sim.player.heldItem).toBeNull();
    expect(ev.some((e) => e.type === 'interaction:completed')).toBe(false);
  });

  it('a floor click cancels the current action and the queue, then walks', () => {
    const sim = sandboxSim();
    sim.clickTile({ x: 8, y: 3 });
    sim.clickTile({ x: 13, y: 2 });
    runUntil(sim, () => sim.player.state === 'WORKING');
    sim.clickTile({ x: 2, y: 9 });
    expect(sim.player.state).toBe('MOVING');
    expect(sim.playerInteraction.snapshot().queue).toHaveLength(0);
    runUntil(sim, () => sim.player.state === 'IDLE');
    expect(sim.player.heldItem).toBeNull();
    expect(sim.player.tile).toEqual({ x: 2, y: 9 });
  });

  it('double-clicking the same object queues it once and completes once', () => {
    const sim = sandboxSim();
    const ev = collectEvents(sim);
    for (let i = 0; i < 5; i++) sim.clickTile({ x: 8, y: 3 });
    runUntil(sim, () => sim.player.state === 'CARRYING');
    sim.tick(10_000);
    expect(ev.filter((e) => e.type === 'interaction:completed')).toHaveLength(1);
    expect(ev.filter((e) => e.type === 'interaction:queued')).toHaveLength(0);
  });

  it('a huge frame (tab switched away) still completes an action exactly once', () => {
    const sim = sandboxSim();
    const ev = collectEvents(sim);
    sim.clickTile({ x: 8, y: 3 });
    sim.clickTile({ x: 3, y: 7 });
    sim.tick(60_000);
    expect(ev.filter((e) => e.type === 'interaction:completed')).toHaveLength(2);
    expect(counters(sim, 'table_a').cupsPlaced).toBe(1);
  });

  it('a listener that re-enters tick() during completion cannot complete an action twice', () => {
    const sim = sandboxSim();
    const ev = collectEvents(sim);
    let reentered = 0;
    sim.bus.on('actor:heldChanged', () => {
      reentered++;
      sim.tick(16);
    });
    sim.clickTile({ x: 8, y: 3 });
    runUntil(sim, () => sim.player.state === 'CARRYING');
    sim.tick(1000);
    expect(reentered).toBe(1);
    expect(ev.filter((e) => e.type === 'interaction:completed')).toHaveLength(1);
    expect(ev.filter((e) => e.type === 'interaction:failed')).toHaveLength(0);
    expect(sim.player.heldItem).toBe('test_cup');
  });

  it('rejects interactions beyond the queue limit', () => {
    const sim = sandboxSim();
    const ev = collectEvents(sim);
    const targets = [
      { x: 8, y: 3 },
      { x: 3, y: 7 },
      { x: 13, y: 2 },
      { x: 1, y: 5 },
      { x: 14, y: 5 },
      { x: 10, y: 7 },
    ];
    for (const t of targets) sim.clickTile(t);
    expect(sim.playerInteraction.snapshot().queue).toHaveLength(CONFIG.player.maxQueuedInteractions);
    expect(ev.filter((e) => e.type === 'interaction:failed').map((e) => (e.payload as { reason: string }).reason)).toEqual(['queueFull']);
  });

  it('removing the target object mid-approach cancels it and moves on', () => {
    const sim = sandboxSim();
    const ev = collectEvents(sim);
    sim.clickTile({ x: 13, y: 2 }); // crate
    sim.clickTile({ x: 14, y: 5 }); // sign
    sim.tick(200);
    sim.world.removeObject('crate');
    sim.playerInteraction.onObjectRemoved('crate');
    runUntil(sim, () => (sim.world.getObject('sign')!.counters.inspected ?? 0) === 1);
    expect(ev.find((e) => e.type === 'interaction:cancelled')?.payload).toMatchObject({ objectId: 'crate', reason: 'objectRemoved' });
  });
});

describe('robustness fuzz', () => {
  it('500 random clicks/cancels never throw, never leave walkable space, and the player is never stuck', () => {
    const sim = sandboxSim();
    let seed = 1234;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 500; i++) {
      const r = rnd();
      if (r < 0.05) sim.cancel();
      else sim.clickTile({ x: Math.floor(rnd() * 16), y: Math.floor(rnd() * 12) });
      const steps = Math.floor(rnd() * 25);
      for (let s = 0; s < steps; s++) {
        sim.tick(16);
        // the whole body (not just its centre) must stay in walkable space
        expect(hasClearance(sim.world.grid, sim.player.pos, sim.player.pos, CONFIG.player.bodyRadius)).toBe(true);
      }
    }
    // Afterwards the player must still be able to reach a known tile.
    sim.cancel();
    sim.clickTile({ x: 2, y: 2 });
    expect(runUntil(sim, () => sim.player.tile.x === 2 && sim.player.tile.y === 2 && !['MOVING'].includes(sim.player.state))).toBe(true);
  });
});
