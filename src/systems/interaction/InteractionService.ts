import type { EventBus } from '../../core/EventBus';
import type { CancelReason, GameEvents, InteractionFailReason, IntentInfo } from '../../core/events';
import type { Actor, ActorState } from '../../entities/Actor';
import type { ActionRegistry } from '../../gameplay/actions/ActionRegistry';
import type { WorldModel } from '../../gameplay/world/WorldModel';
import type { ActionDef, WorldObject } from '../../gameplay/world/types';
import type { TilePos } from '../../utils/tile';
import type { ApproachSpec, NavigationService } from '../navigation/NavigationService';

export interface InteractionConfig {
  engageMs: number;
  maxQueuedInteractions: number;
  blockedClickSearchRadius: number;
}

interface Intent {
  id: number;
  objectId: string;
  actionId: string | null;
}

type Phase = 'approach' | 'engage' | 'work';

interface ActiveIntent {
  intent: Intent;
  phase: Phase;
  elapsed: number;
  action: ActionDef | null;
  completed: boolean;
  reapproaches: number;
}

export interface InteractionSnapshot {
  current: { objectId: string; actionId: string | null; phase: Phase; progress: number } | null;
  queue: Array<{ objectId: string; actionId: string | null }>;
  moveTarget: TilePos | null;
}

const MAX_REAPPROACH = 2;

/**
 * Drives one actor through "go somewhere" and "go to an object and use it".
 *
 * Queue rule (documented in docs/GAMEPLAY_SYSTEMS.md):
 * - Clicking an object adds an interaction to the FIFO queue (max N). If the
 *   actor is only walking to a floor tile, that walk is replaced.
 * - Clicking the floor cancels the current interaction and the queue, then walks.
 * - cancelAll() (Esc / right click) stops everything; a cancelled WORKING
 *   action produces nothing.
 * - Each intent completes at most once.
 */
export class InteractionService {
  private queue: Intent[] = [];
  private current: ActiveIntent | null = null;
  private moveTarget: TilePos | null = null;
  private nextId = 1;

  constructor(
    private readonly actor: Actor,
    private readonly world: WorldModel,
    private readonly nav: NavigationService,
    private readonly actions: ActionRegistry,
    private readonly bus: EventBus<GameEvents>,
    private readonly config: InteractionConfig,
  ) {}

  // ── commands ────────────────────────────────────────────────────────────

  /** Walk to a floor tile (or the nearest reachable tile to it). */
  moveTo(target: TilePos): boolean {
    this.cancelAll('superseded', false);
    const plan = this.nav.planToTileOrNearest(this.actor.pos, target, this.config.blockedClickSearchRadius);
    if (!plan) {
      this.bus.emit('move:unreachable', { actorId: this.actor.id, target });
      this.setState(this.actor.restState());
      return false;
    }
    this.actor.setWaypoints(plan.waypoints);
    this.moveTarget = plan.goal;
    this.setState('MOVING');
    this.bus.emit('move:started', { actorId: this.actor.id, target, goal: plan.goal, waypoints: plan.waypoints.length });
    return true;
  }

  /** Queue an interaction with an object. Returns the intent id, or null if rejected. */
  request(objectId: string, actionId: string | null = null): number | null {
    const obj = this.world.getObject(objectId);
    const info = (id: number): IntentInfo => ({ intentId: id, actorId: this.actor.id, objectId, actionId });
    if (!obj) return this.reject(info(this.nextId++), 'objectMissing');
    if (!obj.def.interaction) return this.reject(info(this.nextId++), 'notInteractable');
    if (actionId && !obj.def.interaction.actions.some((a) => a.id === actionId)) {
      return this.reject(info(this.nextId++), 'unknownAction');
    }

    // Ignore repeated clicks on the same target (double-click / tap spam).
    const same = (i: Intent): boolean => i.objectId === objectId && i.actionId === actionId;
    const last = this.queue[this.queue.length - 1];
    if (last && same(last)) return last.id;
    if (!last && this.current && !this.current.completed && same(this.current.intent)) return this.current.intent.id;

    const intent: Intent = { id: this.nextId++, objectId, actionId };
    if (this.moveTarget) this.stopFreeMove();
    if (!this.current) {
      this.start(intent);
      return intent.id;
    }
    if (this.queue.length >= this.config.maxQueuedInteractions) return this.reject(info(intent.id), 'queueFull');
    this.queue.push(intent);
    this.bus.emit('interaction:queued', { ...info(intent.id), queueLength: this.queue.length });
    return intent.id;
  }

