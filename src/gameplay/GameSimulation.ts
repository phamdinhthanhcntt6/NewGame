import { SystemClock, type Clock } from '../core/Clock';
import { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { GameContent } from '../data/content';
import { Actor, type ActorState, type Facing } from '../entities/Actor';
import { TransactionService } from '../systems/economy/TransactionService';
import { InteractionService, type InteractionSnapshot } from '../systems/interaction/InteractionService';
import { NavigationService } from '../systems/navigation/NavigationService';
import { tileCenter, type TilePos, type WorldPos } from '../utils/tile';
import { ActionRegistry } from './actions/ActionRegistry';
import { registerBasicHandlers } from './actions/basicHandlers';
import { FarmService, type PlotView } from './farm/FarmService';
import { registerFarmHandlers } from './farm/farmHandlers';
import { createNewGameState, type GameState, type ItemStack, type TxRecord } from './state/GameState';
import { WorldModel } from './world/WorldModel';
import type { MapData } from './world/types';

export interface GameplayConfig {
  player: {
    speedTilesPerSec: number;
    bodyRadius: number;
    engageMs: number;
    maxQueuedInteractions: number;
    blockedClickSearchRadius: number;
  };
  simulation: { maxStepMs: number };
}

export interface PlayerSnapshot {
  id: string;
  pos: WorldPos;
  tile: TilePos;
  state: ActorState;
  facing: Facing;
  heldItem: string | null;
  waypoints: WorldPos[];
}

export interface SimulationSnapshot {
  timeMs: number;
  clockMs: number;
  map: string;
  player: PlayerSnapshot;
  interaction: InteractionSnapshot;
  objects: Array<{ id: string; counters: Record<string, number> }>;
  economy: { coins: number; exp: number; inventory: Record<string, ItemStack>; itemCount: number; capacity: number; lastTx: TxRecord | null };
  farm: { plots: PlotView[]; can: { water: number; capacity: number }; selectedSeed: string | null; seedToPlant: string | null; shop: string | null };
}

export interface SimulationOptions {
  /** Restored save; a new game is created when omitted. */
  state?: GameState;
  clock?: Clock;
}

/**
 * Root of the headless gameplay simulation. Owns world, services, actors and
 * the persistent GameState; advanced only through tick(). Rendering reads
 * snapshots and never writes.
 */
export class GameSimulation {
  readonly bus = new EventBus<GameEvents>();
  readonly world: WorldModel;
  readonly nav: NavigationService;
  readonly actions = new ActionRegistry();
  readonly state: GameState;
  readonly clock: Clock;
  readonly tx: TransactionService;
  readonly farm: FarmService;
  readonly player: Actor;
  readonly playerInteraction: InteractionService;
  readonly config: GameplayConfig;
  private timeMs = 0;
  timeScale = 1;

  constructor(
    readonly map: MapData,
    readonly content: GameContent,
    opts: SimulationOptions = {},
  ) {
    this.config = content.gameplay;
    this.clock = opts.clock ?? new SystemClock();
    const eco = content.economy;
    this.state =
      opts.state ??
      createNewGameState({
        now: this.clock.now(),
        startingCoins: eco.startingCoins,
        startingItems: eco.startingItems,
        wateringCanCapacity: eco.farm.wateringCan.capacity,
        map: map.id,
      });
    this.world = new WorldModel(map, content.objectTypes);
    this.nav = new NavigationService(this.world.grid, this.config.player.bodyRadius);
    this.tx = new TransactionService(this.state, content.items, eco, this.bus, this.clock);
    this.farm = new FarmService(this.state, this.world, content.seeds, eco.farm, this.tx, this.bus, this.clock);
    registerBasicHandlers(this.actions, this.bus);
    registerFarmHandlers(this.actions, this.farm);

    this.player = new Actor('player', tileCenter(this.startTile()), this.config.player, () => this.timeMs);
    this.player.fsm.onTransition((from, to) => this.bus.emit('actor:stateChanged', { actorId: this.player.id, from, to }));
    this.playerInteraction = new InteractionService(this.player, this.world, this.nav, this.actions, this.bus, this.config.player);
  }

  /** Resume where the save left the player, if that spot is still walkable on this map. */
  private startTile(): TilePos {
    const saved = this.state.player;
    if (saved.map === this.map.id && saved.tile && this.world.grid.isWalkable(saved.tile)) return saved.tile;
    return this.map.playerStart;
  }

  get now(): number {
    return this.timeMs;
  }

  /** Advance by real elapsed ms. Large gaps (tab switch) are split into bounded steps. */
  tick(realDtMs: number): void {
    let remaining = Math.max(0, realDtMs) * this.timeScale;
    const step = this.config.simulation.maxStepMs;
    while (remaining > 0) {
      const dt = Math.min(step, remaining);
      this.timeMs += dt;
      this.playerInteraction.tick(dt);
      remaining -= dt;
    }
    this.farm.update();
    this.farm.checkShopDistance(this.player.tile);
  }

  /** Player input → command. A click on an object interacts; a click on floor moves. */
  clickTile(tile: TilePos): void {
    const obj = this.world.objectAt(tile);
    if (obj) this.clickObject(obj.id);
    else this.playerInteraction.moveTo(tile);
  }

  /** Player clicked an object's visible shape. Non-interactive objects behave like a click on their tile. */
  clickObject(id: string): void {
    const obj = this.world.getObject(id);
    if (!obj) return;
    this.bus.emit('world:objectSelected', { objectId: id });
    if (!obj.def.interaction) {
      this.playerInteraction.moveTo({ x: obj.footprint.x, y: obj.footprint.y });
      return;
    }
    // Don't walk the player somewhere just to be told "no" (e.g. land not bought yet).
    const gate = this.farm.interactionGate(id);
    if (gate) this.playerInteraction.rejectWithoutMoving(id, gate);
    else this.playerInteraction.request(obj.id);
  }

  cancel(): void {
    this.playerInteraction.cancelAll('playerCancelled');
  }

  /** Copy transient runtime data into the persistent state, ready to save. */
  captureState(): GameState {
    this.farm.update();
    this.state.player = { map: this.map.id, tile: this.player.tile };
    return this.state;
  }

  snapshot(): SimulationSnapshot {
    const p = this.player;
    const eco = this.state.economy;
    return {
      timeMs: this.timeMs,
      clockMs: this.clock.now(),
      map: this.map.id,
      player: {
        id: p.id,
        pos: { ...p.pos },
        tile: p.tile,
        state: p.state,
        facing: p.facing,
        heldItem: p.heldItem,
        waypoints: p.remainingWaypoints.map((w) => ({ ...w })),
      },
      interaction: this.playerInteraction.snapshot(),
      objects: this.world.allObjects().map((o) => ({ id: o.id, counters: { ...o.counters } })),
      economy: {
        coins: eco.coins,
        exp: this.state.progression.exp,
        inventory: structuredClone(eco.inventory),
        itemCount: this.tx.totalItems(),
        capacity: this.content.economy.inventoryCapacity,
        lastTx: eco.history.at(-1) ?? null,
      },
      farm: {
        plots: this.farm.allPlotViews(),
        can: { water: this.farm.canWater, capacity: this.content.economy.farm.wateringCan.capacity },
        selectedSeed: this.farm.selectedSeed,
        seedToPlant: this.farm.seedToPlant(),
        shop: this.farm.openShop,
      },
    };
  }
}
