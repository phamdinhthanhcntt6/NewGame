import type { EventBus } from '../../core/EventBus';
import type { GameEvents } from '../../core/events';
import type { ActionRegistry } from '../actions/ActionRegistry';
import { mustSucceed } from '../farm/farmHandlers';
import type { CafeService } from './CafeService';

/** Café counter and travel signs. `cafe` is null on maps without a café floor. */
export function registerCafeHandlers(registry: ActionRegistry, cafe: CafeService | null, bus: EventBus<GameEvents>, mapIds: readonly string[]): void {
  registry
    .register('cafe.takeOrder', {
      canStart: () => (cafe ? cafe.canTakeOrder() : { ok: false, reason: 'noCafe' }),
      complete: () => mustSucceed(cafe!.takeOrder(), 'takeOrder'),
    })
    .register('travel.go', {
      canStart: ({ object }) => (mapIds.includes(String(object.props.map)) ? { ok: true } : { ok: false, reason: 'unknownMap' }),
      complete: ({ object }) => bus.emit('world:travelRequested', { map: String(object.props.map) }),
    });
}
