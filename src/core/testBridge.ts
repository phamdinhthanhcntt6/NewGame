import type { WorldScene } from '../scenes/WorldScene';
import type { HudScene } from '../scenes/HudScene';
import { SystemClock } from './Clock';
import type { SimulationSnapshot } from '../gameplay/GameSimulation';
import { worldToScreen } from '../utils/iso';
import { tileCenter, type TilePos } from '../utils/tile';

/**
 * Dev/test-only window hook for Playwright. Lets E2E tests turn a tile into
 * real page coordinates (so they click the canvas like a player) and read
 * gameplay state (so assertions never depend on pixels).
 * Never installed in production builds.
 */
export interface TestBridge {
  ready: boolean;
  snapshot(): SimulationSnapshot;
  /** Page (client) coordinates of a tile centre. */
  tileToClient(tile: TilePos): { x: number; y: number };
  /** Tile under page coordinates, via the same path the game's input uses. */
  clientToTile(x: number, y: number): TilePos;
  /** What a click at page coordinates would target (object first, then tile). */
  clientToTarget(x: number, y: number): { objectId: string | null; tile: TilePos };
  /** Page coordinates of an object's visible top/label — where a player would click. */
  objectClickClient(id: string): { x: number; y: number } | null;
  objectTiles(id: string): TilePos[];
  setTimeScale(scale: number): void;
  events(): Array<{ type: string; payload: unknown }>;
  /** Fast-forward the wall clock (crops). Persisted so it survives a page reload. */
  advanceClock(ms: number): void;
  /** Page coordinates of a named HUD button, or null if absent/hidden. */
  buttonClient(name: string): { x: number; y: number; enabled: boolean } | null;
  saveNow(): boolean;
  /** Dev-only cheat for UI-focused tests: grants items through the TransactionService (reason "debug:grant"). */
  grantItems(itemId: string, qty: number, quality?: number): boolean;
  /** Café only: spawn a customer now / turn the automatic spawner on or off. */
  spawnCustomer(archetype?: string): string | null;
  setCafeOpen(open: boolean): void;
}

declare global {
  interface Window {
    __TCSS__?: TestBridge;
  }
}

export function installTestBridge(scene: WorldScene): void {
  if (import.meta.env.PROD) return;
  const log: Array<{ type: string; payload: unknown }> = [];
  const bus = scene.sim.bus;
  for (const type of ['actor:stateChanged', 'move:started', 'move:arrived', 'move:unreachable', 'interaction:queued', 'interaction:started', 'interaction:completed', 'interaction:failed', 'interaction:cancelled', 'actor:heldChanged', 'economy:transaction', 'farm:plotChanged', 'shop:opened', 'shop:closed', 'save:written', 'world:objectSelected', 'order:changed', 'customer:spawned', 'customer:left', 'customer:removed', 'world:travelRequested'] as const) {
    bus.on(type, (payload) => log.push({ type, payload }));
  }
  const canvasRect = () => scene.game.canvas.getBoundingClientRect();
  const renderToClient = (px: number, py: number) => {
    const c = scene.renderToCanvas(px, py);
    const r = canvasRect();
    return { x: r.left + (c.x * r.width) / scene.scale.width, y: r.top + (c.y * r.height) / scene.scale.height };
  };
  const clientToCanvas = (x: number, y: number) => {
    const r = canvasRect();
    return { x: ((x - r.left) * scene.scale.width) / r.width, y: ((y - r.top) * scene.scale.height) / r.height };
  };
  window.__TCSS__ = {
    ready: true,
    snapshot: () => scene.sim.snapshot(),
    tileToClient: (tile) => {
      const w = worldToScreen(tileCenter(tile));
      return renderToClient(w.x, w.y);
    },
    clientToTile: (x, y) => scene.pointerTile(clientToCanvas(x, y)),
    clientToTarget: (x, y) => scene.pointerTarget(clientToCanvas(x, y)),
    objectClickClient: (id) => {
      const p = scene.objectClickPoint(id);
      return p ? renderToClient(p.x, p.y) : null;
    },
    objectTiles: (id) => {
      const o = scene.sim.world.getObject(id);
      if (!o) return [];
      const out: TilePos[] = [];
      for (let y = o.footprint.y; y < o.footprint.y + o.footprint.h; y++) for (let x = o.footprint.x; x < o.footprint.x + o.footprint.w; x++) out.push({ x, y });
      return out;
    },
    setTimeScale: (s) => {
      scene.sim.timeScale = s;
    },
    events: () => log.slice(),
    advanceClock: (ms) => {
      const clock = scene.sim.clock;
      if (!(clock instanceof SystemClock)) throw new Error('advanceClock needs SystemClock');
      clock.offsetMs += ms;
      window.localStorage.setItem('tcss.debug.clockOffset', String(clock.offsetMs));
    },
    buttonClient: (name) => {
      const hud = scene.scene.get('HudScene') as HudScene;
      const b = hud.button(name);
      if (!b || !b.text.visible) return null;
      const bounds = b.text.getBounds();
      const r = canvasRect();
      return { x: r.left + (bounds.centerX * r.width) / scene.scale.width, y: r.top + (bounds.centerY * r.height) / scene.scale.height, enabled: b.isEnabled };
    },
    saveNow: () => scene.autosave.saveNow(),
    spawnCustomer: (archetype) => scene.sim.cafe?.spawn(archetype).id ?? null,
    setCafeOpen: (open) => {
      if (scene.sim.cafe) scene.sim.cafe.open = open;
    },
    grantItems: (itemId, qty, quality = 50) => scene.sim.tx.execute({ reason: 'debug:grant', items: [{ itemId, qty, quality }] }).ok,
  };
}
