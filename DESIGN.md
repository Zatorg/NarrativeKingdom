# Narrative Kingdom Management — Design & Reference

A Foundry VTT **v14** module for **PF2e** that reworks the Kingmaker *Kingdom* subsystem to
be lighter (fewer dice, less bookkeeping) while **keeping army/warfare combat** by delegating
it to PF2e's own army actors. This file is the durable reference for design decisions, data
model, and dev workflow.

Module id: **`narrative-kingdom`** (deployed under that name; do **not** rename — the world's
compendium UUIDs and saved settings are keyed to it).

---

## Architecture (file layout)

The former 1863-line mega-file was split into:

| File | Role |
|---|---|
| `scripts/constants.mjs` | `MODULE_ID` only |
| `scripts/kingdom-data.mjs` | Data model, constants, pure helpers, **schema migration** |
| `scripts/kingdom-app.mjs` | The `KingdomApplication` (ApplicationV2 sheet): render/context, listeners, save API + Handlebars helpers |
| `scripts/kingdom-actions.mjs` | The sheet's action handlers (`on*`) + their shared helpers, invoked with `this` = the app |
| `scripts/narrative-kingdom.mjs` | Thin entry point: settings/partials registration, migration run, socket handler, sidebar buttons, render hooks |
| `scripts/camping.mjs` | Camping/travel `CampingApplication` |
| `scripts/hex-coloring.mjs` | Hex exploration coloring layer |
| `scripts/kingdom-events-catalog.mjs` | `KINGDOM_EVENTS_CATALOG` (event content) |

Templates: `templates/kingdom-sheet.hbs` (host) + `templates/partials/*.hbs` registered under
short aliases (`nk-turn-tab`, `nk-projects-tab`, …). Styles: `styles/narrative-kingdom.css`
(palette CSS vars are scoped to `.narrative-kingdom` — elements appended to `<body>`, e.g. the
skill autocomplete, must re-declare the vars they need).

### Data persistence & sync
- One world setting `kingdomData` (Object) holds everything; also `catalogData` (Array),
  `campingState` (Object), client `nkFontSize`.
- GM writes directly; non-GMs emit a socket message (`module.narrative-kingdom`) that the GM
  applies. The GM socket handler **validates payloads** (known action + correct data/patch type).
- Three write paths, all **re-applied by the GM onto freshly-read authoritative data** so
  concurrent edits merge instead of clobbering:
  - `patchKingdom` → `applyKingdomFieldPatch` — a single text/checkbox field (id-targeted).
  - `opKingdom` → `applyKingdomOp` — a semantic, id-targeted **operation** (currently the
    project actions: `add-project`, `remove-project`, `roll-project`, `leader-act`). e.g. one
    player rolling their project can't overwrite another player's concurrent skill edit.
  - `saveKingdom` — full snapshot; still used by the remaining GM-driven button actions
    (events, settlements, armies, leaders, turn). *Follow-up:* extend `applyKingdomOp` to
    those subsystems to remove the last last-writer-wins windows.
- Non-GMs also apply the patch/op to a local `#pendingKingdom` for an optimistic UI, cleared
  on the `updateSetting` hook once the authoritative write echoes back.

### Schema versioning (`kingdom-data.mjs`)
- `KINGDOM_DATA_VERSION` (currently **6**) + `migrateKingdom(kingdom)` — additive, idempotent,
  guarded. Runs once on `ready` (GM authors the write).
- Migrations: v1 structural back-fill · v2 `recruitCredits` · v3 army settings
  (`armyTierFactor`, `recruitDcStep`) · v4 event settings (`eventThreshold`, `eventDecayPerTurn`) ·
  v5 `turn.active` (a mid-turn save under the old always-running model is treated as active) ·
  v6 `factions` (faction relations / reputation tracker) ·
  v7 per-settlement `structures` (structures / landmarks list).
- **Verified:** a genuine pre-versioning (v0) save with running events migrates to v4 cleanly,
  keeping the events. Backups from before this project restore fine.

---

## Core mechanics

