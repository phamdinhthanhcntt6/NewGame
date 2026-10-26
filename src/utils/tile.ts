export interface TilePos {
  x: number;
  y: number;
}

/** Continuous position in tile units; tile (x, y) has its center at (x + 0.5, y + 0.5). */
export interface WorldPos {
  x: number;
  y: number;
}

export interface Footprint {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const tileKey = (t: TilePos): string => `${t.x},${t.y}`;

export const sameTile = (a: TilePos, b: TilePos): boolean => a.x === b.x && a.y === b.y;

export const tileCenter = (t: TilePos): WorldPos => ({ x: t.x + 0.5, y: t.y + 0.5 });

export const worldToTile = (p: WorldPos): TilePos => ({ x: Math.floor(p.x), y: Math.floor(p.y) });

export const footprintContains = (f: Footprint, t: TilePos): boolean =>
  t.x >= f.x && t.x < f.x + f.w && t.y >= f.y && t.y < f.y + f.h;

export function* footprintTiles(f: Footprint): Generator<TilePos> {
  for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) yield { x, y };
}

/** Chebyshev distance from a tile to the nearest tile of a footprint (0 = inside). */
export const distanceToFootprint = (t: TilePos, f: Footprint): number => {
  const dx = Math.max(f.x - t.x, 0, t.x - (f.x + f.w - 1));
  const dy = Math.max(f.y - t.y, 0, t.y - (f.y + f.h - 1));
  return Math.max(dx, dy);
};

export type Side = 'N' | 'E' | 'S' | 'W';

/**
 * Which side of the footprint a tile lies on (grid directions: N = -y, S = +y,
 * W = -x, E = +x). Diagonal neighbours return null.
 */
export const sideOfFootprint = (t: TilePos, f: Footprint): Side | null => {
  const insideX = t.x >= f.x && t.x < f.x + f.w;
  const insideY = t.y >= f.y && t.y < f.y + f.h;
  if (insideX && t.y < f.y) return 'N';
  if (insideX && t.y >= f.y + f.h) return 'S';
  if (insideY && t.x < f.x) return 'W';
  if (insideY && t.x >= f.x + f.w) return 'E';
  return null;
};
