import { tileCenter, type TilePos, type WorldPos } from '../../utils/tile';
import type { NavGrid } from './NavGrid';

/**
 * True when a body of half-size `radius` (tile units) can slide in a straight
 * line from a to b without any part of it overlapping a blocked tile.
 * Conservative sampling: the four corners of the body's square are tested
 * every `step` along the segment.
 */
export function hasClearance(grid: NavGrid, a: WorldPos, b: WorldPos, radius: number, step = 0.05): boolean {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(len / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    for (const [ox, oy] of [
      [-radius, -radius],
      [radius, -radius],
      [-radius, radius],
      [radius, radius],
    ] as const) {
      if (!grid.isWalkable({ x: Math.floor(px + ox), y: Math.floor(py + oy) })) return false;
    }
  }
  return true;
}

/**
 * Converts an A* tile path into waypoints (tile centres), removing
 * intermediate points whenever the body can travel straight past them.
 * The first waypoint is the path start; the last is always the goal tile centre.
 */
export function smoothPath(grid: NavGrid, tiles: readonly TilePos[], radius: number): WorldPos[] {
  if (tiles.length === 0) return [];
  const pts = tiles.map(tileCenter);
  const out: WorldPos[] = [pts[0]!];
  let anchor = 0;
  while (anchor < pts.length - 1) {
    let next = anchor + 1;
    for (let j = pts.length - 1; j > anchor + 1; j--) {
      if (hasClearance(grid, pts[anchor]!, pts[j]!, radius)) {
        next = j;
        break;
      }
    }
    out.push(pts[next]!);
    anchor = next;
  }
  return out;
}