### Turn loop
Event → Leader Projects → The Week (7 days). "One week per month" managing the kingdom;
absent leaders cost 1 XP each.

### Projects (the activity engine)
Each leader may hold up to 3 projects, one per complexity (**4 / 6 / 10** segments). Roll a PC
skill vs the **kingdom-level DC**, click the degree: Crit +2, Success +1, Failure 0, Crit-Fail −1
segments. Completing awards XP (1/2/3 by complexity). No dice are rolled *by the module* — the
player rolls on their own sheet and clicks the outcome. Projects have an optional `dcBonus`
(mandatory offset, e.g. the recruit penalty) separate from the player-chosen difficulty.

### Leveling / XP
XP threshold = `xpPerLeader (5) × peak leader count`. Threshold locks when set, resets on
level-up (anti-gaming). Kingdom level capped by claimed hexes unless `ignoreHexCap`.

### Armies (recruit economy) — combat stays in PF2e
Armies are links to PF2e **army-type actors** (`{id, actorUuid, name, notes}`); the module governs
*raising/growing/moving/affording*, not combat.
- **Actions are leader projects:** Move **4** / Train **6** / Outfit **6** / Recruit **10**.
  Results are applied by the GM on the PF2e army sheet. **Train = add/change a feat** (army level
  is the kingdom level, not leveled independently — a mismatch flag shows if an army's sheet drifts).
- **Free allowance** = `max(1, round(Σ settlement tiers × armyTierFactor))`; tiers
  Village 1 / Town 2 / City 3 / Metropolis 4; `armyTierFactor` default **0.4**.
- **Recruit DC** = level DC + `max(0, (Nth army − allowance)) × recruitDcStep`; `recruitDcStep`
  default **2**, recruit-only, **uncapped** (self-limiting soft cap; eases as the kingdom grows).
- **Recruit gate:** finishing a Recruit project earns a credit; adding an army spends one
  (GM can override). `kingdom.recruitCredits`.
- Default project skills (character skills, editable): Move `Warfare Lore, Survival` ·
  Train `Warfare Lore, Athletics` · Outfit `Crafting, Warfare Lore` · Recruit `Diplomacy, Warfare Lore`.

### Kingdom Events v2
10-segment green/red clock. Rolls: Crit ±2, Success/Fail ±1 (green = successes, red = failures).
- **Decisive threshold** (`eventThreshold`, default **7**): green ≥ 7 → **Success** (3 XP);
  red ≥ 7 → **Failure** (3 XP); clock fills with neither decisive → **Neutral** fizzle (1 XP).
  (5/5 is Neutral — the old "green ≥ red tie = success" was too lenient.)
- **End-of-turn decay** (`eventDecayPerTurn`, default **1**): when the GM **ends a turn**, each
  still-unresolved event gains red and can **auto-resolve** (Failure at threshold, else Neutral).
  Resolve events before ending the turn to avoid it.

### Turn lifecycle
- A turn is explicitly **GM-run**: `turn.active` gates it. **Start New Turn** (GM, only when no turn
  is active) begins one; **End Turn** (GM, only when active) ends it (applies decay, records history).
  Start/end, day advancement, and event setup (trigger/skip) are GM-only (handler guards + hidden
  buttons); players still roll their own projects and events.
- In-progress projects/events carry across turns untouched; only *finished* ones are cleared at the
  next Start New Turn.
- **Outcome text is split**: `outcomes[band] = { rp, gm }`. `rp` = narrative shown to **everyone**
  on resolution; `gm` = mechanics shown **only to the GM**. `normalizeOutcome()` treats a legacy
  plain string as **GM-only** (so old saves never leak mechanics to players).
- Rewards use **Earn Income at the kingdom's level**. The Events tab shows a live reference line
  (`EARN_INCOME_PER_DAY` table): L13 ≈ 7 gp/day, 49 gp/week per leader (estimate; varies by proficiency).

### GM Settings (Settings tab, tunable live)
`xpPerLeader`, `ignoreHexCap`, `armyTierFactor`, `recruitDcStep`, `eventThreshold`, `eventDecayPerTurn`.
Add new ones by: default in `defaultKingdom().settings` → migration bump → `applyKingdomFieldPatch`
case → `settings-tab.hbs` input (name `settings-<key>`).

### Also present
Settlements (Village→Metropolis stage clocks), Benefits (level-gated passives), Ongoing Effects
(timed bonuses/penalties, Notes tab), Camping/Travel, Hex coloring, JSON export/import, event
catalog editor.

---

## Combat balance (from Monte-Carlo simulation)
Model: 1v1 = Bradley-Terry on power `2^(level/2)` (even = 50%, +2 levels ≈ 2:1 ≈ 67%); battles are
front-line duels.
- **Level dominates numbers:** a +2 kingdom-level gap ≈ needs **~2× the armies** to reach even odds;
  +4 is near-unwinnable by numbers alone.
- **Numbers are gradual & self-limiting:** at even level ~5 v 3 ≈ 78–92%; the settlement-tier
  allowance + recruit-DC ramp stop a runaway army-spam snowball.
- **Movement (≤3 hexes/turn)** lets an underdog win by *defeat in detail* (never facing the whole enemy).
- **Pitax war (Ch. 8a):** designed for a **level-13** kingdom, fought as separate "Severe 13"
  encounters (piecemeal) — **engaging and winnable** for the current L13 kingdom (4–5 armies),
  especially with PCs joining battles + Ilora's +1 intel + diplomacy. Don't get caught outnumbered
  on defense; never let Pitax concentrate its full host.

---

## Dev workflow
- **Deploy:** the Foundry v14 modules dir contains a **junction** `narrative-kingdom` →
  `D:\Projects\NarrativeKingdom`, so the repo *is* the live module.
- **Test a change:** edit → **F5** in the Foundry tab (Foundry doesn't hot-reload scripts). Settings
  changes re-render on save without a reload.
- **Syntax check** scripts with `node --check scripts/<file>.mjs` before reloading.
- **Data-safety when testing:** snapshot `kingdomData`, mutate, verify, then restore — always.
  (One early slip flipped the turn view without a snapshot; be disciplined.)
- **Login:** the assistant cannot type passwords; the user logs in / uses a passwordless GM, then hands off.

### Compendium build pipeline
The compendium pack is **JSON source** (committed) → built LevelDB (gitignored):
- Source of truth: `packs-source/camping-effects/*.json`. Built pack: `packs/` (**gitignored**).
- `npm run unpack` (LevelDB → JSON) / `npm run pack` (JSON → LevelDB), via `@foundryvtt/foundryvtt-cli`
  (`tools/packs.mjs`). Run with the **world closed** (LevelDB single-writer lock).
- Fresh clone / release: `npm install && npm run pack` to generate `packs/`.

---

## Current state / in progress
- **Event v2** mechanic + RP/GM split + Earn Income are **done and committed** but **not pushed**
  (held at the user's request). Commits: `f50ea6c` (3-outcome + decay), `6a5b2b2` (RP/GM + Earn Income + 3 samples).
- **Event catalog rework — IN PROGRESS.** Format approved via 3 samples (Archaeological Find,
  Assassination Attempt, Bandit Activity). **~41 events remain** to convert to
  `{ rp, gm }` + neutral, Earn Income at kingdom level, PF2e-actionable GM lines
  (items by level, `@UUID` conditions, module Ongoing Effects for lingering penalties,
  "re-add event" for recurrence). Neutral gradient: Beneficial → partial benefit; Dangerous →
  contained-not-solved (no reward, may recur).
- **Known follow-ups:** extend the op channel (`applyKingdomOp`) beyond projects to events /
  settlements / armies / leaders so no non-GM action sends a full snapshot. _(Done: camping
  dead-code cleanup; `kingdom-app.mjs` handlers split into `kingdom-actions.mjs`; op-based sync
  for project actions so concurrent skill edits aren't clobbered. Army-level-gap cap dropped —
  no combat-rule changes.)_
