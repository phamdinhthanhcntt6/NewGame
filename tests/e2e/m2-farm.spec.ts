import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page, url = '/'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.waitForFunction(() => window.__TCSS__?.ready === true);
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__TCSS__!.setTimeScale(3));
  return errors;
}

const snap = (page: Page) => page.evaluate(() => window.__TCSS__!.snapshot());
const plot = async (page: Page, id: string) => (await snap(page)).farm.plots.find((p) => p.id === id)!;

/** Click an object where it is drawn, like a player. */
async function clickObject(page: Page, id: string): Promise<void> {
  const p = await page.evaluate((i) => window.__TCSS__!.objectClickClient(i), id);
  if (!p) throw new Error(`no click point for ${id}`);
  await page.mouse.click(p.x, p.y);
}

/** Wait until a HUD button is visible and enabled (the HUD refreshes on the next frame), then click it. */
async function clickButton(page: Page, name: string): Promise<void> {
  await page.waitForFunction((n) => window.__TCSS__!.buttonClient(n)?.enabled === true, name, { timeout: 5000 });
  const b = (await page.evaluate((n) => window.__TCSS__!.buttonClient(n), name))!;
  await page.mouse.click(b.x, b.y);
}

async function waitPhase(page: Page, id: string, phase: string): Promise<void> {
  await page.waitForFunction(([i, ph]) => window.__TCSS__!.snapshot().farm.plots.find((p) => p.id === i)?.phase === ph, [id, phase] as const, { timeout: 15_000 });
}

async function waitIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const s = window.__TCSS__!.snapshot();
    return !s.interaction.current && s.interaction.queue.length === 0 && ['IDLE', 'CARRYING'].includes(s.player.state);
  });
}

const P = 'plot_r0_c0';

test('full farming loop with real clicks: prepare, plant, water, grow, water, harvest', async ({ page }) => {
  const errors = await boot(page);
  await clickObject(page, P);
  await waitPhase(page, P, 'PREPARED');
  await waitIdle(page);
  await clickObject(page, P);
  await waitPhase(page, P, 'PLANTED');
  expect((await snap(page)).economy.inventory.seed_robusta?.qty).toBe(1);
  await waitIdle(page);
  await clickObject(page, P);
  await waitPhase(page, P, 'GROWING');
  expect((await snap(page)).farm.can.water).toBe(3);
  await waitIdle(page);

  // Clicking a growing crop that isn't ripe: told so, nothing gained.
  await clickObject(page, P);
  await page.waitForFunction(() => window.__TCSS__!.events().some((e) => e.type === 'interaction:failed' && (e.payload as { detail?: string }).detail === 'notReady'));
  await waitIdle(page);

  await page.evaluate(() => window.__TCSS__!.advanceClock(61_000));
  await page.waitForFunction((i) => window.__TCSS__!.snapshot().farm.plots.find((p) => p.id === i)?.needsWater === true, P);
  await clickObject(page, P);
  await page.waitForFunction((i) => window.__TCSS__!.snapshot().farm.plots.find((p) => p.id === i)?.waterings === 2, P);
  await waitIdle(page);

  await page.evaluate(() => window.__TCSS__!.advanceClock(61_000));
  await waitPhase(page, P, 'READY');
  await clickObject(page, P);
  await waitPhase(page, P, 'HARVESTED');
  const s = await snap(page);
  expect(s.economy.inventory.cherry_robusta).toEqual({ qty: 10, quality: 55 });
  expect(s.economy.exp).toBe(8);
  expect(errors).toEqual([]);
});

