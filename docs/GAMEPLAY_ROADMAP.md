# Gameplay Roadmap (authoritative)

> **Status:** v1.0 · 2026-10-26 · branch `dev`
> **Supersedes** the milestone list in [production/MILESTONES_AND_BACKLOG.md](production/MILESTONES_AND_BACKLOG.md). The art track there still applies, but it runs *after* gameplay ("gameplay first, art later").
> Systems: [GAMEPLAY_SYSTEMS.md](GAMEPLAY_SYSTEMS.md) · Tests: [GAMEPLAY_TEST_PLAN.md](GAMEPLAY_TEST_PLAN.md) · Art swap: [ASSET_REPLACEMENT_GUIDE.md](ASSET_REPLACEMENT_GUIDE.md)

## Rules
- All rendering is placeholder (shapes, labels, debug panels) until M12 is done.
- A milestone is **done** only when: `npm run typecheck`, `npm run build`, `npm test` and `npm run e2e` all pass; the playable flow has been demonstrated; this file is updated.
- The next milestone starts only when the current one works end to end.

## Milestones

| # | Milestone | Status | Exit criteria (summary) |
|---|---|---|---|
| **M1** | Core engine, movement, interactions | **Done 2026-10-26** | Click/tap-to-move, A*, collision, auto-approach, interaction queue, cancellation, 5 player states, click-what-you-see hit-testing, render adapter. 41 unit + 8 E2E tests pass |
| M2 | Full farming loop | Next | Plot FSM `EMPTY→PREPARED→PLANTED→GROWING→READY→HARVESTED`; locked land + purchase; watering; timestamp growth that survives reload; harvest → inventory |
| M3 | Processing, selling, shared inventory | — | Cherries → green → roasted with equipment, time, capacity and quality; market sell by quantity; transaction history; one inventory |
| M4 | Customer AI & orders | — | Customer FSM `SPAWNING→…→LEAVING`; queue; patience; order FSM `CREATED→…→COMPLETED` + `FAILED/CANCELLED` |
| M5 | Brewing mini-game & serving | — | 5 recipes; grind / portafilter / extract / add / finish steps scored; ingredients consumed; carry → serve once |
| M6 | Ratings, economy, progression | — | Rating 40/25/20/15; feedback text + history; reputation → traffic/tips; XP/levels; central transaction service |
| M7 | Furniture & decoration | — | Buy, preview, validate, rotate, place, move, remove; nav grid rebuild; real bonuses |
| M8 | Employees | — | Barista/Cashier/Server/Farm worker with task assignment + FSM, using the same interaction system as the player |
| M9 | Playable rebirth story | — | Scenes 03/04/05 with click-to-move objectives (no joystick), tutorial uses M5 brewing |
| M10 | World map, quests, expansion | — | Locations, districts, branches, quests, achievements, skills, recipe unlocks (placeholder UI) |
| M11 | Save/load robustness | — | Versioned saves, migration, corruption handling, no duplicates from reload |
| M12 | Integration & bug fixing | — | All 20 final acceptance criteria from the brief pass |

## M1 report (2026-10-26)
- **Playable flow:** `npm run dev` → http://localhost:5180. Click the floor to walk. Click the coffee machine to brew a test cup, then click a table to place it (or click both in a row to queue them). Esc or right-click cancels. The fenced statue shows the unreachable case.
- **Evidence:** [walking around obstacles with a queued action](screenshots/m1-walking.png) · [working at the machine (progress bar, debug panel)](screenshots/m1-working.png) · [idle](screenshots/m1-idle.png) · [front-wall cutaway](screenshots/m1-southwall.png)
- **Delivered:** see GAMEPLAY_SYSTEMS §2–§6.
- **Not in M1 (by design):** inventory, currency, saving, customers, farming. The machine/table/crate/shelf actions are **sandbox test actions** that prove the interaction framework; they are not economy features.
- **Known issues:** see GAMEPLAY_TEST_PLAN §5.
- **M2 unblocked:** yes. Farming adds `farm.*` action handlers and a plot model on top of the M1 interaction and navigation services.
