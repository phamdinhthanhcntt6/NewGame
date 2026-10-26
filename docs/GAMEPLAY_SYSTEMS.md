# Gameplay Systems

> **Status:** v1.0 · 2026-10-26 · reflects code on `dev` after M1
> Roadmap: [GAMEPLAY_ROADMAP.md](GAMEPLAY_ROADMAP.md)

## 1. Overrides of earlier design docs
The gameplay-first brief (2026-10-26) replaces these earlier rules. Where documents conflict, this table wins.

| Topic | New rule | Replaces |
|---|---|---|
| Story controls | **No virtual joystick.** Click/tap-to-move everywhere, including scenes 03–05 | SCREEN_SPECS S03/S04, ART_BIBLE §7 "Mobile controls", ASSET_MANIFEST U-05 |
| Rating weights | Recipe accuracy 40%, bean quality 25%, brewing performance 20%, serving time 15% | GAME_DESIGN §5.4 (0.45/0.20/0.20/0.10/0.05) |
| Plot lifecycle | `EMPTY → PREPARED → PLANTED → GROWING → READY → HARVESTED` (+ locked land) | GAME_DESIGN §6.1 |
| Player states | `IDLE, MOVING, INTERACTING, WORKING, CARRYING` | TECHNICAL_ARCHITECTURE §6 player row |
| Milestones | 12-step gameplay roadmap | MILESTONES_AND_BACKLOG M1–M8 |
| Source layout | `src/{core,scenes,entities,components,systems,gameplay,data,ui,assets,utils}` | TECHNICAL_ARCHITECTURE §3 tree |
| Persistence | **localStorage** for the prototype (single slot `tcss.save.slot1`); IndexedDB/slots revisited in M11 | GAMEPLAY_FLOW §3 "IndexedDB only" |
| Seed economy (M2 data) | Robusta 30 / Arabica 50 / Culi 80 coins; growth 2 / 3 / 5 min; 2 / 3 / 4 waterings; yield 10 / 8 / 8; cherry price 5 / 8 / 12 | GAME_DESIGN §6.2 seed costs and grow times |
| Crop states | Thirst is a flag on `PLANTED/GROWING` (growth pauses until watered), not a separate phase. Overripe is not modelled | GAME_DESIGN §6.1 "dry plot grows at 50%", "Overripe" |
| Offline growth | Full catch-up from saved timestamps (no 2 h cap), but a crop can only grow through segments it was watered for, so offline growth is naturally bounded | GAME_DESIGN §6.4 |
| Recipes (prototype) | Espresso, Americano, Latte, Cappuccino, Vietnamese milk coffee | GAME_DESIGN §7.3 list of 8 |

Economy numbers in GAME_DESIGN §7 remain the **starting data** for M2–M6 unless superseded in `src/data`.

## 2. Architecture (M1)

```
Phaser scene (SandboxScene)  ──input──▶  GameSimulation.clickTile / cancel
        ▲  reads snapshot()                    │ tick(dt)
        │                                       ▼
WorldRenderer (PlaceholderRenderer)     InteractionService (per actor)
DebugPanel / FeedbackPresenter ◀─events─ EventBus<GameEvents>
                                         NavigationService ─ NavGrid ─ A*
                                         ActionRegistry (handlers by key)
                                         WorldModel (map + objects, from JSON)
```

- **Headless core:** everything under `core/`, `entities/`, `systems/`, `gameplay/`, `utils/` runs without Phaser. Tests drive `GameSimulation` directly.
- **One-way data flow:** scenes call commands (`clickTile`, `cancel`) and read `snapshot()`. Renderers never write gameplay state.
- **Fixed sub-steps:** `tick()` splits long frames into ≤ 100 ms steps (`simulation.maxStepMs`), so a backgrounded tab can't skip state transitions.

