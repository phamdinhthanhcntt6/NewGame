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
import { MarketService } from './market/MarketService';
import { ProcessingService, type EquipmentView } from './processing/ProcessingService';
import { registerProcessingHandlers } from './processing/processingHandlers';
import { ShopSessionService, registerShopHandlers } from '../systems/shop/ShopSessionService';
import { Rng } from '../core/Rng';
import { CafeService, type CustomerView } from './cafe/CafeService';
import { OrderService, type Order } from './cafe/OrderService';
import { registerCafeHandlers } from './cafe/cafeHandlers';
import { BrewingService, type BrewView } from './cafe/BrewingService';
import { SupplyService } from './cafe/SupplyService';
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
  farm: { plots: PlotView[]; can: { water: number; capacity: number }; selectedSeed: string | null; seedToPlant: string | null };
  /** Open shop session ('seeds' | 'market') or null. */
  shop: string | null;
  processing: { equipment: EquipmentView[]; selectedRecipe: Record<string, string | null> };
  market: { recentSales: TxRecord[] };
  /** null on maps without a café floor. */
  cafe: { customers: CustomerView[]; orders: Order[]; recentOrders: Order[]; queue: string[]; freeSpots: number; brew: BrewView | null; nextToBrew: number | null; heldDrink: { id: string; recipeId: string; orderId: number; quality: number } | null } | null;
}

export interface SimulationOptions {
  /** Restored save; a new game is created when omitted. */
  state?: GameState;
  clock?: Clock;
  /** Seed for customer spawning/orders (tests pass a fixed one). */
  rngSeed?: number;
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
  readonly shops: ShopSessionService;
  readonly processing: ProcessingService;
  readonly market: MarketService;
  readonly orders: OrderService;
  /** Present only on maps with a café floor (orderPoint marker). */
  readonly cafe: CafeService | null;
  readonly brewing: BrewingService;
  readonly supplies: SupplyService;
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
    this.shops = new ShopSessionService(this.world, this.bus, eco.farm.shopLeaveDistance);
    this.farm = new FarmService(this.state, this.world, content.seeds, eco.farm, this.tx, this.bus, this.clock, this.shops);
    this.processing = new ProcessingService(this.state, this.world, content.processing, this.tx, this.bus, this.clock);
    this.market = new MarketService(this.state, content.market, content.seeds, this.tx, this.shops, this.bus, this.clock);
    registerBasicHandlers(this.actions, this.bus);
    registerShopHandlers(this.actions, this.shops);
    registerFarmHandlers(this.actions, this.farm);
    registerProcessingHandlers(this.actions, this.processing);
    this.player = new Actor('player', tileCenter(this.startTile()), this.config.player, () => this.timeMs);
    this.player.fsm.onTransition((from, to) => this.bus.emit('actor:stateChanged', { actorId: this.player.id, from, to }));
    this.playerInteraction = new InteractionService(this.player, this.world, this.nav, this.actions, this.bus, this.config.player);
    this.orders = new OrderService(content.recipes, this.bus, () => this.timeMs);
    this.cafe = this.world.markers('orderPoint').length
      ? new CafeService(this.world, this.nav, this.orders, content.customers, this.bus, new Rng(opts.rngSeed ?? Date.now()), () => this.timeMs, this.config.player.bodyRadius, this.tx)
      : null;
    this.brewing = new BrewingService(this.world, this.nav, this.player, this.orders, content.recipes, content.brewing, content.items, this.tx, this.bus, () => this.timeMs);
    this.supplies = new SupplyService(content.brewing.supplies, this.tx, this.shops);
    registerCafeHandlers(this.actions, this.cafe, this.brewing, this.bus, Object.keys(content.maps));
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
      this.cafe?.tick(dt);
      remaining -= dt;
    }
    this.farm.update();
    this.shops.checkDistance(this.player.tile);
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

  /** Clicking a customer: serve them at their seat, or take their order at the counter. */
  clickCustomer(id: string): void {
    const c = this.cafe?.customer(id);
    if (!c) return;
    if (c.spot) return this.clickObject(c.spot.objectId);
    const counter = this.world.allObjects().find((o) => o.type === 'order_counter');
    if (counter && this.cafe!.customerAtCounter()?.id === id) this.clickObject(counter.id);
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

  /**
   * Prepare persistent state for leaving this map: commit everything and set
   * the destination so a reload resumes there. Café customers/orders are
   * transient and simply end.
   */
  prepareTravel(targetMap: string): GameState {
    this.cancel();
    this.captureState();
    this.state.player = { map: targetMap, tile: null };
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
      },
      shop: this.shops.current,
      processing: { equipment: this.processing.allViews(), selectedRecipe: { ...this.state.processing.selectedRecipe } },
      market: { recentSales: this.market.recentSales() },
      cafe: this.cafe
        ? { customers: this.cafe.views(), orders: this.orders.activeOrders().map((o) => structuredClone(o)), recentOrders: this.orders.recent().slice(0, 8).map((o) => structuredClone(o)), queue: [...this.cafe.queueOrder()], freeSpots: this.cafe.freeSpots(), brew: this.brewing.view(), nextToBrew: this.brewing.nextOrderToBrew(), heldDrink: (() => { const d = this.brewing.heldDrink(); return d ? { id: d.id, recipeId: d.recipeId, orderId: d.orderId, quality: d.quality } : null; })() }
        : null,
    };
  }
}
