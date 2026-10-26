import { describe, expect, it } from 'vitest';
import type { GameSimulation } from '../../src/gameplay/GameSimulation';
import { farmSim, runUntil } from './helpers';

const P = 'plot_r0_c0';

/** Click an object like a player and wait until the player is idle again. */
function use(sim: GameSimulation, id: string): void {
  sim.clickObject(id);
  const ok = runUntil(sim, () => {
    const s = sim.playerInteraction.snapshot();
    return !s.current && s.queue.length === 0 && !s.moveTarget && ['IDLE', 'CARRYING'].includes(sim.player.state);
  });
  if (!ok) throw new Error(`player never finished using ${id}`);
}

function failures(sim: GameSimulation): Array<{ objectId: string; detail?: string }> {
  const out: Array<{ objectId: string; detail?: string }> = [];
  sim.bus.on('interaction:failed', (e) => out.push({ objectId: e.objectId, ...(e.detail ? { detail: e.detail } : {}) }));
  return out;
}

describe('new farm', () => {
  it('starts with 6 owned empty plots, 18 locked plots, 200 coins and 2 Robusta seeds', () => {
    const { sim } = farmSim();
    const plots = sim.farm.allPlotViews();
    expect(plots).toHaveLength(24);
    expect(plots.filter((p) => !p.locked).map((p) => p.phase)).toEqual(Array(6).fill('EMPTY'));
    expect(plots.filter((p) => p.locked)).toHaveLength(18);
    expect(sim.tx.coins).toBe(200);
    expect(sim.tx.count('seed_robusta')).toBe(2);
  });
});

describe('full farming loop through player interactions', () => {
  it('prepare → plant → water → grow → water → ready → harvest → replant', () => {
    const { sim, clock } = farmSim();
    const fails = failures(sim);
    use(sim, P);
    expect(sim.farm.plot(P)!.phase).toBe('PREPARED');
    use(sim, P);
    expect(sim.farm.plot(P)!.phase).toBe('PLANTED');
    expect(sim.tx.count('seed_robusta')).toBe(1);
    use(sim, P);
    expect(sim.farm.plot(P)!.phase).toBe('GROWING');
    expect(sim.farm.canWater).toBe(3);

    // Half-grown: not ready, and the player is told so.
    clock.advance(30_000);
    sim.tick(16);
    use(sim, P);
    expect(fails.at(-1)).toEqual({ objectId: P, detail: 'notReady' });
    expect(sim.tx.count('cherry_robusta')).toBe(0);

    // First segment done → needs water.
    clock.advance(31_000);
    sim.tick(16);
    expect(sim.farm.plotView(P)!.needsWater).toBe(true);
    use(sim, P);
    expect(sim.farm.plot(P)!.waterings).toBe(2);

    clock.advance(60_000);
    sim.tick(16);
    expect(sim.farm.plot(P)!.phase).toBe('READY');
    use(sim, P);
    expect(sim.farm.plot(P)!.phase).toBe('HARVESTED');
    expect(sim.tx.stack('cherry_robusta')).toEqual({ qty: 10, quality: 55 });
    expect(sim.tx.exp).toBe(8);

    use(sim, P); // clear & prepare again
    expect(sim.farm.plot(P)!.phase).toBe('PREPARED');
    use(sim, P); // replant with the last seed
    expect(sim.farm.plot(P)!.phase).toBe('PLANTED');
    expect(sim.tx.count('seed_robusta')).toBe(0);
  });

  it('the player physically walks next to the plot before acting', () => {
    const { sim } = farmSim();
    sim.clickObject(P);
    runUntil(sim, () => sim.player.state === 'WORKING');
    const t = sim.player.tile;
    expect(Math.max(Math.abs(t.x - 6), Math.abs(t.y - 4))).toBe(1);
  });
});

