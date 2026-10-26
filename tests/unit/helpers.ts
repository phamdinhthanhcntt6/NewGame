import { FakeClock } from '../../src/core/Clock';
import { CONTENT } from '../../src/data/content';
import { GameSimulation } from '../../src/gameplay/GameSimulation';
import type { GameState } from '../../src/gameplay/state/GameState';
import type { MapData, MapObjectData } from '../../src/gameplay/world/types';
import { NavGrid } from '../../src/systems/navigation/NavGrid';

export const TYPES = CONTENT.objectTypes;
export const CONFIG = CONTENT.gameplay;
export const SANDBOX = CONTENT.maps.sandbox!;
export const FARM = CONTENT.maps.farm!;

/** Grid from ASCII rows: '#' blocked, anything else walkable. */
export function gridFrom(rows: string[]): NavGrid {
  const g = new NavGrid(rows[0]!.length, rows.length);
  rows.forEach((r, y) => [...r].forEach((c, x) => c === '#' && g.setTerrainBlocked({ x, y }, true)));
  return g;
}

export function makeMap(rows: string[], objects: MapObjectData[], start = { x: 1, y: 1 }): MapData {
  return {
    id: 'test',
    name: 'test',
    legend: { '#': { kind: 'wall', walkable: false }, '.': { kind: 'floor', walkable: true } },
    terrain: rows,
    playerStart: start,
    objects,
  };
}

export function sandboxSim(): GameSimulation {
  return new GameSimulation(structuredClone(SANDBOX), CONTENT, { clock: new FakeClock() });
}

export function farmSim(opts: { state?: GameState; clock?: FakeClock } = {}): { sim: GameSimulation; clock: FakeClock } {
  const clock = opts.clock ?? new FakeClock();
  const sim = new GameSimulation(structuredClone(FARM), CONTENT, { clock, ...(opts.state ? { state: opts.state } : {}) });
  return { sim, clock };
}

/** Tick in 16 ms frames until predicate holds or the budget runs out. */
export function runUntil(sim: GameSimulation, pred: () => boolean, maxMs = 20_000, frame = 16): boolean {
  for (let t = 0; t < maxMs; t += frame) {
    if (pred()) return true;
    sim.tick(frame);
  }
  return pred();
}

export function collectEvents(sim: GameSimulation): Array<{ type: string; payload: unknown }> {
  const log: Array<{ type: string; payload: unknown }> = [];
  const types = [
    'actor:stateChanged',
    'actor:heldChanged',
    'move:started',
    'move:arrived',
    'move:unreachable',
    'interaction:queued',
    'interaction:started',
    'interaction:completed',
    'interaction:failed',
    'interaction:cancelled',
  ] as const;
  for (const t of types) sim.bus.on(t, (payload) => log.push({ type: t, payload }));
  return log;
}

export const CAFE = CONTENT.maps.cafe!;

/** Café simulation. The automatic spawner is off unless autoSpawn is set, so tests control who arrives. */
export function cafeSim(opts: { seed?: number; state?: GameState; autoSpawn?: boolean } = {}): { sim: GameSimulation; clock: FakeClock } {
  const clock = new FakeClock();
  const sim = new GameSimulation(structuredClone(CAFE), CONTENT, { clock, rngSeed: opts.seed ?? 1, ...(opts.state ? { state: opts.state } : {}) });
  if (sim.cafe) sim.cafe.open = opts.autoSpawn ?? false;
  return { sim, clock };
}
