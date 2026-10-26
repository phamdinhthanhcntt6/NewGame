import type { EventBus } from '../../core/EventBus';
import type { GameEvents } from '../../core/events';
import type { ActionRegistry } from '../actions/ActionRegistry';
import { mustSucceed } from '../farm/farmHandlers';
import type { BrewingService } from './BrewingService';
import type { CafeService } from './CafeService';

/** Café counter, brewing stations, serving spots and travel signs. `cafe` is null on maps without a café floor. */
export function registerCafeHandlers(
  registry: ActionRegistry,
  cafe: CafeService | null,
  brewing: BrewingService,
  bus: EventBus<GameEvents>,
  mapIds: readonly string[],
): void {
  registry
    .register('cafe.takeOrder', {
      canStart: () => (cafe ? cafe.canTakeOrder() : { ok: false, reason: 'noCafe' }),
      complete: () => mustSucceed(cafe!.takeOrder(), 'takeOrder'),
    })
    .register('brew.station', {
      // The station type identifies the step (grinder, espresso machine, milk station).
      canStart: ({ object }) => brewing.canUseStation(object.type),
      complete: ({ object }) => mustSucceed(brewing.useStation(object.type), 'useStation'),
    })
    .register('cafe.serve', {
      canStart: ({ object }) => (cafe ? cafe.canServe(object.id, brewing.heldDrink()) : { ok: false, reason: 'noCafe' }),
      complete: ({ object }) => {
        const drink = brewing.heldDrink()!;
        mustSucceed(cafe!.receive(object.id, drink), 'serve');
        brewing.handOver(drink.id);
      },
    })
    .register('travel.go', {
      canStart: ({ object }) => (mapIds.includes(String(object.props.map)) ? { ok: true } : { ok: false, reason: 'unknownMap' }),
      complete: ({ object }) => bus.emit('world:travelRequested', { map: String(object.props.map) }),
    });
}
