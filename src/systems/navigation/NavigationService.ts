import { distanceToFootprint, footprintContains, sideOfFootprint, tileKey, type Footprint, type Side, type TilePos, type WorldPos, worldToTile } from '../../utils/tile';
import { findPath, reachableSet } from './astar';
import type { NavGrid } from './NavGrid';
import { hasClearance, smoothPath } from './smoothing';

export interface NavPlan {
  goal: TilePos;
  /** Continuous waypoints to follow from the actor's current position. */
  waypoints: WorldPos[];
  /** Raw A* tile path, for debugging/rendering. */
  tiles: TilePos[];
}

export interface ApproachSpec {
  footprint: Footprint;
  radius: number;
  sides?: Side[] | undefined;
}

export class NavigationService {
  constructor(
    private readonly grid: NavGrid,
    private readonly bodyRadius: number,
  ) {}

  /** Walkable tiles from which an actor may interact with a footprint. */
  approachTiles(spec: ApproachSpec): TilePos[] {
    const { footprint: f, radius, sides } = spec;
    const out: TilePos[] = [];
    for (let y = f.y - radius; y < f.y + f.h + radius; y++) {
      for (let x = f.x - radius; x < f.x + f.w + radius; x++) {
        const t = { x, y };
        if (footprintContains(f, t) || !this.grid.isWalkable(t)) continue;
        if (distanceToFootprint(t, f) > radius) continue;
        if (sides) {
          const side = sideOfFootprint(t, f);
          if (!side || !sides.includes(side)) continue;
        }
        out.push(t);
      }
    }
    return out;
  }

  isWithinReach(tile: TilePos, spec: ApproachSpec): boolean {
    return this.approachTiles(spec).some((t) => t.x === tile.x && t.y === tile.y);
  }

  /** Shortest plan to any of the goals, or null when none is reachable. */
  planTo(from: WorldPos, goals: readonly TilePos[]): NavPlan | null {
    const res = findPath(this.grid, worldToTile(from), goals);
    if (!res) return null;
    const waypoints = smoothPath(this.grid, res.tiles, this.bodyRadius);
    // Mid-tile starts: skip the current tile's centre when we can go straight on.
    if (waypoints.length > 1 && hasClearance(this.grid, from, waypoints[1]!, this.bodyRadius)) waypoints.shift();
    return { goal: res.goal, waypoints, tiles: res.tiles };
  }

  /**
   * Plan to a clicked tile. If it's blocked or unreachable, fall back to the
   * reachable walkable tile closest to it (within searchRadius).
   */
  planToTileOrNearest(from: WorldPos, target: TilePos, searchRadius: number): NavPlan | null {
    const direct = this.planTo(from, [target]);
    if (direct) return direct;
    const reach = reachableSet(this.grid, worldToTile(from));
    const candidates: Array<{ t: TilePos; d: number }> = [];
    for (let y = target.y - searchRadius; y <= target.y + searchRadius; y++) {
      for (let x = target.x - searchRadius; x <= target.x + searchRadius; x++) {
        const t = { x, y };
        if (!reach.has(tileKey(t))) continue;
        candidates.push({ t, d: Math.hypot(x - target.x, y - target.y) });
      }
    }
    candidates.sort((a, b) => a.d - b.d || a.t.y - b.t.y || a.t.x - b.t.x);
    const best = candidates[0];
    return best ? this.planTo(from, [best.t]) : null;
  }

  planToApproach(from: WorldPos, spec: ApproachSpec): NavPlan | null {
    const goals = this.approachTiles(spec);
    return goals.length ? this.planTo(from, goals) : null;
  }
}
