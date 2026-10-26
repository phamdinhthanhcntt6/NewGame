import type { EventBus } from '../../core/EventBus';
import type { GameEvents } from '../../core/events';
import type { TransactionError, TransactionService } from '../../systems/economy/TransactionService';
import { reachableSet } from '../../systems/navigation/astar';
import { NavigationService } from '../../systems/navigation/NavigationService';
import { footprintContains, footprintTiles, tileKey, type Footprint, type Side, type TilePos } from '../../utils/tile';
import type { GameState, PlacedFurniture } from '../state/GameState';
import { rotateSide, type WorldModel } from '../world/WorldModel';
import type { ObjectTypeDef } from '../world/types';

export interface FurnitureDef {
  /** Inventory item that represents this piece while it is not placed. */
  itemId: string;
  price: number;
  /** Seating comfort: customers wait longer. */
  comfort: number;
  /** Looks: customers come more often. */
  decor: number;
  /** Player level needed to buy it. */
  unlockLevel: number;
}

export interface FurnitureConfig {
  catalog: Record<string, FurnitureDef>;
  bonuses: { comfortCap: number; decorCap: number; patiencePerComfort: number; trafficPerDecor: number };
}

export interface DecorBonuses {
  comfort: number;
  decor: number;
  /** Seats + standing spots on the map. */
  spots: number;
  /** Multiplies new customers' order and drink patience. */
  patienceFactor: number;
  /** Divides the time between customer arrivals. */
  trafficFactor: number;
}

export type DecorSelection =
  | { kind: 'place'; type: string; rotation: number }
  | { kind: 'move'; type: string; objectId: string; rotation: number };

export type DecorFailReason =
  | 'notDecoratable'
  | 'locked'
  | 'notActive'
  | 'playerBusy'
  | 'unknownFurniture'
  | 'notFurniture'
  | 'notOwned'
  | 'noSelection'
  | 'invalidRotation'
  | 'outOfArea'
  | 'overlap'
  | 'reservedTile'
  | 'occupied'
  | 'seatInUse'
  | 'blocksPath'
  | TransactionError;

export type DecorResult = { ok: true } | { ok: false; reason: DecorFailReason };

export type PlacementCheck = { ok: true; footprint: Footprint } | { ok: false; reason: DecorFailReason; footprint: Footprint | null };

export interface DecorView {
  active: boolean;
  selection: DecorSelection | null;
  /** Ghost of the selection at the hovered tile. */
  preview: { footprint: Footprint; valid: boolean; reason: DecorFailReason | null } | null;
  placed: PlacedFurniture[];
  /** Unplaced pieces per furniture type (inventory items). */
  owned: Record<string, number>;
  bonuses: DecorBonuses;
  area: Footprint[];
}

/** What the service needs to know about the live simulation. */
export interface DecorContext {
  /** Tiles of everyone standing on the map (player, customers). */
  actorTiles(): TilePos[];
  /** A customer has reserved this seat / standing spot. */
  isSeatReserved(objectId: string): boolean;
  /** The player is in the middle of an interaction or has queued ones. */
  playerBusy(): boolean;
  /** Player level (furniture unlocks). */
  playerLevel(): number;
}

const ok: DecorResult = { ok: true };
const fail = (reason: DecorFailReason): DecorResult => ({ ok: false, reason });

export const footprintAt = (def: ObjectTypeDef, at: TilePos, rotation: number): Footprint => {
  const odd = rotation % 2 === 1;
  return { x: at.x, y: at.y, w: odd ? def.footprint.h : def.footprint.w, h: odd ? def.footprint.w : def.footprint.h };
};

interface Placement {
  def: ObjectTypeDef;
  footprint: Footprint;
  sides: Side[] | undefined;
}

/**
 * Furniture & decoration (M7). Buying, placing, moving, rotating and storing
 * furniture on a decoratable map, with validation that keeps the café
 * playable: inside the decor area, no overlap, never on AI markers or people,
 * and never cutting off a marker, seat, station or person from the street.
 * Furniture is an inventory item while unplaced; the layout is saved per map.
 * Every change emits `decor:changed` so navigation and seats can rebuild.
 */
export class FurnitureService {
  private active = false;
  private selection: DecorSelection | null = null;
  private hoverTile: TilePos | null = null;
  private readonly area: Footprint[];
  private readonly markerTiles: TilePos[];
  private readonly markerKeys: Set<string>;
  private readonly root: TilePos;

