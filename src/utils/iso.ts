import type { Footprint, WorldPos } from './tile';

/**
 * 2:1 dimetric isometric projection (ART_BIBLE §2). Pure math so rendering
 * adapters, input and tests all agree on the same mapping.
 */
export interface IsoConfig {
  tileWidth: number;
  tileHeight: number;
}

export const DEFAULT_ISO: IsoConfig = { tileWidth: 128, tileHeight: 64 };

export interface ScreenPos {
  x: number;
  y: number;
}

/** World (tile units, continuous) → screen pixels. Tile (0,0)'s top corner is at screen (0,0). */
export const worldToScreen = (p: WorldPos, iso: IsoConfig = DEFAULT_ISO): ScreenPos => ({
  x: (p.x - p.y) * (iso.tileWidth / 2),
  y: (p.x + p.y) * (iso.tileHeight / 2),
});

/** Exact inverse of worldToScreen. */
export const screenToWorld = (s: ScreenPos, iso: IsoConfig = DEFAULT_ISO): WorldPos => {
  const a = s.x / (iso.tileWidth / 2);
  const b = s.y / (iso.tileHeight / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
};

/**
 * Painter's-order depth. Higher draws in front. An actor at continuous
 * position p sorts by p.x + p.y; a static footprint sorts by the centre of
 * its front-most tile. Actors win ties (ACTOR_BIAS) so a character standing
 * directly in front of furniture is never hidden by it.
 */
export const ACTOR_BIAS = 0.1;

export const actorDepth = (p: WorldPos): number => p.x + p.y + ACTOR_BIAS;

export const footprintDepth = (f: Footprint): number => f.x + f.w - 0.5 + (f.y + f.h - 0.5);

export const floorDepth = -1_000_000;
