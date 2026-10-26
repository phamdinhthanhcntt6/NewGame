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
};

export const DEFAULT_STYLE: PlaceholderStyle = { color: 0xff00ff, height: 24 };

export const TERRAIN_COLORS: Record<string, { top: number; height: number }> = {
  floor: { top: 0xd9c3a0, height: 0 },
  wall: { top: 0x3e2f27, height: 48 },
};

export const PLAYER_COLOR = 0x2f7fd8;
export const FEEDBACK_COLORS = { ok: '#3c9d4a', info: '#2b5d9e', error: '#c8463d' } as const;
