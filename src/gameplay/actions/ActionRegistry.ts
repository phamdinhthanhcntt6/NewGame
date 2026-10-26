import type { Actor } from '../../entities/Actor';
import type { ActionDef, WorldObject } from '../world/types';

export interface ActionContext {
  actor: Actor;
  object: WorldObject;
  action: ActionDef;
}

export type CanStartResult = { ok: true } | { ok: false; reason: string };

/**
 * A gameplay rule bound to an action id from data. Handlers are the only
 * code allowed to change gameplay state as the result of an interaction.
 */
export interface ActionHandler {
  canStart(ctx: ActionContext): CanStartResult;
  complete(ctx: ActionContext): void;
}

export class ActionRegistry {
  private readonly handlers = new Map<string, ActionHandler>();

  register(key: string, handler: ActionHandler): this {
    if (this.handlers.has(key)) throw new Error(`action handler "${key}" already registered`);
    this.handlers.set(key, handler);
    return this;
  }

  get(key: string): ActionHandler | undefined {
    return this.handlers.get(key);
  }

  has(key: string): boolean {
    return this.handlers.has(key);
  }
}
