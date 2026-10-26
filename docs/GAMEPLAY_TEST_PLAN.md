# Gameplay Test Plan

> **Status:** v1.0 · 2026-10-26 · Related: [GAMEPLAY_ROADMAP.md](GAMEPLAY_ROADMAP.md)

## 1. Commands
| Command | What it runs |
|---|---|
| `npm run typecheck` | `tsc --noEmit` (TypeScript 7.0.2, strict + `noUncheckedIndexedAccess`) |
| `npm run build` | Vite production build |
| `npm test` | Vitest unit tests (`tests/unit`), headless, no browser |
| `npm run e2e` | Playwright (Chromium) against `npm run dev` on port 5180 |

## 2. Principles
- Gameplay rules are tested **headless** through `GameSimulation` with deterministic ticks.
- E2E tests **click real canvas coordinates** (from `__TCSS__.tileToClient`) and assert on the **simulation snapshot**, never on pixels.
- Every bug fix starts with a failing test.
- **Mutation checks:** a test suite that passes is only trusted after deliberately breaking the rule it protects and seeing a test fail (§4).

## 3. M1 coverage (all passing 2026-10-26)

### Unit — 41 tests
| Area | File | Checks |
|---|---|---|
| Projection & depth | `iso.test.ts` | Corner mapping; 64×64 round-trip; actor in front/behind of 1×1 and 2×1 footprints |
| Pathfinding | `pathfinding.test.ts` | Optimal cost; walls; unreachable/blocked/empty goals → null; no corner cutting; nearest of multiple goals; determinism; 40×40 serpentine median < 2 ms; smoothing never clips a blocked tile |
| Core | `core.test.ts` | FSM legal/illegal transitions, log, self-transition no-op; EventBus on/once/off |
| World & approach | `world.test.ts` | Map validation (unknown type, overlap, bounds, duplicate ids, ragged rows, blocked start); blocker add/remove; rotation swaps footprint + sides; side-restricted approach; reachable approach chosen when nearest is sealed off; blocked click → nearest tile |
| Interaction | `interaction.test.ts` | Arrive on the clicked tile with body clearance every frame; obstacle click; mid-walk retarget; machine side + facing + state sequence; queued brew → deliver; requirements failure; unreachable (no movement); in-reach instant interaction; cancel mid-work (no reward, progress reported); floor click cancels queue; double-click dedupe; 60 s frame completes once; re-entrant tick completes once and emits no bogus failure; queue limit; object removed mid-approach; 500-step random fuzz (no throw, body always in walkable space, never stuck) |

### E2E — 8 tests (`tests/e2e/m1-movement.spec.ts`)
Boot without console errors + exact client↔tile mapping; click-to-move; object approach + work + carry + queued delivery; **clicking a tall object by its visible top/label targets that object, not the tile behind it**; enclosed object unreachable; Esc cancel; right-click cancel; touch tap-to-move.

E2E object clicks use `__TCSS__.objectClickClient(id)`, the place a player would actually click, not the footprint's floor centre. The M1 suite runs on `/?map=sandbox`.

## 3b. M2 coverage (all passing 2026-10-26) — totals now 78 unit + 13 E2E

### Unit — 37 new tests
| Area | File | Checks |
|---|---|---|
| Plot model | `plotModel.test.ts` | Unwatered seed doesn't grow + dry time; one watering = one segment then thirsty; READY with exact `readyAt`; clock going backwards ignored; **50 random step-wise advances equal one big advance**; non-growing phases are time-invariant; soil speed/yield/quality; thirst penalty + cap |
| Transactions | `transactions.test.ts` | No negative balance; no removing more than owned; all-or-nothing; netting of repeated lines; unknown item / fractional / zero qty / negative EXP rejected; capacity on net additions only; idempotency key survives rebuilding from saved state; quality averaging; bounded history + events; empty stacks removed |
| Farm | `farm.test.ts` | New farm layout (6 owned, 18 locked, 200 coins, 2 seeds); **full loop by player clicks** prepare → plant → water → not-ready feedback → thirsty → water → READY → harvest (10 cherries Q55, +8 EXP) → replant; player stands adjacent while working; no harvest before READY; empty can → well refill; no seeds; shop proximity, exact charge, insufficient coins, invalid qty, closes when walking away; selected Arabica planted; locked land (no walking, buy once, insufficient coins); soil upgrade rules + charges; harvest pays once under repeated clicks and a 60 s frame; full bag blocks harvest cleanly |
| Save | `save.test.ts` | Round-trip equality (economy, plots, player tile); **growth while closed** from timestamps; reload can't duplicate a harvest (even if the plot is forced back to READY); saving mid-action keeps nothing half-done; corrupt JSON backed up; invalid structure rejected; newer version refused and untouched; migrations run in order |

