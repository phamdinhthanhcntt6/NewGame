/**
 * Placeholder look per object type. Visual-only: changing these values must
 * never change gameplay. Replaced by atlas frame keys in the art pass.
 */
export interface PlaceholderStyle {
  color: number;
  /** Extrusion height in screen px for the box. */
  height: number;
}

export const PLACEHOLDER_STYLES: Record<string, PlaceholderStyle> = {
  wall_post: { color: 0x5b4a3f, height: 40 },
  plant: { color: 0x4f8f45, height: 36 },
  counter: { color: 0x8a5a35, height: 28 },
  espresso_machine: { color: 0xb0b6bd, height: 46 },
  table_2: { color: 0xa8743f, height: 20 },
  crate: { color: 0xc49a55, height: 26 },
  shelf: { color: 0x704a2c, height: 54 },
  statue: { color: 0xd8d2c4, height: 60 },
  sign: { color: 0xe0b84a, height: 30 },
  farm_plot: { color: 0x8b6a45, height: 6 },
  well: { color: 0x7d8fa3, height: 34 },
  seed_stall: { color: 0xc9783a, height: 38 },
  farmhouse: { color: 0xa0522d, height: 70 },
  tree: { color: 0x2f6b34, height: 72 },
};

/** Per-variant overrides (ObjectVisual.variant), e.g. plot states. */
export const PLACEHOLDER_VARIANTS: Record<string, Record<string, PlaceholderStyle>> = {
  farm_plot: {
    locked: { color: 0x6f6a5f, height: 2 },
    empty: { color: 0x9b7b52, height: 4 },
    prepared: { color: 0x6b4423, height: 6 },
    thirsty: { color: 0xc2a36b, height: 10 },
    growing_0: { color: 0x7fae5a, height: 10 },
    growing_1: { color: 0x5f9e45, height: 18 },
    growing_2: { color: 0x3f8a35, height: 26 },
    growing_3: { color: 0x2e7a2a, height: 32 },
    ready: { color: 0xc8463d, height: 34 },
    harvested: { color: 0x7a6040, height: 8 },
  },
};

export const DEFAULT_STYLE: PlaceholderStyle = { color: 0xff00ff, height: 24 };

export const TERRAIN_COLORS: Record<string, { top: number; height: number }> = {
  floor: { top: 0xd9c3a0, height: 0 },
  grass: { top: 0xa9c47f, height: 0 },
  wall: { top: 0x3e2f27, height: 48 },
};

export const PLAYER_COLOR = 0x2f7fd8;
export const FEEDBACK_COLORS = { ok: '#3c9d4a', info: '#2b5d9e', error: '#c8463d' } as const;
