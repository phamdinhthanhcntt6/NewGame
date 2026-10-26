import type { ActionRegistry, CanStartResult } from '../actions/ActionRegistry';
import type { FarmResult, FarmService } from './FarmService';

const asCan = (r: FarmResult): CanStartResult => r;

const mustSucceed = (r: FarmResult, what: string): void => {
  // canStart already passed moments ago; a failure here means a rule bug, not a player error.
  if (!r.ok) throw new Error(`${what} failed after canStart passed: ${r.reason}`);
};

/** Binds farm actions declared in objectTypes.json to FarmService rules. */
export function registerFarmHandlers(registry: ActionRegistry, farm: FarmService): void {
  registry
    .register('farm.prepare', {
      canStart: ({ object }) => asCan(farm.canPrepare(object.id)),
      complete: ({ object }) => mustSucceed(farm.prepare(object.id), 'prepare'),
    })
    .register('farm.plant', {
      canStart: ({ object }) => asCan(farm.canPlant(object.id)),
      complete: ({ object }) => mustSucceed(farm.plant(object.id), 'plant'),
    })
    .register('farm.water', {
      canStart: ({ object }) => asCan(farm.canWaterPlot(object.id)),
      complete: ({ object }) => mustSucceed(farm.water(object.id), 'water'),
    })
    .register('farm.harvest', {
      canStart: ({ object }) => asCan(farm.canHarvest(object.id)),
      complete: ({ object }) => mustSucceed(farm.harvest(object.id), 'harvest'),
    })
    .register('farm.refill', {
      canStart: () => asCan(farm.canRefill()),
      complete: () => mustSucceed(farm.refill(), 'refill'),
    })
    .register('shop.open', {
      canStart: () => ({ ok: true }),
      complete: ({ object, action }) => farm.openShopAt(String(action.params.shopId ?? 'seeds'), object.id),
    });
}