describe('farming rules', () => {
  it('cannot harvest before READY (service level)', () => {
    const { sim } = farmSim();
    use(sim, P);
    use(sim, P);
    expect(sim.farm.harvest(P)).toMatchObject({ ok: false, reason: 'notReady' });
    expect(sim.tx.count('cherry_robusta')).toBe(0);
  });

  it('an empty watering can is reported, and the well refills it', () => {
    const { sim } = farmSim();
    const fails = failures(sim);
    use(sim, P);
    use(sim, P);
    sim.state.farm.wateringCan.water = 0;
    use(sim, P);
    expect(fails.at(-1)).toEqual({ objectId: P, detail: 'canEmpty' });
    use(sim, 'well');
    expect(sim.farm.canWater).toBe(4);
    use(sim, P);
    expect(sim.farm.plot(P)!.phase).toBe('GROWING');
  });

  it('planting without seeds is refused; selection falls back to an owned seed', () => {
    const { sim } = farmSim();
    const fails = failures(sim);
    sim.farm.selectSeed('arabica'); // not owned
    expect(sim.farm.seedToPlant()).toBe('robusta');
    sim.state.economy.inventory = {};
    use(sim, P);
    use(sim, P);
    expect(fails.at(-1)).toEqual({ objectId: P, detail: 'noSeeds' });
    expect(sim.farm.plot(P)!.phase).toBe('PREPARED');
  });

  it('buying seeds requires being at the stall, charges exactly, and closes when walking away', () => {
    const { sim } = farmSim();
    expect(sim.farm.buySeeds('arabica', 1)).toMatchObject({ ok: false, reason: 'shopClosed' });
    use(sim, 'seed_stall');
    expect(sim.shops.current).toBe('seeds');
    expect(sim.farm.buySeeds('arabica', 2).ok).toBe(true);
    expect(sim.tx.coins).toBe(100);
    expect(sim.tx.count('seed_arabica')).toBe(2);
    expect(sim.farm.buySeeds('arabica', 3)).toMatchObject({ ok: false, reason: 'insufficientCoins' });
    expect(sim.farm.buySeeds('culi', 1)).toMatchObject({ ok: false, reason: 'levelTooLow' }); // Culi unlocks at level 3
    expect(sim.tx.coins).toBe(100);
    expect(sim.farm.buySeeds('arabica', 0)).toMatchObject({ ok: false, reason: 'invalidQuantity' });
    sim.clickTile({ x: 14, y: 11 });
    runUntil(sim, () => sim.player.state === 'IDLE');
    expect(sim.shops.current).toBeNull();
  });

  it('a selected Arabica seed is planted when owned', () => {
    const { sim } = farmSim();
    use(sim, 'seed_stall');
    sim.farm.buySeeds('arabica', 1);
    sim.farm.selectSeed('arabica');
    use(sim, P);
    use(sim, P);
    expect(sim.farm.plot(P)!.seedId).toBe('arabica');
    expect(sim.tx.count('seed_robusta')).toBe(2);
  });

  it('locked land: clicking does not walk, buying unlocks once, and costs are validated', () => {
    const { sim } = farmSim();
    const fails = failures(sim);
    const locked = 'plot_r1_c0';
    const before = { ...sim.player.pos };
    sim.clickObject(locked);
    sim.tick(500);
    expect(fails.at(-1)).toEqual({ objectId: locked, detail: 'plotLocked' });
    expect(sim.player.pos).toEqual(before);

    expect(sim.farm.buyPlot(locked).ok).toBe(true);
    expect(sim.tx.coins).toBe(50);
    expect(sim.farm.buyPlot(locked)).toMatchObject({ ok: false, reason: 'alreadyOwned' });
    expect(sim.tx.coins).toBe(50);
    expect(sim.farm.buyPlot('plot_r2_c0')).toMatchObject({ ok: false, reason: 'insufficientCoins' });
    use(sim, locked);
    expect(sim.farm.plot(locked)!.phase).toBe('PREPARED');
  });

  it('soil upgrades: only without a crop, charged once per level, capped at max', () => {
    const { sim } = farmSim();
    sim.state.economy.coins = 2000;
    expect(sim.farm.upgradeSoil(P).ok).toBe(true);
    expect(sim.tx.coins).toBe(1750);
    expect(sim.farm.plot(P)!.soilLevel).toBe(2);
    use(sim, P);
    use(sim, P); // planted
    expect(sim.farm.upgradeSoil(P)).toMatchObject({ ok: false, reason: 'cropGrowing' });
    expect(sim.tx.coins).toBe(1750);
    expect(sim.farm.upgradeSoil('plot_r0_c1').ok).toBe(true);
    expect(sim.farm.upgradeSoil('plot_r0_c1').ok).toBe(true);
    expect(sim.farm.upgradeSoil('plot_r0_c1')).toMatchObject({ ok: false, reason: 'maxLevel' });
    expect(sim.tx.coins).toBe(1750 - 250 - 600);
  });

  it('harvest pays exactly once even if called again or with a huge frame', () => {
    const { sim, clock } = farmSim();
    use(sim, P);
    use(sim, P);
    use(sim, P);
    clock.advance(60_000);
    sim.tick(16);
    use(sim, P);
    clock.advance(60_000);
    sim.clickObject(P);
    sim.clickObject(P);
    sim.tick(60_000);
    expect(sim.farm.harvest(P)).toMatchObject({ ok: false });
    expect(sim.tx.count('cherry_robusta')).toBe(10);
    expect(sim.state.economy.history.filter((h) => h.reason.startsWith('harvest')).length).toBe(1);
  });

  it('a full inventory blocks harvesting cleanly (no crash, crop stays READY)', () => {
    const { sim, clock } = farmSim();
    const fails = failures(sim);
    use(sim, P);
    use(sim, P);
    use(sim, P);
    clock.advance(60_000);
    sim.tick(16);
    use(sim, P);
    clock.advance(60_000);
    sim.tick(16);
    sim.tx.execute({ reason: 'fill', items: [{ itemId: 'cherry_arabica', qty: 299 }] });
    use(sim, P);
    expect(fails.at(-1)).toEqual({ objectId: P, detail: 'capacityExceeded' });
    expect(sim.farm.plot(P)!.phase).toBe('READY');
  });
});