  /** Report a request as impossible up front (e.g. locked land) without touching the queue or moving. */
  rejectWithoutMoving(objectId: string, detail: string): void {
    this.bus.emit('interaction:failed', { intentId: this.nextId++, actorId: this.actor.id, objectId, actionId: null, reason: 'requirementsNotMet', detail });
  }

  /** Stop moving/working and drop the queue. Nothing is rewarded for cancelled work. */
  cancelAll(reason: CancelReason = 'playerCancelled', toRest = true): void {
    if (this.current && !this.current.completed) {
      const c = this.current;
      const progress = c.phase === 'work' && c.action && c.action.durationMs > 0 ? Math.min(1, c.elapsed / c.action.durationMs) : 0;
      this.bus.emit('interaction:cancelled', { ...this.infoOf(c.intent), reason, progress });
    }
    for (const q of this.queue) this.bus.emit('interaction:cancelled', { ...this.infoOf(q), reason, progress: 0 });
    this.current = null;
    this.queue = [];
    this.moveTarget = null;
    this.actor.clearWaypoints();
    if (toRest) this.setState(this.actor.restState());
  }

  /** Called when an object disappears (e.g. furniture moved in decorate mode). */
  onObjectRemoved(objectId: string): void {
    const dropped = this.queue.filter((q) => q.objectId === objectId);
    this.queue = this.queue.filter((q) => q.objectId !== objectId);
    for (const q of dropped) this.bus.emit('interaction:cancelled', { ...this.infoOf(q), reason: 'objectRemoved', progress: 0 });
    if (this.current?.intent.objectId === objectId) {
      const c = this.current;
      this.bus.emit('interaction:cancelled', { ...this.infoOf(c.intent), reason: 'objectRemoved', progress: 0 });
      this.current = null;
      this.actor.clearWaypoints();
      this.setState(this.actor.restState());
      this.advance();
    }
  }

  /** The walkable grid changed (furniture placed or moved): re-plan an ongoing walk from where the actor is. */
  onNavChanged(): void {
    if (this.moveTarget) {
      const target = this.moveTarget;
      const plan = this.nav.planToTileOrNearest(this.actor.pos, target, this.config.blockedClickSearchRadius);
      if (plan) {
        this.actor.setWaypoints(plan.waypoints);
        this.moveTarget = plan.goal;
      } else {
        this.moveTarget = null;
        this.actor.clearWaypoints();
        this.setState(this.actor.restState());
        this.bus.emit('move:unreachable', { actorId: this.actor.id, target });
      }
      return;
    }
    const c = this.current;
    if (c?.phase === 'approach') this.start(c.intent, c.reapproaches);
  }

  // ── simulation ──────────────────────────────────────────────────────────

  tick(dtMs: number): void {
    if (this.moveTarget) {
      if (this.actor.stepMovement(dtMs)) {
        const tile = this.moveTarget;
        this.moveTarget = null;
        this.setState(this.actor.restState());
        this.bus.emit('move:arrived', { actorId: this.actor.id, tile });
      }
      return;
    }
    const c = this.current;
    if (!c) return;
    switch (c.phase) {
      case 'approach':
        if (this.actor.stepMovement(dtMs)) {
          this.bus.emit('move:arrived', { actorId: this.actor.id, tile: this.actor.tile });
          this.engage(c);
        }
        break;
      case 'engage':
        c.elapsed += dtMs;
        if (c.elapsed >= this.config.engageMs) {
          if (c.action && c.action.durationMs > 0) {
            c.phase = 'work';
            c.elapsed = 0;
            this.setState('WORKING');
          } else this.complete(c);
        }
        break;
      case 'work':
        c.elapsed += dtMs;
        if (c.action && c.elapsed >= c.action.durationMs) this.complete(c);
        break;
    }
  }

  snapshot(): InteractionSnapshot {
    const c = this.current;
    return {
      current: c
        ? {
            objectId: c.intent.objectId,
            actionId: c.action?.id ?? c.intent.actionId,
            phase: c.phase,
            progress: c.phase === 'work' && c.action && c.action.durationMs > 0 ? Math.min(1, c.elapsed / c.action.durationMs) : 0,
          }
        : null,
      queue: this.queue.map((q) => ({ objectId: q.objectId, actionId: q.actionId })),
      moveTarget: this.moveTarget,
    };
  }

  // ── internals ───────────────────────────────────────────────────────────

  private approachSpec(obj: WorldObject): ApproachSpec {
    return { footprint: obj.footprint, radius: obj.def.interaction?.radius ?? 1, sides: obj.sides };
  }

