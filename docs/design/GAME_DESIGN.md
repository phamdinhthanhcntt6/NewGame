# Game Design Document

> **Project:** TheCoffeeSixSense · **Status:** Draft v0.1 (2026-10-26) · **Branch:** `dev`
> **Related:** [SCREEN_SPECS](SCREEN_SPECS.md) · [GAMEPLAY_FLOW](GAMEPLAY_FLOW.md) · [ART_BIBLE](ART_BIBLE.md) · [TECHNICAL_ARCHITECTURE](../architecture/TECHNICAL_ARCHITECTURE.md)
> **Tags:** `[CONCEPT]` shown in concept art · `[PROPOSAL]` design proposal · `[OPEN]` needs a decision

All numbers in this document are **initial tuning values**. They live in data files (`src/data/*.json`), not in code, and are expected to change during playtests.

---

## 1. Vision

A cozy 2.5D isometric coffee life sim. The player is reborn into a warm storybook world, learns coffee craft from a master, grows coffee on their own farm, and runs a café where every cup is made by hand and judged by real customers.

**Interaction quality target:** the tactile feel of *Coffee Break*-style café sims (walk to things, touch things, things react). The story, characters, art, systems and numbers are all original. We do not copy layouts, assets, names or text from any existing game.

**Platform:** HTML5 (desktop + mobile browsers), landscape, 16:9 base resolution 1920×1080 with responsive scaling.
**UI language:** Vietnamese first, all strings via i18n keys (decided 2026-10-26).

## 2. Pillars

| Pillar | Promise | Proof in play |
|---|---|---|
| **1. Playable rebirth story** | You *play* your way into this world | S03–S05 are interactive levels with fail/retry, not cutscenes |
| **2. Interactive coffee farming** | Coffee comes from soil you worked | Plant → water → visible growth → harvest → process → roast |
| **3. Interactive café management** | Every cup is your craft | Walk to stations, hands-on brewing steps, customers rate what you made |
| **Shared economy** | Farm and café feed each other | One inventory, one wallet; farm beans are the cheapest café supply |

## 3. Story — "Six Senses" `[PROPOSAL]`

- **Protagonist:** a young, overworked city barista (name and look chosen in S06) who dreams of a café of their own.
- **S03 The Incident:** on a rainy night, rushing home, they run into the street to save a stray kitten as a bus's headlights sweep in. White-out.
- **S04 The Portal:** they wake in a twilight forest between worlds. Three *Sense Stones* (Sight, Hearing, Touch) wake when touched and open a portal.
- **S05 The Master:** an old coffee master in a hillside town greets them. He awakens the remaining senses (Smell, Taste, Intuition) by teaching them to brew. The "sixth sense" is a barista's intuition: knowing what each customer needs.
- **S06:** the master hands them a mirror: "You've been reborn. Who are you now?" → character creation.
- **Ongoing:** the master gives the first café (S07) and a small coffee plot (S18). Main-line quests (S25) carry the story; regions on the world map (S23) open new chapters.
- **Tone:** gentle, warm, a little magical. No violence on screen; the accident is implied by light and sound.
- The kitten becomes the café cat (a cosmetic NPC in S07) `[PROPOSAL]`.

## 4. Core loops

```
             ┌──────────────── coins ─────────────────┐
             ▼                                         │
  FARM: buy seeds → prepare soil → plant → water →     │
        grow (visible stages) → harvest cherries →     │
        dry → (sell) / roast → roasted beans ──────────┤
                                  │                    │
                                  ▼ shared inventory   │
  CAFÉ: customer enters → sits/queues → orders →       │
        player walks to stations → grind/tamp/extract/ │
        steam/pour → serve → customer tastes → rates → │
        pays coins + EXP ──────────────────────────────┘
             │
             ▼
  GROW: furniture & upgrades (comfort, capacity, station quality),
        farm land & tools, recipes, skills, staff (later), new regions
```

**Session shape (target):** a 10–20 minute session = one café shift (≈ 8–12 customers) plus one farm visit (water/harvest/process). Crops grow over the shift, so the player naturally alternates between the two scenes.

## 5. Café gameplay

