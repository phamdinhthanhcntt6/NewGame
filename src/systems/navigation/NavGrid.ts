import { footprintTiles, type Footprint, type TilePos } from '../../utils/tile';

/**
 * Walkability grid. Base terrain (walls, water…) plus a per-tile count of
 * blocking footprints, so placing/removing furniture is O(footprint) and
 * overlapping blockers never accidentally "unblock" a tile.
 */
export class NavGrid {
  private readonly terrainBlocked: Uint8Array;
  private readonly occupancy: Uint16Array;
  private version = 0;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.terrainBlocked = new Uint8Array(width * height);
    this.occupancy = new Uint16Array(width * height);
  }

  /** Increments whenever walkability changes; path caches can compare against it. */
  get revision(): number {
    return this.version;
  }

  inBounds(t: TilePos): boolean {
    return t.x >= 0 && t.y >= 0 && t.x < this.width && t.y < this.height;
  }

  private idx(t: TilePos): number {
    return t.y * this.width + t.x;
  }

  isWalkable(t: TilePos): boolean {
    if (!this.inBounds(t)) return false;
    const i = this.idx(t);
    return this.terrainBlocked[i] === 0 && this.occupancy[i] === 0;
  }

  setTerrainBlocked(t: TilePos, blocked: boolean): void {
    if (!this.inBounds(t)) return;
    this.terrainBlocked[this.idx(t)] = blocked ? 1 : 0;
    this.version++;
  }

  addBlocker(f: Footprint): void {
    for (const t of footprintTiles(f)) if (this.inBounds(t)) this.occupancy[this.idx(t)]!++;
    this.version++;
  }

  removeBlocker(f: Footprint): void {
    for (const t of footprintTiles(f)) {
      if (!this.inBounds(t)) continue;
      const i = this.idx(t);
      if (this.occupancy[i]! > 0) this.occupancy[i]!--;
    }
    this.version++;
  }

  /** Independent copy, for "what if" checks (e.g. furniture placement) that must not touch the live grid. */
  clone(): NavGrid {
    const g = new NavGrid(this.width, this.height);
    g.terrainBlocked.set(this.terrainBlocked);
    g.occupancy.set(this.occupancy);
    return g;
  }

  /** True when every tile of the footprint is in bounds and walkable. */
  isAreaFree(f: Footprint): boolean {
    for (const t of footprintTiles(f)) if (!this.isWalkable(t)) return false;
    return true;
  }
}