| Path | Responsibility |
|---|---|
| `src/core/EventBus.ts`, `events.ts` | Typed pub/sub; the `GameEvents` map lists every event |
| `src/core/StateMachine.ts` | Generic FSM; **illegal transitions throw**; transition log |
| `src/core/i18n.ts`, `data/locales/vi.json` | `t(key, params)`; Vietnamese first |
| `src/core/testBridge.ts` | `window.__TCSS__` for Playwright (not installed when `import.meta.env.PROD`) |
| `src/utils/iso.ts`, `tile.ts` | 2:1 projection, depth rules, tile math |
| `src/systems/navigation/*` | `NavGrid` (terrain + reference-counted blockers), A*, smoothing, `NavigationService` |
| `src/systems/interaction/InteractionService.ts` | Approach, engage, work, complete, queue, cancel |
| `src/entities/Actor.ts` | Position, path following, facing, held item, state FSM (reused for customers and employees later) |
| `src/gameplay/world/*` | Map/object types, validation, `WorldModel` |
| `src/gameplay/actions/*` | `ActionRegistry` + handlers (the only code that changes state on interaction) |
| `src/gameplay/GameSimulation.ts` | Composition root + snapshot |
| `src/components/render/*` | `WorldRenderer` contract + placeholder implementation |
| `src/ui/*` | Debug panel, feedback presenter |
| `src/scenes/*` | Phaser adapters only |

## 3. Navigation
- **Grid:** 8-way A*, octile heuristic, deterministic tie-breaking, **no corner cutting**. Multi-goal search, so the nearest of several approach tiles is chosen by real path cost.
- **Blockers:** objects with `blocking: true` add to a per-tile reference count; `removeObject` restores walkability exactly (ready for M7 furniture).
- **Smoothing:** waypoints are tile centres; intermediate points are dropped when the body (half-size `bodyRadius` = 0.25 tile) has clearance along the straight segment. Movement speed is `speedTilesPerSec`.
- **Blocked clicks:** clicking a blocked or unreachable tile walks to the nearest reachable tile within `blockedClickSearchRadius`. If there is none: `move:unreachable` and the player stays put.

## 4. Interactions
Objects declare interactions in `data/config/objectTypes.json`:

```json
"interaction": { "radius": 1, "sides": ["S"], "actions": [
  { "id": "brew_test", "label": "...", "durationMs": 1500, "handler": "held.take", "params": { "item": "test_cup" } } ] }
```

- **Approach tiles:** walkable tiles within Chebyshev `radius` of the (rotated) footprint, optionally limited to grid `sides` (rotation is applied). If the player is already on one, the interaction starts without moving.
- **Phases:** `approach` (MOVING) → `engage` (INTERACTING, `engageMs`) → `work` (WORKING, `durationMs`; skipped when 0) → complete → `IDLE`, or `CARRYING` if holding something.
- **Action choice:** an explicit `actionId`, or else the first action whose handler `canStart` succeeds *when the actor arrives* (so a queued table click works once the cup is in hand).
- **Requirements are checked twice**, on engage and again at completion. A failed check emits `interaction:failed` with `reason` and `detail`.
- **Queue rules:**
  - Clicking an object appends to a FIFO queue (max `maxQueuedInteractions` = 4; more → `queueFull`). A plain floor walk in progress is replaced.
  - Repeated clicks on the same target are ignored (no duplicate intents).
  - Clicking the floor cancels the current action and the whole queue, then walks.
  - Esc or right-click: `cancelAll`. **Cancelled work produces nothing**; the event carries `progress` for UI.
  - An unreachable or failed intent is skipped and the next one starts.
  - Removing an object cancels intents that target it (`objectRemoved`).
- **Exactly-once completion:** guarded per intent, including against re-entrant ticks from event listeners.

### Pointer targeting ("click what you see")
A click resolves in this order:
1. **Front-most drawn object** under the pointer: `WorldRenderer.objectAtPoint` tests each object's silhouette (top face + front faces) and its label. If it is interactive → `GameSimulation.clickObject(id)`. If it is a non-interactive obstacle → walk to the nearest reachable tile beside it.
2. Otherwise the **floor tile** under the pointer → `clickTile`.

This matters because a tall object's top face is drawn over the tiles *behind* it, so tile-only picking would send the player behind the object. Hover highlighting uses the same resolution.

## 5. Player state machine

| From | Allowed to |
|---|---|
| IDLE | MOVING, INTERACTING |
| MOVING | IDLE, CARRYING, INTERACTING |
| INTERACTING | WORKING, IDLE, CARRYING, MOVING |
| WORKING | IDLE, CARRYING, MOVING |
| CARRYING | MOVING, INTERACTING |

`CARRYING` is the rest state while holding an item. While walking with an item the state is `MOVING` (the held item stays visible), and it returns to `CARRYING` on arrival.

