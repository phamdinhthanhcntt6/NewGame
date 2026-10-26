import { expect, test, type Page } from '@playwright/test';

interface Tile {
  x: number;
  y: number;
}

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?map=sandbox');
  await page.waitForFunction(() => window.__TCSS__?.ready === true);
  // Let the camera settle one frame so worldView is current.
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__TCSS__!.setTimeScale(3));
  return errors;
}

const snap = (page: Page) => page.evaluate(() => window.__TCSS__!.snapshot());
const clientOf = (page: Page, t: Tile) => page.evaluate((tile) => window.__TCSS__!.tileToClient(tile), t);

async function clickTile(page: Page, t: Tile, button: 'left' | 'right' = 'left'): Promise<void> {
  const p = await clientOf(page, t);
  await page.mouse.click(p.x, p.y, { button });
}

async function waitFor(page: Page, pred: string, timeout = 15_000): Promise<void> {
  await page.waitForFunction(pred, undefined, { timeout });
}

test('boots without errors and the click mapping is exact', async ({ page }) => {
  const errors = await boot(page);
  for (const t of [{ x: 1, y: 1 }, { x: 8, y: 4 }, { x: 14, y: 10 }, { x: 3, y: 7 }, { x: 0, y: 0 }]) {
    const c = await clientOf(page, t);
    expect(await page.evaluate(([x, y]) => window.__TCSS__!.clientToTile(x!, y!), [c.x, c.y])).toEqual(t);
  }
  expect(errors).toEqual([]);
});

test('click-to-move: the player walks to the clicked tile around obstacles', async ({ page }) => {
  const errors = await boot(page);
  await clickTile(page, { x: 13, y: 6 });
  expect((await snap(page)).player.state).toBe('MOVING');
  await waitFor(page, `(() => { const s = window.__TCSS__.snapshot(); return s.player.state === 'IDLE' && s.player.tile.x === 13 && s.player.tile.y === 6; })()`);
  const states = (await page.evaluate(() => window.__TCSS__!.events()))
    .filter((e) => e.type === 'actor:stateChanged')
    .map((e) => (e.payload as { to: string }).to);
  expect(states).toEqual(['MOVING', 'IDLE']);
  expect(errors).toEqual([]);
});

test('clicking an object walks to a valid adjacent tile, works, and carries the result; queue delivers it', async ({ page }) => {
  await boot(page);
  await clickTile(page, { x: 8, y: 3 }); // coffee machine (front side only)
  await clickTile(page, { x: 3, y: 7 }); // table, queued
  await waitFor(page, `window.__TCSS__.snapshot().player.state === 'WORKING'`);
  expect((await snap(page)).player.tile).toEqual({ x: 8, y: 4 });
  await waitFor(page, `(window.__TCSS__.snapshot().objects.find(o => o.id === 'table_a').counters.cupsPlaced ?? 0) === 1`);
  await waitFor(page, `window.__TCSS__.snapshot().player.state === 'IDLE'`);
  const s = await snap(page);
  expect(s.player.heldItem).toBeNull();
  const done = (await page.evaluate(() => window.__TCSS__!.events())).filter((e) => e.type === 'interaction:completed');
  expect(done.map((e) => (e.payload as { actionId: string }).actionId)).toEqual(['brew_test', 'place_cup']);
});

test('clicking a tall object by its visible top/label interacts with it (not the tile behind)', async ({ page }) => {
  await boot(page);
  for (const id of ['shelf', 'machine']) {
    const p = (await page.evaluate((i) => window.__TCSS__!.objectClickClient(i), id))!;
    // Sanity: the floor tile under the label is NOT the object's footprint — the old bug.
    const tileUnder = await page.evaluate(([x, y]) => window.__TCSS__!.clientToTile(x!, y!), [p.x, p.y]);
    expect(tileUnder).not.toEqual((await page.evaluate((i) => window.__TCSS__!.objectTiles(i), id))[0]);
    expect(await page.evaluate(([x, y]) => window.__TCSS__!.clientToTarget(x!, y!).objectId, [p.x, p.y])).toBe(id);
  }
  const shelfLabel = (await page.evaluate(() => window.__TCSS__!.objectClickClient('shelf')))!;
  await page.mouse.click(shelfLabel.x, shelfLabel.y);
  await waitFor(page, `window.__TCSS__.events().some(e => e.type === 'interaction:failed' || e.type === 'interaction:started')`);
  const ev = await page.evaluate(() => window.__TCSS__!.events());
  // Empty hands → the shelf interaction is attempted at its east side and fails on requirements, proving the target was the shelf.
  expect(ev.find((e) => e.type === 'interaction:failed')?.payload).toMatchObject({ objectId: 'shelf', reason: 'requirementsNotMet' });
  const t = (await snap(page)).player.tile;
  expect(t.x).toBe(2);
  expect([5, 6]).toContain(t.y);
});

test('an enclosed object reports unreachable and the player does not move', async ({ page }) => {
  await boot(page);
  const before = (await snap(page)).player.pos;
  // Click the statue where it is visible (its floor tile is hidden behind the front posts).
  const p = (await page.evaluate(() => window.__TCSS__!.objectClickClient('statue')))!;
  await page.mouse.click(p.x, p.y);
  await waitFor(page, `window.__TCSS__.events().some(e => e.type === 'interaction:failed' && e.payload.reason === 'unreachable')`);
  await page.waitForTimeout(300);
  const s = await snap(page);
  expect(s.player.pos).toEqual(before);
  expect(s.player.state).toBe('IDLE');
});

test('Esc cancels work in progress without a reward', async ({ page }) => {
  await boot(page);
  await clickTile(page, { x: 8, y: 3 });
  await waitFor(page, `window.__TCSS__.snapshot().player.state === 'WORKING'`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2500);
  const s = await snap(page);
  expect(s.player.state).toBe('IDLE');
  expect(s.player.heldItem).toBeNull();
  const ev = await page.evaluate(() => window.__TCSS__!.events());
  expect(ev.some((e) => e.type === 'interaction:completed')).toBe(false);
  expect(ev.find((e) => e.type === 'interaction:cancelled')?.payload).toMatchObject({ reason: 'playerCancelled' });
});

test('right click cancels movement', async ({ page }) => {
  await boot(page);
  await clickTile(page, { x: 14, y: 1 });
  await page.waitForTimeout(150);
  await clickTile(page, { x: 2, y: 9 }, 'right');
  const s = await snap(page);
  expect(s.player.state).toBe('IDLE');
  expect(s.player.waypoints).toEqual([]);
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('tap-to-move works with touch input', async ({ page }) => {
    await boot(page);
    const p = await clientOf(page, { x: 5, y: 9 });
    await page.touchscreen.tap(p.x, p.y);
    await waitFor(page, `(() => { const s = window.__TCSS__.snapshot(); return s.player.state === 'IDLE' && s.player.tile.x === 5 && s.player.tile.y === 9; })()`);
  });
});
