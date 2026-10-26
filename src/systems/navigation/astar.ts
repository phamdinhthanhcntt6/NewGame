import { tileKey, type TilePos } from '../../utils/tile';
import type { NavGrid } from './NavGrid';

const SQRT2 = Math.SQRT2;

// Fixed neighbour order → deterministic results for equal-cost paths.
const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [0, -1, 1],
  [1, 0, 1],
  [0, 1, 1],
  [-1, 0, 1],
  [1, -1, SQRT2],
  [1, 1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

const octile = (a: TilePos, b: TilePos): number => {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
};

export interface PathResult {
  /** Tiles from start (inclusive) to the reached goal (inclusive). */
  tiles: TilePos[];
  goal: TilePos;
  cost: number;
}

/** Binary min-heap keyed by f, ties broken by insertion order (deterministic). */
class OpenSet {
  private heap: Array<{ i: number; f: number; seq: number }> = [];
  private seq = 0;
  get size(): number {
    return this.heap.length;
  }
  push(i: number, f: number): void {
    const node = { i, f, seq: this.seq++ };
    const h = this.heap;
    h.push(node);
    let c = h.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.less(h[c]!, h[p]!)) {
        [h[c], h[p]] = [h[p]!, h[c]!];
        c = p;
      } else break;
    }
  }
  pop(): number {
    const h = this.heap;
    const top = h[0]!;
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1;
        const r = l + 1;
        let m = p;
        if (l < h.length && this.less(h[l]!, h[m]!)) m = l;
        if (r < h.length && this.less(h[r]!, h[m]!)) m = r;
        if (m === p) break;
        [h[m], h[p]] = [h[p]!, h[m]!];
        p = m;
      }
    }
    return top.i;
  }
  private less(a: { f: number; seq: number }, b: { f: number; seq: number }): boolean {
    return a.f < b.f || (a.f === b.f && a.seq < b.seq);
  }
}

/**
 * 8-directional A* towards the nearest of several goal tiles.
 * Diagonal moves are only allowed when both adjacent orthogonal tiles are
 * walkable (no corner cutting through furniture or wall corners).
 * Returns null if no goal is reachable.
 */
export function findPath(grid: NavGrid, start: TilePos, goals: readonly TilePos[]): PathResult | null {
  const goalSet = new Set(goals.filter((g) => grid.isWalkable(g)).map(tileKey));
  if (goalSet.size === 0 || !grid.inBounds(start)) return null;
  const goalList = goals.filter((g) => goalSet.has(tileKey(g)));
  if (goalSet.has(tileKey(start))) return { tiles: [{ ...start }], goal: { ...start }, cost: 0 };

  const w = grid.width;
  const n = w * grid.height;
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const h = (x: number, y: number): number => {
    let best = Infinity;
    for (const goal of goalList) best = Math.min(best, octile({ x, y }, goal));
    return best;
  };

  const startIdx = start.y * w + start.x;
  g[startIdx] = 0;
  const open = new OpenSet();
  open.push(startIdx, h(start.x, start.y));

  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    if (goalSet.has(`${cx},${cy}`)) {
      const tiles: TilePos[] = [];
      for (let i = cur; i !== -1; i = parent[i]!) tiles.push({ x: i % w, y: Math.floor(i / w) });
      tiles.reverse();
      return { tiles, goal: { x: cx, y: cy }, cost: g[cur]! };
    }
    for (const [dx, dy, step] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!grid.isWalkable({ x: nx, y: ny })) continue;
      if (dx !== 0 && dy !== 0) {
        if (!grid.isWalkable({ x: cx + dx, y: cy }) || !grid.isWalkable({ x: cx, y: cy + dy })) continue;
      }
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      const ng = g[cur]! + step;
      if (ng < g[ni]!) {
        g[ni] = ng;
        parent[ni] = cur;
        open.push(ni, ng + h(nx, ny));
      }
    }
  }
  return null;
}

/** Tiles reachable from start (flood fill, same movement rules as findPath). */
export function reachableSet(grid: NavGrid, start: TilePos): Set<string> {
  const seen = new Set<string>();
  if (!grid.isWalkable(start)) return seen;
  const stack: TilePos[] = [start];
  seen.add(tileKey(start));
  while (stack.length) {
    const c = stack.pop()!;
    for (const [dx, dy] of DIRS) {
      const t = { x: c.x + dx, y: c.y + dy };
      const k = tileKey(t);
      if (seen.has(k) || !grid.isWalkable(t)) continue;
      if (dx !== 0 && dy !== 0 && (!grid.isWalkable({ x: c.x + dx, y: c.y }) || !grid.isWalkable({ x: c.x, y: c.y + dy }))) continue;
      seen.add(k);
      stack.push(t);
    }
  }
  return seen;
}