test('seed shop needs the player at the stall; HUD buy goes through the transaction service', async ({ page }) => {
  await boot(page);
  const before = await page.evaluate(() => window.__TCSS__!.buttonClient('seed.buy1.arabica'));
  expect(before?.enabled).toBe(false); // shop closed
  await clickObject(page, 'seed_stall');
  await page.waitForFunction(() => window.__TCSS__!.snapshot().farm.shop === 'seeds');
  await clickButton(page, 'seed.buy1.arabica');
  await page.waitForFunction(() => (window.__TCSS__!.snapshot().economy.inventory.seed_arabica?.qty ?? 0) === 1);
  expect((await snap(page)).economy.coins).toBe(150);

  // Select Arabica and plant it.
  await clickButton(page, 'seed.select.arabica');
  await clickObject(page, P);
  await waitPhase(page, P, 'PREPARED');
  await waitIdle(page);
  await clickObject(page, P);
  await waitPhase(page, P, 'PLANTED');
  expect((await plot(page, P)).seedId).toBe('arabica');
  // The plot is within 2 tiles of the stall, so the shop is still open; walking far away closes it.
  await waitIdle(page);
  const far = await page.evaluate(() => window.__TCSS__!.tileToClient({ x: 14, y: 11 }));
  await page.mouse.click(far.x, far.y);
  await page.waitForFunction(() => window.__TCSS__!.snapshot().farm.shop === null);
  await page.waitForFunction(() => window.__TCSS__!.buttonClient('seed.buy1.arabica')?.enabled === false, undefined, { timeout: 2000 });
});

test('locked land: clicking does not walk; buying from the HUD unlocks it', async ({ page }) => {
  await boot(page);
  const start = (await snap(page)).player.pos;
  await clickObject(page, 'plot_r1_c0');
  await page.waitForFunction(() => window.__TCSS__!.events().some((e) => e.type === 'interaction:failed' && (e.payload as { detail?: string }).detail === 'plotLocked'));
  await page.waitForTimeout(300);
  expect((await snap(page)).player.pos).toEqual(start);
  await clickButton(page, 'plot.buy');
  await page.waitForFunction(() => window.__TCSS__!.snapshot().farm.plots.find((p) => p.id === 'plot_r1_c0')?.locked === false);
  expect((await snap(page)).economy.coins).toBe(50);
  // The buy button disappears once owned (cannot be bought twice).
  expect(await page.evaluate(() => window.__TCSS__!.buttonClient('plot.buy'))).toBeNull();
});

test('progress survives a page reload, and crops keep growing from saved timestamps', async ({ page }) => {
  await boot(page);
  await clickObject(page, P);
  await waitPhase(page, P, 'PREPARED');
  await waitIdle(page);
  await clickObject(page, P);
  await waitPhase(page, P, 'PLANTED');
  await waitIdle(page);
  await clickObject(page, P);
  await waitPhase(page, P, 'GROWING');
  await waitIdle(page);
  const before = await snap(page);

  // No explicit save: rely on autosave / pagehide flush.
  await page.reload();
  await page.waitForFunction(() => window.__TCSS__?.ready === true);
  const after = await snap(page);
  expect(after.economy.coins).toBe(before.economy.coins);
  expect(after.economy.inventory).toEqual(before.economy.inventory);
  expect(after.farm.can.water).toBe(3);
  const p = after.farm.plots.find((x) => x.id === P)!;
  expect(p.phase).toBe('GROWING');
  expect(p.plantedAt).toBe(before.farm.plots.find((x) => x.id === P)!.plantedAt);

  // "Close the game" for a minute: the crop grows through its watered segment while away.
  await page.evaluate(() => window.__TCSS__!.advanceClock(61_000));
  await page.reload();
  await page.waitForFunction(() => window.__TCSS__?.ready === true);
  const later = (await snap(page)).farm.plots.find((x) => x.id === P)!;
  expect(later.needsWater).toBe(true);
  expect(later.progress).toBeCloseTo(0.5, 2);
});

test('the M1 sandbox still runs and never touches the farm save', async ({ page }) => {
  await boot(page);
  await clickObject(page, P);
  await waitPhase(page, P, 'PREPARED');
  await page.evaluate(() => window.__TCSS__!.saveNow());
  await page.goto('/?map=sandbox');
  await page.waitForFunction(() => window.__TCSS__?.ready === true);
  expect(await page.evaluate(() => window.__TCSS__!.saveNow())).toBe(false);
  await page.goto('/');
  await page.waitForFunction(() => window.__TCSS__?.ready === true);
  expect((await plot(page, P)).phase).toBe('PREPARED');
});
