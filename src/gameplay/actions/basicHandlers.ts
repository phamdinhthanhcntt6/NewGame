import type { EventBus } from '../../core/EventBus';
import type { GameEvents } from '../../core/events';
import type { ActionRegistry } from './ActionRegistry';

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`action param "${name}" must be a non-empty string`);
  return v;
};

/**
 * M1 sandbox handlers: generic "take an item into your hands" and "deliver
 * the held item to an object". Farming, brewing etc. register their own
 * handlers in later milestones.
 */
export function registerBasicHandlers(registry: ActionRegistry, bus: EventBus<GameEvents>): void {
  registry.register('held.take', {
    canStart: ({ actor }) => (actor.heldItem === null ? { ok: true } : { ok: false, reason: 'handsFull' }),
    complete: ({ actor, action }) => {
      actor.heldItem = str(action.params.item, 'item');
      bus.emit('actor:heldChanged', { actorId: actor.id, item: actor.heldItem });
    },
  });

  registry.register('held.deliver', {
    canStart: ({ actor, action }) =>
      actor.heldItem === str(action.params.item, 'item') ? { ok: true } : { ok: false, reason: 'needsItem' },
    complete: ({ actor, object, action }) => {
      actor.heldItem = null;
      const counter = action.params.counter;
      if (typeof counter === 'string') object.counters[counter] = (object.counters[counter] ?? 0) + 1;
      bus.emit('actor:heldChanged', { actorId: actor.id, item: null });
    },
  });

  registry.register('inspect', {
    canStart: () => ({ ok: true }),
    complete: ({ object }) => {
      object.counters.inspected = (object.counters.inspected ?? 0) + 1;
    },
  });
}
