# Screen Specifications & Visual Reference Registry

> **Project:** TheCoffeeSixSense · **Status:** Draft v0.1 (2026-10-26) · **Branch:** `dev`
> **Visual source of truth:** [reference/concept-sheet-29-screens.jpg](reference/concept-sheet-29-screens.jpg)
> **Tags:** `[CONCEPT]` = visible in the concept tile · `[PROPOSAL]` = design proposal, not shown in concept · `[OPEN]` = needs a decision · `(?)` = label partly illegible at reference resolution

---

## 1. Reference availability

| Item | Status |
|---|---|
| Concept sheet (all 29 screens, one composite, 1536×1024 px) | **Available**, stored in repo |
| Individual full-resolution frame per screen | **MISSING** for all 29 screens |
| Turnarounds / model sheets for characters | **MISSING** |
| UI kit source (PSD/Figma), fonts, color values | **MISSING** |
| Animation reference (timing, poses) | **MISSING** |

**Consequence:** each tile is roughly 200–400 × 180–220 px. That is enough to lock *layout, composition, mood, palette family and screen purpose*. It is **not** enough to lock exact typography, icon detail, UI texture detail, small text or exact hex colors. Those items are marked `[OPEN]` until full-resolution frames are supplied. Nothing below invents detail that the tile does not show; anything beyond the tile is tagged `[PROPOSAL]`.

## 2. Registry

Tile boxes are approximate pixel ranges on the concept sheet (x0–x1, y0–y1), for cropping later.

| ID | Vietnamese label (verbatim) | English | Type | Tile box (approx.) | Pillar | Hi-res |
|---|---|---|---|---|---|---|
| S01 | Màn khởi động (Splash) | Splash / loading | Menu | 0–333, 0–225 | Shell | Missing |
| S02 | Màn chính (Main Menu) | Main menu | Menu | 340–617, 0–225 | Shell | Missing |
| S03 | Màn 1 - Biến cố (Gameplay) | Ch.1 The Incident | Story gameplay | 625–862, 0–225 | Story | Missing |
| S04 | Màn 2 - Cánh cổng (Gameplay) | Ch.2 The Portal | Story gameplay | 870–1115, 0–225 | Story | Missing |
| S05 | Màn 3 - Gặp bậc thầy (Gameplay) | Ch.3 Meet the Master | Story gameplay + tutorial | 1122–1335, 0–225 | Story | Missing |
| S06 | Tạo nhân vật (Gameplay) | Character creation | Menu-in-world | 1340–1536, 0–225 | Story | Missing |
| S07 | Quán cà phê đầu tiên (Gameplay chính) | First café (main gameplay) | Core gameplay | 0–410, 232–442 | Café | Missing |
| S08 | Khách order (Gameplay) | Customer orders | Core gameplay | 418–618, 232–442 | Café | Missing |
| S09 | Pha cà phê (Gameplay) | Brewing | Core gameplay | 625–818, 232–442 | Café | Missing |
| S10 | Hoàn thành & phục vụ (Gameplay) | Complete & serve | Core gameplay | 825–1053, 232–442 | Café | Missing |
| S11 | Đánh giá khách (Gameplay) | Customer rating | Core gameplay | 1060–1296, 232–442 | Café | Missing |
| S12 | Nâng cấp quán (Gameplay) | Shop upgrades / furniture shop | Panel over world | 1303–1536, 232–442 | Café | Missing |
| S13 | Trang trí quán (Gameplay) | Decorate (placement mode) | Mode over world | 0–310, 450–655 | Café | Missing |
| S14 | Nhân viên (Gameplay) | Staff | Full panel | 318–592, 450–655 | Café meta | Missing |
| S15 | Công thức (Gameplay) | Recipes | Full panel | 600–940, 450–655 | Café meta | Missing |
| S16 | Túi đồ (Gameplay) | Inventory | Full panel | 948–1220, 450–655 | Shared | Missing |
| S17 | Kỹ năng (Gameplay) | Skills | Full panel | 1228–1536, 450–655 | Meta | Missing |
| S18 | Nông trại cà phê (Gameplay) | Coffee farm | Core gameplay | 0–328, 660–838 | Farm | Missing |
| S19 | Trồng cây (Gameplay) | Planting | Panel over world | 336–570, 660–838 | Farm | Missing |
| S20 | Thu hoạch (Gameplay) | Harvest | Core gameplay | 578–787, 660–838 | Farm | Missing |
| S21 | Chế biến (Gameplay) | Processing | Core gameplay | 794–992, 660–838 | Farm | Missing |
| S22 | Bán nông sản (Gameplay) | Sell produce | Panel over world | 1000–1228, 660–838 | Economy | Missing |
| S23 | Bản đồ thế giới (Gameplay) | World map | Full scene | 1235–1536, 660–838 | Meta | Missing |
| S24 | Chi nhánh (Gameplay) | Branches | Full scene + panel | 0–325, 845–1024 | Meta | Missing |
| S25 | Nhiệm vụ (Gameplay) | Quests | Full panel | 332–550, 845–1024 | Meta | Missing |
| S26 | Thành tựu (Gameplay) | Achievements | Full panel | 558–795, 845–1024 | Meta | Missing |
| S27 | Cài đặt (Gameplay) | Settings | Full panel | 803–1053, 845–1024 | Shell | Missing |
| S28 | Tạm dừng (Gameplay) | Pause | Overlay | 1060–1282, 845–1024 | Shell | Missing |
| S29 | Lưu & tiếp tục (Gameplay) | Save & continue | Full panel | 1290–1536, 845–1024 | Shell | Missing |

