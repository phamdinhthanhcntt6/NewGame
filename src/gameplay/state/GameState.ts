import type { TilePos } from '../../utils/tile';

/**
 * The complete persistent game state: plain JSON, no class instances, no
 * Phaser. Saving = serialising this object; loading = validating + migrating it.
 * Services mutate it only through their own methods.
 */
export const SAVE_SCHEMA_VERSION = 2;

export interface ItemStack {
  qty: number;
  /** Average quality 0–100 of the units in the stack. */
  quality: number;
}

export interface TxItemDelta {
  itemId: string;
  qty: number;
  quality?: number;
}

export interface TxRecord {
  id: number;
  at: number;
  reason: string;
  coins: number;
  exp: number;
  items: TxItemDelta[];
  key?: string;
}

export type PlotPhase = 'EMPTY' | 'PREPARED' | 'PLANTED' | 'GROWING' | 'READY' | 'HARVESTED';

export interface PlotState {
  id: string;
  locked: boolean;
  price: number;
  soilLevel: number;
  phase: PlotPhase;
  seedId: string | null;
  /** Epoch ms when planted; part of the harvest idempotency key. */
  plantedAt: number | null;
  /** Effective growth accumulated (ms), only while watered. */
  growthMs: number;
  /** Waterings received for the current crop. */
  waterings: number;
  /** Epoch ms up to which growth/dryness has been computed. */
  lastUpdateAt: number;
  /** Total ms the crop spent waiting for water (lowers quality). */
  dryMs: number;
  readyAt: number | null;
}

export interface ProcessingJob {
  recipeId: string;
  /** Epoch ms; with the equipment id it forms the collection idempotency key. */
  startedAt: number;
  durationMs: number;
  inputItem: string;
  inputQty: number;
  outputItem: string;
  outputQty: number;
  outputQuality: number;
  expReward: number;
}

export interface EquipmentState {
  id: string;
  type: string;
  level: number;
  /** Inputs were already consumed when the job was created; outputs exist only here until collected. */
  job: ProcessingJob | null;
}

export interface GameState {
  schemaVersion: number;
  createdAt: number;
  savedAt: number;
  economy: {
    coins: number;
    inventory: Record<string, ItemStack>;
    nextTxId: number;
    history: TxRecord[];
    /** Idempotency keys of completed one-off transactions (rewards, purchases). */
    processedKeys: string[];
  };
  progression: { exp: number };
  farm: {
    plots: Record<string, PlotState>;
    wateringCan: { water: number };
    selectedSeed: string | null;
  };
  player: { map: string; tile: TilePos | null };
  /** v2 */
  processing: {
    equipment: Record<string, EquipmentState>;
    /** Preferred recipe per equipment type (HUD choice); null = first runnable. */
    selectedRecipe: Record<string, string | null>;
  };
  /** v2: market saturation per item (decays over time). */
  market: { saturation: Record<string, { value: number; at: number }> };
}

export interface NewGameOptions {
  now: number;
  startingCoins: number;
  startingItems: Record<string, number>;
  wateringCanCapacity: number;
  map: string;
}

export function createNewGameState(o: NewGameOptions): GameState {
  const inventory: Record<string, ItemStack> = {};
  for (const [itemId, qty] of Object.entries(o.startingItems)) inventory[itemId] = { qty, quality: 50 };
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    createdAt: o.now,
    savedAt: o.now,
    economy: { coins: o.startingCoins, inventory, nextTxId: 1, history: [], processedKeys: [] },
    progression: { exp: 0 },
    farm: { plots: {}, wateringCan: { water: o.wateringCanCapacity }, selectedSeed: null },
    player: { map: o.map, tile: null },
    processing: { equipment: {}, selectedRecipe: {} },
    market: { saturation: {} },
  };
}

/** Save migrations: key = version migrated FROM. */
export const SAVE_MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2 (M3): processing equipment and market state did not exist yet.
  1: (raw) => ({ ...raw, processing: { equipment: {}, selectedRecipe: {} }, market: { saturation: {} } }),
};
