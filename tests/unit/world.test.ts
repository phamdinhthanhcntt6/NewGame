import { describe, expect, it } from 'vitest';
import { WorldModel, validateMap, rotateSide } from '../../src/gameplay/world/WorldModel';
import { NavigationService } from '../../src/systems/navigation/NavigationService';
import { SANDBOX, TYPES, makeMap } from './helpers';

const ROOM = ['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#######'];

describe('map validation', () => {
  it('accepts the sandbox map', () => {
    expect(validateMap(SANDBOX, TYPES)).toEqual([]);
  });

  it('reports unknown types, overlaps, bounds, duplicate ids and ragged rows', () => {
    const map = makeMap(['#####', '#...#', '#..#'], [
      { id: 'a', type: 'crate', x: 1, y: 1 },
      { id: 'a', type: 'crate', x: 1, y: 1 },
      { id: 'b', type: 'nope', x: 2, y: 1 },
      { id: 'c', type: 'table_2', x: 4, y: 1 },
    ]);
    const problems = validateMap(map, TYPES).join('\n');
    expect(problems).toMatch(/row 2 has length/);
    expect(problems).toMatch(/duplicate object id "a"/);
    expect(problems).toMatch(/overlaps/);
    expect(problems).toMatch(/unknown type "nope"/);
    expect(problems).toMatch(/"c" is out of bounds/);
  });

  it('throws on construction when the start tile is blocked', () => {
    expect(() => new WorldModel(makeMap(ROOM, [{ id: 'c', type: 'crate', x: 1, y: 1 }]), TYPES)).toThrow(/playerStart/);
  });
});

describe('world objects & collision', () => {
  it('blocking objects make their footprint unwalkable; removal restores it', () => {
    const w = new WorldModel(makeMap(ROOM, [{ id: 't', type: 'table_2', x: 2, y: 2 }], { x: 1, y: 1 }), TYPES);
    expect(w.grid.isWalkable({ x: 2, y: 2 })).toBe(false);
    expect(w.grid.isWalkable({ x: 3, y: 2 })).toBe(false);
    expect(w.objectAt({ x: 3, y: 2 })?.id).toBe('t');
    w.removeObject('t');
    expect(w.grid.isWalkable({ x: 2, y: 2 })).toBe(true);
  });

  it('rotation swaps the footprint and rotates approach sides', () => {
    expect(rotateSide('E', 1)).toBe('S');
    const w = new WorldModel(makeMap(ROOM, [{ id: 's', type: 'shelf', x: 2, y: 2, rotation: 1 }], { x: 1, y: 1 }), TYPES);
    const s = w.getObject('s')!;
    expect(s.footprint).toEqual({ x: 2, y: 2, w: 2, h: 1 });
    expect(s.sides).toEqual(['S']);
  });
});

describe('approach tiles', () => {
  it('respects interaction sides (machine is reachable from the south only)', () => {
    const w = new WorldModel(structuredClone(SANDBOX), TYPES);
    const nav = new NavigationService(w.grid, 0.25);
    const m = w.getObject('machine')!;
    expect(nav.approachTiles({ footprint: m.footprint, radius: 1, sides: m.sides })).toEqual([{ x: 8, y: 4 }]);
  });

  it('chooses a reachable approach tile when the nearest one is cut off', () => {
    // Crate at (4,2). Its west neighbour (3,2) is walkable and nearest to the start,
    // but sealed off: walls N/S/W and diagonal exits would cut corners.
    const rows = ['#######', '#.##..#', '#.#...#', '#.##..#', '#.....#', '#######'];
    const map = makeMap(rows, [{ id: 'c', type: 'crate', x: 4, y: 2 }], { x: 1, y: 1 });
    const w = new WorldModel(map, TYPES);
    const nav = new NavigationService(w.grid, 0.25);
    const crate = w.getObject('c')!;
    const spec = { footprint: crate.footprint, radius: 1 };
    expect(nav.approachTiles(spec)).toContainEqual({ x: 3, y: 2 });
    const plan = nav.planToApproach({ x: 1.5, y: 1.5 }, spec)!;
    expect(plan).not.toBeNull();
    expect(plan.goal).not.toEqual({ x: 3, y: 2 });
    expect(Math.max(Math.abs(plan.goal.x - 4), Math.abs(plan.goal.y - 2))).toBe(1);
  });

  it('a click on a blocked tile resolves to the nearest reachable tile', () => {
    const w = new WorldModel(structuredClone(SANDBOX), TYPES);
    const nav = new NavigationService(w.grid, 0.25);
    const plan = nav.planToTileOrNearest({ x: 2.5, y: 9.5 }, { x: 7, y: 6 }, 4)!; // plant
    expect(w.grid.isWalkable(plan.goal)).toBe(true);
    expect(Math.hypot(plan.goal.x - 7, plan.goal.y - 6)).toBe(1);
  });
});
