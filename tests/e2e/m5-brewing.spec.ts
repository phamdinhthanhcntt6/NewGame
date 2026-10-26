import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?map=cafe');
  await page.waitForFunction(() => window.__TCSS__?.ready === true);
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    window.__TCSS__!.setCafeOpen(false);
    window.__TCSS__!.setTimeScale(3);
  });
  return errors;
}

const snap = (page: Page) => page.evaluate(() => window.__TCSS__!.snapshot());

async function idle(page: Page): Promise<void> {
  await page.waitForTimeout(120);
  await page.waitForFunction(() => {
    const s = window.__TCSS__!.snapshot();
    return !s.interaction.current && s.interaction.queue.length === 0 && ['IDLE', 'CARRYING'].includes(s.player.state);
  });
}

async function clickObject(page: Page, id: string): Promise<void> {
  const p = await page.evaluate((i) => window.__TCSS__!.objectClickClient(i), id);
  await page.mouse.click(p!.x, p!.y);
  await idle(page);
}

async function clickCustomer(page: Page, id: string): Promise<void> {
  const p = await page.evaluate((i) => window.__TCSS__!.customerClickClient(i), id);
  if (!p) throw new Error(`customer ${id} not on screen`);
  await page.mouse.click(p.x, p.y);
  await idle(page);
}

async function clickButton(page: Page, name: string): Promise<void> {
  await page.waitForFunction((n) => window.__TCSS__!.buttonClient(n)?.enabled === true, name, { timeout: 5000 });
  const b = (await page.evaluate((n) => window.__TCSS__!.buttonClient(n), name))!;
  await page.mouse.click(b.x, b.y);
}

/** Watch the needle like a player and hit Space while it is inside the green zone. */
async function stopNeedleInZone(page: Page): Promise<void> {
  const before = (await snap(page)).cafe!.brew!.stepIndex;
  await page.evaluate(() => window.__TCSS__!.setTimeScale(0.25)); // slow needle: reliable timing in a browser
  await page.waitForFunction(() => {
    const b = window.__TCSS__!.snapshot().cafe!.brew;
    const st = b?.current;
    if (!b || !st || st.kind !== 'timing' || b.needle === null) return false;
    return Math.abs(b.needle - st.target) < st.tolerance * 0.5;
  }, undefined, { timeout: 15_000, polling: 'raf' });
  await page.keyboard.press('Space');
  await page.waitForFunction((i) => {
    const s = window.__TCSS__!.snapshot().cafe!;
    return !s.brew || s.brew.stepIndex > i;
  }, before);
  await page.evaluate(() => window.__TCSS__!.setTimeScale(3));
}

test('full latte with real input: take order by clicking the customer, brew at three stations, serve, get paid', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    window.__TCSS__!.grantItems('roasted_arabica', 2, 72);
    window.__TCSS__!.grantItems('milk', 1, 70);
  });
  const id = (await page.evaluate(() => window.__TCSS__!.spawnCustomer('tourist', 'latte')))!;
  await page.waitForFunction((cid) => window.__TCSS__!.snapshot().cafe!.customers.find((c) => c.id === cid)?.state === 'ORDERING', id, { timeout: 20_000 });
  await clickCustomer(page, id); // at the counter → take the order
  await page.waitForFunction((cid) => window.__TCSS__!.snapshot().cafe!.customers.find((c) => c.id === cid)?.state === 'WAITING', id);

  await clickObject(page, 'grinder');
  await clickButton(page, 'brew.bean.roasted_arabica');
  await stopNeedleInZone(page); // grind
  await clickObject(page, 'espresso');
  await stopNeedleInZone(page); // tamp
  await stopNeedleInZone(page); // extract
  await clickObject(page, 'milk_station');
  await clickButton(page, 'brew.add.milk');
  await stopNeedleInZone(page); // pour

  const held = (await snap(page)).cafe!.heldDrink!;
  expect(held.recipeId).toBe('latte');
  expect(held.quality).toBeGreaterThanOrEqual(80); // all needles in the zone: 0.5×72 + 0.5×100 = 86
  expect((await snap(page)).economy.inventory.milk).toBeUndefined();

  // Wait until the customer has sat down, then click them to serve.
  await page.waitForFunction((cid) => {
    const c = window.__TCSS__!.snapshot().cafe!.customers.find((x) => x.id === cid);
    return c?.state === 'WAITING';
  }, id);
  const coins = (await snap(page)).economy.coins;
  await clickCustomer(page, id);
  await page.waitForFunction(() => window.__TCSS__!.events().some((e) => e.type === 'cafe:paid'), undefined, { timeout: 20_000 });
  const s = await snap(page);
  expect(s.economy.coins).toBe(coins + 60);
  expect(s.player.heldItem).toBeNull();
  expect(s.cafe!.recentOrders.find((o) => o.customerId === id)?.status).toBe('COMPLETED');
  expect(errors).toEqual([]);
});

test('supplies: milk is bought at the shelf through the HUD', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => window.__TCSS__!.buttonClient('supply.1.milk'))).toBeNull();
  await clickObject(page, 'supply_shelf');
  const coins = (await snap(page)).economy.coins;
  await clickButton(page, 'supply.5.milk');
  await page.waitForFunction(() => window.__TCSS__!.snapshot().economy.inventory.milk?.qty === 5);
  expect((await snap(page)).economy.coins).toBe(coins - 25);
});

test('the wrong station is refused with a hint; cancelling keeps the order', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__TCSS__!.grantItems('roasted_robusta', 1, 60));
  const id = (await page.evaluate(() => window.__TCSS__!.spawnCustomer('student', 'espresso')))!;
  await page.waitForFunction((cid) => window.__TCSS__!.snapshot().cafe!.customers.find((c) => c.id === cid)?.state === 'ORDERING', id, { timeout: 20_000 });
  await clickObject(page, 'order_counter');
  await clickObject(page, 'espresso');
  await page.waitForFunction(() => window.__TCSS__!.events().some((e) => e.type === 'interaction:failed' && (e.payload as { detail?: string }).detail === 'wrongStation'));
  await clickObject(page, 'grinder');
  await clickButton(page, 'brew.cancel');
  await page.waitForFunction(() => window.__TCSS__!.snapshot().cafe!.brew === null);
  expect((await snap(page)).cafe!.orders.find((o) => o.customerId === id)?.status).toBe('ACCEPTED');
});