  constructor(
    private readonly state: GameState,
    private readonly world: WorldModel,
    readonly config: FurnitureConfig,
    private readonly tx: TransactionService,
    private readonly bus: EventBus<GameEvents>,
    private readonly bodyRadius: number,
    private readonly ctx: DecorContext,
  ) {
    this.area = world.map.decor?.area ?? [];
    this.markerTiles = Object.values(world.map.markers ?? {}).flat();
    this.markerKeys = new Set(this.markerTiles.map(tileKey));
    // Paths are checked from where people enter the map.
    this.root = world.markers('spawn')[0] ?? world.map.playerStart;
    if (this.available) this.applySavedLayout();
  }

  get available(): boolean {
    return this.area.length > 0;
  }

  get isActive(): boolean {
    return this.active;
  }

  get hasSelection(): boolean {
    return this.selection !== null;
  }

  isFurniture(objectId: string): boolean {
    const o = this.world.getObject(objectId);
    return !!o && !!this.config.catalog[o.type];
  }

  /** Furniture currently in the world. */
  layout(): PlacedFurniture[] {
    return this.world
      .allObjects()
      .filter((o) => this.config.catalog[o.type])
      .map((o) => ({ id: o.id, type: o.type, x: o.footprint.x, y: o.footprint.y, rotation: o.rotation }));
  }

  owned(type: string): number {
    const f = this.config.catalog[type];
    return f ? this.tx.count(f.itemId) : 0;
  }

  bonuses(): DecorBonuses {
    const b = this.config.bonuses;
    let comfort = 0;
    let decor = 0;
    let spots = 0;
    for (const o of this.world.allObjects()) {
      const f = this.config.catalog[o.type];
      if (f) {
        comfort += f.comfort;
        decor += f.decor;
      }
      if (o.def.interaction?.actions.some((a) => a.handler === 'cafe.serve')) spots++;
    }
    if (!this.available) return { comfort: 0, decor: 0, spots, patienceFactor: 1, trafficFactor: 1 };
    comfort = Math.min(b.comfortCap, comfort);
    decor = Math.min(b.decorCap, decor);
    return { comfort, decor, spots, patienceFactor: 1 + comfort * b.patiencePerComfort, trafficFactor: 1 + decor * b.trafficPerDecor };
  }

  // ── validation ──────────────────────────────────────────────────────────