  private start(intent: Intent, reapproaches = 0): void {
    const c: ActiveIntent = { intent, phase: 'approach', elapsed: 0, action: null, completed: false, reapproaches };
    this.current = c;
    const obj = this.world.getObject(intent.objectId);
    if (!obj) return this.fail(c, 'objectMissing');
    const spec = this.approachSpec(obj);
    if (this.nav.isWithinReach(this.actor.tile, spec)) return this.engage(c);
    const plan = this.nav.planToApproach(this.actor.pos, spec);
    if (!plan) return this.fail(c, 'unreachable');
    this.actor.setWaypoints(plan.waypoints);
    this.setState('MOVING');
    this.bus.emit('move:started', { actorId: this.actor.id, target: plan.goal, goal: plan.goal, waypoints: plan.waypoints.length });
  }

  private engage(c: ActiveIntent): void {
    const obj = this.world.getObject(c.intent.objectId);
    if (!obj) return this.fail(c, 'objectMissing');
    if (!this.nav.isWithinReach(this.actor.tile, this.approachSpec(obj))) {
      // The world changed under us (e.g. furniture moved). Try again a bounded number of times.
      if (c.reapproaches >= MAX_REAPPROACH) return this.fail(c, 'unreachable');
      return this.start(c.intent, c.reapproaches + 1);
    }
    const resolved = this.resolveAction(obj, c.intent.actionId);
    if ('fail' in resolved) return this.fail(c, resolved.fail, resolved.detail);
    c.action = resolved.action;
    c.phase = 'engage';
    c.elapsed = 0;
    const f = obj.footprint;
    this.actor.faceTowards({ x: f.x + f.w / 2, y: f.y + f.h / 2 });
    this.setState('INTERACTING');
    this.bus.emit('interaction:started', { ...this.infoOf(c.intent), actionId: resolved.action.id, durationMs: resolved.action.durationMs });
  }

  private resolveAction(
    obj: WorldObject,
    actionId: string | null,
  ): { action: ActionDef } | { fail: InteractionFailReason; detail?: string } {
    const candidates = (obj.def.interaction?.actions ?? []).filter((a) => !actionId || a.id === actionId);
    if (candidates.length === 0) return { fail: 'unknownAction' };
    let firstReason: string | undefined;
    let firstApplicable: string | undefined;
    for (const action of candidates) {
      const handler = this.actions.get(action.handler);
      if (!handler) return { fail: 'unknownAction', detail: `no handler "${action.handler}"` };
      const r = handler.canStart({ actor: this.actor, object: obj, action });
      if (r.ok) return { action };
      firstReason ??= r.reason;
      if (r.applicable !== false) firstApplicable ??= r.reason;
    }
    const detail = firstApplicable ?? firstReason;
    return detail === undefined ? { fail: 'requirementsNotMet' } : { fail: 'requirementsNotMet', detail };
  }

  private complete(c: ActiveIntent): void {
    if (c.completed || this.current !== c || !c.action) return;
    const obj = this.world.getObject(c.intent.objectId);
    if (!obj) return this.fail(c, 'objectMissing');
    const handler = this.actions.get(c.action.handler)!;
    const ctx = { actor: this.actor, object: obj, action: c.action };
    const check = handler.canStart(ctx);
    if (!check.ok) return this.fail(c, 'requirementsNotMet', check.reason);
    c.completed = true;
    handler.complete(ctx);
    this.current = null;
    this.setState(this.actor.restState());
    this.bus.emit('interaction:completed', { ...this.infoOf(c.intent), actionId: c.action.id });
    this.advance();
  }

  private fail(c: ActiveIntent, reason: InteractionFailReason, detail?: string): void {
    if (this.current === c) this.current = null;
    this.actor.clearWaypoints();
    this.setState(this.actor.restState());
    this.bus.emit('interaction:failed', { ...this.infoOf(c.intent), reason, ...(detail ? { detail } : {}) });
    this.advance();
  }

  private reject(info: IntentInfo, reason: InteractionFailReason): null {
    this.bus.emit('interaction:failed', { ...info, reason });
    return null;
  }

  private advance(): void {
    if (this.current) return;
    const next = this.queue.shift();
    if (next) this.start(next);
  }

  private stopFreeMove(): void {
    this.moveTarget = null;
    this.actor.clearWaypoints();
  }

  private setState(s: ActorState): void {
    this.actor.fsm.transition(s);
  }

  private infoOf(i: Intent): IntentInfo {
    return { intentId: i.id, actorId: this.actor.id, objectId: i.objectId, actionId: i.actionId };
  }
}