### E2E — 5 new tests (`tests/e2e/m2-farm.spec.ts`)
Full farming loop with real mouse clicks and clock fast-forward; seed shop via HUD buttons (disabled away from the stall, active at it, Arabica selected and planted, shop closes when walking far); locked land (no walking, HUD purchase, buy button disappears); **reload persistence without an explicit save** + growth while "closed"; the sandbox never writes the farm save.

E2E HUD clicks use `__TCSS__.buttonClient(name)` and wait for the button to be enabled, because the HUD refreshes one frame after the simulation.

## 3c. M3 coverage (all passing 2026-10-26) — totals now 100 unit + 17 E2E

### Unit — 21 new tests
| Area | File | Checks |
|---|---|---|
| Processing | `processing.test.ts` | Equipment on the map; no-input refusal; inputs consumed at load, outputs only on collect after the time; full chain with quality; busy machine refused, second rack free; preferred vs first-runnable recipe; full bag blocks collect; collect idempotent; upgrade rules (idle only, charged once, batch ×2, speed, quality, max level); jobs finish while closed |
| Conservation | `processing.test.ts` | **300-step fuzz with an independent ledger:** bag = start + Σ transaction deltas, and per recipe collected + pending outputs = consumed inputs × ratio |
| Market | `market.test.ts` | Market session required; payout = quote exactly; overselling / zero / fractional / unsellable rejected; quality pricing; saturation lowers price and recovers over time; bulk vs one-by-one; saturation saved; recent sales order; walking away closes |
| Economy data | `market.test.ts` | Every processing step increases the sale value of a harvest; raw sale covers ≥ 80% of seed cost |
| Save | `save.test.ts` | Real v1 (M2-era) save → v2: farm progress kept, equipment created; multi-step migration chain order |

### E2E — 4 new tests (`tests/e2e/m3-processing-market.spec.ts`)
Farm → market with real clicks (harvest, dry, roast, sell all via HUD; exact payout 94); bulk selling lowers the next price and nothing sells away from the market; equipment panel recipe preference + upgrade blocked while running; a batch keeps processing across reloads and finishes while closed.

UI-focused E2E tests may use the dev-only `__TCSS__.grantItems`, which still goes through `TransactionService` (reason `debug:grant`). The full-chain test uses no grants.

## 3d. M4 coverage (all passing 2026-10-26) — totals now 118 unit + 20 E2E

### Unit — 18 new tests (`cafe.test.ts`)
Map capacity (8 seats, 4 standing spots, 5-tile queue); spawn schedule + concurrency cap; **no teleporting** (per-tick displacement bound over 3 minutes); complete order fields; queue order and advancing; unique seats; `noSeat` when full; `queueFull`; impatient → CANCELLED + walks out + queue advances; timeout → FAILED + seat released; blocked door → `blocked`; sealed café → `customer:removed` (never stuck); taking orders by clicking the counter (from behind it); "no customer" feedback; **20-minute fuzz** (unique reservations, queue members in queue states, nobody outlives their patience); order transition table (happy path, illegal jumps, terminal states, unknown ids/recipes); travel sign event.

### E2E — 3 new tests (`tests/e2e/m4-cafe.spec.ts`)
Farm → café → farm through signs with shared inventory and reload resuming on the last map (this test caught the HUD scene-reuse bug); customer walks in from the street, the player takes the order with a real click, the customer gets a seat; an untaken order is cancelled for impatience and the customer walks out.

The café's automatic spawner is off in tests that spawn customers themselves (`cafeSim({ autoSpawn })`, `__TCSS__.setCafeOpen`), so they control exactly who arrives.

## 4. Mutation checks performed for M1
| Deliberate break | Tests failing |
|---|---|
| Allow diagonal corner cutting in A* | 4 |
| Ignore interaction `sides` | 2 |
| Remove double-click dedupe | 1 |
| Remove once-only completion guard | 1 (after adding the re-entrancy test; initially 0) |
| Disable object hit-testing (tile-only picking) | 2 E2E |