  /**
   * Can `type` stand with its footprint origin at `at`? `movingId` is the
   * placed piece being moved (it doesn't collide with itself). `loading`
   * skips the people check (nobody stands on the map yet).
   */
  check(type: string, at: TilePos, rotation: number, movingId: string | null = null, loading = false): PlacementCheck {
    const def = this.world.types[type];
    if (!def || !this.config.catalog[type]) return { ok: false, reason: 'unknownFurniture', footprint: null };
    if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3) return { ok: false, reason: 'invalidRotation', footprint: null };
    const footprint = footprintAt(def, at, rotation);
    const no = (reason: DecorFailReason): PlacementCheck => ({ ok: false, reason, footprint });
    if (movingId && this.ctx.isSeatReserved(movingId)) return no('seatInUse');
    const tiles = [...footprintTiles(footprint)];
    const floor = (t: TilePos) => this.world.map.legend[this.world.map.terrain[t.y]?.[t.x] ?? '']?.walkable === true;
    if (!tiles.every((t) => floor(t) && this.area.some((a) => footprintContains(a, t)))) return no('outOfArea');
    for (const t of tiles) {
      const other = this.world.objectAt(t);
      if (other && other.id !== movingId) return no('overlap');
    }
    if (tiles.some((t) => this.markerKeys.has(tileKey(t)))) return no('reservedTile');
    if (!loading && this.ctx.actorTiles().some((a) => footprintContains(footprint, a))) return no('occupied');
    const sides = def.interaction?.sides?.map((s) => rotateSide(s, rotation));
    if (!this.keepsPathsOpen({ def, footprint, sides }, movingId, loading)) return no('blocksPath');
    return { ok: true, footprint };
  }

  /**
   * With the piece in its new place, everything people need must still be
   * reachable from the entry: every AI marker, the player start, everyone's
   * current tile, every seat, and at least one approach tile of every
   * interactive object. Works on a copy of the grid.
   */
  private keepsPathsOpen(p: Placement, movingId: string | null, loading: boolean): boolean {
    const grid = this.world.grid.clone();
    const moving = movingId ? this.world.getObject(movingId) : undefined;
    if (moving?.def.blocking) grid.removeBlocker(moving.footprint);
    if (p.def.blocking) grid.addBlocker(p.footprint);
    const reach = reachableSet(grid, this.root);
    const reached = (t: TilePos) => reach.has(tileKey(t));
    const people = loading ? [] : this.ctx.actorTiles();
    if (![...this.markerTiles, this.world.map.playerStart, ...people].every(reached)) return false;
    const nav = new NavigationService(grid, this.bodyRadius);
    const others: Placement[] = this.world
      .allObjects()
      .filter((o) => o.id !== movingId)
      .map((o) => ({ def: o.def, footprint: o.footprint, sides: o.sides }));
    for (const o of [...others, p]) {
      const ia = o.def.interaction;
      if (!ia) continue;
      // Seats are walked onto by customers.
      if (!o.def.blocking && ![...footprintTiles(o.footprint)].every(reached)) return false;
      if (!nav.approachTiles({ footprint: o.footprint, radius: ia.radius ?? 1, sides: o.sides }).some(reached)) return false;
    }
    return true;
  }

  // ── commands (also used directly by tests) ─────────────────────────────

  /** Buy furniture: coins out, pieces into the shared inventory, in one transaction. */
  buy(type: string, qty = 1): DecorResult {
    const f = this.config.catalog[type];
    if (!f) return fail('unknownFurniture');
    if (this.ctx.playerLevel() < f.unlockLevel) return fail('locked');
    const r = this.tx.execute({ reason: `buyFurniture:${type}`, coins: -f.price * qty, items: [{ itemId: f.itemId, qty }] });
    return r.ok ? ok : fail(r.error);
  }

  /** Place an owned piece. The item leaves the inventory in the same step the object appears. */
  place(type: string, at: TilePos, rotation = 0): DecorResult {
    if (!this.available) return fail('notDecoratable');
    const f = this.config.catalog[type];
    if (!f) return fail('unknownFurniture');
    if (this.tx.count(f.itemId) < 1) return fail('notOwned');
    const c = this.check(type, at, rotation);
    if (!c.ok) return fail(c.reason);
    const r = this.tx.execute({ reason: `placeFurniture:${type}`, items: [{ itemId: f.itemId, qty: -1 }] });
    if (!r.ok) return fail(r.error);
    let id = `f${this.state.decor.nextId++}`;
    while (this.world.getObject(id)) id = `f${this.state.decor.nextId++}`;
    this.world.addObject(id, type, at, rotation);
    this.changed('placed', id, type);
    return ok;
  }

  /** Move (and/or rotate) a placed piece. */
  move(objectId: string, at: TilePos, rotation: number): DecorResult {
    if (!this.available) return fail('notDecoratable');
    const o = this.world.getObject(objectId);
    if (!o || !this.config.catalog[o.type]) return fail('notFurniture');
    const c = this.check(o.type, at, rotation, objectId);
    if (!c.ok) return fail(c.reason);
    this.world.removeObject(objectId);
    this.world.addObject(objectId, o.type, at, rotation, { ...o.props });
    this.changed('moved', objectId, o.type);
    return ok;
  }

  /** Take a placed piece back into the inventory. */
  store(objectId: string): DecorResult {
    if (!this.available) return fail('notDecoratable');
    const o = this.world.getObject(objectId);
    const f = o ? this.config.catalog[o.type] : undefined;
    if (!o || !f) return fail('notFurniture');
    if (this.ctx.isSeatReserved(objectId)) return fail('seatInUse');
    const r = this.tx.execute({ reason: `storeFurniture:${o.type}`, items: [{ itemId: f.itemId, qty: 1 }] });
    if (!r.ok) return fail(r.error);
    this.world.removeObject(objectId);
    this.changed('stored', objectId, o.type);
    return ok;
  }

  // ── decorate mode (player UI) ───────────────────────────────────────────

  enter(): DecorResult {
    if (!this.available) return this.reject('notDecoratable');
    if (this.active) return ok;
    if (this.ctx.playerBusy()) return this.reject('playerBusy');
    this.active = true;
    this.bus.emit('decor:modeChanged', { active: true });
    return ok;
  }

  exit(): void {
    this.selection = null;
    this.hoverTile = null;
    if (!this.active) return;
    this.active = false;
    this.bus.emit('decor:modeChanged', { active: false });
  }

  /** Esc / right click: drop the selection, or leave the mode when nothing is selected. */
  escape(): void {
    if (this.selection) this.selection = null;
    else this.exit();
  }

  clearSelection(): void {
    this.selection = null;
  }

  /** Pick an owned piece from the inventory to place. */
  selectToPlace(type: string): DecorResult {
    if (!this.active) return fail('notActive');
    if (!this.config.catalog[type]) return this.reject('unknownFurniture');
    if (this.owned(type) < 1) return this.reject('notOwned');
    this.selection = { kind: 'place', type, rotation: 0 };
    return ok;
  }

  /** Pick up a placed piece to move it (it stays where it is until confirmed). */
  pick(objectId: string): DecorResult {
    if (!this.active) return fail('notActive');
    const o = this.world.getObject(objectId);
    if (!o || !this.config.catalog[o.type]) return this.reject('notFurniture', o ? { x: o.footprint.x, y: o.footprint.y } : null);
    if (this.ctx.isSeatReserved(objectId)) return this.reject('seatInUse', { x: o.footprint.x, y: o.footprint.y });
    this.selection = { kind: 'move', type: o.type, objectId, rotation: o.rotation };
    return ok;
  }

  rotate(): DecorResult {
    if (!this.active) return fail('notActive');
    if (!this.selection) return this.reject('noSelection');
    this.selection = { ...this.selection, rotation: (this.selection.rotation + 1) % 4 };
    return ok;
  }

  hover(tile: TilePos | null): void {
    this.hoverTile = tile ? { ...tile } : null;
  }

  /** Put the selection down with its footprint origin at `tile`. */
  confirm(tile: TilePos): DecorResult {
    if (!this.active) return fail('notActive');
    const s = this.selection;
    if (!s) return this.reject('noSelection', tile);
    const r = s.kind === 'place' ? this.place(s.type, tile, s.rotation) : this.move(s.objectId, tile, s.rotation);
    if (!r.ok) return this.reject(r.reason, tile);
    this.selection = null;
    return ok;
  }

  /** Store the piece being moved. */
  storeSelected(): DecorResult {
    if (!this.active) return fail('notActive');
    const s = this.selection;
    if (s?.kind !== 'move') return this.reject('noSelection');
    const r = this.store(s.objectId);
    if (!r.ok) return this.reject(r.reason);
    this.selection = null;
    return ok;
  }

  /** World click while decorating: put down the selection, or pick up the clicked piece. */
  click(tile: TilePos, objectId: string | null): DecorResult {
    if (this.selection) return this.confirm(tile);
    const id = objectId ?? this.world.objectAt(tile)?.id ?? null;
    return id ? this.pick(id) : ok;
  }

  view(): DecorView {
    const s = this.selection;
    let preview: DecorView['preview'] = null;
    if (this.active && s && this.hoverTile) {
      const c = this.check(s.type, this.hoverTile, s.rotation, s.kind === 'move' ? s.objectId : null);
      const def = this.world.types[s.type];
      const footprint = c.footprint ?? (def ? footprintAt(def, this.hoverTile, s.rotation) : null);
      if (footprint) preview = { footprint, valid: c.ok, reason: c.ok ? null : c.reason };
    }
    const owned: Record<string, number> = {};
    for (const type of Object.keys(this.config.catalog)) owned[type] = this.owned(type);
    return {
      active: this.active,
      selection: s ? { ...s } : null,
      preview,
      placed: this.layout(),
      owned,
      bonuses: this.bonuses(),
      area: this.area.map((a) => ({ ...a })),
    };
  }

  // ── internals ───────────────────────────────────────────────────────────

  private reject(reason: DecorFailReason, tile: TilePos | null = null): DecorResult {
    this.bus.emit('decor:rejected', { reason, tile });
    return fail(reason);
  }

  private changed(action: 'placed' | 'moved' | 'stored', objectId: string, type: string): void {
    // The first edit turns the map's starting furniture into a saved layout.
    this.state.decor.layouts[this.world.map.id] = this.layout();
    this.bus.emit('decor:changed', { action, objectId, type });
  }

  /**
   * A saved layout replaces the map's own furniture. Pieces that no longer
   * fit (map data changed) go back to the inventory instead of vanishing.
   */
  private applySavedLayout(): void {
    const saved = this.state.decor.layouts[this.world.map.id];
    if (!saved) return;
    for (const o of this.world.allObjects()) if (this.config.catalog[o.type]) this.world.removeObject(o.id);
    const returned = new Map<string, number>();
    for (const f of saved) {
      const fits = !this.world.getObject(f.id) && this.check(f.type, { x: f.x, y: f.y }, f.rotation, null, true).ok;
      if (fits) this.world.addObject(f.id, f.type, { x: f.x, y: f.y }, f.rotation);
      else {
        const item = this.config.catalog[f.type]?.itemId;
        if (item) returned.set(item, (returned.get(item) ?? 0) + 1);
      }
    }
    if (returned.size === 0) return;
    this.tx.execute({ reason: 'decor:returned', items: [...returned].map(([itemId, qty]) => ({ itemId, qty })) });
    this.state.decor.layouts[this.world.map.id] = this.layout();
  }
}