### 5.1 The shift
1. The player opens the café (sign on the door). A shift lasts **6 in-game hours ≈ 8 real minutes** `[tuning]`.
2. Customers spawn at the street edge according to a spawn curve (rate × reputation × comfort).
3. Each customer walks (A*) to the door, then to a **free reserved seat**. If none are free, they queue at the counter (up to the queue limit), then leave unhappy if the wait passes their patience.
4. The customer walks to the counter (or the player comes to the table, after the "Table service" upgrade) and shows an **order bubble** (S08): 1 drink at the start, 1–2 later.
5. The player accepts the order, which goes to the **order rail** HUD (max 3 active orders at the start).
6. The player walks to stations and performs the recipe steps (§5.3).
7. The player carries the drink (carry state: max 2 items, upgradable tray) to the customer and serves it (S10).
8. The customer tastes (animation), **rates (S11)**, pays, and leaves. A free seat makes the café ready for the next customer.

### 5.2 Customer model (data-driven, `customers.json`)
| Field | Meaning |
|---|---|
| `archetype` | student, office worker, tourist, elder, critic (later) |
| `patience` | seconds before mood drops a band (e.g. 60–120) |
| `preferences` | weighted list of recipe IDs; roast preference |
| `tipFactor` | multiplier on tips |
| `sensitivity` | how much each quality variable matters (critics are strict) |

### 5.3 Stations and brewing steps
Every step is a hands-on interaction that **produces a measured value**. Recipes declare which steps they need.

| Station | Step | Interaction | Measured value |
|---|---|---|---|
| Grinder | Grind | choose dial setting, then hold to grind until the dose fills | `grindError` = distance from the recipe's target grind (0 = perfect) + `doseError` |
| Tamp station | Tamp | drag down; release while the pressure needle is in the green band | `tampError` (0–1) |
| Espresso machine | Extract | start the shot; stop it when the flow meter is in the target window | `extractionError` = time outside the target window |
| Steam wand | Steam milk | hold; release in the target temperature band; watch foam texture | `milkError` |
| Cup / bar | Assemble | drag components into the cup in order; pour (latte art later) | `orderCorrect` (bool), `assemblyError` |
| Ice / syrup / topping | Add | tap the correct count | `extrasCorrect` (bool) |

Station quality (from upgrades) **widens the target bands**; skills (S17) do too. Practice therefore pays off, and upgrades help without replacing skill.

### 5.4 Rating formula (S11)
A drink's score is 0–100, computed only from real gameplay variables:

```
if wrongDrink:                     stars = 1, pay 0, customer leaves annoyed
craft    = 100 × (1 − weighted mean of step errors)       weight 0.45
bean     = bean quality grade (0–100, from farm care/roast) weight 0.20
          × roast match (1.0 matching roast, 0.8 off by one level)
wait     = 100 × clamp(1 − (waitTime − graceTime)/patience) weight 0.20
ambience = café comfort score (0–100, from furniture)      weight 0.10
temp     = 100 if served within the hot/cold window, decays after  weight 0.05
score    = Σ(weight × component) × customer.sensitivity adjustments
```

| Score | 0–39 | 40–59 | 60–74 | 75–89 | 90–100 |
|---|---|---|---|---|---|
| Stars | 1★ | 2★ | 3★ | 4★ | 5★ |
| Price multiplier | 0.6 | 0.8 | 1.0 | 1.25 | 1.5 |
| Tip (% of base price) | 0 | 0 | 0 | 15% | 50% |
| EXP multiplier | 0.5 | 1 | 1.5 | 2 | 3 |

**Calibration check against concept S11:** Latte base price 60, 5★ → 60 × 1.5 + 60 × 50% = **120 coins** ✓; Latte base EXP 10 × 3 = **30 EXP** ✓.

Reputation = a moving average of the last 50 ratings. It drives the spawn rate and unlocks critic customers.

## 6. Farming gameplay

### 6.1 Plot life cycle
```
Locked → (buy land) → Wild → [Hoe] → Prepared → [Plant seed] → Seedling
   → Sapling → Flowering → Green cherries → Ripe cherries → [Harvest] → Resting → [Hoe] → Prepared
                                                ↘ (left too long) Overripe (lower grade)
```
- **Watering:** each growing stage needs ≥ 1 watering to advance at full speed. A dry plot grows at 50% speed and loses care points. Visible state: dark wet soil vs. pale cracked soil.
- **Care score (0–100)** per plot: starts at 70; + for watering on time, + fertilizer (later), − for dry periods, − for overripe. Care decides the **quality grade** of the harvest.
- Each stage has its own sprite (5 visible growth stages per variety, see ASSET_MANIFEST).

