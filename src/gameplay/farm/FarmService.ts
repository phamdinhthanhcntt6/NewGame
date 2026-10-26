import type { Clock } from '../../core/Clock';
import type { EventBus } from '../../core/EventBus';
import type { GameEvents } from '../../core/events';
import type { TransactionService } from '../../systems/economy/TransactionService';
import { distanceToFootprint, type TilePos } from '../../utils/tile';
import type { GameState, PlotState } from '../state/GameState';
import type { WorldModel } from '../world/WorldModel';
import {
  advancePlot,
  growthProgress,
  growthStage,
  harvestQuality,
  harvestYield,
  needsWater,
  soilOf,
  type FarmRules,
  type SeedTable,
} from './plotModel';

export const PLOT_TYPE = 'farm_plot';

export type FarmResult = { ok: true } | { ok: false; reason: string; applicable?: boolean };

export interface FarmConfig extends FarmRules {
  wateringCan: { capacity: number };
  shopLeaveDistance: number;
}

export interface PlotView extends PlotState {
  needsWater: boolean;
  progress: number;
  stage: number;
}

const OK: FarmResult = { ok: true };
const no = (reason: string, applicable = true): FarmResult => ({ ok: false, reason, applicable });

/**
 * Farming rules: plot lifecycle, seeds, watering, harvest, land purchase and
 * soil upgrades. Mutates only `state.farm`; every coin/item/EXP change goes
 * through the TransactionService.
 */
export class FarmService {
  private shop: { shopId: string; objectId: string } | null = null;
  private lastSignature = new Map<string, string>();

  constructor(
    private readonly state: GameState,
    private readonly world: WorldModel,
    readonly seeds: SeedTable,
    readonly config: FarmConfig,
    private readonly tx: TransactionService,
    private readonly bus: EventBus<GameEvents>,
    private readonly clock: Clock,
  ) {
    this.syncPlotsWithMap();
    this.update();
  }

  // ── setup ───────────────────────────────────────────────────────────────

  /** Every plot object on the map gets a persistent PlotState (existing saves keep theirs). */
  private syncPlotsWithMap(): void {
    const now = this.clock.now();
    for (const o of this.world.allObjects()) {
      if (o.type !== PLOT_TYPE || this.state.farm.plots[o.id]) continue;
      const price = typeof o.props.price === 'number' ? o.props.price : 0;
      this.state.farm.plots[o.id] = {
        id: o.id,
        locked: price > 0,
        price,
        soilLevel: 1,
        phase: 'EMPTY',
        seedId: null,
        plantedAt: null,
        growthMs: 0,
        waterings: 0,
        lastUpdateAt: now,
        dryMs: 0,
        readyAt: null,
      };
    }
  }

  // ── queries ─────────────────────────────────────────────────────────────

  /** The plot, advanced to the current wall-clock time (so every rule sees fresh growth). */
  plot(id: string): PlotState | undefined {
    const p = this.state.farm.plots[id];
    if (!p) return undefined;
    const seed = p.seedId ? this.seeds[p.seedId] : undefined;
    const fresh = advancePlot(p, seed, this.config, this.clock.now());
    this.state.farm.plots[id] = fresh;
    return fresh;
  }

  plotView(id: string): PlotView | undefined {
    const p = this.plot(id);
    if (!p) return undefined;
    const seed = p.seedId ? this.seeds[p.seedId] : undefined;
    return { ...p, needsWater: needsWater(p, seed, this.config), progress: growthProgress(p, seed, this.config), stage: growthStage(p, seed, this.config) };
  }

  get canWater(): number {
    return this.state.farm.wateringCan.water;
  }

  get selectedSeed(): string | null {
    return this.state.farm.selectedSeed;
  }

  get openShop(): string | null {
    return this.shop?.shopId ?? null;
  }

  /** Seed used for planting: the selected one if owned, else the first owned seed in data order. */
  seedToPlant(): string | null {
    const sel = this.state.farm.selectedSeed;
    if (sel && this.seeds[sel] && this.tx.count(this.seeds[sel].seedItem) > 0) return sel;
    for (const [id, s] of Object.entries(this.seeds)) if (this.tx.count(s.seedItem) > 0) return id;
    return null;
  }

  /** Reason an object can't be interacted with at all (so the player doesn't walk there for nothing). */
  interactionGate(objectId: string): string | null {
    const p = this.plot(objectId);
    return p?.locked ? 'plotLocked' : null;
  }

