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

E2E object clicks use `__TCSS__.objectClickClient(id)`, the place a player would actually click, not the footprint's floor centre.

## 4. Mutation checks performed for M1
| Deliberate break | Tests failing |
|---|---|
| Allow diagonal corner cutting in A* | 4 |
| Ignore interaction `sides` | 2 |
| Remove double-click dedupe | 1 |
| Remove once-only completion guard | 1 (after adding the re-entrancy test; initially 0) |
| Disable object hit-testing (tile-only picking) | 2 E2E |

## 5. Known issues / gaps after M1
1. **No customer or employee actors yet**, so actor–actor overlap and avoidance are untested (M4/M8).
2. **Depth sorting** uses a footprint heuristic tested at fixed probe points. Long multi-tile objects with actors on diagonal corners may still mis-sort; this needs a visual test map when real sprites arrive.
3. **The E2E suite runs Chromium only.** No WebKit/Firefox and no real mobile device yet.
4. **Pointer drag vs tap:** `pointerdown` triggers movement, so a future camera-pan drag will need a tap threshold.
5. **Production bundle is 1.4 MB** (Phaser unminified chunk warning suppressed). Code-splitting is deferred.
6. **Performance** has only been checked on desktop Chromium (59–60 fps in the sandbox); there's no mobile profiling.
7. **Feedback text for `unknownAction` failures** builds an i18n key from free-text detail, so it shows a raw key. Only reachable with broken data; fix when the production HUD lands.
8. **Hit-testing is per-object polygon checks** (linear scan). Fine for a room of tens of objects; it will need a spatial index if a scene has hundreds.

## 6. Planned coverage per milestone
| Milestone | Key automated checks |
|---|---|
| M2 | Plot FSM legality; cannot harvest before READY; growth from saved timestamps after reload (fake clock); harvest → inventory exactly once |
| M3 | Processing consumes inputs before producing outputs; capacity limits; no selling more than owned; transaction history totals |
| M4 | Customers never teleport (max displacement per tick); queue order; patience → FAILED; blocked path → customer leaves, no stuck NPCs (fuzz) |
| M5 | Each mini-game input changes quality; ingredients consumed once; a drink can be served only once |
| M6 | Rating weights 40/25/20/15 table tests; reputation/traffic/tips; no negative balance; reward idempotency |
| M7 | Placement validation; nav rebuild; furniture bonus applied; persistence |
| M8 | Employees use real tasks (inventory changes match work done) |
| M9 | Each story scene completable only through its objectives |
| M11 | Save round-trip equality; migration v1→v2; corrupt save handling; reload does not duplicate rewards |
