# Asset Manifest & Production Checklist

> **Project:** TheCoffeeSixSense · **Status:** Draft v0.1 (2026-10-26) · **Branch:** `dev`
> **Rules:** [ART_BIBLE](ART_BIBLE.md) §9–10 · **Status values:** `missing` → `placeholder` → `wip` → `review` → `final`
> **Milestone column** = the first milestone that needs the asset (see [MILESTONES_AND_BACKLOG](../production/MILESTONES_AND_BACKLOG.md)).

**Current state (2026-10-26): every production asset is `missing`.** The only art in the project is the concept sheet, which is reference art and is not used in the game. No 3D models, rigs, renders, UI textures, fonts, music or SFX exist yet.

---

## 0. Pipeline prerequisites
| ID | Item | Status | Milestone | Notes |
|---|---|---|---|---|
| P-01 | Full-resolution frames for all 29 concept screens | missing | M0 | Needed to lock ART_BIBLE ⏳ items |
| P-02 | Blender install + shared `rig_iso_camera.blend` (camera, lights, render settings) | missing | M1 | Blender is **not installed** on the dev machine |
| P-03 | Render-to-atlas script (Blender Python: per direction/frame render → packer → Phaser JSON) | missing | M1 | |
| P-04 | Atlas packer choice (free-tex-packer-core in Node, or TexturePacker CLI) | missing | M1 | Prefer a Node packer so CI can run it |
| P-05 | Placeholder generator (renders labeled `PH` sprites at the final sizes/pivots) | missing | M1 | |
| P-06 | Font licenses (Baloo 2, Nunito; OFL) | missing | M1 | |

## 1. Characters
| ID | Asset | Animations / views | Status | Milestone |
|---|---|---|---|---|
| C-01 | Player base body (chibi), rigged | all sets in ART_BIBLE §8, 8 dirs | missing | M1 (idle/walk), M2 (carry, brew, serve) |
| C-02 | Player modular parts: hair × 6–9 styles × colors, outfits × 4+ | layered paper-doll, same rig | missing | M4 (S06) |
| C-03 | Player story views (back, back-3/4) | run, vault, pick-up, touch | missing | M4 |
| C-04 | Customer archetypes × 5 (student, office worker, tourist, elder, critic) + 2 color variants each | walk, idle, sit, sit-drink, 3 reactions | missing | M1 (1 archetype walk/sit), M2 (reactions) |
| C-05 | Coffee master (old man, white beard, apron) | idle, talk, gesture, taste, react | missing | M4 |
| C-06 | Staff NPC "Anna" + 2 more | idle, walk, brew, serve | missing | M7 |
| C-07 | Café cat (kitten from S03) | idle, walk, sleep | missing | M5 |
| C-08 | Character portraits (HUD, dialog, staff list) | 3 expressions each | missing | M2 |

## 2. Environments (isometric tile kits, rendered)
| ID | Asset | Status | Milestone |
|---|---|---|---|
| E-01 | Café floor tiles (wood ×3 variants), wall segments (L/R, window, door) | missing | M1 |
| E-02 | Café exterior street edge + entrance | missing | M1 |
| E-03 | Farm terrain: grass, wild soil, prepared soil, wet soil, cracked dry soil, path | missing | M3 |
| E-04 | Farm surroundings: trees, fence, shed, drying-bed area | missing | M3 |
| E-05 | S03 rainy street layered scene (road, sidewalk, buildings, bus, cars, barriers) | missing | M4 |
| E-06 | S04 forest ruins (pillars, stones, portal ring, 3 Sense Stones) | missing | M4 |
| E-07 | S05 master's workshop interior | missing | M4 |
| E-08 | S01 splash painting (hillside town) + S02 storefront background | missing | M6 |
| E-09 | S23 world map painting + region labels + locks | missing | M8 |
| E-10 | S24 town map + branch building thumbnails | missing | M8 |

## 3. Props, stations & furniture (rendered, 4 rotations where placeable)
| ID | Asset | Status | Milestone |
|---|---|---|---|
| F-01 | Stations: grinder, tamp station, espresso machine, steam wand, cup/assembly bar, ice/syrup bar, pickup counter | missing | M1 (machine + counter), M2 (rest) |
| F-02 | Station close-ups for S09 (machine, grinder, steam pitcher, cup) with interactive parts as separate sprites (portafilter, lever, needle, milk jug) | missing | M2 |
| F-03 | Wooden table + 2 chairs ("Bàn ghế gỗ"), 4 rotations | missing | M1 |
| F-04 | Furniture catalog v1: 4 tables, 4 chairs, 6 plants, 4 lamps, 4 wall decor, 2 rugs, shelves | missing | M5 |
| F-05 | Station upgrade variants (Lv.2/Lv.3 visuals) | missing | M5 |
| F-06 | Farm tools in hand + world: hoe, watering can, basket, rake | missing | M3 |
| F-07 | Drying bed (empty/loaded/raked/done), roaster (idle/roasting), sacks | missing | M3 |

