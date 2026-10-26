# Asset Replacement Guide

> **Status:** v1.0 · 2026-10-26 · How placeholder visuals get swapped for production art **without touching gameplay code**.
> Art direction: [design/ART_BIBLE.md](design/ART_BIBLE.md) · Asset list: [design/ASSET_MANIFEST.md](design/ASSET_MANIFEST.md)

## 1. The boundary
Gameplay never imports Phaser game objects, textures or colours. The only contract between gameplay and visuals is:

| Contract | File | Used by |
|---|---|---|
| `WorldRenderer`, `ActorView`, `ObjectViewData`, `ActorViewState` | `src/components/render/WorldRenderer.ts` | World scenes |
| `FeedbackSink` | `src/ui/FeedbackPresenter.ts` | Feedback presenter |
| `SimulationSnapshot` | `src/gameplay/GameSimulation.ts` | Renderers, HUD, debug UI |
| `GameEvents` | `src/core/events.ts` | HUD, SFX, VFX |

Positions in these contracts are **world tile units**. Converting them to pixels (`utils/iso.ts`) is the renderer's job.

## 2. Swapping the world renderer
1. Create `src/components/render/AtlasRenderer.ts` implementing `WorldRenderer`.
2. Map `ObjectViewData.type` + `rotation` to atlas frame keys (e.g. `obj_table_2_r0`). Keep this mapping in a visual data file such as `src/data/visual/objectSprites.json`, never in `objectTypes.json`.
3. Map `ActorViewState.state` + `facing` to animations (e.g. `char_player_walk_se`). `heldItem` maps to a held-item sprite; `progress` drives the HUD work bar.
4. Use `footprintDepth()` / `actorDepth()` from `utils/iso.ts` for sorting, so sorting stays identical to what the gameplay tests assume.
4b. Implement `objectAtPoint` against the **sprite's visible bounds** (alpha mask or trimmed polygon), front-most by depth, and `objectClickPoint` as the sprite's visual centre. E2E tests click there, so a wrong implementation fails tests instead of silently sending the player behind objects.
5. In the scene, replace `new PlaceholderRenderer(this)` with the new renderer. Nothing else changes.

**Sprite pivot rule:** an object's anchor is the screen position of its footprint's **bottom corner** (`worldToScreen({x: f.x + f.w, y: f.y + f.h})`). An actor's anchor is its feet (`worldToScreen(pos)`).

## 3. Swapping UI
- `DebugPanel` and `FeedbackPresenter` read snapshots and events only. A production HUD subscribes to the same events and snapshots.
- All strings come from `t(key)` and `data/locales/*.json`.
- `FeedbackPresenter` can be kept as is with a styled `FeedbackSink` (speech bubbles, toasts).

## 4. What must NOT change during an art pass
- `src/data/config/*.json` gameplay values (footprints, blocking, radius, sides). If art needs a different footprint, that is a **gameplay change** and needs tests.
- The tile size (128×64) unless `utils/iso.ts` and its tests change together.
- Anything under `core/`, `systems/`, `gameplay/`, `entities/`.

## 5. Checklist per replaced asset
- [ ] Footprint in art matches `objectTypes.json` (grid overlay check)
- [ ] Pivot follows §2
- [ ] Depth uses the shared helpers
- [ ] All E2E tests still pass (they assert on state, so they must stay green without edits)
- [ ] ASSET_MANIFEST status updated

## 6. Placeholder inventory (M1)
| Visual | Placeholder | Defined in |
|---|---|---|
| Floor, walls | Shaded diamonds / extruded boxes; front walls cut away | `PlaceholderRenderer.buildWorld`, `TERRAIN_COLORS` |
| Objects | Extruded labelled boxes per type | `PLACEHOLDER_STYLES` |
| Player | Blue circle + facing dot + shadow + state label | `PlaceholderActorView` |
| Held item | Cream box with item id | `PlaceholderActorView` |
| Work progress | Green bar | `PlaceholderActorView` |
| Path, hover, highlight | Lines/outlines | `PlaceholderRenderer` |
| Feedback | Coloured floating text | `PlaceholderRenderer.showFeedback` |
| Debug HUD | Monospace text panel (separate overlay scene, unzoomed camera) | `DebugPanel`, `DebugOverlayScene` |
