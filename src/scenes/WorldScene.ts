import Phaser from 'phaser';
import { CONTENT } from '../data/content';
import { Autosave, createSession, type GameSession } from '../core/session';
import { SystemClock } from '../core/Clock';
import type { GameSimulation } from '../gameplay/GameSimulation';
import { PlaceholderRenderer } from '../components/render/PlaceholderRenderer';
import type { ActorView } from '../components/render/WorldRenderer';
import { PlotPresenter } from '../components/presenters/PlotPresenter';
import { FeedbackPresenter } from '../ui/FeedbackPresenter';
import { installTestBridge } from '../core/testBridge';
import { screenToWorld } from '../utils/iso';
import { worldToTile, type TilePos } from '../utils/tile';

export const WORLD_SCENE = 'WorldScene';

export interface WorldSceneData {
  mapId: string;
  persistent: boolean;
  /** Dev/test only: start from a fresh game, discarding the stored save. */
  fresh?: boolean;
}

/**
 * World scene: thin adapter between Phaser (input, frame loop, drawing) and
 * the headless GameSimulation. Contains no gameplay rules.
 */
export class WorldScene extends Phaser.Scene {
  session!: GameSession;
  autosave!: Autosave;
  private worldRenderer!: PlaceholderRenderer;
  private playerView!: ActorView;
  private feedback!: FeedbackPresenter;
  private plots!: PlotPresenter;
  private hoveredObject: string | null = null;
  private launchData!: WorldSceneData;

  constructor() {
    super(WORLD_SCENE);
  }

  get sim(): GameSimulation {
    return this.session.sim;
  }

  init(data: WorldSceneData): void {
    this.launchData = data;
  }

  create(): void {
    const clock = new SystemClock(import.meta.env.PROD ? 0 : readDebugClockOffset());
    if (this.launchData.fresh && !import.meta.env.PROD) window.localStorage.removeItem('tcss.save.slot1');
    this.session = createSession({ mapId: this.launchData.mapId, content: CONTENT, persistent: this.launchData.persistent, clock });
    this.autosave = new Autosave(this.session);
    const world = this.sim.world;

    this.worldRenderer = new PlaceholderRenderer(this);
    const floor = [];
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const tile = { x, y };
        floor.push({ tile, kind: world.terrainKind(tile) ?? 'floor', walkable: world.grid.isWalkable(tile) });
      }
    }
    this.worldRenderer.buildWorld(
      floor,
      world.allObjects().map((o) => ({ id: o.id, type: o.type, label: o.def.label, footprint: o.footprint, rotation: o.rotation, interactive: !!o.def.interaction })),
    );
    // Layout policy: the farm HUD panel occupies the right edge (FarmHud PANEL_W + margin).
    this.worldRenderer.frame(world.width, world.height, this.sim.farm.allPlotViews().length > 0 ? 346 : 0);
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.worldRenderer.reframe());

    this.playerView = this.worldRenderer.createActor('player', 'player');
    this.feedback = new FeedbackPresenter(this.sim.bus, world, this.worldRenderer, () => this.sim.player.pos);
    this.plots = new PlotPresenter(this.worldRenderer, CONTENT.seeds);

    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) return this.sim.cancel();
      const target = this.pointerTarget(p);
      if (target.objectId) this.sim.clickObject(target.objectId);
      else this.sim.clickTile(target.tile);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.updateHover(this.pointerTarget(p)));
    this.input.keyboard?.on('keydown-ESC', () => this.sim.cancel());

    // Persist when the tab is hidden or closed (best effort; autosave covers the rest).
    const flush = () => this.autosave.saveNow();
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);

    this.scene.launch('HudScene', { session: this.session });
    installTestBridge(this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      flush();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      this.autosave.destroy();
      this.feedback.destroy();
      this.playerView.destroy();
      this.sim.bus.clear();
    });
  }

  override update(time: number, delta: number): void {
    this.sim.tick(delta);
    const s = this.sim.snapshot();
    const cur = s.interaction.current;
    this.playerView.update({
      pos: s.player.pos,
      state: s.player.state,
      facing: s.player.facing,
      heldItem: s.player.heldItem,
      progress: cur?.phase === 'work' ? cur.progress : null,
    });
    this.worldRenderer.setPathPreview(s.player.waypoints.length ? [s.player.pos, ...s.player.waypoints] : null);
    this.plots.sync(s.farm.plots);
    this.autosave.update(time);
  }

  /** Pointer → tile, using the camera's own inverse transform. */
  pointerTile(p: { x: number; y: number }): TilePos {
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    return worldToTile(screenToWorld({ x: w.x, y: w.y }));
  }

  /**
   * What the player is pointing at: the front-most object whose drawn shape
   * is under the pointer, otherwise the floor tile under it.
   */
  pointerTarget(p: { x: number; y: number }): { objectId: string | null; tile: TilePos } {
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    return { objectId: this.worldRenderer.objectAtPoint(w.x, w.y), tile: worldToTile(screenToWorld({ x: w.x, y: w.y })) };
  }

  /** Render-space point → screen (canvas) pixels; inverse of the camera transform. */
  renderToCanvas(px: number, py: number): { x: number; y: number } {
    const cam = this.cameras.main;
    return { x: (px - cam.worldView.x) * cam.zoom + cam.x, y: (py - cam.worldView.y) * cam.zoom + cam.y };
  }

  objectClickPoint(id: string): { x: number; y: number } | null {
    return this.worldRenderer.objectClickPoint(id);
  }

  private updateHover(target: { objectId: string | null; tile: TilePos }): void {
    const obj = target.objectId ? this.sim.world.getObject(target.objectId) : undefined;
    const id = obj?.def.interaction ? obj.id : null;
    if (id !== this.hoveredObject) {
      this.worldRenderer.setObjectHighlight(id ?? '', id !== null);
      this.hoveredObject = id;
    }
    this.worldRenderer.setHoverTile(!obj && this.sim.world.grid.inBounds(target.tile) ? target.tile : null);
  }
}

function readDebugClockOffset(): number {
  try {
    const v = Number(window.localStorage.getItem('tcss.debug.clockOffset') ?? 0);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}
