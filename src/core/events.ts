import type { TilePos } from '../utils/tile';
import type { ActorState } from '../entities/Actor';
import type { PlotPhase, TxRecord } from '../gameplay/state/GameState';
import type { OrderStatus } from '../gameplay/cafe/OrderService';

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
  'world:objectSelected': { objectId: string };
  'economy:transaction': TxRecord;
  'farm:plotChanged': { plotId: string; phase: PlotPhase; locked: boolean; needsWater: boolean; stage: number; soilLevel: number };
  'farm:canChanged': { water: number; capacity: number };
  'farm:seedSelected': { seedId: string | null };
  'processing:changed': { equipmentId: string; status: 'idle' | 'working' | 'done' };
  'market:sold': { itemId: string; qty: number; coins: number };
  'order:changed': { orderId: number; customerId: string; recipeId: string; from: OrderStatus | null; to: OrderStatus; reason?: string };
  'customer:spawned': { customerId: string; archetype: string };
  'customer:stateChanged': { customerId: string; from: string; to: string };
  'customer:left': { customerId: string; reason: string; satisfaction: number };
  'customer:removed': { customerId: string; reason: 'stuck' };
  'world:travelRequested': { map: string };
  'brew:started': { orderId: number; recipeId: string };
  'brew:step': { orderId: number; stepIndex: number };
  'brew:finished': { orderId: number; drinkId: string; quality: number };
  'brew:aborted': { orderId: number; reason: 'cancelled' | 'orderEnded' };
  'brew:discarded': { drinkId: string; orderId: number };
  'cafe:paid': { orderId: number; coins: number; exp: number };
  'cafe:rated': { orderId: number; customerId: string; stars: number; score: number; feedback: string[]; coins: number; tip: number };
  'cafe:reputationChanged': { reputation: number; reason: string };
  'progression:levelUp': { from: number; to: number };
  'shop:opened': { shopId: string; objectId: string };
  'shop:closed': { shopId: string };
  'save:written': { at: number };
  'save:loadProblem': { status: 'corrupt' | 'invalid' | 'unsupported'; detail: string };
}
