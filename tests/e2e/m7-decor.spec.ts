import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?map=cafe');
  await ready(page);
  return errors;
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__TCSS__?.ready === true);
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    window.__TCSS__!.setCafeOpen(false);
    window.__TCSS__!.setTimeScale(3);
  });
}

const snap = (page: Page) => page.evaluate(() => window.__TCSS__!.snapshot());
const decor = async (page: Page) => (await snap(page)).decor!;

async function idle(page: Page): Promise<void> {
  await page.waitForTimeout(120);
  await page.waitForFunction(() => {
    const s = window.__TCSS__!.snapshot();
    return !s.interaction.current && s.interaction.queue.length === 0 && ['IDLE', 'CARRYING'].includes(s.player.state);
  });
}

/** HUD buttons update a frame after the simulation: wait until the button is really clickable. */
async function clickButton(page: Page, name: string): Promise<void> {
  await page.waitForFunction((n) => window.__TCSS__!.buttonClient(n)?.enabled === true, name, { timeout: 5000 });
  const b = (await page.evaluate((n) => window.__TCSS__!.buttonClient(n), name))!;
  await page.mouse.click(b.x, b.y);
  await page.waitForTimeout(80);
}

/** Point at a floor tile like a player (the ghost follows), then click it. */
async function clickTile(page: Page, tile: { x: number; y: number }): Promise<void> {
  const p = await page.evaluate((t) => window.__TCSS__!.tileToClient(t), tile);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(80);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(80);
}

async function clickObject(page: Page, id: string): Promise<void> {
  const p = await page.evaluate((i) => window.__TCSS__!.objectClickClient(i), id);
  await page.mouse.click(p!.x, p!.y);
  await page.waitForTimeout(80);
}

const at = (d: { placed: Array<{ id: string; x: number; y: number }> }, id: string) => d.placed.find((f) => f.id === id);

test('decorate: buy, place with a live ghost, rotate, move, store; bad spots are refused; the layout survives a reload', async ({ page }) => {
  const errors = await boot(page);
  const coins = (await snap(page)).economy.coins;

  await clickButton(page, 'decor.enter');
  expect((await decor(page)).active).toBe(true);

  // S12: buy a plant (coins → furniture in the shared inventory).
  await clickButton(page, 'decor.buy.plant');
  expect((await snap(page)).economy.coins).toBe(coins - 50);
  expect((await decor(page)).owned.plant).toBe(1);

  // S13: select it, point at the queue: red ghost; clicking there is refused.
  await clickButton(page, 'decor.place.plant');
  const queueTile = await page.evaluate(() => window.__TCSS__!.tileToClient({ x: 5, y: 7 }));
  await page.mouse.move(queueTile.x, queueTile.y);
  await page.waitForFunction(() => window.__TCSS__!.snapshot().decor!.preview?.valid === false);
  expect((await decor(page)).preview).toMatchObject({ footprint: { x: 5, y: 7 }, reason: 'reservedTile' });
  await page.mouse.click(queueTile.x, queueTile.y);
  await page.waitForTimeout(80);
  expect((await decor(page)).placed.some((f) => f.x === 5 && f.y === 7)).toBe(false);
  const events = await page.evaluate(() => window.__TCSS__!.events());
  expect(events.some((e) => e.type === 'decor:rejected' && (e.payload as { reason: string }).reason === 'reservedTile')).toBe(true);

  // A free floor tile: green ghost, click places it and the tile stops being walkable.
  const free = await page.evaluate(() => window.__TCSS__!.tileToClient({ x: 7, y: 7 }));
  await page.mouse.move(free.x, free.y);
  await page.waitForFunction(() => window.__TCSS__!.snapshot().decor!.preview?.valid === true);
  await page.mouse.click(free.x, free.y);
  await page.waitForFunction(() => window.__TCSS__!.snapshot().decor!.owned.plant === 0);
  const placed = (await decor(page)).placed.find((f) => f.x === 7 && f.y === 7);
  expect(placed?.type).toBe('plant');

  // Pick up a table, rotate with R, put it elsewhere.
  await clickObject(page, 'table_1');
  expect((await decor(page)).selection).toMatchObject({ kind: 'move', objectId: 'table_1', rotation: 0 });
  await page.keyboard.press('r');
  await page.waitForTimeout(50);
  expect((await decor(page)).selection?.rotation).toBe(1);
  await clickTile(page, { x: 8, y: 9 });
  expect(at(await decor(page), 'table_1')).toMatchObject({ x: 8, y: 9, rotation: 1 });

  // Store a plant back into the inventory.
  await clickObject(page, 'plant_c2');
  await clickButton(page, 'decor.store');
  const d = await decor(page);
  expect(at(d, 'plant_c2')).toBeUndefined();
  expect(d.owned.plant).toBe(1);

  // Done → back to normal play; the player can walk again.
  await clickButton(page, 'decor.exit');
  expect((await decor(page)).active).toBe(false);
  await clickTile(page, { x: 3, y: 6 });
  await idle(page);
  expect((await snap(page)).player.tile).toEqual({ x: 3, y: 6 });

  // Reload: the exact layout comes back, nothing duplicated from the map file.
  const before = (await decor(page)).placed;
  expect(await page.evaluate(() => window.__TCSS__!.saveNow())).toBe(true);
  await page.reload();
  await ready(page);
  const after = await decor(page);
  expect(after.placed).toEqual(before);
  expect(after.owned.plant).toBe(1);
  expect(errors).toEqual([]);
});

