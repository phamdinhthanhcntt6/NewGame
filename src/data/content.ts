import economy from './config/economy.json';
import gameplay from './config/gameplay.json';
import items from './config/items.json';
import objectTypes from './config/objectTypes.json';
import seeds from './config/seeds.json';
import farmMap from './maps/farm.json';
import sandboxMap from './maps/sandbox.json';
import type { GameplayConfig } from '../gameplay/GameSimulation';
import type { FarmConfig } from '../gameplay/farm/FarmService';
import type { SeedTable } from '../gameplay/farm/plotModel';
import type { MapData, ObjectTypeTable } from '../gameplay/world/types';
import type { ItemTable } from '../systems/economy/TransactionService';

export interface EconomyConfig {
  startingCoins: number;
  startingItems: Record<string, number>;
  inventoryCapacity: number;
  historyLimit: number;
  processedKeyLimit: number;
  farm: FarmConfig;
}

/** Everything data-driven the simulation needs, typed once here. */
export interface GameContent {
  gameplay: GameplayConfig;
  economy: EconomyConfig;
  items: ItemTable;
  seeds: SeedTable;
  objectTypes: ObjectTypeTable;
  maps: Record<string, MapData>;
}

export function validateContent(c: GameContent): string[] {
  const p: string[] = [];
  for (const [id, s] of Object.entries(c.seeds)) {
    if (!c.items[s.seedItem]) p.push(`seed ${id}: unknown seedItem ${s.seedItem}`);
    if (!c.items[s.productItem]) p.push(`seed ${id}: unknown productItem ${s.productItem}`);
    if (!(s.waterings >= 1) || !Number.isInteger(s.waterings)) p.push(`seed ${id}: waterings must be an integer ≥ 1`);
    if (!(s.growthMs > 0)) p.push(`seed ${id}: growthMs must be > 0`);
    if (!(s.purchaseCost >= 0) || !(s.yield >= 1)) p.push(`seed ${id}: cost/yield out of range`);
  }
  for (const id of Object.keys(c.economy.startingItems)) if (!c.items[id]) p.push(`startingItems: unknown item ${id}`);
  const levels = c.economy.farm.soilLevels.map((l) => l.level);
  if (levels[0] !== 1 || levels.some((l, i) => l !== i + 1)) p.push('soilLevels must be 1..n in order');
  return p;
}

export const CONTENT: GameContent = {
  gameplay: gameplay as GameplayConfig,
  economy: economy as EconomyConfig,
  items: items as ItemTable,
  seeds: seeds as SeedTable,
  objectTypes: objectTypes as ObjectTypeTable,
  maps: { farm: farmMap as MapData, sandbox: sandboxMap as MapData },
};

const problems = validateContent(CONTENT);
if (problems.length) throw new Error(`Invalid game content:\n- ${problems.join('\n- ')}`);