### 6.2 Varieties (`crops.json`)
| Variety | Seed cost | Grow time (total) | Yield (cherries) | Flavor role | Unlock |
|---|---|---|---|---|---|
| Robusta | 60 | 4 min | 10–14 | strong, Vietnamese iced coffee | Start |
| Arabica | 120 | 6 min | 8–12 | balanced, milk drinks | Start |
| Culi (peaberry) | 200 | 8 min | 6–9 | premium, espresso | Farm Lv.3 |

Grow times are real minutes during active play, for prototype tuning `[OPEN: final pacing]`.

### 6.3 Processing chain
| Step | Input → Output | Where | Interaction |
|---|---|---|---|
| Harvest | ripe bush → cherries (grade A/B/C) | Farm | tap/hold each bush; picking green cherries lowers grade |
| Dry | 2 cherries → 1 green bean | Drying bed (S21) | load the bed, rake it 1–3 times during drying (+quality); dries in 2 min |
| Roast | 1 green bean → 1 roasted bean (light/medium/dark) | Roaster (farm shed, Farm Lv.2) | stop the roast at the color/crack cue; the roast level is the result |
| Grind | 1 roasted bean = 1 dose | Café grinder | see §5.3 |

### 6.4 Time rules
- Crops grow on a **world clock** that runs while the game is open in *any* scene (farm or café). This makes the alternating loop work.
- **Offline growth:** on load, elapsed real time is applied, **capped at 2 hours**. Crops never pass "Ripe" while offline (no offline overripe loss).
- The pause menu (S28) pauses the café shift simulation but not the world clock `[OPEN]`.

### 6.5 Farm upgrades
More plots (land purchase), watering-can capacity, sprinkler (auto-water one row), more drying beds, roaster, storage size.

## 7. Shared economy

### 7.1 Single source of truth
- **One wallet:** `coins`. `[OPEN]` the concept HUD shows 2–3 counters. Proposed: coins, EXP/level, and reputation stars. **No premium/paid currency** is in scope.
- **One inventory** (S16) with item stacks `{ itemId, qty, quality }` (quality is averaged when stacks merge, within the same grade). Farm outputs and café inputs are the same items.

### 7.2 Item price table (`items.json`)
"Sell" is what the market pays the player (S22); "Buy" is the supplier price. Buying is always ≥ 1.5× selling, so farming is the cheapest source of beans.

**Concept numbers used as targets vs. ignored:** S11 (+120 coins / +30 EXP), S12 (2,500 table set) and S17 (500 skill) are calibration targets. The S22 tile (20 Arabica → 2,000, i.e. 100 per bean) is deliberately **not** a target: at that price, selling raw would beat brewing and break the farm→café incentive (§7.5). The coin balances on S07/S24 (12,500) are illustrative only.

| Item | Sell | Buy | Source |
|---|---|---|---|
| Cherry — Robusta / Arabica / Culi | 5 / 8 / 12 | — | Farm |
| Green bean — R / A / C | 12 / 20 / 28 | — | Drying (2 cherries → 1, so drying adds value) |
| Roasted bean — R / A / C | 18 / 28 / 40 | 30 / 45 / 65 | Roasting / supplier |
| Fresh milk | — | 5 | Supplier |
| Condensed milk | — | 6 | Supplier |
| Sugar / Ice / Water | — | 2 / 1 / 0 | Supplier |
| Cocoa / Cinnamon / Vanilla / Cream | — | 6 / 4 / 8 / 6 | Supplier |

### 7.3 Recipe table (`recipes.json`)
Any roasted bean is accepted; the preferred bean only affects the `bean` rating component. "Bought" cost uses the cheapest bean (Robusta, 30).

