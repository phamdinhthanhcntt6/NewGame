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
