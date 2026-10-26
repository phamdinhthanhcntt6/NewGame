import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page, url: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await ready(page);
  return errors;
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__TCSS__?.ready === true);
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__TCSS__!.setTimeScale(3));
}

const snap = (page: Page) => page.evaluate(() => window.__TCSS__!.snapshot());

async function clickObject(page: Page, id: string): Promise<void> {
  const p = await page.evaluate((i) => window.__TCSS__!.objectClickClient(i), id);
  if (!p) throw new Error(`no click point for ${id}`);
  await page.mouse.click(p.x, p.y);
}

test('travel farm → café → farm through signs; reload resumes on the last map; economy is shared', async ({ page }) => {
  const errors = await boot(page, '/');
  expect((await snap(page)).map).toBe('farm');
  await page.evaluate(() => window.__TCSS__!.grantItems('roasted_robusta', 3, 60));
  await clickObject(page, 'cafe_sign');
  await page.waitForFunction(() => window.__TCSS__?.ready === true && window.__TCSS__.snapshot().map === 'cafe', undefined, { timeout: 15_000 });
  await ready(page);
  const s = await snap(page);
  expect(s.economy.inventory.roasted_robusta).toEqual({ qty: 3, quality: 60 }); // same inventory in the café
  expect(s.cafe).not.toBeNull();

  await page.reload();
  await ready(page);
  expect((await snap(page)).map).toBe('cafe');

  await clickObject(page, 'farm_door');
  await page.waitForFunction(() => window.__TCSS__?.ready === true && window.__TCSS__.snapshot().map === 'farm', undefined, { timeout: 15_000 });
  expect((await snap(page)).economy.inventory.roasted_robusta?.qty).toBe(3);
  expect(errors).toEqual([]);
});

test('a customer walks in from the street, queues, and the player takes the order at the counter', async ({ page }) => {
  const errors = await boot(page, '/?map=cafe');
  await page.evaluate(() => window.__TCSS__!.setCafeOpen(false));
  const id = await page.evaluate(() => window.__TCSS__!.spawnCustomer('tourist'));
  const first = (await snap(page)).cafe!.customers.find((c) => c.id === id)!;
  expect(first.tile.y).toBe(13); // on the street, outside
  await page.waitForFunction((cid) => window.__TCSS__!.snapshot().cafe!.customers.find((c) => c.id === cid)?.state === 'ORDERING', id, { timeout: 20_000 });
  const order = (await snap(page)).cafe!.orders.find((o) => o.customerId === id)!;
  expect(order.status).toBe('CREATED');

  await clickObject(page, 'order_counter');
  await page.waitForFunction((cid) => window.__TCSS__!.snapshot().cafe!.customers.find((c) => c.id === cid)?.state === 'WAITING', id, { timeout: 15_000 });
  const s = await snap(page);
  expect(s.cafe!.orders.find((o) => o.customerId === id)!.status).toBe('ACCEPTED');
  expect(s.cafe!.customers.find((c) => c.id === id)!.spot).toMatch(/^seat:/);
  expect(errors).toEqual([]);
});

test('an order nobody takes is cancelled when the customer runs out of patience, and they walk out', async ({ page }) => {
  await boot(page, '/?map=cafe');
  await page.evaluate(() => window.__TCSS__!.setCafeOpen(false));
  await page.evaluate(() => window.__TCSS__!.setTimeScale(12));
  const id = await page.evaluate(() => window.__TCSS__!.spawnCustomer('office'));
  await page.waitForFunction(() => window.__TCSS__!.events().some((e) => e.type === 'order:changed' && (e.payload as { to: string }).to === 'CANCELLED'), undefined, { timeout: 20_000 });
  const cancelled = (await page.evaluate(() => window.__TCSS__!.events())).find((e) => e.type === 'order:changed' && (e.payload as { to: string }).to === 'CANCELLED')!;
  expect(cancelled.payload).toMatchObject({ customerId: id, reason: 'impatient' });
  await page.waitForFunction((cid) => !window.__TCSS__!.snapshot().cafe!.customers.some((c) => c.id === cid), id, { timeout: 20_000 });
});