  // ── time ────────────────────────────────────────────────────────────────

  /** Bring every plot up to wall-clock time and announce visible changes. */
  update(): void {
    const now = this.clock.now();
    for (const [id, p] of Object.entries(this.state.farm.plots)) {
      const seed = p.seedId ? this.seeds[p.seedId] : undefined;
      this.state.farm.plots[id] = advancePlot(p, seed, this.config, now);
      this.announce(id);
    }
  }

  private announce(id: string, force = false): void {
    const v = this.plotView(id)!;
    const sig = `${v.phase}|${v.locked}|${v.needsWater}|${v.stage}|${v.soilLevel}`;
    if (!force && this.lastSignature.get(id) === sig) return;
    this.lastSignature.set(id, sig);
    this.bus.emit('farm:plotChanged', { plotId: id, phase: v.phase, locked: v.locked, needsWater: v.needsWater, stage: v.stage, soilLevel: v.soilLevel });
  }

  // ── plot actions (validated twice by the interaction system: on arrival and on completion) ──

  canPrepare(id: string): FarmResult {
    const p = this.plot(id);
    if (!p) return no('notAPlot');
    if (p.locked) return no('plotLocked');
    return p.phase === 'EMPTY' || p.phase === 'HARVESTED' ? OK : no('notEmpty', false);
  }

  prepare(id: string): FarmResult {
    const c = this.canPrepare(id);
    if (!c.ok) return c;
    const p = this.plot(id)!;
    Object.assign(p, { phase: 'PREPARED', seedId: null, plantedAt: null, growthMs: 0, waterings: 0, dryMs: 0, readyAt: null, lastUpdateAt: this.clock.now() });
    this.announce(id);
    return OK;
  }

  canPlant(id: string): FarmResult {
    const p = this.plot(id);
    if (!p) return no('notAPlot');
    if (p.locked) return no('plotLocked');
    if (p.phase !== 'PREPARED') return no('notPrepared', false);
    return this.seedToPlant() ? OK : no('noSeeds');
  }

  plant(id: string): FarmResult {
    const c = this.canPlant(id);
    if (!c.ok) return c;
    const seedId = this.seedToPlant()!;
    const seed = this.seeds[seedId]!;
    const now = this.clock.now();
    const res = this.tx.execute({ reason: `plant:${seedId}`, items: [{ itemId: seed.seedItem, qty: -1 }] });
    if (!res.ok) return no(res.error);
    Object.assign(this.plot(id)!, { phase: 'PLANTED', seedId, plantedAt: now, growthMs: 0, waterings: 0, dryMs: 0, readyAt: null, lastUpdateAt: now });
    this.announce(id);
    return OK;
  }

  canWaterPlot(id: string): FarmResult {
    const p = this.plot(id);
    if (!p) return no('notAPlot');
    if (p.locked) return no('plotLocked');
    const seed = p.seedId ? this.seeds[p.seedId] : undefined;
    if (!needsWater(p, seed, this.config)) return no('noWaterNeeded', false);
    return this.state.farm.wateringCan.water > 0 ? OK : no('canEmpty');
  }

  water(id: string): FarmResult {
    this.update(); // growth up to now before changing water state
    const c = this.canWaterPlot(id);
    if (!c.ok) return c;
    const p = this.plot(id)!;
    p.waterings += 1;
    p.phase = 'GROWING';
    this.state.farm.wateringCan.water -= 1;
    this.bus.emit('farm:canChanged', { water: this.canWater, capacity: this.config.wateringCan.capacity });
    this.announce(id);
    return OK;
  }

  private harvestRequest(p: PlotState) {
    const seed = this.seeds[p.seedId!]!;
    return {
      reason: `harvest:${p.seedId}`,
      items: [{ itemId: seed.productItem, qty: harvestYield(p, seed, this.config), quality: harvestQuality(p, seed, this.config) }],
      exp: seed.expReward,
      key: `harvest:${p.id}:${p.plantedAt}`,
    };
  }

  canHarvest(id: string): FarmResult {
    const p = this.plot(id);
    if (!p) return no('notAPlot');
    if (p.locked) return no('plotLocked');
    if (p.phase === 'READY') {
      const check = this.tx.check(this.harvestRequest(p)); // e.g. inventory full → don't start
      return check.ok ? OK : no(check.error);
    }
    const growing = p.phase === 'PLANTED' || p.phase === 'GROWING';
    const seed = p.seedId ? this.seeds[p.seedId] : undefined;
    return no('notReady', growing && !needsWater(p, seed, this.config));
  }

