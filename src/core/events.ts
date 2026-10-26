import type { TilePos } from '../utils/tile';
import type { ActorState } from '../entities/Actor';

export type InteractionFailReason =
  | 'unreachable'
  | 'objectMissing'
  | 'notInteractable'
  | 'unknownAction'
  | 'requirementsNotMet'
  | 'queueFull';

export type CancelReason = 'superseded' | 'playerCancelled' | 'objectRemoved';

export interface IntentInfo {
  intentId: number;
  actorId: string;
  objectId: string;
  actionId: string | null;
}

/** Every gameplay fact the simulation publishes. Keys are namespaced by system. */
export interface GameEvents {
  'actor:stateChanged': { actorId: string; from: ActorState; to: ActorState };
  'actor:heldChanged': { actorId: string; item: string | null };
  'move:started': { actorId: string; target: TilePos; goal: TilePos; waypoints: number };
  'move:arrived': { actorId: string; tile: TilePos };
  'move:unreachable': { actorId: string; target: TilePos };
  'interaction:queued': IntentInfo & { queueLength: number };
  'interaction:started': IntentInfo & { actionId: string; durationMs: number };
  'interaction:completed': IntentInfo & { actionId: string };
  'interaction:failed': IntentInfo & { reason: InteractionFailReason; detail?: string };
  'interaction:cancelled': IntentInfo & { reason: CancelReason; progress: number };
}
