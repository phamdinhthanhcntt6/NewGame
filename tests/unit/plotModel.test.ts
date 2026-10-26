import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../src/data/content';
import { advancePlot, harvestQuality, harvestYield, needsWater, totalGrowthMs, soilOf } from '../../src/gameplay/farm/plotModel';
import type { PlotState } from '../../src/gameplay/state/GameState';

const rules = CONTENT.economy.farm;
const robusta = CONTENT.seeds.robusta!; // 120 s, 2 waterings → 60 s per segment
const T0 = 1_000_000;

const planted = (over: Partial<PlotState> = {}): PlotState => ({
  id: 'p',
  locked: false,
  price: 0,
  soilLevel: 1,
  phase: 'PLANTED',
  seedId: 'robusta',
  plantedAt: T0,
  growthMs: 0,
  waterings: 0,
  lastUpdateAt: T0,
  dryMs: 0,
  readyAt: null,
  ...over,
});

describe('plot growth from timestamps', () => {
  it('an unwatered seed does not grow and accumulates dry time', () => {
    const p = advancePlot(planted(), robusta, rules, T0 + 30_000);
    expect(p.growthMs).toBe(0);
    expect(p.dryMs).toBe(30_000);
    expect(p.phase).toBe('PLANTED');
    expect(needsWater(p, robusta, rules)).toBe(true);
  });

  it('one watering unlocks exactly one segment, then the crop waits for water', () => {
    const p = advancePlot(planted({ phase: 'GROWING', waterings: 1 }), robusta, rules, T0 + 90_000);
    expect(p.growthMs).toBe(60_000);
    expect(p.dryMs).toBe(30_000);
    expect(p.phase).toBe('GROWING');
    expect(needsWater(p, robusta, rules)).toBe(true);
  });

  it('becomes READY when all waterings are given and time has passed, with an exact readyAt', () => {
    const p = advancePlot(planted({ phase: 'GROWING', waterings: 2, growthMs: 60_000 }), robusta, rules, T0 + 100_000);
    expect(p.phase).toBe('READY');
    expect(p.readyAt).toBe(T0 + 60_000);
    expect(p.dryMs).toBe(0);
  });

  it('ignores clocks that go backwards', () => {
    const start = planted({ phase: 'GROWING', waterings: 1, growthMs: 10_000 });
    const p = advancePlot(start, robusta, rules, T0 - 50_000);
    expect(p.growthMs).toBe(10_000);
    expect(p.lastUpdateAt).toBe(T0);
    expect(p.dryMs).toBe(0);
  });

  it('many small advances equal one big advance (restoring after closing the game is exact)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    for (let trial = 0; trial < 50; trial++) {
      const start = planted({ phase: 'GROWING', waterings: 1 + Math.floor(rnd() * 2), growthMs: Math.floor(rnd() * 30_000) });
      const end = T0 + Math.floor(rnd() * 200_000);
      let stepwise = start;
      for (let t = T0; t < end; ) {
        t = Math.min(end, t + 1 + Math.floor(rnd() * 20_000));
        stepwise = advancePlot(stepwise, robusta, rules, t);
      }
      const once = advancePlot(start, robusta, rules, end);
      expect(stepwise.growthMs).toBeCloseTo(once.growthMs, 6);
      expect(stepwise.dryMs).toBeCloseTo(once.dryMs, 6);
      expect(stepwise.phase).toBe(once.phase);
      expect(stepwise.readyAt).toBe(once.readyAt);
    }
  });

  it('non-growing phases never change with time', () => {
    for (const phase of ['EMPTY', 'PREPARED', 'READY', 'HARVESTED'] as const) {
      const p = advancePlot(planted({ phase }), robusta, rules, T0 + 999_999);
      expect(p.phase).toBe(phase);
      expect(p.growthMs).toBe(0);
    }
  });
});

describe('soil, yield and quality', () => {
  it('soil level speeds growth and raises yield and quality', () => {
    expect(totalGrowthMs(robusta, soilOf(rules, 1))).toBe(120_000);
    expect(totalGrowthMs(robusta, soilOf(rules, 2))).toBe(Math.round(120_000 / 1.1));
    expect(harvestYield(planted({ soilLevel: 1 }), robusta, rules)).toBe(10);
    expect(harvestYield(planted({ soilLevel: 3 }), robusta, rules)).toBe(15);
    expect(harvestQuality(planted({ soilLevel: 2 }), robusta, rules)).toBe(60);
  });

  it('thirst lowers quality, capped by dryPenalty.max', () => {
    expect(harvestQuality(planted({ dryMs: 60_000 }), robusta, rules)).toBe(53); // 55 − 2/min
    expect(harvestQuality(planted({ dryMs: 3_600_000 }), robusta, rules)).toBe(40); // capped at −15
  });
});
