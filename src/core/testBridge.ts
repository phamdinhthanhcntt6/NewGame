import type { SandboxScene } from '../scenes/SandboxScene';
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
}

declare global {
  interface Window {
    __TCSS__?: TestBridge;
  }
}

export function installTestBridge(scene: SandboxScene): void {
  if (import.meta.env.PROD) return;
  const log: Array<{ type: string; payload: unknown }> = [];
  const bus = scene.sim.bus;
  for (const type of ['actor:stateChanged', 'move:started', 'move:arrived', 'move:unreachable', 'interaction:queued', 'interaction:started', 'interaction:completed', 'interaction:failed', 'interaction:cancelled', 'actor:heldChanged'] as const) {
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
  };
}