  harvest(id: string): FarmResult {
    this.update();
    const c = this.canHarvest(id);
    if (!c.ok) return c;
    const p = this.plot(id)!;
    const res = this.tx.execute(this.harvestRequest(p));
    if (!res.ok) return no(res.error);
    p.phase = 'HARVESTED';
    this.announce(id);
    return OK;
  }

  // ── watering can ────────────────────────────────────────────────────────

  canRefill(): FarmResult {
    return this.state.farm.wateringCan.water < this.config.wateringCan.capacity ? OK : no('canFull');
  }

  refill(): FarmResult {
    const c = this.canRefill();
    if (!c.ok) return c;
    this.state.farm.wateringCan.water = this.config.wateringCan.capacity;
    this.bus.emit('farm:canChanged', { water: this.canWater, capacity: this.config.wateringCan.capacity });
    return OK;
  }

  // ── seeds & shop ────────────────────────────────────────────────────────

  selectSeed(seedId: string | null): FarmResult {
    if (seedId !== null && !this.seeds[seedId]) return no('unknownSeed');
    this.state.farm.selectedSeed = seedId;
    this.bus.emit('farm:seedSelected', { seedId });
    return OK;
  }

  openShopAt(shopId: string, objectId: string): void {
    this.shop = { shopId, objectId };
    this.bus.emit('shop:opened', { shopId, objectId });
  }

  closeShop(): void {
    if (!this.shop) return;
    const { shopId } = this.shop;
    this.shop = null;
    this.bus.emit('shop:closed', { shopId });
  }

  /** The shop session ends when the player walks away from the stall. */
  checkShopDistance(playerTile: TilePos): void {
    if (!this.shop) return;
    const o = this.world.getObject(this.shop.objectId);
    if (!o || distanceToFootprint(playerTile, o.footprint) > this.config.shopLeaveDistance) this.closeShop();
  }

  buySeeds(seedId: string, qty: number): FarmResult {
    if (this.shop?.shopId !== 'seeds') return no('shopClosed');
    const seed = this.seeds[seedId];
    if (!seed) return no('unknownSeed');
    if (!Number.isInteger(qty) || qty <= 0) return no('invalidQuantity');
    const res = this.tx.execute({ reason: `buySeeds:${seedId}`, coins: -seed.purchaseCost * qty, items: [{ itemId: seed.seedItem, qty, quality: 50 }] });
    return res.ok ? OK : no(res.error);
  }

  // ── land ────────────────────────────────────────────────────────────────

  buyPlot(id: string): FarmResult {
    const p = this.plot(id);
    if (!p) return no('notAPlot');
    if (!p.locked) return no('alreadyOwned');
    const res = this.tx.execute({ reason: `buyPlot:${id}`, coins: -p.price, key: `buyPlot:${id}` });
    if (!res.ok) return no(res.error);
    p.locked = false;
    p.phase = 'EMPTY';
    p.lastUpdateAt = this.clock.now();
    this.announce(id);
    return OK;
  }

  nextSoilCost(id: string): number | null {
    const p = this.plot(id);
    if (!p) return null;
    const next = this.config.soilLevels.find((s) => s.level === p.soilLevel + 1);
    return next ? next.cost : null;
  }

  /** Soil upgrades only on plots without a crop, so a growing crop's timing never changes mid-way. */
  upgradeSoil(id: string): FarmResult {
    const p = this.plot(id);
    if (!p) return no('notAPlot');
    if (p.locked) return no('plotLocked');
    if (!['EMPTY', 'PREPARED', 'HARVESTED'].includes(p.phase)) return no('cropGrowing');
    const next = this.config.soilLevels.find((s) => s.level === p.soilLevel + 1);
    if (!next) return no('maxLevel');
    const res = this.tx.execute({ reason: `upgradeSoil:${id}:${next.level}`, coins: -next.cost, key: `upgradeSoil:${id}:${next.level}` });
    if (!res.ok) return no(res.error);
    p.soilLevel = next.level;
    this.announce(id);
    return OK;
  }

  soil(id: string) {
    const p = this.plot(id);
    return p ? soilOf(this.config, p.soilLevel) : undefined;
  }

  allPlotViews(): PlotView[] {
    return Object.keys(this.state.farm.plots).map((id) => this.plotView(id)!);
  }
}
