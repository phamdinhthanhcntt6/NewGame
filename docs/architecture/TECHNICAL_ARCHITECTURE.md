# Technical Architecture

> **Project:** TheCoffeeSixSense · **Status:** Draft v0.1 (2026-10-26) · **Branch:** `dev`
> **Related:** [GAMEPLAY_FLOW](../design/GAMEPLAY_FLOW.md) (scenes, save schema) · [GAME_DESIGN](../design/GAME_DESIGN.md) · [MILESTONES_AND_BACKLOG](../production/MILESTONES_AND_BACKLOG.md)

---

## 1. Repository audit (2026-10-26)

| Check | Finding |
|---|---|
| Existing codebase | **None.** `D:\NewGame` was empty and not a git repository. No TheCoffeeSixSense project was found on local drives or in VS Code's recent workspaces. There is no prior architecture to analyze or migrate. |
| Git | Repository created 2026-10-26. `main` = one baseline commit (README + concept sheet), kept as the untouched reference. All work happens on `dev`. Nothing is pushed; there is no remote. |
| Uncommitted work to preserve | None existed. |
| Design references | One composite concept sheet (29 screens, 1536×1024). See [SCREEN_SPECS §1](../design/SCREEN_SPECS.md). |
| Toolchain on dev machine | Node 24.16.0, npm 12.0.2, git 2.55.0 ✅. **Blender: not installed** ❌. **GitHub CLI (`gh`): not installed**. Python present without Pillow. |
| Latest on npm (2026-10-26) | `phaser` 4.2.1, `vite` 8.3.5, `typescript` 7.0.2, `vitest` 5.0.5, `@playwright/test` 1.64.1. Only Phaser is pinned by design; the other versions are chosen and pinned in backlog item B-001 after a compatibility check |

**Migration scope:** none. This is a greenfield build. The "rebuild" therefore starts from the design documents, not from code.

## 2. Stack
| Concern | Choice | Notes |
|---|---|---|
| Engine | **Phaser 4.2.x** (pin `~4.2.1`) | WebGL renderer; Canvas fallback not targeted |
| Language | TypeScript, `strict: true` | |
| Build | Vite | asset hashing; `import.meta.env` for debug flags |
| Unit tests | Vitest | all `systems/`, `world/iso`, `pathfinding`, `fsm`, `state` |
| E2E | Playwright (Chromium + WebKit + mobile viewport) | drives the game via a dev-only test bridge (§8) |
| Saves | IndexedDB via the `idb` wrapper | see GAMEPLAY_FLOW §3 |
| Maps | Tiled (`.tmj`) isometric maps for layout, collision and markers | sprites still come from atlases |
| Art | Blender → render script → atlas packer → Phaser JSON atlases | ART_BIBLE §9 |
| Lint/format | ESLint + Prettier | |

## 3. Layering

```
┌──────────────────────────────────────────────────────────────┐
│ scenes/   Phaser scenes: thin adapters (render, input, tweens)│
│ ui/       Panel/Button/Bubble widgets, i18n text              │
├──────────────────────────────────────────────────────────────┤
│ entities/ Player, Customer, Station, Plot (view + FSM glue)   │
├──────────────────────────────────────────────────────────────┤
│ systems/  Economy, Inventory, Recipes, Rating, Farming,       │
│           Processing, Progression, Quests, Spawn  (PURE TS)   │
│ world/    iso projection, grid, nav, A*, depth sort (PURE TS) │
│ fsm/      generic state machine (PURE TS)                     │
│ state/    GameState store, SaveService, migrations            │
│ core/     EventBus, SceneRouter, Clock, RNG, i18n, config     │
├──────────────────────────────────────────────────────────────┤
│ data/     JSON: items, recipes, crops, customers, furniture…  │
└──────────────────────────────────────────────────────────────┘
```

**Rule:** nothing under `systems/`, `world/`, `fsm/` or `state/` imports Phaser. These modules run headless under Vitest, which is how gameplay rules (rating, economy, growth, pathfinding) get real tests instead of screenshots.

