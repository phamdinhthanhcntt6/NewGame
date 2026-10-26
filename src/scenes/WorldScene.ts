import Phaser from 'phaser';
import { CONTENT } from '../data/content';
import { Autosave, createSession, type GameSession } from '../core/session';
import { SystemClock } from '../core/Clock';
import type { GameSimulation } from '../gameplay/GameSimulation';
import { PlaceholderRenderer } from '../components/render/PlaceholderRenderer';
import type { ActorView } from '../components/render/WorldRenderer';
import { PlotPresenter } from '../components/presenters/PlotPresenter';
import { EquipmentPresenter } from '../components/presenters/EquipmentPresenter';
import { CustomerPresenter } from '../components/presenters/CustomerPresenter';
import { DecorPresenter } from '../components/presenters/DecorPresenter';
import { FeedbackPresenter } from '../ui/FeedbackPresenter';
import { installTestBridge } from '../core/testBridge';
import { screenToWorld, worldToScreen } from '../utils/iso';
import { worldToTile, type TilePos } from '../utils/tile';

export const WORLD_SCENE = 'WorldScene';

export interface WorldSceneData {
  /** Omitted = resume the map the save was on. */
  mapId?: string;
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
  private equipment!: EquipmentPresenter;
  private customers: CustomerPresenter | null = null;
  private decor: DecorPresenter | null = null;
  private travelling = false;
  /** Set by the travel event; performed at the start of the next frame, never mid-tick. */
  private pendingTravel: string | null = null;
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
    this.travelling = false;
    this.pendingTravel = null;
    this.hoveredObject = null; // scene instances are reused on restart
    this.session = createSession({ ...(this.launchData.mapId ? { mapId: this.launchData.mapId } : {}), content: CONTENT, persistent: this.launchData.persistent, clock });
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
    // Layout policy: the farm/café HUD panel occupies the right edge (PANEL_W + margin).
    const hasHud = this.sim.farm.allPlotViews().length > 0 || this.sim.cafe !== null;
    this.worldRenderer.frame(world.width, world.height, hasHud ? 346 : 0);
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.worldRenderer.reframe());

    this.playerView = this.worldRenderer.createActor('player', 'player');
    this.feedback = new FeedbackPresenter(this.sim.bus, world, this.worldRenderer, () => this.sim.player.pos, (id) => this.sim.cafe?.customer(id)?.actor.pos);
    this.plots = new PlotPresenter(this.worldRenderer, CONTENT.seeds);
    this.equipment = new EquipmentPresenter(this.worldRenderer);
    if (this.sim.cafe) this.customers = new CustomerPresenter(this.worldRenderer, CONTENT.recipes);
    this.decor = this.sim.decor.available
      ? new DecorPresenter(this.sim.bus, world, this.worldRenderer, (type) => CONTENT.items[CONTENT.furniture.catalog[type]?.itemId ?? '']?.label ?? type, (id) => {
          if (this.hoveredObject !== id) return;
          this.worldRenderer.setObjectHighlight('', false);
          this.hoveredObject = null;
        })
      : null;

    // Travel: commit state with the destination, then rebuild the world from the save.
    this.sim.bus.on('world:travelRequested', ({ map }) => {
      if (!this.travelling && this.session.saves) this.pendingTravel = map;
    });

    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) return this.sim.cancel();
      const target = this.pointerTarget(p);
      if (this.sim.decor.isActive) {
        // Decorating: a selected piece goes onto the floor tile under the pointer; otherwise pick up what is clicked.
        if (!this.sim.decor.hasSelection && target.objectId) this.sim.clickObject(target.objectId);
        else this.sim.clickTile(target.tile);
        return;
      }
      if (target.customerId) this.sim.clickCustomer(target.customerId);
      else if (target.objectId) this.sim.clickObject(target.objectId);
      else this.sim.clickTile(target.tile);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.updateHover(this.pointerTarget(p)));
    this.input.keyboard?.on('keydown-ESC', () => this.sim.cancel());
    this.input.keyboard?.on('keydown-R', () => this.sim.decor.isActive && this.sim.decor.rotate());

    // Persist when the tab is hidden or closed (best effort; autosave covers the rest).
    const flush = () => this.autosave.saveNow();
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);

    this.scene.launch('HudScene', { session: this.session });
    installTestBridge(this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (!this.travelling) flush(); // travel already saved with the destination map
      this.customers?.destroy();
      this.customers = null;
      this.decor?.destroy();
      this.decor = null;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      this.autosave.destroy();
      this.feedback.destroy();
      this.playerView.destroy();
      this.sim.bus.clear();
    });
  }

  override update(time: number, delta: number): void {
    if (this.travelling) return;
    if (this.pendingTravel) return this.travel(this.pendingTravel);
    this.sim.tick(delta);
    // Decorating: follow the pointer every frame (Phaser can drop the first move after a HUD click).
    if (this.sim.decor.isActive) this.updateHover(this.pointerTarget(this.input.activePointer));
    const s = this.sim.snapshot();
    const cur = s.interaction.current;
    this.playerView.update({
      pos: s.player.pos,
      state: s.player.state,
      facing: s.player.facing,
      // A drink shows as its recipe name rather than its internal id.
      heldItem: s.cafe?.heldDrink ? (CONTENT.recipes[s.cafe.heldDrink.recipeId]?.label ?? s.player.heldItem) : s.player.heldItem,
      progress: cur?.phase === 'work' ? cur.progress : null,
    });
    this.worldRenderer.setPathPreview(s.player.waypoints.length ? [s.player.pos, ...s.player.waypoints] : null);
    this.plots.sync(s.farm.plots);
    this.equipment.sync(s.processing.equipment);
    if (s.cafe) this.customers?.sync(s.cafe.customers);
    this.decor?.sync(s.decor);
    this.autosave.update(time);
  }

  /** Commit state with the destination map, then rebuild the world (and HUD) from the save. */
  private travel(map: string): void {
    this.travelling = true;
    this.pendingTravel = null;
    this.sim.prepareTravel(map);
    this.session.saves!.save(this.sim.state, this.sim.clock.now());
    this.scene.stop('HudScene');
    this.scene.restart({ mapId: map, persistent: true });
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
  pointerTarget(p: { x: number; y: number }): { customerId: string | null; objectId: string | null; tile: TilePos } {
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    return {
      customerId: this.customers?.customerAtPoint(w.x, w.y) ?? null,
      objectId: this.worldRenderer.objectAtPoint(w.x, w.y),
      tile: worldToTile(screenToWorld({ x: w.x, y: w.y })),
    };
  }

  /** Render-space point on a customer's body (test bridge). */
  customerClickPoint(id: string): { x: number; y: number } | null {
    const c = this.sim.cafe?.customer(id);
    if (!c) return null;
    const s = worldToScreen(c.actor.pos);
    return { x: s.x, y: s.y - 22 };
  }

  /** Render-space point → screen (canvas) pixels; inverse of the camera transform. */
  renderToCanvas(px: number, py: number): { x: number; y: number } {
    const cam = this.cameras.main;
    return { x: (px - cam.worldView.x) * cam.zoom + cam.x, y: (py - cam.worldView.y) * cam.zoom + cam.y };
  }

  objectClickPoint(id: string): { x: number; y: number } | null {
    return this.worldRenderer.objectClickPoint(id);
  }

  private updateHover(target: { customerId: string | null; objectId: string | null; tile: TilePos }): void {
    const decor = this.sim.decor;
    if (decor.isActive) decor.hover(this.sim.world.grid.inBounds(target.tile) ? target.tile : null);
    const obj = target.objectId ? this.sim.world.getObject(target.objectId) : undefined;
    // Decorating highlights what can be picked up; otherwise what can be used.
    const pickable = decor.isActive ? !decor.hasSelection && !!obj && decor.isFurniture(obj.id) : !!obj?.def.interaction;
    const id = pickable ? obj!.id : null;
    if (id !== this.hoveredObject) {
      this.worldRenderer.setObjectHighlight(id ?? '', id !== null);
      this.hoveredObject = id;
    }
    const ghost = decor.isActive && decor.hasSelection; // the ghost already marks the tile
    this.worldRenderer.setHoverTile(!obj && !ghost && this.sim.world.grid.inBounds(target.tile) ? target.tile : null);
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
