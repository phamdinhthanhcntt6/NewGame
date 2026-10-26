import { StateMachine } from '../core/StateMachine';
import { worldToTile, type TilePos, type WorldPos } from '../utils/tile';

/**
 * IDLE        standing, hands empty
 * MOVING      following a path (may be holding an item)
 * INTERACTING arrived at an object, engaging / resolving the action
 * WORKING     performing a timed action (progress 0→1)
 * CARRYING    standing while holding an item
 */
export type ActorState = 'IDLE' | 'MOVING' | 'INTERACTING' | 'WORKING' | 'CARRYING';

export const ACTOR_TRANSITIONS: Record<ActorState, readonly ActorState[]> = {
  // IDLE ⇄ CARRYING: an item can appear in or leave the hands while standing
  // (e.g. a drink finished by the brewing panel, or discarded when its order ends).
  IDLE: ['MOVING', 'INTERACTING', 'CARRYING'],
  MOVING: ['IDLE', 'CARRYING', 'INTERACTING'],
  INTERACTING: ['WORKING', 'IDLE', 'CARRYING', 'MOVING'],
  WORKING: ['IDLE', 'CARRYING', 'MOVING'],
  CARRYING: ['MOVING', 'INTERACTING', 'IDLE'],
};

export type Facing = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

const FACINGS: Facing[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

/** Grid-space direction → 8-way facing (grid axes, not screen axes). */
export const facingFrom = (dx: number, dy: number): Facing | null => {
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return null;
  const a = Math.atan2(dy, dx);
  const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return FACINGS[i]!;
};

export interface ActorConfig {
  speedTilesPerSec: number;
  bodyRadius: number;
}

/**
 * A movable character in the simulation (player now; customers and
 * employees later). Holds position, path, held item and state. It knows
 * nothing about rendering or about why it is moving.
 */
export class Actor {
  pos: WorldPos;
  facing: Facing = 'S';
  heldItem: string | null = null;
  readonly fsm: StateMachine<ActorState>;
  private waypoints: WorldPos[] = [];

  constructor(
    readonly id: string,
    start: WorldPos,
    readonly config: ActorConfig,
    now: () => number,
  ) {
    this.pos = { ...start };
    this.fsm = new StateMachine<ActorState>(`actor:${id}`, 'IDLE', ACTOR_TRANSITIONS, now);
  }

  get state(): ActorState {
    return this.fsm.state;
  }

  get tile(): TilePos {
    return worldToTile(this.pos);
  }

  /** After the held item changed outside an interaction: re-derive the resting state if standing still. */
  syncRestState(): void {
    if (this.fsm.is('IDLE', 'CARRYING')) this.fsm.transition(this.restState());
  }

  /** The state an actor returns to when it has nothing to do. */
  restState(): ActorState {
    return this.heldItem ? 'CARRYING' : 'IDLE';
  }

  get remainingWaypoints(): readonly WorldPos[] {
    return this.waypoints;
  }

  setWaypoints(points: WorldPos[]): void {
    this.waypoints = points.map((p) => ({ ...p }));
  }

  clearWaypoints(): void {
    this.waypoints = [];
  }

  faceTowards(target: WorldPos): void {
    this.facing = facingFrom(target.x - this.pos.x, target.y - this.pos.y) ?? this.facing;
  }

  /**
   * Advances along the current waypoints. Returns true on the tick the
   * final waypoint is reached.
   */
  stepMovement(dtMs: number): boolean {
    if (this.waypoints.length === 0) return false;
    let budget = (this.config.speedTilesPerSec * dtMs) / 1000;
    while (budget > 0 && this.waypoints.length > 0) {
      const target = this.waypoints[0]!;
      const dx = target.x - this.pos.x;
      const dy = target.y - this.pos.y;
      const dist = Math.hypot(dx, dy);
      this.facing = facingFrom(dx, dy) ?? this.facing;
      if (dist <= budget) {
        this.pos = { ...target };
        budget -= dist;
        this.waypoints.shift();
      } else {
        this.pos = { x: this.pos.x + (dx / dist) * budget, y: this.pos.y + (dy / dist) * budget };
        budget = 0;
      }
    }
    return this.waypoints.length === 0;
  }
}
