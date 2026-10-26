# Art Bible

> **Project:** TheCoffeeSixSense · **Status:** Draft v0.1 (2026-10-26) · **Branch:** `dev`
> **Visual source of truth:** [reference/concept-sheet-29-screens.jpg](reference/concept-sheet-29-screens.jpg)
> **Lock level:** items marked 🔒 are locked from the concept sheet. Items marked ⏳ are **provisional**: the reference is too small (≈ 250 px tiles) to measure them, and they lock once full-resolution frames arrive.

---

## 1. Target look 🔒
- **Cozy, warm, storybook 3D-rendered look:** soft global illumination, rounded forms, rich wood and brass textures, lush plants. Read as "premium mobile cozy sim," not flat vector, not pixel art.
- **Characters:** chibi proportions (head ≈ 1/3 of body height; large expressive eyes; simple hands). Fully 3D-rendered look with soft shading.
- **Environments:** detailed and densely dressed (shelves, jars, plants, lamps, crates). European hillside town meets Vietnamese coffee culture `[PROPOSAL: the Vietnamese touch comes through props, drinks and the farm: phin filters, Robusta, condensed milk]`.
- **Story chapters** use a contrasting palette: S03 cold rainy night blues with hot headlight highlights; S04 deep teal forest with a cyan magical glow; S05 returns to warm amber.

## 2. Camera & projection 🔒
- **Gameplay world:** isometric **2:1 dimetric** (tile diamond **128 × 64 px** at 1× scale). Blender camera: orthographic, rotation X = 60°, Y = 0°, Z = 45°.
- **Close-up moments** (S08 order, S09 brewing, S10/S11 reactions, S05 dialog): rendered as **framed close-up layers** (illustrated scenes at a 3/4 perspective) shown as overlays, *not* by rotating the world camera.
- **Story chapters S03/S04:** third-person behind-the-character composition in the concept. ⏳ Implementation decision: render these as **2.5D side-on/behind-view layered scenes** with parallax depth, using the same character atlas rendered from additional camera angles (back, back-3/4). This needs extra character renders (see ASSET_MANIFEST).

## 3. Scale 🔒/⏳
| Thing | Size at 1× |
|---|---|
| Floor tile | 128 × 64 px |
| Chibi character (standing) | ≈ 1.5 tiles tall → ~140–160 px tall ⏳ |
| Table (2-seat) | 1×1 tile footprint |
| Counter segment | 1×1 tile |
| Coffee bush (ripe) | ≈ 1 tile wide, ~110 px tall ⏳ |
| UI base resolution | 1920 × 1080 |

Assets render at **2×** and are downscaled at runtime by quality setting (High 2×, Medium 1.5×, Low 1×).

## 4. Lighting 🔒
- **Key light from upper-left** (sun / window), warm (≈ 3800–4500 K). Fill light cool and soft from the right. Warm practical lights (lamps) in the café.
- **Shadows:** soft contact shadows baked into each sprite's own render pass, cast **toward lower-right**. Characters use a separate soft ellipse shadow sprite so it stays correct while they move.
- Night/story scenes: motivated lights only (headlights, street lamps, portal glow); same light *direction* rule for the base key light.

## 5. Color palette ⏳
Hex values below were estimated by eye from the concept sheet, not measured. Re-sample them from full-resolution frames.

| Token | Use | Approx. hex |
|---|---|---|
| `espresso-900` | panel title bars, dark text | `#3B2416` |
| `coffee-700` | frames, secondary text | `#6B4226` |
| `caramel-500` | primary buttons | `#D19A55` |
| `cream-100` | panel body | `#F6E8CC` |
| `latte-200` | panel insets, slots | `#EAD3AA` |
| `gold-400` | coins, stars | `#F2C14E` |
| `leaf-500` | progress bars, confirm | `#6DB55A` |
| `cherry-500` | cancel, danger, coffee cherries | `#C8463D` |
| `night-800` | S03 base | `#14213D` |
| `portal-300` | S04 glow | `#5AD8FF` |

