# Milestones & Prioritized Backlog

> **Project:** TheCoffeeSixSense · **Status:** Draft v0.1 (2026-10-26) · **Branch:** `dev`
> **Related:** [ACCEPTANCE_TESTS](../design/ACCEPTANCE_TESTS.md) · [ASSET_MANIFEST](../design/ASSET_MANIFEST.md) · [TECHNICAL_ARCHITECTURE](../architecture/TECHNICAL_ARCHITECTURE.md)

---

## 1. Milestone roadmap

Order principle: build first the shared technology every pillar stands on, then the core café loop, then the farm feeding it, then the story that reuses both. The shell (menus) comes late because it proves nothing risky.

| # | Milestone | Screens | Depends on | Exit gate |
|---|---|---|---|---|
| **M0** | Foundation docs + repo (**this task**) | — | — | Docs reviewed by owner |
| **M1** | **Isometric Café Core Slice** | S07 (partial) | M0 | ACCEPTANCE M1-G1…G13 |
| M2 | Brew, Serve, Rate | S07–S11 | M1 | M2-G*, S08–S11 gameplay-complete |
| M3 | Farm loop + shared economy | S16, S18–S22, S23 (farm↔café travel only) | M2 | M3-G* incl. the shared-economy E2E |
| M4 | Rebirth story | S03–S06 | M2 (brewing for S05) | M4-G* |
| M5 | Upgrades & decoration | S12, S13 | M2 | M5 tests |
| M6 | Shell & saves UI | S01, S02, S27–S29 | M1 | M6 tests |
| M7 | Meta panels | S14–S17 | M2, M3 | M7 tests |
| M8 | World & long-term | S23–S26 | M3 | M8 tests |
| **Art track** (parallel) | A1 lock art bible (needs P-01) → A2 Blender rig + render script → A3 café kit + player → A4 customers → A5 farm kit → A6 story scenes → A7 UI kit | all | P-01, Blender | VG-1…7 per screen |

Visual completion of any screen depends on the art track. Gameplay milestones can finish as "gameplay-complete (placeholder art)".

## 2. First implementation milestone — M1: Isometric Café Core Slice

**Goal:** prove the risky shared technology in one small, playable room: isometric rendering + depth, A* navigation, FSM-driven player and customers, station interaction, and IndexedDB persistence. Everything later builds on these.

**In scope**
1. Project scaffold: Vite + TypeScript (strict) + Phaser `~4.2.1`, ESLint/Prettier, Vitest, Playwright (Chromium), `npm run dev | build | test | e2e`.
2. Phaser 4 spike (R3): confirm isometric tilemap loading from Tiled, 9-slice, pointer/keyboard input, and depth sorting in 4.2.1. Write the findings into TECHNICAL_ARCHITECTURE §4.
3. `world/iso` (projection, depth) and `world/nav` (NavGrid, A*, SeatRegistry), with unit tests.
4. `fsm/StateMachine` with a transition log.
5. One café room (≈ 12×10 tiles) from a Tiled map: floor, walls, door, a counter, an espresso machine, 3 two-seat tables.
6. Player: tap/click-to-move + WASD; FSM `Idle/Walking/Interacting`; clicking the machine walks to its approach tile and enters `Interacting` (stub: a 1 s work animation).
7. Customers (1 archetype): spawn → door → reserve seat / queue → sit → order bubble (Espresso icon) → wait → leave on patience 0. Up to 6 concurrent.
8. `GameState` + `SaveService` (IndexedDB, slot 1): coins, player tile, scene. Autosave every 60 s and on `visibilitychange`; corrupt-save handling.
9. Placeholder art produced **through the atlas pipeline** (`tools/atlas/pack.mjs` + placeholder generator), with `PH` marks, correct sizes and pivots. If Blender is installed by then, also render the first real test model (one table) to prove the Blender → atlas path.
10. Dev test bridge `window.__TCSS__` + Playwright tests M1-G5…G11.
11. `locales/vi.json` + `t()` helper; no hard-coded UI strings.

**Out of scope for M1:** brewing minigames, rating, money earned, farm, story, menus, final art.

**Exit:** all M1 acceptance tests pass in CI; a 2-minute recorded play session showing the slice; risk notes R3/R4 updated. M1 is reported as "tech slice complete", not as any screen complete.

**Owner prerequisites before/during M1:** install Blender (LTS) for item 9; provide full-resolution concept frames (P-01) for the art track.

## 3. Prioritized backlog

