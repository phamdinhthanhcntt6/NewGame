import economy from './config/economy.json';
import gameplay from './config/gameplay.json';
import items from './config/items.json';
import market from './config/market.json';
import processing from './config/processing.json';
import objectTypes from './config/objectTypes.json';
import seeds from './config/seeds.json';
import recipes from './config/recipes.json';
import customers from './config/customers.json';
import cafeMap from './maps/cafe.json';
import farmMap from './maps/farm.json';
import sandboxMap from './maps/sandbox.json';
import type { GameplayConfig } from '../gameplay/GameSimulation';
import type { FarmConfig } from '../gameplay/farm/FarmService';
import type { SeedTable } from '../gameplay/farm/plotModel';
import type { MapData, ObjectTypeTable } from '../gameplay/world/types';
import type { ItemTable } from '../systems/economy/TransactionService';
import type { ProcessingConfig } from '../gameplay/processing/ProcessingService';
import type { MarketConfig } from '../gameplay/market/MarketService';
import type { RecipeTable } from '../gameplay/cafe/OrderService';
import type { CustomerConfig } from '../gameplay/cafe/CafeService';

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
  processing: ProcessingConfig;
  market: MarketConfig;
  recipes: RecipeTable;
  customers: CustomerConfig;
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
  for (const [id, r] of Object.entries(c.processing.recipes)) {
    if (!c.processing.equipment[r.equipment]) p.push(`recipe ${id}: unknown equipment ${r.equipment}`);
    if (!c.items[r.input.itemId]) p.push(`recipe ${id}: unknown input ${r.input.itemId}`);
    if (!c.items[r.output.itemId]) p.push(`recipe ${id}: unknown output ${r.output.itemId}`);
    if (!(r.input.qty >= 1 && r.output.qty >= 1 && r.durationMs > 0)) p.push(`recipe ${id}: quantities/duration out of range`);
    if (!(r.output.itemId in c.market.basePrices)) p.push(`recipe ${id}: output ${r.output.itemId} has no market price`);
  }
  for (const [type, e] of Object.entries(c.processing.equipment)) {
    if (e.levels.some((l, i) => l.level !== i + 1)) p.push(`equipment ${type}: levels must be 1..n`);
    if (!c.objectTypes[type]) p.push(`equipment ${type}: no object type`);
  }
  for (const id of Object.keys(c.market.basePrices)) if (!c.items[id]) p.push(`market: unknown item ${id}`);
  for (const [id, r] of Object.entries(c.recipes)) {
    for (const ing of r.ingredients) {
      const kinds = [ing.itemId, ing.category, ing.utility].filter((k) => k !== undefined).length;
      if (kinds !== 1) p.push(`recipe ${id}: each ingredient needs exactly one of itemId/category/utility`);
      if (ing.itemId && !c.items[ing.itemId]) p.push(`recipe ${id}: unknown item ${ing.itemId}`);
      if (ing.category && !Object.values(c.items).some((it) => it.category === ing.category)) p.push(`recipe ${id}: no items in category ${ing.category}`);
    }
    if (!c.items[r.preferredBean]) p.push(`recipe ${id}: unknown preferredBean`);
  }
  for (const [k, a] of Object.entries(c.customers.archetypes)) {
    for (const rid of Object.keys(a.preferences)) if (!c.recipes[rid]) p.push(`customer ${k}: unknown recipe ${rid}`);
    if (!(a.orderPatienceMs > 0 && a.drinkPatienceMs > 0 && a.speedTilesPerSec > 0)) p.push(`customer ${k}: patience/speed must be > 0`);
  }
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
  processing: processing as ProcessingConfig,
  market: market as MarketConfig,
  recipes: recipes as RecipeTable,
  customers: customers as CustomerConfig,
  maps: { farm: farmMap as MapData, cafe: cafeMap as MapData, sandbox: sandboxMap as MapData },
};

const problems = validateContent(CONTENT);
if (problems.length) throw new Error(`Invalid game content:\n- ${problems.join('\n- ')}`);
