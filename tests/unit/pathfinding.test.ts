import { describe, expect, it } from 'vitest';
import { findPath } from '../../src/systems/navigation/astar';
import { hasClearance, smoothPath } from '../../src/systems/navigation/smoothing';
import { gridFrom } from './helpers';

const OPEN = ['.....', '.....', '.....', '.....', '.....'];

describe('A* pathfinding', () => {
  it('finds the shortest octile path on an open grid', () => {
    const res = findPath(gridFrom(OPEN), { x: 0, y: 0 }, [{ x: 4, y: 2 }])!;
    expect(res).not.toBeNull();
    expect(res.cost).toBeCloseTo(2 + 2 * Math.SQRT2, 9);
    expect(res.tiles[0]).toEqual({ x: 0, y: 0 });
    expect(res.tiles.at(-1)).toEqual({ x: 4, y: 2 });
  });

  it('routes around a wall', () => {
    const g = gridFrom(['.....', '.###.', '.#...', '.#.#.', '...#.']);
    const res = findPath(g, { x: 2, y: 2 }, [{ x: 0, y: 0 }])!;
    expect(res).not.toBeNull();
    for (const t of res.tiles) expect(g.isWalkable(t)).toBe(true);
  });

  it('returns null for unreachable or blocked goals', () => {
    const g = gridFrom(['..#..', '..#..', '..#..']);
    expect(findPath(g, { x: 0, y: 0 }, [{ x: 4, y: 0 }])).toBeNull();
    expect(findPath(g, { x: 0, y: 0 }, [{ x: 2, y: 1 }])).toBeNull();
    expect(findPath(g, { x: 0, y: 0 }, [])).toBeNull();
  });

  it('never cuts corners diagonally', () => {
    // Moving from (0,1) to (1,0) diagonally would squeeze between two blocked corners.
    const g = gridFrom(['#.', '.#']);
    expect(findPath(g, { x: 0, y: 1 }, [{ x: 1, y: 0 }])).toBeNull();
    const g2 = gridFrom(['..', '.#']);
    const res = findPath(g2, { x: 0, y: 1 }, [{ x: 1, y: 0 }])!;
    expect(res.tiles).toEqual([{ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }]);
  });

  it('picks the closest of several goals', () => {
    const res = findPath(gridFrom(OPEN), { x: 0, y: 0 }, [{ x: 4, y: 4 }, { x: 0, y: 3 }])!;
    expect(res.goal).toEqual({ x: 0, y: 3 });
  });

  it('is deterministic', () => {
    const a = findPath(gridFrom(OPEN), { x: 0, y: 0 }, [{ x: 4, y: 4 }]);
    const b = findPath(gridFrom(OPEN), { x: 0, y: 0 }, [{ x: 4, y: 4 }]);
    expect(a).toEqual(b);
  });

  it('solves a 40×40 maze-ish grid in under 2 ms (median of 100)', () => {
    // Serpentine: wall columns every 6 tiles with a single gap alternating top/bottom.
    const rows = Array.from({ length: 40 }, (_, y) =>
      Array.from({ length: 40 }, (_, x) => {
        if (x % 6 !== 3 || x > 36) return '.';
        const gapY = x % 12 === 3 ? 38 : 1;
        return y === gapY ? '.' : '#';
      }).join(''),
    );
    const g = gridFrom(rows);
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      expect(findPath(g, { x: 0, y: 0 }, [{ x: 39, y: 39 }])).not.toBeNull();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[50]!).toBeLessThan(2);
  });
});

describe('path smoothing', () => {
  it('collapses a straight corridor to start + goal', () => {
    const g = gridFrom(OPEN);
    const res = findPath(g, { x: 0, y: 2 }, [{ x: 4, y: 2 }])!;
    expect(smoothPath(g, res.tiles, 0.25)).toHaveLength(2);
  });

  it('never produces a segment that clips a blocked tile', () => {
    const g = gridFrom(['.......', '.#####.', '.#...#.', '.#.#.#.', '...#...']);
    const res = findPath(g, { x: 2, y: 2 }, [{ x: 6, y: 0 }])!;
    const pts = smoothPath(g, res.tiles, 0.25);
    for (let i = 1; i < pts.length; i++) expect(hasClearance(g, pts[i - 1]!, pts[i]!, 0.25)).toBe(true);
    expect(pts.at(-1)).toEqual({ x: 6.5, y: 0.5 });
  });
});