## 3. Per-screen specifications

Each spec lists: **Seen in concept** (only what the tile shows), **Gameplay spec** (what the screen must do), **Not allowed**, and **Depends on**. Acceptance criteria live in [ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md) under the same ID.

### S01 — Splash / loading
- **Seen in concept:** "The Coffee SixSense" logo with a coffee-cup emblem, over a daytime European-style hillside town with towers and a river; a horizontal loading bar about 75% filled with a percentage on the right; a loading caption above the bar and a one-line tip along the bottom (text illegible).
- **Gameplay spec:** real asset-loading progress (not a fake timer); rotating tips from the locale file; tap/click to continue only once loading is done.
- **Not allowed:** fake progress; browser default fonts.
- **Depends on:** Preload pipeline, logo asset, splash painting.

### S02 — Main menu
- **Seen in concept:** chibi barista (brown hair, white shirt, dark apron) holding a cup, in front of a café storefront with a "Coffee SixSense" sign; three stacked caramel buttons on the right: **Tiếp tục**, **Chơi mới**, **Cài đặt**; a bottom bar with 4 icon buttons with captions (illegible).
- **Gameplay spec:** Continue (latest save, disabled if none), New Game (slot select → S03), Settings (S27). The barista has an idle animation loop. `[OPEN]` what the 4 bottom icons are.
- **Depends on:** SaveService, character idle animation, storefront background.

### S03 — Ch.1 The Incident (Biến cố)
- **Seen in concept:** rainy night city street, wet reflections, a bus with bright headlights; the player character running in back view; an objective box top-left with a small icon; a countdown timer top-right; a virtual joystick bottom-left; a round action button bottom-right with a running-figure icon.
- **Gameplay spec `[PROPOSAL]`:** a 30–45 s playable escape. The player steers with the joystick/WASD through a short street segment, uses the action button to vault or dash past obstacles (barriers, puddles that slow you down, crossing cars), and reaches the goal (a stray kitten in the road, to carry to safety). When the player reaches it, scripted headlights white out the screen and lead to S04. If the timer runs out, the player restarts from a checkpoint; no death is shown. Rain, puddle splashes and headlight sweeps are live effects, not a pre-rendered video.
- **Not allowed:** a static cinematic, a "press to continue" slideshow, or a level that can't be failed.
- **Depends on:** player controller + FSM, virtual joystick, collision layer, timer HUD, rain VFX.

### S04 — Ch.2 The Portal (Cánh cổng)
- **Seen in concept:** a dark blue forest/ruin with stone pillars; a large glowing cyan-blue ring portal at the center; the player running toward it; the same objective box, joystick and action button as S03.
- **Gameplay spec `[PROPOSAL]`:** a small explorable area. The player finds and activates 3 "Sense Stones" (Sight, Hearing, Touch; this ties to the *SixSense* title) by walking to them and pressing the action button. Each activation adds one ring to the portal's glow. When all 3 are active, the portal opens and walking into it moves to S05. Optional collectible: one hidden coffee cherry that grants a starting seed.
- **Not allowed:** auto-walk, or a portal that opens with no player action.
- **Depends on:** interactables, light/VFX layering, objective tracker.

### S05 — Ch.3 Meet the Master (Gặp bậc thầy)
- **Seen in concept:** a warm workshop/café interior with shelves and jars; an old white-bearded man in an apron and tan coat gesturing; a speech bubble top-right; the player in back view on the left; a round "!" hint icon on the left.
- **Gameplay spec `[PROPOSAL]`:** dialog with the master (who awakens the remaining senses: Smell, Taste, Intuition), then a **playable brewing tutorial**: walk to the grinder, grind, tamp, pull an espresso shot, and serve the master. He rates the shot using the same rating system as S11, with tutorial leniency. Retrying is allowed. Then he asks "who are you now?", which leads to S06.
- **Not allowed:** a tutorial that only shows text; a rating not based on the player's actions.
- **Depends on:** dialog system, brewing stations (M2), rating system.