## 6. Events
- **M1:** `actor:stateChanged`, `actor:heldChanged`, `move:started`, `move:arrived`, `move:unreachable`, `interaction:queued|started|completed|failed|cancelled`.
- **M2:** `world:objectSelected`, `economy:transaction`, `farm:plotChanged`, `farm:canChanged`, `farm:seedSelected`, `shop:opened|closed`, `save:written`, `save:loadProblem`.

Payload types are in `src/core/events.ts`.

## 7. Data files
| File | Contents |
|---|---|
| `data/config/gameplay.json` | Player speed, body radius, engage time, queue size, click search radius, sim step |
| `data/config/objectTypes.json` | Footprints, blocking, interaction radius/sides/actions (incl. `farm_plot`, `well`, `seed_stall`) |
| `data/config/items.json` | Every item id the economy accepts (unknown ids are rejected) |
| `data/config/seeds.json` | Per seed: purchase cost, growth duration, waterings, yield, base quality, sell price, EXP reward, unlock level |
| `data/config/economy.json` | Starting coins/items, inventory capacity, history limits, watering can, soil levels (cost, yield/quality/speed bonus), thirst penalty, shop leave distance |
| `data/maps/sandbox.json`, `data/maps/farm.json` | Maps; objects may carry `props` (e.g. plot `price`). Validated at load |
| `data/content.ts` | Typed bundle of all the above + cross-reference validation (seed → item ids, soil levels 1..n) |
| `data/locales/vi.json` | UI strings |
| `data/config/furniture.json` (M7) | Furniture catalog (item, price, comfort, decor, unlock level) and bonus caps/rates; maps declare a `decor.area` |

## 8. Extension points for the next milestones
- **New gameplay verbs** (roast, brew, serve): register handlers in `ActionRegistry`; add actions to object types in data. `InteractionService` does not change.
- **Customers/employees:** create more `Actor`s, each with its own `InteractionService`, ticked by `GameSimulation`.
- **Anything that costs or gives coins/items/EXP:** goes through `TransactionService.execute` (see §9). One-off rewards must pass an idempotency `key`.

## 9. Economy: TransactionService (M2)
The single gateway for coins, inventory and EXP (`src/systems/economy/TransactionService.ts`).
- **Request:** `{ reason, coins?, exp?, items?: [{ itemId, qty, quality? }], key? }`. Negative values spend or remove.
- **Validated as a whole, then applied (all-or-nothing):** integers only; EXP ≥ 0; known item ids; quality 0–100; balance never negative; never remove more than owned (repeated item lines are netted first); total items ≤ `inventoryCapacity` (only net additions are checked, so selling always works when full).
- **Idempotency:** a request with a `key` that already succeeded fails with `duplicate`. Keys are persisted in the save, so reloading cannot re-pay a harvest or re-buy land. Harvest key: `harvest:<plotId>:<plantedAt>`; land: `buyPlot:<id>`; soil: `upgradeSoil:<id>:<level>`.
- **Quality:** stacks keep a weighted-average quality when merged.
- **History:** every transaction is recorded (`economy.history`, last 100) and emitted as `economy:transaction`.
- `check(req)` validates without applying. Rules use it in `canStart`, so an action never starts if its transaction would fail (e.g. harvest with a full bag).

## 10. Farming (M2)
`src/gameplay/farm/plotModel.ts` (pure rules), `FarmService.ts` (commands/state), `farmHandlers.ts` (bindings to object actions).

