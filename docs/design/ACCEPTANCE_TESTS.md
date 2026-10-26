# Acceptance Tests

> **Project:** TheCoffeeSixSense · **Status:** Draft v0.1 (2026-10-26) · **Branch:** `dev`
> **Related:** [SCREEN_SPECS](SCREEN_SPECS.md) · [MILESTONES_AND_BACKLOG](../production/MILESTONES_AND_BACKLOG.md) · [TECHNICAL_ARCHITECTURE §8](../architecture/TECHNICAL_ARCHITECTURE.md)

---

## 1. Definition of Done

A **screen** is "complete" only when **both** gates pass:

| Gate | Passes when | How it is checked |
|---|---|---|
| **G — Gameplay** | Every `G` test for the screen passes | Vitest (U) and Playwright (E) in CI; manual (M) items signed off in the milestone review |
| **V — Visual** | Every `V` item for the screen passes, using **final** (not placeholder) art | Side-by-side review against the concept tile + ART_BIBLE §10 checklist; Playwright screenshot baseline locked afterwards |

States reported per screen: `not started` → `gameplay-complete (placeholder art)` → `complete`. A screen running on placeholder art is **never** reported as complete.

Test types: **U** = unit (Vitest), **E** = end-to-end (Playwright), **M** = manual review.

## 2. Global visual checks (apply to every screen with final art)
| ID | Check | Type |
|---|---|---|
| VG-1 | Composition and element placement match the concept tile (HUD corners, panel side, button stack) | M |
| VG-2 | Isometric world assets align with the 128×64 grid overlay (debug toggle) | M/E (screenshot with grid) |
| VG-3 | Light from upper-left, shadows lower-right, on every sprite in frame | M |
| VG-4 | Character scale consistent across scenes (reference silhouette overlay) | M |
| VG-5 | Only palette tokens/fonts from ART_BIBLE used in UI; Vietnamese diacritics render correctly | M + E (i18n render test) |
| VG-6 | No Phaser Graphics primitives in production environments (debug layer off); no emoji, browser alerts or default widgets | E (scene scan) + M |
| VG-7 | Every interaction has animation feedback + SFX | M |

## 3. Milestone M1 — Isometric Café Core Slice
| ID | Test | Type |
|---|---|---|
| M1-G1 | `toScreen`/`toTile` round-trip for every tile in a 64×64 grid | U |
| M1-G2 | A* returns the shortest path on fixtures; returns `null` for unreachable targets; never cuts blocked corners; deterministic | U |
| M1-G3 | A* on a 40×40 grid completes in < 2 ms (median of 100 runs) | U |
| M1-G4 | Depth sort: a character walking around a table is drawn in front/behind correctly at 8 probe positions | U + M |
| M1-G5 | Click/tap on a floor tile → the player walks a valid path and stops on that tile; clicking a blocked tile walks to the nearest reachable tile | E |
| M1-G6 | WASD/arrow movement respects collision | E |
| M1-G7 | Clicking the espresso machine → the player paths to its approach tile, faces it, and enters `Interacting`; the FSM log shows `Idle→Walking→Interacting` | E |
| M1-G8 | A customer spawns, walks to the door, reserves a free seat, walks to it, sits, shows an order bubble, waits, and leaves when patience runs out (time scale ×10 in test) | E + U (FSM with fake clock) |
| M1-G9 | 3 customers in a row with 2 free seats: 2 sit, the 3rd queues; no two customers ever reserve the same seat (1,000 randomized runs) | U |
| M1-G10 | Save → reload page → coins, player tile and scene restored exactly from IndexedDB | E |
| M1-G11 | Corrupt save in slot 1 → the game reports it and does not overwrite it | E |
| M1-G12 | 60 fps sustained on desktop Chromium with 6 customers (dev perf overlay) | M |
| M1-G13 | No production code path uses `alert`/`confirm`/`prompt` | U (lint rule) |
| M1-V | **Visual gate not expected in M1.** M1 runs on pipeline-produced placeholders. The pass condition is "placeholders come from the atlas pipeline, carry `PH` marks, and sizes/pivots match ART_BIBLE §3" | M |

