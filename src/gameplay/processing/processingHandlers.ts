import type { ActionRegistry } from '../actions/ActionRegistry';
import { mustSucceed } from '../farm/farmHandlers';
import type { ProcessingService } from './ProcessingService';

/** Equipment actions: collect finished output first, otherwise load a new batch. */
export function registerProcessingHandlers(registry: ActionRegistry, processing: ProcessingService): void {
  registry
    .register('process.collect', {
      canStart: ({ object }) => processing.canCollect(object.id),
      complete: ({ object }) => mustSucceed(processing.collect(object.id), 'collect'),
    })
    .register('process.load', {
      canStart: ({ object }) => processing.canLoad(object.id),
      complete: ({ object }) => mustSucceed(processing.load(object.id), 'load'),
    });
}
