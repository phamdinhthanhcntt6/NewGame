import type { Footprint, Side, TilePos } from '../../utils/tile';

export interface ActionDef {
  id: string;
  label: string;
  /** 0 = instant (INTERACTING only); > 0 = timed WORKING phase. */
  durationMs: number;
  /** Key into the ActionRegistry; the rule lives in code, the numbers live in data. */
  handler: string;
  params: Record<string, unknown>;
}

export interface InteractionDef {
  /** Chebyshev distance from the footprint the actor must stand within. */
  radius?: number;
  /** Restrict approach to these grid sides of the (rotated) footprint. Omit = any side incl. diagonals. */
  sides?: Side[];
  actions: ActionDef[];
}

export interface ObjectTypeDef {
  label: string;
  footprint: { w: number; h: number };
  blocking: boolean;
  interaction?: InteractionDef;
}

export type ObjectTypeTable = Record<string, ObjectTypeDef>;

export interface MapObjectData {
  id: string;
  type: string;
  x: number;
  y: number;
  /** Quarter turns clockwise (0–3). Odd values swap footprint w/h. */
  rotation?: number;
}

export interface MapData {
  id: string;
  name: string;
  legend: Record<string, { kind: string; walkable: boolean }>;
  terrain: string[];
  playerStart: TilePos;
  objects: MapObjectData[];
}

export interface WorldObject {
  readonly id: string;
  readonly type: string;
  readonly def: ObjectTypeDef;
  readonly footprint: Footprint;
  readonly rotation: number;
  /** Approach sides after rotation (undefined = any side). */
  readonly sides: Side[] | undefined;
  /** Generic per-object counters mutated only by action handlers. */
  readonly counters: Record<string, number>;
}
