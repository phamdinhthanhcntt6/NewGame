import gameplay from '../../src/data/config/gameplay.json';
import objectTypes from '../../src/data/config/objectTypes.json';
import sandbox from '../../src/data/maps/sandbox.json';
import { GameSimulation, type GameplayConfig } from '../../src/gameplay/GameSimulation';
import type { MapData, MapObjectData, ObjectTypeTable } from '../../src/gameplay/world/types';
import { NavGrid } from '../../src/systems/navigation/NavGrid';

export const TYPES = objectTypes as ObjectTypeTable;
export const CONFIG = gameplay as GameplayConfig;
export const SANDBOX = sandbox as MapData;

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
  return new GameSimulation(structuredClone(SANDBOX), TYPES, CONFIG);
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
