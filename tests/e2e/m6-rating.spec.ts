import { expect, test, type Page } from '@playwright/test';

// Each test plays one or two full brews with the needle slowed down for reliable input,
// so they legitimately take longer than the 30 s default.
test.describe.configure({ timeout: 90_000 });

async function boot(page: Page, url = '/?map=cafe'): Promise<string[]> {
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
  await page.evaluate(() => {
    window.__TCSS__!.setCafeOpen(false);
    window.__TCSS__!.setTimeScale(3);
  });
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
  await page.mouse.click(p!.x, p!.y);
  await idle(page);
}

async function clickButton(page: Page, name: string): Promise<void> {
  await page.waitForFunction((n) => window.__TCSS__!.buttonClient(n)?.enabled === true, name, { timeout: 5000 });
  const b = (await page.evaluate((n) => window.__TCSS__!.buttonClient(n), name))!;
  await page.mouse.click(b.x, b.y);
}

async function stopNeedleInZone(page: Page): Promise<void> {
  const before = (await snap(page)).cafe!.brew!.stepIndex;
  await page.evaluate(() => window.__TCSS__!.setTimeScale(0.25));
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

/** Take an order, brew a latte with the given addition, serve it, and return the rating event. */
async function serveLatte(page: Page, addition: string): Promise<{ stars: number; coins: number; tip: number; feedback: string[] }> {
  const id = (await page.evaluate(() => window.__TCSS__!.spawnCustomer('tourist', 'latte')))!;
  await page.waitForFunction((cid) => window.__TCSS__!.snapshot().cafe!.customers.find((c) => c.id === cid)?.state === 'ORDERING', id, { timeout: 20_000 });
  await clickCustomer(page, id);
  await clickObject(page, 'grinder');
  await clickButton(page, 'brew.bean.roasted_arabica');
  await stopNeedleInZone(page);
  await clickObject(page, 'espresso');
  await stopNeedleInZone(page);
  await stopNeedleInZone(page);
  await clickObject(page, 'milk_station');
  await clickButton(page, `brew.add.${addition}`);
  await stopNeedleInZone(page);
  await page.waitForFunction((cid) => window.__TCSS__!.snapshot().cafe!.customers.find((c) => c.id === cid)?.state === 'WAITING', id);
  const before = (await page.evaluate(() => window.__TCSS__!.events())).filter((e) => e.type === 'cafe:rated').length;
  await clickCustomer(page, id);
  await page.waitForFunction((n) => window.__TCSS__!.events().filter((e) => e.type === 'cafe:rated').length > n, before, { timeout: 20_000 });
  return (await page.evaluate(() => window.__TCSS__!.events())).filter((e) => e.type === 'cafe:rated').at(-1)!.payload as { stars: number; coins: number; tip: number; feedback: string[] };
}

test('a latte made with water is rated "wrong order": fewer stars and less money than a correct one', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    window.__TCSS__!.grantItems('roasted_arabica', 2, 72);
    window.__TCSS__!.grantItems('milk', 1, 70);
  });
  const good = await serveLatte(page, 'milk');
  const bad = await serveLatte(page, 'water');
  expect(good.feedback).not.toContain('wrongOrder');
  expect(bad.feedback).toContain('wrongOrder');
  expect(bad.stars).toBeLessThan(good.stars);
  expect(bad.coins + bad.tip).toBeLessThan(good.coins + good.tip);
  expect(errors).toEqual([]);
});

test('reputation and rating history persist across a reload', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    window.__TCSS__!.grantItems('roasted_arabica', 1, 72);
    window.__TCSS__!.grantItems('milk', 1, 70);
  });
  const r = await serveLatte(page, 'milk');
  await page.waitForFunction(() => window.__TCSS__!.snapshot().reputation.served === 1);
  const before = (await snap(page)).reputation;
  expect(before.recent[0]!.stars).toBe(r.stars);
  await page.evaluate(() => window.__TCSS__!.saveNow());
  await page.reload();
  await ready(page);
  const after = (await snap(page)).reputation;
  expect(after.value).toBeCloseTo(before.value, 9);
  expect(after.served).toBe(1);
  expect(after.recent.map((f) => f.orderId)).toEqual(before.recent.map((f) => f.orderId));
});