**Plot lifecycle:**
```
locked ──buyPlot──▶ EMPTY ─prepare─▶ PREPARED ─plant(−1 seed)─▶ PLANTED ─water─▶ GROWING ─(time + all waterings)─▶ READY ─harvest(+cherries, +EXP)─▶ HARVESTED ─prepare─▶ PREPARED …
```
- **Water requirement:** growth is split into `waterings` equal segments. Each watering unlocks one segment; when growth reaches the unlocked amount, the crop is *thirsty* (`needsWater`) and stops growing. Thirsty time is recorded as `dryMs`.
- **Time:** growth uses the wall clock (`Clock`), not frame time. `advancePlot(plot, now)` is a pure function of the saved fields. Advancing in many small steps equals one big step (property-tested), so restoring after the game was closed is exact. Clocks going backwards are ignored.
- **Fresh state:** every rule reads the plot advanced to *now* (`FarmService.plot()`), so a crop that ripened in real time is harvestable the moment the player arrives.
- **Yield / quality:** `yield × (1 + soil.yieldBonus)`; `baseQuality + soil.qualityBonus − min(max, dryMinutes × perMinute)`.
- **Soil upgrades:** only on plots without a crop (`EMPTY/PREPARED/HARVESTED`), so a growing crop's timing never changes mid-way. Level 2: +25% yield, +5 quality, +10% speed; level 3: +50%, +10, +20%.
- **Action choice on a plot:** the plot declares `harvest, water, plant, prepare`; the first one whose `canStart` passes runs. Failures report the first *applicable* reason ("can empty" rather than "not ready"). `CanStartResult.applicable: false` marks "doesn't apply to this state".
- **Locked land:** clicking it does not walk the player; `interactionGate` rejects immediately with `plotLocked`. Buying is a HUD command (`buyPlot`).
- **Watering can:** capacity 4, refilled at the well (an interaction).
- **Seed shop:** opened by interacting with the seed stall; `buySeeds` only works while the shop session is open, and the session closes when the player is more than `shopLeaveDistance` (2) tiles from the stall.
- **Planting seed:** the HUD-selected seed if owned, otherwise the first owned seed in data order.

## 11. Save / load (M2 baseline; hardened in M11)
`src/gameplay/state/GameState.ts` (schema), `SaveService.ts`, `src/core/session.ts`.
- **What is saved:** the whole `GameState` (economy incl. history and idempotency keys, EXP, all plots with timestamps, watering can, selected seed, player map + tile), as JSON in localStorage, schema version 1.
- **When:** after any gameplay change (debounced to once per 2 s), on `visibilitychange → hidden`, on `pagehide`, and on scene shutdown.
- **Never half-done:** only committed state lives in `GameState`. An action in progress when the game closes simply didn't happen.
- **Load problems:**
  - Unparseable JSON or a structurally invalid save is copied to `tcss.save.slot1.backup.<time>`; the player is told and a new game starts.
  - A save from a *newer* version is left untouched and saving is disabled for the session.
  - Migrations are registered per version (`{ [fromVersion]: fn }`) and run in order (tested with a v1→v2 fixture).
- **The M1 sandbox** (`?map=sandbox`) never loads or saves.

## 12. Farm HUD and plot visuals (placeholder)
- `FarmHud` (`src/ui/FarmHud.ts`) reads snapshots and calls only the `FarmUiCommands` interface: `selectSeed`, `buySeeds`, `buyPlot`, `upgradeSoil`, `nextSoilCost`. Its background swallows clicks, and Phaser's top-scene-first input means HUD clicks never reach the world.
- `PlotPresenter` maps plot state to an `ObjectVisual` (`locked`, `empty`, `prepared`, `thirsty`, `growing_0..3`, `ready`, `harvested` + caption + progress). The renderer only redraws when the visual actually changes.

