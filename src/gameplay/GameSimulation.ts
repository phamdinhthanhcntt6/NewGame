import { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { Actor, type ActorState, type Facing } from '../entities/Actor';
import { InteractionService, type InteractionSnapshot } from '../systems/interaction/InteractionService';
import { NavigationService } from '../systems/navigation/NavigationService';
import { tileCenter, type TilePos, type WorldPos } from '../utils/tile';
import { ActionRegistry } from './actions/ActionRegistry';
import { registerBasicHandlers } from './actions/basicHandlers';
import { WorldModel } from './world/WorldModel';
import type { MapData, ObjectTypeTable } from './world/types';

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
  player: PlayerSnapshot;
  interaction: InteractionSnapshot;
  objects: Array<{ id: string; counters: Record<string, number> }>;
}

/**
 * Root of the headless gameplay simulation. Owns world, services and actors;
 * advanced only through tick(). Rendering reads snapshots and never writes.
 */
export class GameSimulation {
  readonly bus = new EventBus<GameEvents>();
  readonly world: WorldModel;
  readonly nav: NavigationService;
  readonly actions = new ActionRegistry();
  readonly player: Actor;
  readonly playerInteraction: InteractionService;
  private timeMs = 0;
  timeScale = 1;

  constructor(map: MapData, types: ObjectTypeTable, readonly config: GameplayConfig) {
    this.world = new WorldModel(map, types);
    this.nav = new NavigationService(this.world.grid, config.player.bodyRadius);
    registerBasicHandlers(this.actions, this.bus);
    this.player = new Actor('player', tileCenter(map.playerStart), config.player, () => this.timeMs);
    this.player.fsm.onTransition((from, to) => this.bus.emit('actor:stateChanged', { actorId: this.player.id, from, to }));
    this.playerInteraction = new InteractionService(this.player, this.world, this.nav, this.actions, this.bus, config.player);
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
  }

  /** Player input → command. A click on an object interacts; a click on floor moves. */
  clickTile(tile: TilePos): void {
    const obj = this.world.objectAt(tile);
    if (obj?.def.interaction) this.playerInteraction.request(obj.id);
    else this.playerInteraction.moveTo(tile);
  }

  /** Player clicked an object's visible shape. Non-interactive objects behave like a click on their tile. */
  clickObject(id: string): void {
    const obj = this.world.getObject(id);
    if (!obj) return;
    if (obj.def.interaction) this.playerInteraction.request(obj.id);
    else this.playerInteraction.moveTo({ x: obj.footprint.x, y: obj.footprint.y });
  }

  cancel(): void {
    this.playerInteraction.cancelAll('playerCancelled');
  }

  snapshot(): SimulationSnapshot {
    const p = this.player;
    return {
      timeMs: this.timeMs,
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
    };
  }
}
