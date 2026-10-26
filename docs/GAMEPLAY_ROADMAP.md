# Gameplay Roadmap (authoritative)

> **Status:** v1.0 · 2026-10-26 · branch `dev`
> **Supersedes** the milestone list in [production/MILESTONES_AND_BACKLOG.md](production/MILESTONES_AND_BACKLOG.md). The art track there still applies, but it runs *after* gameplay ("gameplay first, art later").
> Systems: [GAMEPLAY_SYSTEMS.md](GAMEPLAY_SYSTEMS.md) · Tests: [GAMEPLAY_TEST_PLAN.md](GAMEPLAY_TEST_PLAN.md) · Art swap: [ASSET_REPLACEMENT_GUIDE.md](ASSET_REPLACEMENT_GUIDE.md)

## Rules
- All rendering is placeholder (shapes, labels, debug panels) until M12 is done.
- A milestone is **done** only when: `npm run typecheck`, `npm run build`, `npm test` and `npm run e2e` all pass; the playable flow has been demonstrated; this file is updated.
- The next milestone starts only when the current one works end to end.

## Milestones

| # | Milestone | Status | Exit criteria (summary) |
|---|---|---|---|
| **M1** | Core engine, movement, interactions | **Done 2026-10-26** | Click/tap-to-move, A*, collision, auto-approach, interaction queue, cancellation, 5 player states, click-what-you-see hit-testing, render adapter. 41 unit + 8 E2E tests pass |
| **M2** | Full farming loop | **Done 2026-10-26** | Plot FSM `EMPTY→PREPARED→PLANTED→GROWING→READY→HARVESTED`; locked land + purchase; soil upgrades; seed shop; watering can + well; timestamp growth that survives reload; harvest → inventory exactly once; central TransactionService; versioned localStorage save. 78 unit + 13 E2E tests pass |
| **M3** | Processing, selling, shared inventory | **Done 2026-10-26** | Cherries → green → roasted with equipment, time, capacity and quality; market sell by quantity; transaction history; one inventory |
| **M4** | Customer AI & orders | **Done 2026-10-26** | Customer FSM `SPAWNING→…→LEAVING`; queue; patience; order FSM `CREATED→…→COMPLETED` + `FAILED/CANCELLED` |
| **M5** | Brewing mini-game & serving | **Done 2026-10-26** | 5 recipes; grind / portafilter / extract / add / finish steps scored; ingredients consumed; carry → serve once |
| M6 | Ratings, economy, progression | Next | Rating 40/25/20/15; feedback text + history; reputation → traffic/tips; XP/levels; central transaction service |
| M7 | Furniture & decoration | — | Buy, preview, validate, rotate, place, move, remove; nav grid rebuild; real bonuses |
| M8 | Employees | — | Barista/Cashier/Server/Farm worker with task assignment + FSM, using the same interaction system as the player |
| M9 | Playable rebirth story | — | Scenes 03/04/05 with click-to-move objectives (no joystick), tutorial uses M5 brewing |
| M10 | World map, quests, expansion | — | Locations, districts, branches, quests, achievements, skills, recipe unlocks (placeholder UI) |
| M11 | Save/load robustness | — | Versioned saves, migration, corruption handling, no duplicates from reload |
| M12 | Integration & bug fixing | — | All 20 final acceptance criteria from the brief pass |

## M1 report (2026-10-26)
- **Playable flow:** `npm run dev` → http://localhost:5180. Click the floor to walk. Click the coffee machine to brew a test cup, then click a table to place it (or click both in a row to queue them). Esc or right-click cancels. The fenced statue shows the unreachable case.
- **Evidence:** [walking around obstacles with a queued action](screenshots/m1-walking.png) · [working at the machine (progress bar, debug panel)](screenshots/m1-working.png) · [idle](screenshots/m1-idle.png) · [front-wall cutaway](screenshots/m1-southwall.png)
- **Delivered:** see GAMEPLAY_SYSTEMS §2–§6.
- **Not in M1 (by design):** inventory, currency, saving, customers, farming. The machine/table/crate/shelf actions are **sandbox test actions** that prove the interaction framework; they are not economy features.
- **Known issues:** see GAMEPLAY_TEST_PLAN §5.
- **M2 unblocked:** yes. Farming adds `farm.*` action handlers and a plot model on top of the M1 interaction and navigation services.

## M2 report (2026-10-26)
- **Playable flow:** `npm run dev` → http://localhost:5180 (the farm is now the default map; `?map=sandbox` opens the M1 sandbox).
  1. Click an owned plot (top row) and the player walks over and prepares the soil.
  2. Click it again to plant the selected seed (HUD "Hạt giống"); click again to water it.
  3. Wait: Robusta needs 2 waterings over 2 min. A thirsty plot turns pale and says "cần tưới".
  4. Water again, wait until the plot turns red ("chín!"), then click to harvest. The cherries land in "Túi đồ".
  5. Click again to clear and prepare the plot for replanting.
  6. Seeds: walk to the orange seed stall; the HUD buy buttons become active while you stand nearby.
  7. Can empty? Click the well. Locked plots: click one, then "Mua đất" in the HUD. Owned empty plots can be upgraded ("Nâng cấp").
  8. Progress is saved automatically (and when the tab is hidden or closed). Reloading resumes exactly, including crop growth while the game was closed.
