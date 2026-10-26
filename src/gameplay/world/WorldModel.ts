import { NavGrid } from '../../systems/navigation/NavGrid';
import { footprintContains, type Footprint, type Side, type TilePos } from '../../utils/tile';
import type { MapData, ObjectTypeTable, WorldObject } from './types';

const SIDE_ORDER: Side[] = ['N', 'E', 'S', 'W'];

export const rotateSide = (side: Side, quarterTurns: number): Side =>
  SIDE_ORDER[(SIDE_ORDER.indexOf(side) + quarterTurns) % 4]!;

export class MapValidationError extends Error {
  constructor(problems: string[]) {
    super(`Invalid map data:\n- ${problems.join('\n- ')}`);
    this.name = 'MapValidationError';
  }
}

/** Fails fast on broken data instead of producing an unplayable map. */
export function validateMap(map: MapData, types: ObjectTypeTable): string[] {
  const problems: string[] = [];
  const height = map.terrain.length;
  const width = map.terrain[0]?.length ?? 0;
  if (height === 0 || width === 0) problems.push('terrain is empty');
  map.terrain.forEach((row, y) => {
    if (row.length !== width) problems.push(`terrain row ${y} has length ${row.length}, expected ${width}`);
    for (const ch of row) if (!map.legend[ch]) problems.push(`terrain row ${y} uses unknown symbol "${ch}"`);
  });
  const ids = new Set<string>();
  const occupied = new Map<string, string>();
  for (const o of map.objects) {
    if (ids.has(o.id)) problems.push(`duplicate object id "${o.id}"`);
    ids.add(o.id);
    const def = types[o.type];
    if (!def) {
      problems.push(`object "${o.id}" has unknown type "${o.type}"`);
      continue;
    }
    const rot = o.rotation ?? 0;
    if (!Number.isInteger(rot) || rot < 0 || rot > 3) problems.push(`object "${o.id}" has invalid rotation ${rot}`);
    const w = rot % 2 ? def.footprint.h : def.footprint.w;
    const h = rot % 2 ? def.footprint.w : def.footprint.h;
    if (o.x < 0 || o.y < 0 || o.x + w > width || o.y + h > height) problems.push(`object "${o.id}" is out of bounds`);
    for (let ty = o.y; ty < o.y + h; ty++) {
      for (let tx = o.x; tx < o.x + w; tx++) {
        const other = occupied.get(`${tx},${ty}`);
        if (other) problems.push(`object "${o.id}" overlaps "${other}" at ${tx},${ty}`);
        else occupied.set(`${tx},${ty}`, o.id);
      }
    }
    for (const a of def.interaction?.actions ?? []) {
      if (a.durationMs < 0) problems.push(`action "${o.type}.${a.id}" has negative duration`);
    }
  }
  const s = map.playerStart;
  if (s.x < 0 || s.y < 0 || s.x >= width || s.y >= height) problems.push('playerStart is out of bounds');
  return problems;
}

/**
 * Static description of one map: terrain, placed objects, and the derived
 * navigation grid. Pure data + queries; no rendering.
 */
export class WorldModel {
  readonly width: number;
  readonly height: number;
  readonly grid: NavGrid;
  private readonly objects = new Map<string, WorldObject>();

  constructor(
    readonly map: MapData,
    private readonly types: ObjectTypeTable,
  ) {
    const problems = validateMap(map, types);
    if (problems.length) throw new MapValidationError(problems);
    this.height = map.terrain.length;
    this.width = map.terrain[0]!.length;
    this.grid = new NavGrid(this.width, this.height);
    map.terrain.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (!map.legend[ch]!.walkable) this.grid.setTerrainBlocked({ x, y }, true);
      });
    });
    for (const o of map.objects) this.addObject(o.id, o.type, { x: o.x, y: o.y }, o.rotation ?? 0);
    if (!this.grid.isWalkable(map.playerStart)) throw new MapValidationError(['playerStart is not walkable']);
  }

  terrainKind(t: TilePos): string | undefined {
    const ch = this.map.terrain[t.y]?.[t.x];
    return ch === undefined ? undefined : this.map.legend[ch]?.kind;
  }

  addObject(id: string, type: string, at: TilePos, rotation = 0): WorldObject {
    if (this.objects.has(id)) throw new Error(`object id "${id}" already exists`);
    const def = this.types[type];
    if (!def) throw new Error(`unknown object type "${type}"`);
    const odd = rotation % 2 === 1;
    const footprint: Footprint = { x: at.x, y: at.y, w: odd ? def.footprint.h : def.footprint.w, h: odd ? def.footprint.w : def.footprint.h };
    const obj: WorldObject = {
      id,
      type,
      def,
      footprint,
      rotation,
      sides: def.interaction?.sides?.map((s) => rotateSide(s, rotation)),
      counters: {},
    };
    this.objects.set(id, obj);
    if (def.blocking) this.grid.addBlocker(footprint);
    return obj;
  }

  removeObject(id: string): boolean {
    const obj = this.objects.get(id);
    if (!obj) return false;
    if (obj.def.blocking) this.grid.removeBlocker(obj.footprint);
    this.objects.delete(id);
    return true;
  }

  getObject(id: string): WorldObject | undefined {
    return this.objects.get(id);
  }

  allObjects(): WorldObject[] {
    return [...this.objects.values()];
  }

  /** Top-most object covering a tile (objects don't overlap in valid maps). */
  objectAt(t: TilePos): WorldObject | undefined {
    for (const o of this.objects.values()) if (footprintContains(o.footprint, t)) return o;
    return undefined;
  }
}
