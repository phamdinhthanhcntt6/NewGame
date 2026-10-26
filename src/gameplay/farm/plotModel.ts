import type { PlotState } from '../state/GameState';

export interface SeedDef {
  label: string;
  seedItem: string;
  productItem: string;
  purchaseCost: number;
  growthMs: number;
  /** Number of waterings the crop needs; growth is split into this many equal segments. */
  waterings: number;
  yield: number;
  baseQuality: number;
  sellPrice: number;
  expReward: number;
  unlockLevel: number;
}

export type SeedTable = Record<string, SeedDef>;

export interface SoilLevelDef {
  level: number;
  cost: number;
  yieldBonus: number;
  qualityBonus: number;
  growthSpeedBonus: number;
}

export interface FarmRules {
  soilLevels: SoilLevelDef[];
  dryPenalty: { perMinute: number; max: number };
}

export const soilOf = (rules: FarmRules, level: number): SoilLevelDef =>
  rules.soilLevels.find((s) => s.level === level) ?? rules.soilLevels[0]!;

/** Total effective growth needed, after the soil's speed bonus. */
export const totalGrowthMs = (seed: SeedDef, soil: SoilLevelDef): number => Math.round(seed.growthMs / (1 + soil.growthSpeedBonus));

export const segmentMs = (seed: SeedDef, soil: SoilLevelDef): number => totalGrowthMs(seed, soil) / seed.waterings;

/** True when a planted crop has used up its watered growth and is waiting for water. */
export function needsWater(p: PlotState, seed: SeedDef | undefined, rules: FarmRules): boolean {
  if (!seed || (p.phase !== 'PLANTED' && p.phase !== 'GROWING')) return false;
  if (p.waterings >= seed.waterings) return false;
  return p.growthMs >= p.waterings * segmentMs(seed, soilOf(rules, p.soilLevel)) - 1e-6;
}

/** 0–1 growth progress for display. */
export function growthProgress(p: PlotState, seed: SeedDef | undefined, rules: FarmRules): number {
  if (p.phase === 'READY' || p.phase === 'HARVESTED') return 1;
  if (!seed || (p.phase !== 'PLANTED' && p.phase !== 'GROWING')) return 0;
  return Math.min(1, p.growthMs / totalGrowthMs(seed, soilOf(rules, p.soilLevel)));
}

/**
 * Advance a plot to wall-clock time `now`. Pure function of the saved fields,
 * so restoring a save and calling advance() yields exactly the state the
 * crop would have reached had the game stayed open. Time going backwards
 * (clock change) is ignored, never negative.
 */
export function advancePlot(p: PlotState, seed: SeedDef | undefined, rules: FarmRules, now: number): PlotState {
  const elapsed = Math.max(0, now - p.lastUpdateAt);
  const next: PlotState = { ...p, lastUpdateAt: Math.max(p.lastUpdateAt, now) };
  if (!seed || (p.phase !== 'PLANTED' && p.phase !== 'GROWING') || elapsed === 0) return next;

  const soil = soilOf(rules, p.soilLevel);
  const total = totalGrowthMs(seed, soil);
  const unlocked = Math.min(total, p.waterings * segmentMs(seed, soil)); // growth allowed by water given
  const canGrow = Math.max(0, unlocked - p.growthMs);
  const grow = Math.min(elapsed, canGrow);
  next.growthMs = p.growthMs + grow;
  next.dryMs = p.dryMs + (elapsed - grow); // time spent with no water left
  if (next.growthMs >= total - 1e-6) {
    next.growthMs = total;
    next.phase = 'READY';
    next.readyAt = p.lastUpdateAt + grow;
    next.dryMs = p.dryMs; // a ripe crop isn't thirsty
  }
  return next;
}

export function harvestQuality(p: PlotState, seed: SeedDef, rules: FarmRules): number {
  const soil = soilOf(rules, p.soilLevel);
  const penalty = Math.min(rules.dryPenalty.max, (p.dryMs / 60_000) * rules.dryPenalty.perMinute);
  return Math.max(1, Math.min(100, Math.round(seed.baseQuality + soil.qualityBonus - penalty)));
}

export function harvestYield(p: PlotState, seed: SeedDef, rules: FarmRules): number {
  return Math.max(1, Math.round(seed.yield * (1 + soilOf(rules, p.soilLevel).yieldBonus)));
}

/** Visual stage 0–4 (0 = seed, 4 = ripe). */
export function growthStage(p: PlotState, seed: SeedDef | undefined, rules: FarmRules): number {
  if (p.phase === 'READY') return 4;
  if (p.phase !== 'PLANTED' && p.phase !== 'GROWING') return 0;
  return Math.min(3, Math.floor(growthProgress(p, seed, rules) * 4));
}