- **Evidence:** [farm with ripe, thirsty and locked plots, HUD](screenshots/m2-farm.png)
- **Delivered:** GAMEPLAY_SYSTEMS §9–§12.
- **Pulled forward from later milestones** (needed for a correct M2): a minimal central `TransactionService` (M6 extends it) and a versioned save with corruption handling (M11 hardens it).
- **Not in M2:** processing, market selling, transaction-history UI (M3); levels and seed unlock enforcement (M6); offline catch-up limits beyond the dry-quality penalty.
- **Known issues:** GAMEPLAY_TEST_PLAN §5.
- **M3 unblocked:** yes. Processing equipment is new object types + handlers that consume cherries through `TransactionService`; selling is a market service over the same inventory.

## M3 report (2026-10-26)
- **Playable flow** (farm map):
  1. Harvest cherries, then click a **drying rack**: the player loads a batch (inputs leave the bag immediately).
  2. When it shows "xong!", click it again to collect green beans.
  3. Click the **roaster** to roast green beans the same way.
  4. Walk to the blue **market** stall. The station panel lists everything sellable you own, with the live unit price; sell 1, 10 or everything.
  5. Selecting a machine shows its status, the recipe it prefers next, and its upgrade.
- **Evidence:** [equipment panel with machines running](screenshots/m3-equipment.png) · [market panel](screenshots/m3-market.png)
- **Delivered:** GAMEPLAY_SYSTEMS §13–§15. Save schema bumped to **v2** with a real v1→v2 migration (M2 saves load into M3).
- **Totals:** 100 unit + 17 E2E tests; 8 more mutation checks caught.
- **Known issues:** GAMEPLAY_TEST_PLAN §5.
- **M4 unblocked:** yes. Roasted beans sit in the shared inventory, ready for café recipes. Customers reuse `Actor` + `InteractionService` + A*.

## M4 report (2026-10-26)
- **Playable flow:**
  1. On the farm, click the teal **sign** (right edge) to travel to the café; in the café, the teal sign top-right goes back. The game saves before every trip, and reopening resumes on the last map.
  2. Customers appear on the street, walk in through the door, and queue at the order counter.
  3. The first one shows a "Latte?" bubble. Click the **order counter**: the player walks behind it and takes the order, and the customer walks to a reserved seat (or a standing spot).
  4. Bars under customers show remaining patience. Unanswered or unserved customers give up and walk out ("Khách chờ lâu, bỏ về").
  5. The café HUD lists open orders with status and patience, plus queue length, free seats and recent outcomes.
- **Evidence:** [café with queue, ordering and seated customers](screenshots/m4-cafe.png)
- **Delivered:** GAMEPLAY_SYSTEMS §16–§18.
- **Not in M4 (by design):** brewing, serving and payment. Accepted orders currently always end FAILED (timeout); M5 adds `PREPARING → READY → SERVED → COMPLETED`.
- **Bug found by E2E and fixed:** Phaser reuses scene instances on restart, so the HUD kept a destroyed farm panel after travelling (console error). Panels are now reset on create/shutdown, and travel is deferred to the start of the next frame.
- **Totals:** 118 unit + 20 E2E tests; 7 more mutation checks caught.
- **M5 unblocked:** yes. Orders carry recipe, ingredients, time limit, expected quality and reward. `CafeService` has the RECEIVING → TASTING → RATING states ready for serving.

## M5 report (2026-10-26)
- **Playable flow (café):**
  1. Buy milk / condensed milk at the **supply shelf**; bring roasted beans from the farm (shared inventory).
  2. Take an order by clicking the counter *or the customer* standing at it.
  3. Brew at the stations behind the counter, in order: **grinder** (choose a bean, stop the grind needle) → **espresso machine** (tamp, extract) → **milk station** (choose milk / condensed milk / water, pour). Espresso skips the milk station.
  4. Stop each needle inside the green zone (button or **Space**). The panel shows progress, the next station, and a cancel button.
  5. The finished drink is in your hands. Click the customer (or their seat) to serve. They taste, rate and pay, and the order becomes COMPLETED.
- **Evidence:** [brewing panel with timing needle](screenshots/m5-brewing.png)
- **Delivered:** GAMEPLAY_SYSTEMS §19–§21.
- **Payment in M5 is the recipe's base price.** Quality-based ratings, tips and reputation are M6; they plug into the `RatingPolicy` hook.
- **Totals:** 131 unit + 23 E2E tests; 7 of 8 mutation checks caught (the 8th is an equivalent mutant, see the test plan).
- **M6 unblocked:** yes. Each drink records bean quality, recipe accuracy, per-step timing accuracy and ready time; each order records accept/serve times. Those are the inputs of the 40/25/20/15 rating.