### Proposed source tree
```
src/
  main.ts                     # Phaser.Game config, scene list
  core/  EventBus.ts SceneRouter.ts WorldClock.ts Rng.ts i18n.ts debug.ts
  state/ GameState.ts StateStore.ts SaveService.ts migrations.ts schema.ts
  data/  items.json recipes.json crops.json customers.json furniture.json locales/vi.json
  fsm/   StateMachine.ts
  world/iso/ projection.ts depth.ts IsoGrid.ts
  world/nav/ NavGrid.ts astar.ts SeatRegistry.ts
  systems/ Economy.ts Inventory.ts Rating.ts Brewing.ts Farming.ts Processing.ts Progression.ts Spawner.ts
  entities/ Player.ts Customer.ts Station.ts Plot.ts
  scenes/ Boot Preload Splash MainMenu StoryIncident StoryPortal StoryMaster CharacterCreate Cafe Farm WorldMap
  scenes/overlay/ Hud Panel Pause Settings SaveSlots Dialog
  ui/    NineSlicePanel.ts Button.ts SpeechBubble.ts VirtualJoystick.ts
  test-bridge/ bridge.ts      # dev/test builds only
tools/
  blender/ render_iso.py      # headless Blender render script
  atlas/  pack.mjs            # packs renders → public/assets/atlases
  sim/    economy-sim.ts      # headless economy balance check
tests/ unit/  e2e/
public/assets/ atlases/ audio/ fonts/ maps/
```

## 4. Isometric world
- **Projection:** 2:1, tile 128×64. `toScreen(tx, ty) = ((tx − ty) × 64, (tx + ty) × 32)`; `toTile` is the exact inverse (floor). Unit-tested both ways.
- **Depth sorting:** each world sprite has a footprint (tile rect) and a base point; `depth = (baseX + baseY) × K + layerBias`. Multi-tile furniture sorts on its front-most footprint corner. Characters update depth every frame while moving. Edge cases (a character between two tables) get unit tests plus a visual test map.
- **Map source:** a Tiled isometric map provides floor, walls (blocked), spawn/door/queue markers, and station interaction tiles. ⚠ Phaser 4's isometric `Tilemap` support needs to be verified in the M1 spike (R3). Fallback: our own renderer places floor sprites from the Tiled JSON. That is simple, and the depth rules are ours either way.

## 5. Navigation & A*
- `NavGrid`: walkable flags per tile, rebuilt from the map + placed furniture (after decorate confirm, S13).
- `astar.ts`: 8-neighbour A* with octile heuristic, **no corner cutting**, deterministic tie-breaking. Paths are smoothed by line-of-sight on the grid. Budget: < 2 ms for a 40×40 grid.
- **Dynamic agents:** customers don't path-block each other (cozy game; avoid deadlocks). Local separation steering stops visible overlap. Seats and queue spots use a `SeatRegistry` with **reservations**, so two customers never target the same seat.
- Interaction tiles: each station declares an *approach tile* + facing direction. The player paths to that tile, then plays the interaction.

## 6. Finite state machines
One generic `StateMachine<TState, TContext>` with `enter/update/exit` and guarded transitions, plus a transition log (exposed to the test bridge).

| Entity | States |
|---|---|
| Player | `Idle → Walking → Interacting(station) → Carrying → Serving`; story: `Running, Vaulting, PickingUp` |
| Customer | `Spawned → WalkToDoor → FindSeat → WalkToSeat / Queue → WalkToCounter → Ordering → Waiting → Receiving → Tasting → Rating → Paying → Leaving → Despawn`; `Waiting → LeavingAngry` when patience hits 0 |
| Station (machine) | `Idle → Loaded → Working → Ready → (Overdone)`; level affects target bands |
| Plot | `Locked → Wild → Prepared → Growing(stage n) → Ripe → (Overripe) → Resting` |
| Processor | `Empty → Loaded → Processing → Done` |
| Shift | `Closed → Opening → Open → LastOrders → Closing → Summary` |