## 4. Milestone M2 — Brew, Serve, Rate (S07–S11)
| ID | Test | Type |
|---|---|---|
| M2-G1 | Rating formula: given step errors/bean/wait/ambience inputs, it yields the expected score and stars (table-driven, ≥ 20 cases) | U |
| M2-G2 | Calibration: perfect Latte, 5★ → **+120 coins, +30 EXP** (matches concept S11) | U |
| M2-G3 | Wrong drink served → 1★, 0 coins, customer leaves annoyed | U + E |
| M2-G4 | Each brewing step reads real input: a scripted "perfect" input sequence yields 5★, a scripted "sloppy" one yields ≤ 2★, through the real input handlers | E |
| M2-G5 | Serving consumes exactly the recipe ingredients from the shared inventory; brewing is blocked with an in-world hint when ingredients are missing | U + E |
| M2-G6 | Order rail shows ≤ 3 orders; carry limit 2 enforced | E |
| M2-G7 | Economy invariants (GAME_DESIGN §7.5) pass in the headless sim | U |
| M2-G8 | Shift FSM runs Open→Summary; the summary totals equal the sum of individual payouts | U + E |
| S08–S11-V | Order bubble, brewing close-up, serve reaction, rating popup match concept tiles S08–S11 (VG-1…7) | M |

## 5. Milestone M3 — Farm loop + shared economy (S16, S18–S22)
| ID | Test | Type |
|---|---|---|
| M3-G1 | Plot FSM: Wild→Prepared (hoe)→Growing→Ripe; each growth stage shows a different sprite key | U + E |
| M3-G2 | Unwatered plot grows at 50% speed and loses care; watered soil sprite differs from dry | U + E |
| M3-G3 | Harvest yield/grade follow `crops.json` and the care score (seeded RNG, table tests) | U |
| M3-G4 | Drying 2 cherries → 1 green bean; roasting yields the chosen roast level; raking raises quality | U |
| M3-G5 | Selling (S22) the stepper quantity credits exactly qty × price; cannot sell more than owned | U + E |
| M3-G6 | **Shared economy E2E:** harvest on the farm → travel to the café → the beans appear in S16 → brew with them → coins earned are visible back on the farm HUD | E |
| M3-G7 | Crops keep growing while the player is in the café; offline growth is applied on load, capped at 2 h, never past Ripe | U + E |
| M3-G8 | Save/load round-trip preserves plots, processors and inventory exactly | E |
| S18–S22-V | Farm scene, planting panel, harvest, processing and sell panel match concept tiles | M |

## 6. Milestone M4 — Rebirth story (S03–S06)
| ID | Test | Type |
|---|---|---|
| M4-G1 | S03 is controllable (joystick + keyboard); reaching the goal before the timer ends triggers the transition; letting the timer expire restarts from the checkpoint | E |
| M4-G2 | S03 has no auto-progression: with no input for 60 s the scene does not advance | E |
| M4-G3 | S04: the portal stays closed until all 3 Sense Stones are activated by the player; walking into the open portal transitions | E |
| M4-G4 | S05: the tutorial requires the real brewing steps; the master's rating comes from the M2 rating system | E |
| M4-G5 | S06: name supports Vietnamese diacritics, 1–16 characters; the appearance persists into S07 and across reload | E |
| M4-G6 | Reloading mid-story resumes at the chapter checkpoint | E |
| S03–S06-V | Rain/night, portal glow, workshop warmth and creation panel match concept tiles | M |

## 7. Milestones M5–M8 (summary; detailed tests written when the milestone starts)
| Milestone | Screens | Key gameplay tests |
|---|---|---|
| M5 Upgrades & decor | S12, S13 | Purchase deducts coins once; placement validity (overlap, blocking the door path is rejected); nav grid + seats rebuild after placement; comfort score updates rating ambience |
| M6 Shell | S01, S02, S27, S28, S29 | Real load progress; Continue disabled with no save; settings persist outside slots; pause freezes the shift sim; 3 slots load/delete |
| M7 Meta panels | S14–S17 | Recipe unlock gating; skill effects measurably widen bands; staff automation quality ceiling |
| M8 World | S23–S26 | Region locks by level; quests/achievements count from EventBus events; branch revenue (Phase 3) |

## 8. Regression rule
Every bug fixed after M1 gets a failing test first (U or E), then the fix.