## 13. Processing (M3)
`src/gameplay/processing/ProcessingService.ts`, `processingHandlers.ts`, data `data/config/processing.json`.
- **Chain:** cherries →(drying rack)→ green beans →(roaster)→ roasted beans. Recipes per variety: input item/qty, output item/qty, duration, quality delta, EXP.
- **Equipment** on the farm: `drying_rack_1`, `drying_rack_2`, `roaster`. Each has a persistent `EquipmentState { level, job }`.
- **Load** (click an idle machine): picks the HUD-preferred recipe if its inputs are available, else the first runnable one. Inputs × batch size are removed through `TransactionService` *in the same step* the job is recorded. A busy machine can't be loaded.
- **Job:** runs on the wall clock (`startedAt + durationMs`), so it finishes while the game is closed. Output quantity and quality are fixed at load: `inputQuality + qualityDelta + level.qualityBonus`.
- **Collect** (click a finished machine): adds outputs + EXP with idempotency key `process:<equipmentId>:<startedAt>`. It needs bag space; if the bag is full the output waits in the machine.
- **Conservation:** outputs exist only inside a job created by consuming inputs, and enter the bag only by collecting that job once. A 300-step fuzz test checks this against an independent transaction ledger.
- **Upgrades** (idle machines only, so a running job's terms never change): level 2/3 = speed +25/50%, quality +3/6 (rack) or +4/8 (roaster), batch ×2/×3. Costs in data, charged once per level (idempotency key).
- **Machine click order:** collect if done, otherwise load (`collect`, `load` actions).

## 14. Market (M3)
`src/gameplay/market/MarketService.ts`, data `data/config/market.json` (+ cherry prices from `seeds.json sellPrice`).
- **Price per unit:** `base × (0.5 + 0.01 × quality) × max(0.5, 1 − saturation)`. Each unit sold adds 0.01 saturation; saturation recovers 0.05 per minute of wall-clock time and is saved.
- **Quote = payout:** `quote(item, qty)` prices each unit at its own saturation step and floors the total. `sell` pays exactly that.
- **Validation:** sale only while the market session is open (standing at the stall); integer qty > 0; never more than owned; only items with a price are sellable (seeds are not).
- **History:** every sale is a `sell:<item>` transaction in the central history; the panel shows the latest.
- **Design invariant (tested on data):** for every variety, green beans are worth more than the cherries they came from, and roasted beans more than the green.

## 15. Shared inventory & shop sessions (M3)
- One inventory (`economy.inventory`) holds seeds, cherries, green and roasted beans; the café will consume from the same stacks.
- `ShopSessionService` (`src/systems/shop/`) is shared by the seed stall (`seeds`) and the market (`market`). Opening one closes the other; walking more than 2 tiles away closes it.
- **HUD:** the right column is `FarmHud` (top) + `StationHud` (bottom, context: market → selected machine → inventory). Both issue commands only through narrow interfaces (`FarmUiCommands`, `StationUiCommands`).
- **Save schema v2** adds `processing` and `market`; `SAVE_MIGRATIONS[1]` upgrades v1 saves.

## 16. Café floor & customers (M4)
`src/gameplay/cafe/CafeService.ts`, data `data/config/customers.json`, map `data/maps/cafe.json`.
- **Map markers:** `spawn` (street), `exit` (street), `door`, `orderPoint`, `queue[5]`. Seats are the `chair` objects and standing spots the `standing_spot` objects (both non-blocking; since M5 they carry the serve action). Markers are validated walkable at load.
- **Customer FSM** (illegal transitions throw):
  `SPAWNING → ENTERING → (QUEUING) → WALKING_TO_ORDER → ORDERING → WAITING → RECEIVING → TASTING → RATING → LEAVING`.
  `QUEUING` is an addition to the brief's list (standing in line behind the order point). Walking to a seat happens inside `WAITING`.
- **Spawning:** the first customer arrives after `firstDelayMs`, then every `min..maxIntervalMs`, capped at `maxConcurrent`. Archetype and drink are chosen with a seeded RNG (weights from data), so tests are deterministic.
- **No teleporting:** customers spawn on the street and move with `Actor.stepMovement` along A* paths at their archetype speed. A test asserts per-tick displacement ≤ speed × dt for every customer over 3 minutes.
- **Queue:** FIFO; index 0 walks to the order point, others stand on queue tiles and step forward as the line moves. A full queue (1 + 5) turns arrivals away (`queueFull`).
- **Seats:** taking an order reserves a free seat (else a standing spot) for that customer; reservations are unique and released on departure. With nothing free the order can't be taken (`noSeat`) and the customer keeps waiting (patience still runs).
- **Patience:** order patience runs from joining the queue until the order is taken; drink patience runs from acceptance until serving. Expiry → `impatient` (order CANCELLED) or `timeout` (order FAILED), then the customer walks out.
- **Blocked paths / stuck:** paths are retried every `retryPathMs`; after `giveUpBlockedMs` the customer leaves (`blocked`). A customer that doesn't move for `stuckCheckMs` repaths, up to `maxRepaths`. If even the exit is unreachable, the customer is removed with `customer:removed` rather than staying forever. A 20-minute fuzz checks that nobody outlives their total patience.
- **Satisfaction** (placeholder until M6 ratings): failures = 10; otherwise 100 − 40 × queue-wait share − 40 × drink-wait share.
- Customers and orders are **transient**: they are not saved. Leaving the café ends them.

## 17. Orders (M4)
`src/gameplay/cafe/OrderService.ts`, recipes in `data/config/recipes.json` (Espresso, Americano, Latte, Cappuccino, Cà phê sữa đá).
- **Order:** customer id, recipe id, ingredients (by exact item, by category such as any roasted bean, or a utility such as tap water), created time, time limit (= the customer's drink patience), expected quality, reward (base price + EXP), status, status history with reasons.
- **Transition table:** `CREATED → ACCEPTED | CANCELLED`; `ACCEPTED → PREPARING | FAILED | CANCELLED`; `PREPARING → READY | FAILED | CANCELLED`; `READY → SERVED | FAILED | CANCELLED`; `SERVED → COMPLETED`; terminal states never change. Illegal transitions are refused (`illegalTransition`), not thrown.
- **Taking orders:** the `order_counter` can only be used from its north side (behind the counter). The action succeeds only when a customer is ordering at the order point *and* a seat or standing spot is free.

## 18. Travel & scene lifecycle (M4)
- `travel_sign` objects carry `props.map`. Using one emits `world:travelRequested`.
- The world scene performs travel at the **start of the next frame**: `prepareTravel` (cancel actions, commit state, set `player.map` to the destination), save, stop the HUD, restart the world scene with the new map. Shutdown flushing is skipped during travel so it can't overwrite the destination.
- Opening the game without `?map=` resumes the saved map (farm for a new game). `?map=sandbox` is never saved.
- **Phaser reuses scene instances on restart:** scenes must reset per-run fields in `create()`. HUD panels and hover state are reset explicitly.

## 19. Brewing (M5)
`src/gameplay/cafe/BrewingService.ts`, steps in `data/config/recipes.json`, options in `data/config/brewing.json`.
- **Stations** (café, behind the counter, used from their south side): `grinder`, `cafe_espresso`, `milk_station`. Each recipe step names the station *type* it happens at.
- **Session:** using the first station starts a session for the **oldest ACCEPTED order** (FIFO); the order becomes PREPARING. Steps run in order; using a station "arms" its step. Consecutive steps at the same station arm automatically. Using the wrong station fails with `wrongStation`.
- **Step kinds:**
  - `choose_bean`: pick one owned roasted bean; 1 unit is consumed immediately (`brew:bean:<order>` transaction).
  - `choose_addition`: milk / condensed milk (consumed) or water (free). A choice other than the recipe's `correct` one lowers recipe accuracy. A missing item is refused (`noIngredient`).
  - `timing`: a needle moves 0→1→0 (triangle wave, `periodMs`) on **simulation time**. Pressing records `accuracy = 1` inside `target ± tolerance`, falling linearly to 0 at `zeroAt` (0.35) beyond it.
- Step commands only work while the player stands at that step's station (`notAtStation`).
- **Drink:** `performance` = mean timing accuracy; `recipeAccuracy` = share of correct choices; `quality = 0.5 × beanQuality + 0.5 × performance × 100`; `readyAt` = sim time. It goes into the player's hands (`CARRYING`); the order becomes READY.
- **Cancel:** the session ends, used ingredients are lost (never refunded or reused), and the order goes back to ACCEPTED (`PREPARING → ACCEPTED` was added to the order table for this).
- **Customer gives up:** the session aborts; a finished drink for that order is discarded from the player's hands automatically (no stuck hands).
- The player FSM gained `IDLE ⇄ CARRYING` (an item can appear in or leave the hands while standing, e.g. when the brewing panel finishes a drink).

## 20. Serving & payment (M5)
- Chairs and standing spots (`standing_spot` objects, replacing the M4 `waitSpots` markers) have a `serve` action. Clicking a **customer** routes to their spot (or to the order counter if they are ordering there).
- **Validation (`canServe`):** holding a drink; a customer reserved that spot; the drink's order is *that* customer's order (`wrongCustomer` otherwise); the customer is WAITING and already seated; the order is READY.
- **Serve:** order READY → SERVED; the drink leaves the player's hands (so it can't be served twice); the customer goes RECEIVING → TASTING → RATING.
- **Settle:** when rating ends, a `RatingPolicy` decides coins + EXP (M5: the recipe's base price and EXP). Payment uses idempotency key `order:<id>:paid`; the order becomes COMPLETED; the customer leaves (`served`).

## 21. Supplies & café HUD (M5)
- `supply_shelf` opens the `supplies` shop session; `SupplyService.buy` sells milk (5) and condensed milk (6) through `TransactionService`.
- `CafeHud` (placeholder) shows coins and stock, open orders, the brewing panel (progress, next station, bean/addition buttons, timing bar with target zone, Stop/Space, Cancel), supply buttons at the shelf, and recent outcomes. It issues only `CafeUiCommands`.

## 22. Customer ratings (M6)
`src/gameplay/cafe/RatingService.ts`, data `data/config/progression.json` (`rating`, `reputation`).
- **Score 0–100** = 40% recipe accuracy + 25% bean quality + 20% brewing performance + 15% serving time (weights in data, validated to sum to 1):
  - *recipe accuracy* = share of correct ingredient choices × 100;
  - *bean quality* = the bean stack's quality, +10 if it is the recipe's preferred bean (cap 100);
  - *brewing performance* = mean timing accuracy × 100;
  - *serving time* = 100 while served within 25% of the customer's drink patience (from order accepted to served), then linearly down to 0 at 100%.
- **Stars:** thresholds 0 / 40 / 55 / 70 / 85 → 1–5★.
- **Feedback** (deterministic rules, thresholds in data):
  - *Sai món*: any wrong ingredient choice;
  - *Đắng quá*: the extract needle stopped > 0.08 past target;
  - *Ngọt quá*: condensed milk by mistake, or a sweet recipe's pour > 0.10 past target;
  - *Cà phê nguội*: served > 45 s after the drink was ready;
  - *Phục vụ chậm*: served after 60% of patience;
  - *Thơm tuyệt*: preferred bean of quality ≥ 80;
  - *Ngon tuyệt*: 4★+ with no complaint.
- **Pay:** `round(base × [0.6, 0.8, 1.0, 1.15, 1.3][★])` + tip `round(base × [0, 0, 0, 10%, 25%][★] × (1 + (reputation − 3) × 0.1))`. **EXP:** base × [0.5, 0.75, 1, 1.25, 1.5][★]. Paid once through `TransactionService` (key `order:<id>:paid`).
- **History:** every rating is stored in `state.cafe.feedback` (last 50: stars, score, components, feedback, coins, tip, EXP) and shown in the HUD.

## 23. Reputation & traffic (M6)
- Reputation = average of the last 20 ratings (starts at 3★). Customers who leave unhappy (`impatient`, `timeout`, `queueFull`) count as **1★**; a blocked path does not (map problem, not service).
- **Traffic:** spawn intervals are divided by `clamp(0.6, 1.45, 1 + (reputation − 3) × 0.15)`, so a 5★ café sees ~30% more customers and a 1★ café ~30% fewer. This is tested with the same RNG seed at 5★ vs 1★.
- **Tips** scale with reputation (see §22). Stats `served` / `failed` are saved.

## 24. Levels & unlocks (M6)
`src/gameplay/progression/ProgressionService.ts`.
- Level from total EXP: level *L* starts at `50 × L × (L − 1)` EXP (0, 100, 300, 600, 1000…). EXP comes only through `TransactionService` (harvests, processing, served drinks).
- `progression:levelUp` fires once per level gained.
- **Unlocks:** recipes (`recipeUnlockLevel`: espresso / americano / cà phê sữa đá at 1, latte at 2, cappuccino at 3). Customers only order unlocked recipes; if none of their favourites is unlocked they pick any unlocked one. Seeds follow `seeds.json unlockLevel` (Culi at 3); `buySeeds` refuses with `levelTooLow`, and the HUD shows "Cần cấp 3".

## 25. Furniture & decoration (M7)
`src/gameplay/decor/FurnitureService.ts`, data `data/config/furniture.json`, map field `decor.area`.
- **Catalog:** chair (seat), armchair (seat, comfort 10), round table, long table (2×1, comfort 4), plant (decor 4), floor lamp (comfort 3, decor 6), bookshelf (2×1, decor 12). Prices 40–160. Armchair, long table and lamp unlock at level 2, the bookshelf at 3 (`buy` refuses with `locked`).
- **Furniture is an inventory item while unplaced** (`furn_*`, category `furniture`), so buying, placing and storing all go through `TransactionService`:
  - *buy*: one transaction, coins out + 1 item in (`buyFurniture:<type>`);
  - *place*: validated first, then 1 item out (`placeFurniture:<type>`) in the same step the object appears;
  - *store*: 1 item back in (`storeFurniture:<type>`); refused if the bag is full or the seat is reserved.
- **The starting tables, chairs and plants are furniture too.** A map's JSON furniture is its starting layout. The first edit saves the whole layout in `state.decor.layouts[mapId]`; from then on the saved layout replaces the map's own furniture (nothing is added back on load). New pieces get ids `f<n>` (`decor.nextId`).
- **Load safety:** each saved piece is re-validated when the map loads. A piece that no longer fits (map data changed) goes back to the bag (`decor:returned`) instead of vanishing.
- **Save schema v4** adds `decor: { layouts, nextId }`; `SAVE_MIGRATIONS[3]` starts it empty, so v3 saves keep the starting café.
- **Bonuses** (from what is placed, each capped at 60):
  - `patienceFactor = 1 + comfort × 0.005` multiplies a **new** customer's order and drink patience, and therefore the order's time limit and the M6 serving-time yardstick;
  - `trafficFactor = 1 + decor × 0.005` divides the time between arrivals, on top of M6 reputation;
  - seats are every object with the `cafe.serve` action.
  The starting café has comfort 0 and decor 8 (two plants), i.e. +4% traffic.

## 26. Placement validation & navigation rebuild (M7)
`FurnitureService.check(type, at, rotation, movingId)` returns the first failing rule:

| Reason | Rule |
|---|---|
| `outOfArea` | every footprint tile inside `decor.area` and on walkable terrain (café floor `x 1–12, y 5–11`; never behind the counter, in walls or on the street) |
| `overlap` | no other object on any tile, including non-blocking chairs and standing spots (a piece being moved doesn't collide with itself) |
| `reservedTile` | no AI marker tile (spawn, exit, door, order point, queue) |
| `occupied` | nobody (player or customer) standing on the footprint |
| `seatInUse` | a seat a customer has reserved can't be picked up, moved or stored |
| `blocksPath` | on a **copy** of the nav grid with the piece in its new place, flood-filled from the street spawn: every marker, the player start, every person's tile, every seat tile and at least one approach tile of **every** interactive object (stations, counter from its north side, shelf, travel sign, seats) must stay reachable. An object left with no approach tile at all counts as blocked |
| `invalidRotation`, `unknownFurniture`, `notOwned` | data / inventory checks |

- A check never touches the live grid (`NavGrid.clone()`), so the ghost can be validated every frame.
- **Commit:** a move is `removeObject` + `addObject` with the same id, so blocker counts stay exact (a fuzz test compares the grid with the objects after 300 random operations). Then `decor:changed` fires and the simulation:
  - cancels player intents that targeted a moved/stored object (`onObjectRemoved`);
  - re-plans the player's walk or approach from where they stand (`InteractionService.onNavChanged`);
  - rebuilds the café's seat list (`CafeService.refreshSpots`; reserved spots are always kept);
  - makes every walking customer re-plan from where they stand (`CafeService.onNavChanged`).

## 27. Decorate mode (M7)
- `FurnitureService.enter/exit` is a mode, not a scene (S13). Entering needs a free player (`playerBusy` while an interaction runs or is queued); a plain walk is stopped. Travel leaves the mode.
- While active, `GameSimulation.clickTile/clickObject` go to the decorator: with a selection, a click confirms it at the floor tile under the pointer; without one, clicking furniture picks it up for moving. Customers can't be clicked. Esc / right click (`cancel`) drops the selection, then exits.
- **Selection:** `selectToPlace(type)` (needs one in the bag) or `pick(objectId)`; `rotate()` turns it a quarter; `hover(tile)` positions the ghost; `confirm(tile)`; `storeSelected()`. Failures emit `decor:rejected` (red text at the tile) and keep the selection.
- **Snapshot `decor`:** active, selection, preview `{ footprint, valid, reason }`, placed layout, owned counts, bonuses, area. `null` on maps without a decor area (farm).
- **UI (placeholder):** `DecorHud` (catalog with buy/place, selection with rotate/store/deselect, bonus scores and effects) takes the café panel's slot. `DecorPresenter` redraws changed objects and draws the area grid and the green/red ghost through `WorldRenderer.setDecorArea / setPlacementPreview`. While decorating, the world scene follows the pointer every frame (Phaser can drop the first move after a HUD click). **R** rotates.