### M2 mutation checks
| Deliberate break | Unit tests failing |
|---|---|
| No idempotency check (duplicate rewards) | 2 |
| Allow negative balance | 3 |
| Allow removing more items than owned | 3 |
| Ignore inventory capacity | 2 |
| Crops grow without water | 5 |
| Buy seeds away from the stall | 1 |
| Rules read stale (un-advanced) plot state | 1 |
| Harvest allowed while GROWING | 3 |

### M3 mutation checks
| Deliberate break | Unit tests failing |
|---|---|
| Load a batch without consuming inputs | 4 |
| Collect without idempotency key | 1 |
| Load a busy machine | 2 |
| Collect before the job is done | 1 |
| Upgrade while running | 1 |
| Sell away from the market | 1 |
| No saturation after selling | 3 |
| Sale pays more than the quote | 1 |

### M4 mutation checks
| Deliberate break | Unit tests failing |
|---|---|
| Order transitions unchecked | 1 |
| No order patience | 2 |
| No drink patience | 2 |
| Accept with no free seat | 1 |
| Unbounded queue | 1 |
| Seat never released | 1 |
| Customers jump to the end of their path (teleport) | 2 |

## 5. Known issues / gaps (after M2)
1. **No customer or employee actors yet**, so actor–actor overlap and avoidance are untested (M4/M8).
2. **Depth sorting** uses a footprint heuristic tested at fixed probe points. Long multi-tile objects with actors on diagonal corners may still mis-sort; this needs a visual test map when real sprites arrive.
3. **The E2E suite runs Chromium only.** No WebKit/Firefox and no real mobile device yet.
4. **Pointer drag vs tap:** `pointerdown` triggers movement, so a future camera-pan drag will need a tap threshold.
5. **Production bundle is 1.4 MB** (Phaser unminified chunk warning suppressed). Code-splitting is deferred.
6. **Performance** has only been checked on desktop Chromium (59–60 fps in the sandbox); there's no mobile profiling.
7. **Feedback text for `unknownAction` failures** builds an i18n key from free-text detail, so it shows a raw key. Only reachable with broken data; fix when the production HUD lands.
8. **Hit-testing is per-object polygon checks** (linear scan). Fine for a room of tens of objects; it will need a spatial index if a scene has hundreds.
9. **Farm scene ran at ~43 fps in headless Chromium** (software rendering, 29 objects + labels), versus 59–60 in the M1 sandbox. Each frame also builds the snapshot twice (world + HUD). Profile on real hardware before M4 adds customers.
10. **Plot labels are small at the fitted zoom.** Placeholder only; the HUD's selected-plot panel carries the detail.
11. **Seed `unlockLevel` is data only.** Culi can be bought at level 1 until levels exist (M6).
12. **Single save slot in localStorage.** Quota errors on `setItem` are not caught yet (M11). Playwright gets a fresh browser context per test, so E2E runs never share saves.
13. **The dev clock offset** (`tcss.debug.clockOffset`) persists in localStorage in dev builds. It is ignored in production builds.
14. **The world snapshot is built twice per frame** (world + HUD scenes) and now includes equipment views and market history. Fine at this scale; it should be shared once customers arrive.
15. **Station panel recipe buttons** sit at fixed positions; long localized labels could overflow. Placeholder only.
16. **No free "sell quantity" stepper:** selling is by 1 / 10 / all buttons. `MarketService.sell` accepts any quantity; the UI just doesn't offer it yet.
17. **Customers can overlap each other** while walking (no actor–actor collision); reservations prevent two customers targeting the same seat or queue tile. Local avoidance is a polish item.
18. **Accepted orders always fail by timeout until M5** adds brewing and serving.
19. **Customers/orders are not saved;** leaving the café or reloading ends them (by design for the prototype).
20. **Travel restarts the whole world scene** (rebuild from save, about one frame). Fine for placeholder art; production may want a transition screen.

## 6. Planned coverage per milestone
| Milestone | Key automated checks |
|---|---|
| M2 | ✅ done (§3b) |
| M3 | ✅ done (§3c) |
| M4 | ✅ done (§3d) |
| M5 | Each mini-game input changes quality; ingredients consumed once; a drink can be served only once |
| M6 | Rating weights 40/25/20/15 table tests; reputation/traffic/tips; no negative balance; reward idempotency |
| M7 | Placement validation; nav rebuild; furniture bonus applied; persistence |
| M8 | Employees use real tasks (inventory changes match work done) |
| M9 | Each story scene completable only through its objectives |
| M11 | Save round-trip equality; migration v1→v2; corrupt save handling; reload does not duplicate rewards |
