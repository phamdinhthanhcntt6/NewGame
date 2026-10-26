import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await page.waitForFunction(() => window.__TCSS__?.ready === true);
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__TCSS__!.setTimeScale(3));
  return errors;
}

const snap = (page: Page) => page.evaluate(() => window.__TCSS__!.snapshot());
const count = async (page: Page, item: string) => (await snap(page)).economy.inventory[item]?.qty ?? 0;

async function clickObject(page: Page, id: string): Promise<void> {
  const p = await page.evaluate((i) => window.__TCSS__!.objectClickClient(i), id);
  if (!p) throw new Error(`no click point for ${id}`);
  await page.mouse.click(p.x, p.y);
}

async function clickButton(page: Page, name: string): Promise<void> {
  await page.waitForFunction((n) => window.__TCSS__!.buttonClient(n)?.enabled === true, name, { timeout: 5000 });
  const b = (await page.evaluate((n) => window.__TCSS__!.buttonClient(n), name))!;
  await page.mouse.click(b.x, b.y);
}

async function waitIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const s = window.__TCSS__!.snapshot();
    return !s.interaction.current && s.interaction.queue.length === 0 && ['IDLE', 'CARRYING'].includes(s.player.state);
  });
}

async function use(page: Page, id: string): Promise<void> {
  await clickObject(page, id);
  await page.waitForTimeout(100);
  await waitIdle(page);
}

const equip = async (page: Page, id: string) => (await snap(page)).processing.equipment.find((e) => e.id === id)!;

test('farm to market with real clicks: harvest → dry → roast → sell roasted beans', async ({ page }) => {
  const errors = await boot(page);
  const P = 'plot_r0_c0';
  await use(page, P); // prepare
  await use(page, P); // plant
  await use(page, P); // water 1
  await page.evaluate(() => window.__TCSS__!.advanceClock(61_000));
  await use(page, P); // water 2
  await page.evaluate(() => window.__TCSS__!.advanceClock(61_000));
  await use(page, P); // harvest
  expect(await count(page, 'cherry_robusta')).toBe(10);

  await use(page, 'drying_rack_1'); // load
  expect(await count(page, 'cherry_robusta')).toBe(0);
  expect((await equip(page, 'drying_rack_1')).status).toBe('working');
  await page.evaluate(() => window.__TCSS__!.advanceClock(91_000));
  await use(page, 'drying_rack_1'); // collect
  expect(await count(page, 'green_robusta')).toBe(5);

  await use(page, 'roaster'); // load
  await page.evaluate(() => window.__TCSS__!.advanceClock(61_000));
  await use(page, 'roaster'); // collect
  expect((await snap(page)).economy.inventory.roasted_robusta).toEqual({ qty: 5, quality: 57 });

  await use(page, 'market');
  expect((await snap(page)).shop).toBe('market');
  const coins = (await snap(page)).economy.coins;
  await clickButton(page, 'sell.all.roasted_robusta');
  await page.waitForFunction(() => (window.__TCSS__!.snapshot().economy.inventory.roasted_robusta?.qty ?? 0) === 0);
  const s = await snap(page);
  // 18 × (0.5 + 0.01 × 57) = 19.26 per unit × saturation (1 + .99 + .98 + .97 + .96 = 4.9) = 94.37 → 94
  expect(s.economy.coins - coins).toBe(94);
  expect(s.market.recentSales[0]).toMatchObject({ reason: 'sell:roasted_robusta', coins: 94 });
  expect(errors).toEqual([]);
});

test('market: selling in bulk lowers the next price; nothing sells away from the market', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__TCSS__!.grantItems('cherry_arabica', 40, 70));
  // Away from the market, the panel shows the inventory (no sell buttons).
  expect(await page.evaluate(() => window.__TCSS__!.buttonClient('sell.10.cherry_arabica'))).toBeNull();
  await use(page, 'market');
  let coins = (await snap(page)).economy.coins;
  await clickButton(page, 'sell.10.cherry_arabica');
  await page.waitForFunction(() => window.__TCSS__!.snapshot().economy.inventory.cherry_arabica?.qty === 30);
  const first = (await snap(page)).economy.coins - coins;
  coins += first;
  await clickButton(page, 'sell.10.cherry_arabica');
  await page.waitForFunction(() => window.__TCSS__!.snapshot().economy.inventory.cherry_arabica?.qty === 20);
  const second = (await snap(page)).economy.coins - coins;
  expect(first).toBeGreaterThan(0);
  expect(second).toBeLessThan(first);
});

test('equipment panel: preferred recipe is used, upgrade is blocked while running', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__TCSS__!.grantItems('cherry_robusta', 10, 55));
  await page.evaluate(() => window.__TCSS__!.grantItems('cherry_arabica', 8, 70));
  await clickObject(page, 'drying_rack_2'); // selects it (and loads the default recipe)
  await waitIdle(page);
  const rack = await equip(page, 'drying_rack_2');
  expect(rack.status).toBe('working');
  expect(rack.job!.recipeId).toBe('dry_robusta'); // first runnable by default
  // Now prefer Arabica for the next batch on drying racks.
  await clickButton(page, 'recipe.dry_arabica');
  expect((await snap(page)).processing.selectedRecipe.drying_rack).toBe('dry_arabica');
  const up = await page.evaluate(() => window.__TCSS__!.buttonClient('equip.upgrade'));
  expect(up?.enabled).toBe(false); // busy (and level-2 costs 300 > 200 coins)
  await use(page, 'drying_rack_1');
  expect((await equip(page, 'drying_rack_1')).job!.recipeId).toBe('dry_arabica');
});

test('a batch keeps processing across reloads and finishes while closed', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__TCSS__!.grantItems('cherry_robusta', 10, 55));
  await use(page, 'drying_rack_1');
  expect((await equip(page, 'drying_rack_1')).status).toBe('working');
  await page.reload();
  await page.waitForFunction(() => window.__TCSS__?.ready === true);
  expect((await equip(page, 'drying_rack_1')).status).toBe('working');
  expect(await count(page, 'cherry_robusta')).toBe(0);
  await page.evaluate(() => window.__TCSS__!.advanceClock(91_000));
  await page.reload();
  await page.waitForFunction(() => window.__TCSS__?.ready === true);
  await page.evaluate(() => window.__TCSS__!.setTimeScale(3));
  expect((await equip(page, 'drying_rack_1')).status).toBe('done');
  await use(page, 'drying_rack_1');
  expect(await count(page, 'green_robusta')).toBe(5);
});