### S06 — Character creation
- **Seen in concept:** a full-body chibi character on the left; a right-hand cream panel with a grid of hairstyle options (about 6–9 heads), outfit swatches, a labeled name field (pre-filled text illegible, possibly "Barista"), and a confirm button at the bottom.
- **Gameplay spec:** choose hair (style + color), outfit, and name (Vietnamese diacritics supported; 1–16 characters). The preview updates live and the character idles/turns. Confirming saves the choice and goes to S07.
- **Depends on:** a modular character atlas (paper-doll layers), text input.

### S07 — First café (main gameplay hub)
- **Seen in concept:** an isometric café interior with wooden floor, counter, tables, plants and warm lamps; several customers seated or walking; floating order icons above customers. **HUD:** top-left portrait + level; top-right resource counters (coins about 12,500 and others; at least 3 counters); a left quest panel "Nhiệm vụ" with 2–3 checkbox lines and progress fractions; a bottom-right row of 4 round buttons with captions.
- **Gameplay spec:** the main loop (see GAME_DESIGN §4). Click/tap-to-move with A*, plus WASD; stations; customers with FSMs; live quest tracker.
- **Not allowed:** a menu-driven café with no walking, or static customers.
- **Depends on:** M1 + M2.

### S08 — Customer orders
- **Seen in concept:** a close shot of 3 customers at the counter; a speech bubble with two drink icons (latte cup, coffee cup).
- **Gameplay spec:** a customer at the counter shows an order bubble with 1–2 drinks from unlocked recipes, weighted by customer type. The player confirms by walking to the counter and interacting. The order is added to the order rail.

### S09 — Brewing
- **Seen in concept:** close-up of an espresso machine/grinder with metal detail; a pointing-hand cursor indicating a drag or tap; a progress bar at the bottom with a label (green fill) and a small icon on the right.
- **Gameplay spec:** station-specific interaction minigames (grind, tamp, extract, steam, pour), defined per recipe in data. Each step produces a measured value that feeds rating (GAME_DESIGN §5).
- **Not allowed:** a single "Brew" button; a timer bar with no player skill input.

### S10 — Complete & serve
- **Seen in concept:** the barista sets a drink on a table; the customer reacts with the bubble "Tuyệt quá!", 5 stars, and a "+120" coin popup.
- **Gameplay spec:** the player carries the finished drink, walks to the customer's seat and serves it. The customer plays a taste animation and the reaction appears.

### S11 — Customer rating
- **Seen in concept:** a smiling customer close-up; a review bubble (text illegible); 5 stars; reward popups **+120 coins** and **+30 EXP**.
- **Gameplay spec:** stars come from the rating formula (GAME_DESIGN §5); reward = price × star multiplier + tip; EXP is granted. The concept values (+120 / +30 for a 5★ Latte) are the **calibration target** for the economy numbers.

### S12 — Shop upgrades
- **Seen in concept:** a café background; a right panel showing item "Bàn ghế gỗ" with a short description, price **2,500** coins, and a **Mua** button; a bottom strip of 5 furniture thumbnails.
- **Gameplay spec:** buy furniture/upgrades with coins; a purchased item goes to the furniture inventory and can then be placed (S13).

### S13 — Decorate
- **Seen in concept:** isometric placement mode with a green highlighted grid on the floor; tables placed; a left panel "Bàn gỗ" with rotate/move buttons; red ✗ (cancel) and green ✓ (confirm) buttons bottom-right.
- **Gameplay spec:** grid snapping, red/green footprint validity, rotation (4 directions), move/store placed items. Navigation grid and seats rebuild on confirm.

### S14 — Staff
- **Seen in concept:** a left column of 3 staff portraits; the center shows a full-body character named **Anna**, **Lv.3**, a role tag, and 4 stat bars (labels illegible); an upgrade button with a coin cost.
- **Gameplay spec `[PROPOSAL]`:** hire/upgrade NPC staff who automate stations (auto-serve or auto-brew at a lower quality ceiling than the player). Phase 2+.

### S15 — Recipes
- **Seen in concept:** tabs (about 4; "Tất cả" first); a grid of 8 drinks including Espresso, Latte, Cappuccino, an iced coffee (Cà phê đá?), Mocha, Macchiato(?), and others; a right detail panel for **Latte** with ingredient/stat bars and a price; an action button.
- **Gameplay spec:** browse unlocked/locked recipes; view ingredients, steps and preferred roast; unlock with coins/level.