## 7. Data-driven content
- All tunables live in `src/data/*.json`, validated at boot against TypeScript-derived schemas (fail fast in dev).
- Recipes declare `steps: [{ station, kind, target, tolerance }]`; the brewing system is generic over steps, so new drinks need no new code.
- Crops declare stage durations, yields, water needs and sprite keys.

## 8. Testability
- **Vitest:** projection round-trips; A* paths (blocked, unreachable, corner cutting); seat reservations under contention; customer FSM transitions with a fake clock; rating formula (S11 calibration: 5★ Latte → 120 coins / 30 EXP); economy invariants (GAME_DESIGN §7.5); save → load equality; migrations.
- **Headless economy sim** (`tools/sim/economy-sim.ts`): simulates N shifts with scripted skill levels and checks pacing targets. Runs in CI as a Vitest test.
- **Playwright:** the game exposes `window.__TCSS__` only when `import.meta.env.MODE !== 'production'`: `getState()`, `getEntities()`, `tileToScreen()`, `setTimeScale()`, `waitForState(pred)`. E2E tests click real canvas coordinates derived from tile positions, then assert on game state. **Gameplay is never asserted from pixels.**
- **Visual checks:** Playwright screenshots of fixed debug camera framings, compared to approved baselines (after art lands). Until then, visual acceptance is a manual side-by-side review against the concept tile (ACCEPTANCE_TESTS §2).

## 9. Performance budgets
| Metric | Target |
|---|---|
| FPS | 60 desktop; ≥ 45 on a mid-range Android (2023) in the café with 12 customers |
| Initial load (to S02) | ≤ 8 MB, ≤ 4 s on a fast 4G connection |
| Texture memory | ≤ 256 MB at High quality; ≤ 128 MB at Low |
| Atlas pages | ≤ 4096²; per-scene atlases loaded/unloaded by the router |

## 10. Technical risk register
| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **No art pipeline:** Blender not installed, no models, no artist assigned | High | Critical: blocks all visual acceptance | Install Blender in M1; build the render script on a single test model; placeholder renders through the same pipeline; decide art sourcing (artist vs. generated-then-modeled) |
| R2 | Low-res concept only | Certain | High: art bible can't lock | Request full-resolution frames (P-01); ⏳ items stay provisional |
| R3 | Phaser 4 is newer than Phaser 3: fewer examples; Phaser 3 plugins (e.g. rexUI) may not be compatible; isometric tilemap support unverified | Medium | Medium | M1 spike: verify iso tilemap, 9-slice, input, render textures in 4.2.1 before building on them; prefer our own small UI widgets over plugins |
| R4 | Isometric depth sorting with multi-tile furniture and moving characters | Medium | Medium | Footprint-based depth rules + a dedicated test map + unit tests |
| R5 | Sprite memory: 8 dirs × ~16 anims × layered outfits | High | High on mobile | Mirror directions; per-scene atlases; quality-scaled atlases (1×/1.5×/2×); budget check in CI |
| R6 | IndexedDB unavailable or evicted (Safari, private mode) | Medium | High (lost progress) | `navigator.storage.persist()` request; detect and warn; JSON export/import |
| R7 | Story scenes need a different camera (behind view) | Certain | Medium | Treat S03/S04 as layered 2.5D scenes with their own render set (ASSET_MANIFEST C-03) |
| R8 | Brewing minigames feel fiddly on touch | Medium | High (core loop) | Prototype S09 interactions with placeholder art early (M2); tolerance bands in data; playtest |
| R9 | Scope: 29 screens + 3 pillars | High | High | Milestones gate on acceptance; Phase 2/3 screens explicitly deferred |
| R10 | Vietnamese text: diacritic rendering, line breaking, text length in buttons | Medium | Low | Web fonts, i18n length tests, pseudo-locale for overflow |
| R11 | Originality / IP (Coffee Break as the inspiration) | Low | High | Original names, layouts and assets; no reference assets in the repo except our own concept sheet; review at each milestone |
| R12 | Concept sheet provenance (looks AI-generated) | Unknown | Medium | Use as direction only; production assets are made fresh; confirm usage rights `[OPEN]` |