| Recipe | Ingredients | Steps | Base price | Base EXP | Coin cost: farm beans / bought beans | Unlock |
|---|---|---|---|---|---|---|
| Espresso | 1 roasted (pref. Culi/Arabica) | grind, tamp, extract | 45 | 6 | 0* / 30 | Tutorial |
| Cà phê sữa đá | 1 roasted (pref. Robusta), condensed milk, ice | grind, tamp, extract, assemble | 55 | 8 | 7 / 37 | Start |
| Americano | 1 roasted, water | grind, tamp, extract, assemble | 45 | 6 | 0 / 30 | Lv.2 |
| Latte | 1 roasted (pref. Arabica), milk | grind, tamp, extract, steam, assemble | 60 | 10 | 5 / 35 | Lv.2 |
| Cappuccino | 1 roasted, milk | + foam-heavy steam | 65 | 11 | 5 / 35 | Lv.4 |
| Macchiato | 1 roasted, milk (small) | grind, tamp, extract, steam-dot | 55 | 9 | 5 / 35 | Lv.5 |
| Mocha | 1 roasted, milk, cocoa | + add cocoa | 75 | 13 | 11 / 41 | Lv.6 |
| Cinnamon latte (special) | 1 roasted, milk, cinnamon, vanilla | full | 90 | 16 | 17 / 47 | Lv.8 |

\* Using your own farm beans costs no coins at serve time; the real cost is their *opportunity cost* (the sell price you gave up: 18–40). **Design intent:** serving a farm bean in a 3★+ drink earns at least as much as selling that bean raw (worst case: Espresso 45 vs. a Culi bean's 40), so the café is the best outlet and the farm is the best supplier. Selling raw produce is a cash-flow safety valve. The economy sim (§7.5) enforces this as a test.

### 7.4 Sinks and progression costs (initial)
| Purchase | Cost | Effect |
|---|---|---|
| Wooden table set ("Bàn ghế gỗ", concept S12) | 2,500 | +2 seats, +comfort |
| Plant pot / lamp / painting | 300–1,200 | +comfort |
| Grinder Lv.2 / Machine Lv.2 / Steam Lv.2 | 1,500 / 3,000 / 2,000 | wider target bands |
| Extra farm plot | 400 × n (n = plots owned) | +1 plot |
| Drying bed / Roaster | 800 / 3,500 | processing capacity |
| Skill node (S17, e.g. "Barista Chuyên Nghiệp") | 500+ coins + skill point | e.g. +20% band width on extraction |
| Recipe unlock | 300–2,000 | new menu item |

**Starting state:** 500 coins, 4 prepared plots, 3 Robusta + 2 Arabica seeds, 6 roasted Robusta, milk 5, condensed milk 5, ice 10.

### 7.5 Economy health targets (for test/sim tooling)
- First table-set purchase (2,500) reachable in **4–6 shifts** (≈ 45 min of play) with average 3–4★ play, including quest rewards. Rough check: 10 customers × ~65 coins − ~150 ingredient cost ≈ 500 net per shift.
- Farm beans served at 3★+ must earn ≥ their raw sell price, for every recipe (see §7.3).
- An all-bought-beans café must still be profitable at 3★ (price > coin cost) for every recipe, so new players can't soft-lock. **Rule: the player always gets ≥ 3 free roasted Robusta per day from the master's gift crate** `[PROPOSAL]` as an anti-softlock floor.
- A headless economy simulation (Vitest) checks these targets on every data change.

## 8. Progression
- **Player level** from EXP: `expToNext = 100 × level^1.5`. Levels unlock recipes, furniture and regions. Each level grants 1 skill point.
- **Farm level** from harvest EXP; unlocks Culi, the roaster and plots.
- **Skills (S17):** 4 trees: Barista, Service, Farming, Business.
- **Quests (S25):** Main (story), Daily (3 per day), Achievements (S26) with counters.
- **Staff (S14), Branches (S24), World regions (S23):** Phase 2/3 (see MILESTONES).

## 9. Out of scope (for now)
Multiplayer, monetization/IAP, premium currency, ads, cloud saves, latte-art drawing, weather on the farm.

## 10. Open decisions
| # | Decision | Default until decided |
|---|---|---|
| D1 | Meaning of the 4 bottom icons on S02 | Hidden until known |
| D2 | Second/third HUD currency in S07 | EXP level + reputation; no premium currency |
| D3 | Final real-time pacing for crops | Values in §6.2 |
| D4 | Fast-forward cost in S21 | Coins, 1 coin per 2 s remaining |
| D5 | Does pause stop the world clock? | No |
| D6 | Protagonist default gender/look in S03–S05 | Neutral silhouette-friendly default; replaced after S06 |