### S16 — Inventory
- **Seen in concept:** 3 tabs; a 4×2 grid of ingredient icons with counts: coffee beans, fresh milk, sugar, a cup/milk jug, cocoa powder, cinnamon, vanilla, a pink item (cream?).
- **Gameplay spec:** **one shared inventory** for farm and café (see GAME_DESIGN §6). Tabs: Ingredients / Items / Other `[OPEN: exact tab names]`.

### S17 — Skills
- **Seen in concept:** 4 tabs; a node tree with connecting lines, one highlighted coffee-cup node, locked nodes; a detail card **"Barista Chuyên Nghiệp"** with a short effect line, cost **500** coins, and an upgrade button.

### S18 — Coffee farm
- **Seen in concept:** an isometric farm with crop rows, trees and a farmer character; HUD coin and resource counters at the top; a bottom toolbar of 5 large tool buttons with captions.
- **Gameplay spec:** walkable farm; tools: Hoe (prepare soil), Seeds, Watering can, Harvest basket, Processing. Plots have visible growth stages.

### S19 — Planting
- **Seen in concept:** soil plots with seedlings; a panel "Chọn giống cà phê" with 3 varieties (**Arabica, Robusta, Culi**), grow time, yield range, cost **200**, and a plant button.

### S20 — Harvest
- **Seen in concept:** close-up of bushes heavy with red coffee cherries; the character picking into a woven basket; a lock icon on a section (locked plot or tool).
- **Gameplay spec:** harvest by interacting with ripe bushes (tap or hold per bush). Under-ripe picking lowers grade.

### S21 — Processing
- **Seen in concept:** raised drying beds of red cherries; the character working; a progress bar "Đang phơi hạt" with a timer; a fast-forward button.
- **Gameplay spec:** drying runs in game time; the player rakes beds (interaction) to keep quality up; the fast-forward costs coins `[OPEN]`. Roasting is the next step (see GAME_DESIGN §6).

### S22 — Sell produce
- **Seen in concept:** sacks of coffee cherries; a panel "Hạt cà phê Arabica"; a quantity stepper (− 20 +); total **2,000** coins; a unit-price line; a sell button.

### S23 — World map
- **Seen in concept:** a painted island map with regions labeled (approx.) "Nông trại", "Thị trấn", "Thành phố", "Khu nghỉ dưỡng"; lock icons on unavailable regions.
- **Gameplay spec:** travel between the farm and café scenes (both available from M3); other regions locked behind progression.

### S24 — Branches
- **Seen in concept:** a town map with building thumbnails; a panel "Quán Trung Tâm" with revenue **12,500**, 4 stars, two buttons; locked branch slots.
- **Gameplay spec:** late-game expansion. Phase 3.

### S25 — Quests
- **Seen in concept:** tabs (Chính tuyến, Hằng ngày, and a third); a list of quests with icons, progress (6/10, 2/5, 0/50), and claim buttons.

### S26 — Achievements
- **Seen in concept:** a list with medal icons: "Barista Tài Ba", "Nông Dân Cà Phê", "Nhà Thiết Kế Quán", each with a progress bar and fraction.

### S27 — Settings
- **Seen in concept:** sections **Âm thanh** (music and SFX sliders), **Đồ họa** (quality: Thấp / Trung bình / Cao), **Điều khiển** (Hiển thị FPS toggle).
- **Gameplay spec:** settings persist outside save slots. Adds a language selector (VI first) `[PROPOSAL]`.

### S28 — Pause
- **Seen in concept:** a darkened game background; a vertical stack: **Tiếp tục**, **Lưu game**, **Cài đặt**, **Về màn chính** (the last in red).
- **Gameplay spec:** pauses the simulation clock (farm growth keeps its real-time rules, see GAME_DESIGN §6.4).

### S29 — Save & continue
- **Seen in concept:** save cards with a location thumbnail, name (e.g., "Quán Trung Tâm Lv.?", "Nông trại"), a timestamp, and a continue button.
- **Gameplay spec:** 3 save slots; each card shows the last location, level, coins and playtime; load/delete.

## 4. Screen-type rules (apply to all)

- **World screens** (S03–S05, S07–S11, S13, S18, S20, S21): the world is rendered from atlas sprites in isometric 2:1. UI floats over the world. No full-screen dashboards.
- **Panel-over-world** (S12, S19, S22): the world stays visible, dimmed, behind a right-side textured panel.
- **Full panels** (S14–S17, S25–S27, S29): textured parchment/cream panels with a dark-brown title bar. Not flat rectangles: they use 9-slice textured frames.
- No browser `alert()`/`confirm()`, no emoji as icons, and no placeholder text in shipped builds.