test.describe.configure({ timeout: 60_000 });

test('furniture changes the café live: new seats count, and a customer walks around a table placed in their way', async ({ page }) => {
  const errors = await boot(page);
  expect((await snap(page)).cafe!.freeSpots).toBe(12);

  // A new chair is a new seat.
  await clickButton(page, 'decor.enter');
  await clickButton(page, 'decor.buy.chair');
  await clickButton(page, 'decor.place.chair');
  await clickTile(page, { x: 7, y: 9 });
  expect((await snap(page)).cafe!.freeSpots).toBe(13);
  await clickButton(page, 'decor.exit');

  // Take an order: the customer heads along row 5 to chair_1 at (9,5).
  const id = await page.evaluate(() => window.__TCSS__!.spawnCustomer('student'));
  await page.waitForFunction((cid) => window.__TCSS__!.snapshot().cafe!.customers.find((c) => c.id === cid)?.state === 'ORDERING', id, { timeout: 30_000 });
  await page.evaluate(() => window.__TCSS__!.setTimeScale(0.15)); // slow enough to decorate while they walk
  await clickObject(page, 'order_counter');
  await idle(page);
  await page.waitForFunction((cid) => window.__TCSS__!.snapshot().cafe!.customers.find((c) => c.id === cid)?.state === 'WAITING', id);

  // Record every tile the customer stands on from now on.
  await page.evaluate((cid) => {
    const seen: Array<{ x: number; y: number }> = [];
    (window as unknown as { __seen: typeof seen }).__seen = seen;
    const tick = () => {
      const c = window.__TCSS__!.snapshot().cafe!.customers.find((x) => x.id === cid);
      if (c) seen.push(c.tile);
      requestAnimationFrame(tick);
    };
    tick();
  }, id);

  await clickButton(page, 'decor.enter');
  await clickButton(page, 'decor.buy.cafe_table');
  await clickButton(page, 'decor.place.cafe_table');
  await clickTile(page, { x: 8, y: 5 });
  const s = await snap(page);
  const table = s.decor!.placed.find((f) => f.x === 8 && f.y === 5);
  expect(table?.type).toBe('cafe_table');
  // The table went down while the customer was still before it on their way.
  expect(s.cafe!.customers.find((c) => c.id === id)!.tile.x).toBeLessThan(8);
  await clickButton(page, 'decor.exit');

  await page.evaluate(() => window.__TCSS__!.setTimeScale(3));
  await page.waitForFunction((cid) => {
    const c = window.__TCSS__!.snapshot().cafe!.customers.find((x) => x.id === cid);
    return c?.tile.x === 9 && c.tile.y === 5;
  }, id, { timeout: 20_000 });
  const seen = await page.evaluate(() => (window as unknown as { __seen: Array<{ x: number; y: number }> }).__seen);
  expect(seen.some((t) => t.x === 8 && t.y === 5)).toBe(false);
  expect(errors).toEqual([]);
});