## 6. Typography ⏳
The concept uses a bold rounded display face for titles and a clean rounded sans for body text. Exact fonts cannot be identified at this resolution. **Hard requirement: full Vietnamese diacritic support** (e.g. ặ, ữ, ở).

| Role | Proposal (all OFL, all support Vietnamese) |
|---|---|
| Display / titles / buttons | *Baloo 2* ExtraBold |
| Body / UI text | *Nunito* SemiBold |
| Numbers (coins, timers) | *Nunito* ExtraBold, tabular figures |

Text is rendered as web fonts preloaded before S01 completes, not bitmap fonts (diacritics would explode the glyph set).

## 7. UI kit 🔒 (structure) / ⏳ (texture detail)
- **Panels:** cream parchment body, dark espresso title bar with a cream title, thin wood/brown frame, soft drop shadow. 9-slice textures.
- **Buttons:** caramel pill/rounded-rectangle with a lighter top bevel and darker bottom edge. States: normal, hover, pressed (shift down 2 px), disabled (desaturated). Destructive buttons in `cherry-500` (S28 "Về màn chính").
- **Tabs:** dark-brown inactive, cream active, attached to the top of the panel (S15, S16, S17, S25).
- **Item slots:** rounded latte squares with an item icon and a count at the bottom-right (S16).
- **Progress bars:** dark inset track, `leaf-500` fill, rounded ends (S09, S21, S25, S26).
- **Popups in world:** white speech bubbles with a tail (S08, S10, S11); stars in gold; reward chips (`+120` coin, `+30 EXP` star) float up and fade.
- **HUD:** circular portrait with a level badge (top-left); pill-shaped resource counters with an icon and a "+" button (top-right); round action buttons with captions (bottom-right).
- **Mobile controls (S03/S04):** translucent virtual joystick bottom-left; a large round action button bottom-right with a context icon.
- **Banned:** flat untextured rectangles as panels, browser default widgets, system alerts, emoji icons.

## 8. Animation conventions
| Item | Rule |
|---|---|
| Directions | 8 directions rendered (N, NE, E, SE, S, SW, W, NW). ⏳ Option to render 5 and mirror 3 if the art is symmetric; asymmetric items (apron pocket) break mirroring |
| Frame rate | Characters 24 fps rendered, played at 12–24 fps; idle loops 2–3 s |
| Required character sets | idle, walk, run (story), carry-idle, carry-walk, interact-reach, brew-work, serve, sit, sit-drink, react-happy, react-neutral, react-unhappy, harvest, water, hoe |
| Story-only | run (back view), vault, crouch-pick-up (kitten), touch-stone |
| UI motion | 150–250 ms ease-out; buttons scale 0.95 on press; panels slide 20 px + fade |
| World feedback | every interaction has a sprite reaction (steam puff, splash, sparkle) and a sound |

## 9. Production pipeline (summary; details in ASSET_MANIFEST and TECHNICAL_ARCHITECTURE)
1. Model in **Blender** (shared scene with locked camera rig, light rig and render settings).
2. Render with transparent background, per direction and per frame, plus a separate shadow pass where needed.
3. Pack into atlases (≤ 4096² per page, power-of-two), export Phaser JSON hash.
4. Naming: `{category}_{name}_{action}_{dir}_{frame:02}` e.g. `char_player_walk_se_07`.
5. **Placeholders** use the same names, sizes, pivots and atlas pipeline, carry a visible `PH` corner mark, and are listed in ASSET_MANIFEST with status `placeholder`. Environments are never drawn with Phaser Graphics primitives, not even as placeholders. Graphics primitives are only allowed for debug overlays (nav grid, hitboxes) behind a debug flag.

## 10. Consistency checklist (run on every new asset)
- [ ] Rendered with the shared camera rig (projection matches the tile grid overlay)
- [ ] Key light upper-left; shadow falls lower-right
- [ ] Scale checked against the reference character silhouette
- [ ] Palette within the tokens (no oversaturated outliers)
- [ ] Pivot at the footprint center (world) or as specified (UI)
- [ ] Name follows the convention; entry added to ASSET_MANIFEST