P0 = needed for M1 · P1 = M2–M3 (core loops) · P2 = M4–M6 · P3 = M7+ / Phase 2–3.

| ID | Pri | Item | Milestone | Acceptance |
|---|---|---|---|---|
| B-001 | P0 | Scaffold Vite + TS + Phaser 4.2.1 + lint + Vitest + Playwright; choose and pin exact versions of every tool (lockfile committed) | M1 | builds, empty test passes in CI |
| B-002 | P0 | Phaser 4 capability spike (iso tilemap, 9-slice, input, depth) | M1 | findings documented |
| B-003 | P0 | Iso projection + depth module | M1 | M1-G1, G4 |
| B-004 | P0 | NavGrid + A* + SeatRegistry | M1 | M1-G2, G3, G9 |
| B-005 | P0 | Generic FSM + transition log | M1 | unit tests |
| B-006 | P0 | Atlas pipeline + placeholder generator | M1 | M1-V |
| B-007 | P0 | Café test room (Tiled) + loader | M1 | renders, nav grid built |
| B-008 | P0 | Player controller (click/tap + WASD) + FSM + station approach | M1 | M1-G5…G7 |
| B-009 | P0 | Customer FSM + spawner (1 archetype) + order bubble | M1 | M1-G8 |
| B-010 | P0 | GameState, SaveService (IndexedDB), autosave, corrupt handling | M1 | M1-G10, G11 |
| B-011 | P0 | Test bridge + Playwright harness | M1 | E2E tests run in CI |
| B-012 | P0 | i18n `t()` + `vi.json` | M1 | no raw strings (lint) |
| B-013 | P0 | **Art:** install Blender, iso camera/light rig, render script on one test model | M1 / Art A2 | renders align with the grid |
| B-020 | P1 | Data schemas + `items/recipes.json` + boot validation | M2 | invalid data fails fast |
| B-021 | P1 | Inventory + Economy services + EventBus events | M2 | unit tests |
| B-022 | P1 | Brewing step framework (generic over recipe steps) | M2 | M2-G4 |
| B-023 | P1 | Station minigames: grind, tamp, extract, steam, assemble | M2 | M2-G4, playtest |
| B-024 | P1 | Carry/serve + order rail | M2 | M2-G6 |
| B-025 | P1 | Rating system + reward popups | M2 | M2-G1…G3 |
| B-026 | P1 | Shift FSM + summary | M2 | M2-G8 |
| B-027 | P1 | HUD overlay (portrait, coins, quest tracker stub) | M2 | E2E |
| B-028 | P1 | Headless economy sim in CI | M2 | M2-G7 |
| B-030 | P1 | Farm scene + plot FSM + tools (hoe, seed, water, harvest) | M3 | M3-G1…G3 |
| B-031 | P1 | WorldClock + offline growth | M3 | M3-G7 |
| B-032 | P1 | Processing: drying beds, roaster | M3 | M3-G4 |
| B-033 | P1 | Inventory panel S16 + Sell panel S22 + Planting panel S19 | M3 | M3-G5 |
| B-034 | P1 | SceneRouter + farm↔café travel (minimal S23) | M3 | M3-G6, G8 |
| B-035 | P1 | **Art:** café kit, player base, 1 customer, stations (A3/A4) | Art | VG on S07–S11 |
| B-040 | P2 | Virtual joystick + story player states | M4 | M4-G1 |
| B-041 | P2 | S03 Incident level | M4 | M4-G1, G2 |
| B-042 | P2 | S04 Portal level | M4 | M4-G3 |
| B-043 | P2 | Dialog system + S05 tutorial | M4 | M4-G4 |
| B-044 | P2 | Modular character + S06 | M4 | M4-G5 |
| B-045 | P2 | Furniture shop S12 + decorate mode S13 | M5 | M5 tests |
| B-046 | P2 | Splash/menu/settings/pause/save slots | M6 | M6 tests |
| B-047 | P2 | **Art:** farm kit, story scenes, UI kit (A5–A7) | Art | VG |
| B-050 | P3 | Recipes S15, Skills S17 | M7 | M7 tests |
| B-051 | P3 | Staff S14 | M7 | M7 tests |
| B-052 | P3 | Quests S25, Achievements S26 | M8 | M8 tests |
| B-053 | P3 | World map regions S23, Branches S24 | M8 | M8 tests |
| B-054 | P3 | Save export/import, storage persistence request | M6+ | R6 |