## 4. Crops (per variety: Robusta, Arabica, Culi)
| ID | Asset | Status | Milestone |
|---|---|---|---|
| CR-01 | Growth stages ×5 (seedling, sapling, flowering, green, ripe) + overripe + harvested/resting | missing | M3 (Robusta + Arabica), M5 (Culi) |
| CR-02 | Wet/dry soil overlay per stage | missing | M3 |
| CR-03 | Harvest close-up (S20) bush with pickable cherry sprites | missing | M3 |

## 5. Items & icons (UI, 128 × 128 at 2×)
| ID | Asset | Status | Milestone |
|---|---|---|---|
| I-01 | Seeds ×3, cherries ×3, green beans ×3, roasted beans ×3 (+ roast levels light/med/dark) | missing | M2 (roasted Robusta), M3 (rest) |
| I-02 | Ingredients: fresh milk, condensed milk, sugar, ice, water, cocoa, cinnamon, vanilla, cream | missing | M2 |
| I-03 | Drinks ×8 (S15 grid), plus in-world held/served versions | missing | M2 (Espresso, Cà phê sữa đá, Latte) |
| I-04 | Currency & stat icons: coin, EXP star, reputation, level badge | missing | M1 (coin), M2 |
| I-05 | Skill node icons, quest icons, achievement medals | missing | M7–M8 |

## 6. UI kit (9-slice textures, rendered or painted)
| ID | Asset | Status | Milestone |
|---|---|---|---|
| U-01 | Panel frame + title bar, button (4 states, primary/secondary/danger), tab (2 states) | missing | M1 (button), M2 (panel) |
| U-02 | Item slot, progress bar (track/fill), slider, toggle, stepper (S22) | missing | M2–M3 |
| U-03 | HUD: portrait ring, resource pill, round action button, quest panel | missing | M2 |
| U-04 | Speech bubbles (order, reaction, review), stars, reward chips | missing | M1 (order bubble), M2 |
| U-05 | Virtual joystick base/knob, context action button + icons | missing | M1 (mobile input), M4 |
| U-06 | Logo "The Coffee SixSense" (vector source) | missing | M6 |
| U-07 | Cursor/hand pointer hints (S09) | missing | M2 |

## 7. VFX (sprite sheets / particles)
| ID | Asset | Status | Milestone |
|---|---|---|---|
| V-01 | Steam puff, coffee pour stream, milk froth | missing | M2 |
| V-02 | Coin burst, sparkle, star pop | missing | M2 |
| V-03 | Water splash (farm), soil dust (hoe), leaf rustle | missing | M3 |
| V-04 | Rain, puddle splash, headlight sweep, white-out | missing | M4 |
| V-05 | Portal swirl, Sense Stone activation | missing | M4 |

## 8. Audio
| ID | Asset | Status | Milestone |
|---|---|---|---|
| A-01 | Music: menu, café day, farm, story night (S03), portal (S04), master (S05) | missing | M2 (café), M4, M6 |
| A-02 | SFX: footsteps (wood/grass), grinder, tamp, espresso pump, steam, pour, cup clink, door bell, coin, UI click/hover | missing | M2 |
| A-03 | SFX: hoe, water, harvest pick, rake, roast crack | missing | M3 |
| A-04 | SFX: rain, traffic, bus horn, portal hum | missing | M4 |

## 9. Data (authored, not art, but tracked here)
| ID | File | Status | Milestone |
|---|---|---|---|
| D-01 | `items.json`, `recipes.json` | missing | M2 |
| D-02 | `crops.json`, `processing.json` | missing | M3 |
| D-03 | `customers.json`, `spawn_curves.json` | missing | M1 (1 archetype), M2 |
| D-04 | `furniture.json`, `upgrades.json` | missing | M5 |
| D-05 | `locales/vi.json` (all UI strings) | missing | M1 |
| D-06 | Tiled maps (`cafe_01.tmj`, `farm_01.tmj`) | missing | M1, M3 |

## 10. Missing-asset risk summary
1. **No 3D art exists and Blender is not installed.** Art is the critical path for every "visual acceptance" criterion. Without an artist (or a decided art-generation approach), only gameplay acceptance can pass.
2. **Character modularity (C-02) is costly:** 8 directions × ~16 animations × hair/outfit layers. Mitigation: render 5 directions and mirror 3, and keep outfit variants as texture swaps on one mesh.
3. **Story scenes (E-05/E-06) need non-isometric views** of the player (C-03), which adds a second render set.
4. **Resolution of the concept** blocks final palette/typography/UI texture lock (P-01).
