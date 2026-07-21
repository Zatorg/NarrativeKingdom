/**
 * Narrative Kingdom — action handlers and their shared helpers.
 * Extracted from kingdom-app.mjs. Each on* handler is invoked by the
 * KingdomApplication actions map (or a drop listener) with `this` bound to the
 * app instance, so they read the app via `const app = this` exactly as before.
 */
import { MODULE_ID } from "./constants.mjs";
import {
  eventCatalog, PROJECT_XP, SETTLEMENT_THRESHOLDS, SETTLEMENT_NEXT_STAGE, KINGDOM_BENEFITS,
  getKingmakerClaimedHexes, hexesForLevel, hexLevelCap, getPf2eDate, xpMultiplier,
  LEVEL_DC, DC_ADJUSTMENTS, effectiveMaxLevel, clampXp, applyKingdomFieldPatch, defaultKingdom,
  armyAllowance, recruitPenalty, eventOutcome, normalizeOutcome, resolveEvent, parseEventLevelMod, clampReputation, EARN_INCOME_PER_DAY,
} from "./kingdom-data.mjs";

// V14 compat: TextEditor moved to foundry.applications.ux.TextEditor.implementation
const TextEditor = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;

export async function onLeaderDrop(event) {
    event.preventDefault();
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    if (data.type !== "Actor") {
      ui.notifications.warn("Only actors can be dropped as leaders.");
      return;
    }
    const actor = await fromUuid(data.uuid);
    if (!actor) return;

    const kingdom = foundry.utils.deepClone(this.kingdom);
    kingdom.leaders ??= [];
    if (kingdom.leaders.some(l => l.actorUuid === data.uuid)) {
      ui.notifications.warn(`${actor.name} is already a leader.`);
      return;
    }
    kingdom.leaders.push({
      name: actor.name,
      actorUuid: data.uuid,
      role: "",
      attendedTurn: true,
      notes: "",
      projects: [],
    });
    kingdom.peakLeaderCount = Math.max(kingdom.peakLeaderCount ?? 0, kingdom.leaders.length);
    kingdom.xpToNextLevel = kingdom.peakLeaderCount * xpMultiplier(kingdom);
    await this.saveKingdom(kingdom);
  }
export async function onStartNewTurn() {
    if (!game.user.isGM) return;
    const app = /** @type {KingdomApplication} */ (this);
    const kingdom = foundry.utils.deepClone(app.kingdom);
    if (kingdom.turn?.active) return; // a turn is already in progress — end it first

    kingdom.turnNumber = (kingdom.turnNumber ?? 0) + 1;

    // Finished work from the previous turn is cleared; in-progress projects and
    // events (their clocks) carry over untouched.
    for (const leader of kingdom.leaders) {
      leader.projects = (leader.projects ?? []).filter(p => !p.complete);
    }
    kingdom.activeEvents = (kingdom.activeEvents ?? []).filter(e => !e.resolved);

    // Expire ongoing effects whose turn has come (removed when the new turn begins).
    if (kingdom.ongoingEffects?.length) {
      kingdom.ongoingEffects.forEach(e => { if (e.turnsRemaining != null) e.turnsRemaining -= 1; });
      const expired = kingdom.ongoingEffects.filter(e => e.turnsRemaining != null && e.turnsRemaining <= 0);
      kingdom.ongoingEffects = kingdom.ongoingEffects.filter(e => !expired.includes(e));
      if (expired.length) {
        ui.notifications.info(`${expired.length} ongoing effect(s) expired: ${expired.map(e => e.name).join(", ")}.`);
      }
    }

    kingdom.turn = {
      active: true,
      phase: "event",
      currentDay: 0,
      projectPhaseComplete: false,
      eventPhaseComplete: false,
      absentCount: 0,
      completedProjects: [],
      completedEvents: [],
      eventName: null,
    };
    kingdom.leaders.forEach(l => { l.attendedTurn = true; l.lastActedDay = 0; });
    await app.saveKingdom(kingdom);
  }

export async function onEndTurn() {
    if (!game.user.isGM) return;
    const app = /** @type {KingdomApplication} */ (this);
    const kingdom = foundry.utils.deepClone(app.kingdom);
    if (!kingdom.turn?.active) return; // no turn in progress

    // Events left unresolved at turn's end worsen: each gains red and may
    // auto-resolve (Failure if red hits the threshold, else Neutral once full).
    const decay = kingdom.settings?.eventDecayPerTurn ?? 1;
    const threshold = kingdom.settings?.eventThreshold ?? 7;
    const worsened = [];
    if (decay > 0) {
      for (const ev of kingdom.activeEvents ?? []) {
        if (ev.resolved) continue;
        const size = ev.clockSize ?? 10;
        ev.redFilled = Math.min(size, (ev.redFilled ?? 0) + decay);
        const outcome = eventOutcome(ev.greenFilled ?? 0, ev.redFilled ?? 0, size, threshold);
        if (outcome) { resolveEvent(kingdom, ev, outcome); worsened.push(`${ev.name} → ${outcome}`); }
      }
    }
    if (worsened.length) ui.notifications.warn(`Unresolved event(s) worsened at turn's end: ${worsened.join(", ")}.`);

    await recordTurnHistory(kingdom, kingdom.turn.eventName ?? "—");
    kingdom.turn.active = false;
    await app.saveKingdom(kingdom);
  }

export async function onCompleteProjectPhase() {
    if (!game.user.isGM) return;
    const app = /** @type {KingdomApplication} */ (this);
    const kingdom = foundry.utils.deepClone(app.kingdom);
    const absent = kingdom.leaders.filter(l => !l.attendedTurn).length;
    kingdom.turn.projectPhaseComplete = true;
    kingdom.turn.absentCount = absent;
    if (absent > 0) {
      kingdom.xp = Math.max(0, (kingdom.xp ?? 0) - absent);
      ui.notifications.warn(`${absent} leader(s) were absent. Kingdom loses ${absent} XP.`);
    }
    await app.saveKingdom(kingdom);
  }

export async function onBeginWeek() {
    if (!game.user.isGM) return;
    const app = /** @type {KingdomApplication} */ (this);
    const kingdom = foundry.utils.deepClone(app.kingdom);
    const absent = kingdom.leaders.filter(l => !l.attendedTurn).length;
    kingdom.turn.projectPhaseComplete = true;
    kingdom.turn.absentCount = absent;
    kingdom.turn.phase = "week";
    kingdom.turn.currentDay = 1;
    if (absent > 0) {
      kingdom.xp = Math.max(0, (kingdom.xp ?? 0) - absent);
      ui.notifications.warn(`${absent} leader(s) were absent. Kingdom loses ${absent} XP.`);
    }
    await app.saveKingdom(kingdom);
  }

export async function onAdvanceDay() {
    if (!game.user.isGM) return;
    const app = /** @type {KingdomApplication} */ (this);
    const kingdom = foundry.utils.deepClone(app.kingdom);
    const day = kingdom.turn.currentDay ?? 1;
    if (day >= 7) {
      kingdom.turn.phase = "complete";
      kingdom.turn.currentDay = 7;
      ui.notifications.info("The kingdom turn week is complete!");
    } else {
      kingdom.turn.currentDay = day + 1;
    }
    await app.saveKingdom(kingdom);
  }

export async function onTriggerEvent() {
    if (!game.user.isGM) return;
    const app = /** @type {KingdomApplication} */ (this);
    app.activeTab = "events";
    const kingdom = foundry.utils.deepClone(app.kingdom);
    kingdom.turn.phase = "projects";
    kingdom.turn.eventPhaseComplete = true;
    await app.saveKingdom(kingdom);
    await onAddRandomEvent.call(app);
  }

export async function onSkipEvent() {
    if (!game.user.isGM) return;
    const app = /** @type {KingdomApplication} */ (this);
    const kingdom = foundry.utils.deepClone(app.kingdom);
    kingdom.turn.phase = "projects";
    kingdom.turn.eventPhaseComplete = true;
    kingdom.turn.eventName = "No event";
    await app.saveKingdom(kingdom);
  }

export async function onAddProject(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const btn = event.target.closest("[data-action]");
    const leaderIndex = parseInt(btn.dataset.leaderIndex);
    const select = btn.closest(".nk-add-project").querySelector(".nk-complexity-select");
    const complexity = parseInt(select?.value ?? 4);

    // Op (not a full-snapshot save) so a concurrent skill/notes edit on another
    // project isn't clobbered. The id is generated here so the optimistic local
    // copy and the GM's authoritative copy agree.
    const info = await app.applyOp({ type: "add-project", leaderIndex, complexity, id: foundry.utils.randomID() });
    if (info?.ok === false && info.reason) ui.notifications.warn(info.reason);
  }

export async function onRemoveProject(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const projectId = event.target.closest("[data-action]").dataset.projectId;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      content: "Remove this project? This cannot be undone.",
      yes: { label: "Remove" },
      no:  { label: "Cancel" },
    });
    if (!confirmed) return;
    await app.applyOp({ type: "remove-project", projectId });
  }

export async function onRollResult(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const btn = event.target.closest("[data-action]");
    const ali = btn.dataset.actingLeaderIndex;

    const info = await app.applyOp({
      type: "roll-project",
      projectId: btn.dataset.projectId,
      result: btn.dataset.result,
      actingLeaderIndex: ali != null ? parseInt(ali) : null,
    });

    if (info?.completed) {
      ui.notifications.info(`Project "${info.projectName}" complete! Kingdom gains ${info.xp} XP.`);
      if (info.recruit) {
        ui.notifications.info("Recruitment complete — you may now add 1 army (drop its actor on the Armies tab).");
      }
      checkLevelUp(app.kingdom, app);
    }
  }

  /**
   * Turn-tab "Aid/Event" — a leader spends their daily action on aiding another
   * leader or resolving a kingdom event off-sheet. This simply consumes the
   * leader's action for the day (disabling their roll buttons); the actual roll
   * is handled at the table.
   */
export async function onTurnAid(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const leaderIndex = parseInt(event.target.closest("[data-action]").dataset.leaderIndex);
    await app.applyOp({ type: "leader-act", leaderIndex });
  }

export async function onAidProject(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const btn = event.target.closest("[data-action]");
    const projectId = btn.dataset.projectId;

    // Present a dialog to choose the aid result (with One Banner, One Flag benefit)
    const level = app.kingdom.level;
    const hasBanner = level >= 17;

    const result = await foundry.applications.api.DialogV2.prompt({
      content: `
        <p><strong>Aid Activity Result</strong></p>
        ${hasBanner ? '<p><em>One Banner, One Flag: treat result as one degree higher.</em></p>' : ''}
        <select id="aid-result">
          <option value="crit-success">Critical Success (+2 segments)</option>
          <option value="success" selected>Success (+1 segment)</option>
          <option value="failure">Failure (0 segments)</option>
          <option value="crit-failure">Critical Failure (−1 segment)</option>
        </select>`,
      ok: { callback: (event, button) => button.form.querySelector("#aid-result").value },
    });
    if (!result) return;

    // Apply One Banner, One Flag upgrade
    const DEGREES = ["crit-failure", "failure", "success", "crit-success"];
    let effectiveResult = result;
    if (hasBanner) {
      const idx = DEGREES.indexOf(result);
      effectiveResult = DEGREES[Math.min(idx + 1, DEGREES.length - 1)];
    }

    // Reuse the roll-result logic
    const fakeEvent = { target: { closest: () => ({ dataset: { projectId, result: effectiveResult } }) } };
    await onRollResult.call(app, fakeEvent);
  }

export async function onAddEvent(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const kingdom = foundry.utils.deepClone(app.kingdom);
    const level = kingdom.level ?? 1;
    const clockSize = 10;
    let startGreen = 0;
    if (level >= 14) startGreen = 2;
    else if (level >= 7) startGreen = 1;

    // Read picked event from the select in the same section (if triggered from the button).
    let catalogEntry = null;
    if (event?.target) {
      const section = event.target.closest(".nk-add-event");
      const select = section?.querySelector(".nk-event-catalog-select");
      const picked = select?.value;
      if (picked) catalogEntry = eventCatalog().find(e => e.name === picked) ?? null;
    }

    kingdom.activeEvents ??= [];
    kingdom.activeEvents.push(buildActiveEvent(catalogEntry, clockSize, startGreen));
    await app.saveKingdom(kingdom);
  }

export async function onAddRandomEvent() {
    const app = /** @type {KingdomApplication} */ (this);
    if (!eventCatalog().length) {
      ui.notifications.warn("Kingdom event catalog is not yet loaded.");
      return;
    }
    const entry = eventCatalog()[Math.floor(Math.random() * eventCatalog().length)];
    const kingdom = foundry.utils.deepClone(app.kingdom);
    const level = kingdom.level ?? 1;
    const clockSize = 10;
    let startGreen = 0;
    if (level >= 14) startGreen = 2;
    else if (level >= 7) startGreen = 1;
    kingdom.activeEvents ??= [];
    kingdom.activeEvents.push(buildActiveEvent(entry, clockSize, startGreen));
    await app.saveKingdom(kingdom);
  }

  /**
   * Build a new active-event object from a catalog entry (or a blank custom event).
   * @param {object|null} entry  Catalog entry, or null for a blank custom event.
   * @param {number} clockSize
   */
function buildActiveEvent(entry, clockSize, startGreen = 0) {
    const base = {
      id:          foundry.utils.randomID(),
      clockSize,
      greenFilled: startGreen,
      redFilled:   0,
      notes:       "",
      resolved:    false,
      outcomeResult: null,
    };
    if (!entry) {
      return { ...base, name: "New Kingdom Event" };
    }
    return {
      ...base,
      name:        entry.name,
      subtitle:    entry.subtitle    ?? null,
      traits:      entry.traits      ?? [],
      location:    entry.location    ?? null,
      description: entry.description ?? "",
      checks:      entry.checks      ?? [],
      outcomes:    entry.outcomes    ?? null,
      resolution:  entry.resolution  ?? null,
      special:     entry.special     ?? null,
    };
  }

export async function onRemoveEvent(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const btn = event.target.closest("[data-action]");
    const eventId = btn.dataset.eventId;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      content: "Remove this event?",
      yes: { label: "Remove" },
      no:  { label: "Cancel" },
    });
    if (!confirmed) return;

    const kingdom = foundry.utils.deepClone(app.kingdom);
    kingdom.activeEvents = (kingdom.activeEvents ?? []).filter(e => e.id !== eventId);
    await app.saveKingdom(kingdom);
  }

  /**
   * Finalize an event with the given outcome: award XP (3 for success/failure,
   * 1 for a neutral fizzle), record it, and flag the event phase complete.
   */
export async function onEventRoll(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const btn = event.target.closest("[data-action]");
    // Op (not a full-snapshot save) so rolling an event can't clobber a
    // concurrent edit elsewhere in the kingdom.
    const info = await app.applyOp({ type: "event-roll", eventId: btn.dataset.eventId, result: btn.dataset.result });
    if (info?.resolved) {
      const label = info.outcome.charAt(0).toUpperCase() + info.outcome.slice(1);
      ui.notifications.info(`Kingdom Event "${info.eventName}" resolved: ${label} (+${info.xp} XP).`);
      checkLevelUp(app.kingdom, app);
    }
  }

export async function onAddLeader() {
    const app = /** @type {KingdomApplication} */ (this);
    const kingdom = foundry.utils.deepClone(app.kingdom);
    kingdom.leaders ??= [];
    kingdom.leaders.push({
      name: "New Leader",
      role: "",
      attendedTurn: true,
      notes: "",
      projects: [],
    });
    // Track peak simultaneous leader count; re-adding a removed leader never exceeds prior peak.
    kingdom.peakLeaderCount = Math.max(kingdom.peakLeaderCount ?? 0, kingdom.leaders.length);
    kingdom.xpToNextLevel = kingdom.peakLeaderCount * xpMultiplier(kingdom);
    await app.saveKingdom(kingdom);
  }

export async function onRemoveLeader(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const btn = event.target.closest("[data-action]");
    const index = parseInt(btn.dataset.leaderIndex);
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      content: "Remove this leader?",
      yes: { label: "Remove" },
      no:  { label: "Cancel" },
    });
    if (!confirmed) return;

    const kingdom = foundry.utils.deepClone(app.kingdom);
    // Lock threshold before splicing so it never shrinks on removal.
    if (kingdom.xpToNextLevel == null) {
      kingdom.peakLeaderCount = Math.max(kingdom.peakLeaderCount ?? 0, kingdom.leaders.length);
      kingdom.xpToNextLevel = kingdom.peakLeaderCount * xpMultiplier(kingdom);
    }
    kingdom.leaders.splice(index, 1);
    await app.saveKingdom(kingdom);
  }

export async function onResetKingdom() {
    const app = /** @type {KingdomApplication} */ (this);
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      content: "<p><strong>This will permanently erase all kingdom data</strong> — leaders, events, projects, XP, and turn history — and cannot be undone.</p><p>Are you sure?</p>",
      yes: { label: "Reset Everything", icon: "fa-solid fa-trash" },
      no:  { label: "Cancel" },
    });
    if (!confirmed) return;
    await app.saveKingdom(defaultKingdom());
    ui.notifications.info("Kingdom data has been reset.");
  }

  // ─── Catalog Handlers ──────────────────────────────────────────────────────

  /** Build and show the event edit dialog. Returns the edited entry or null. */
async function catalogEditDialog(entry = null) {
    const isNew = entry === null;
    const e = entry ?? {
      name: "", subtitle: "", traits: [], location: null,
      description: "", checks: [], outcomes: {},
      resolution: null, special: null,
    };
    // Normalise each band to { rp, gm } (also upgrades any legacy plain-string outcome).
    const S = normalizeOutcome(e.outcomes?.success);
    const N = normalizeOutcome(e.outcomes?.neutral);
    const F = normalizeOutcome(e.outcomes?.failure);
    const band = (key, label, o) => `
        <fieldset class="nk-cf-outcome">
          <legend>${label}</legend>
          <label class="nk-cf-sub">Player (read aloud)</label>
          <textarea name="${key}Rp" rows="2">${esc(o.rp)}</textarea>
          <label class="nk-cf-sub">GM (mechanics)</label>
          <textarea name="${key}Gm" rows="2">${esc(o.gm)}</textarea>
        </fieldset>`;
    const traitsStr  = (e.traits ?? []).join(", ");
    const checksStr  = (e.checks ?? []).map(c => `${c.name}: ${c.description}`).join("\n");
    const content = `
      <div class="nk-catalog-form">
        <div class="nk-cf-row">
          <label>Name</label>
          <input name="name" type="text" value="${esc(e.name)}" required />
        </div>
        <div class="nk-cf-row">
          <label>Difficulty <span class="nk-cf-hint">(event level relative to the kingdom — sets the check DC)</span></label>
          <input name="levelMod" type="number" min="-4" max="4" step="1" value="${parseEventLevelMod(e.subtitle)}" />
        </div>
        <div class="nk-cf-row">
          <label>Traits <span class="nk-cf-hint">(comma-separated)</span></label>
          <input name="traits" type="text" value="${esc(traitsStr)}" />
        </div>
        <div class="nk-cf-row">
          <label>Location</label>
          <input name="location" type="text" value="${esc(e.location)}" />
        </div>
        <div class="nk-cf-row">
          <label>Description</label>
          <textarea name="description" rows="4">${esc(e.description)}</textarea>
        </div>
        <div class="nk-cf-row">
          <label>Suggested Checks <span class="nk-cf-hint">(one per line: "Skill: description")</span></label>
          <textarea name="checks" rows="4">${esc(checksStr)}</textarea>
        </div>
        <div class="nk-cf-row nk-cf-outcomes">
          <label>Outcomes <span class="nk-cf-hint">(Player = narrative read aloud; GM = mechanics)</span></label>
          ${band("success", "Success", S)}
          ${band("neutral", "Neutral", N)}
          ${band("failure", "Failure", F)}
        </div>
        <div class="nk-cf-row">
          <label>Resolution <span class="nk-cf-hint">(continuous events)</span></label>
          <textarea name="resolution" rows="2">${esc(e.resolution)}</textarea>
        </div>
        <div class="nk-cf-row">
          <label>Special</label>
          <textarea name="special" rows="2">${esc(e.special)}</textarea>
        </div>
      </div>`;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: isNew ? "Add Catalog Event" : `Edit — ${e.name}`, resizable: true },
      position: { width: 520 },
      content,
      ok: { label: isNew ? "Add" : "Save", callback: (_event, button) => button.form },
      rejectClose: false,
    });
    if (!result) return null;

    const str = v => result.elements?.[v]?.value?.trim() ?? "";
    const parseChecks = raw => raw.split("\n")
      .map(l => l.trim()).filter(Boolean)
      .map(l => {
        const colon = l.indexOf(":");
        return colon > 0
          ? { name: l.slice(0, colon).trim(), description: l.slice(colon + 1).trim() }
          : { name: l, description: "" };
      });

    const lm = parseInt(str("levelMod"), 10) || 0;
    return {
      name:        str("name"),
      subtitle:    `Event ${lm >= 0 ? "+" : "−"}${Math.abs(lm)}`,
      traits:      str("traits").split(",").map(t => t.trim()).filter(Boolean),
      location:    str("location") || null,
      description: str("description"),
      checks:      parseChecks(str("checks")),
      outcomes: {
        success: { rp: str("successRp"), gm: str("successGm") },
        neutral: { rp: str("neutralRp"), gm: str("neutralGm") },
        failure: { rp: str("failureRp"), gm: str("failureGm") },
      },
      resolution: str("resolution") || null,
      special:    str("special") || null,
    };
  }

export async function onCatalogAdd() {
    const app = /** @type {KingdomApplication} */ (this);
    const entry = await catalogEditDialog(null);
    if (!entry || !entry.name) return;
    const catalog = foundry.utils.deepClone(eventCatalog());
    catalog.push(entry);
    await app.saveCatalog(catalog);
  }

export async function onCatalogEdit(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const btn = event.target.closest("[data-action]");
    const idx = parseInt(btn.dataset.catalogIndex);
    const catalog = foundry.utils.deepClone(eventCatalog());
    const updated = await catalogEditDialog(catalog[idx]);
    if (!updated) return;
    catalog[idx] = updated;
    await app.saveCatalog(catalog);
  }

export async function onCatalogRemove(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const btn = event.target.closest("[data-action]");
    const idx = parseInt(btn.dataset.catalogIndex);
    const catalog = foundry.utils.deepClone(eventCatalog());
    const name = catalog[idx]?.name ?? "this event";
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      content: `Remove <strong>${name}</strong> from the catalog?`,
      yes: { label: "Remove" },
      no:  { label: "Cancel" },
    });
    if (!confirmed) return;
    catalog.splice(idx, 1);
    await app.saveCatalog(catalog);
  }

export async function onAddSettlement() {
    const app = /** @type {KingdomApplication} */ (this);
    const kingdom = foundry.utils.deepClone(app.kingdom);
    kingdom.settlements ??= [];
    const isFirst = kingdom.settlements.length === 0;
    kingdom.settlements.push({
      id: foundry.utils.randomID(),
      name: "New Settlement",
      location: "",
      population: 0,
      stage: "village",
      importantPeople: "",
      notes: "",
      completedSegments: 0,
      isCapital: isFirst, // first settlement auto-becomes capital
      structures: [],
    });
    await app.saveKingdom(kingdom);
  }

export async function onRemoveSettlement(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const btn = event.target.closest("[data-action]");
    const index = parseInt(btn.dataset.settlementIndex);
    const kingdom = foundry.utils.deepClone(app.kingdom);
    const settlement = kingdom.settlements?.[index];
    if (!settlement) return;
    const wasCapital = settlement.isCapital;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      content: `Remove settlement <strong>${settlement.name}</strong>?`,
      yes: { label: "Remove" },
      no:  { label: "Cancel" },
    });
    if (!confirmed) return;
    kingdom.settlements.splice(index, 1);
    // If the removed settlement was the capital, auto-assign to the first remaining one
    if (wasCapital && kingdom.settlements.length > 0) {
      kingdom.settlements[0].isCapital = true;
    }
    await app.saveKingdom(kingdom);
  }

export async function onSettlementAddSegments(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const btn = event.target.closest("[data-action]");
    const index  = parseInt(btn.dataset.settlementIndex);
    const amount = parseInt(btn.dataset.amount) || 0;
    const kingdom = foundry.utils.deepClone(app.kingdom);
    const s = kingdom.settlements?.[index];
    if (!s) return;
    s.completedSegments = Math.max(0, (s.completedSegments ?? 0) + amount);
    await app.saveKingdom(kingdom);
  }

export async function onSettlementAdvanceStage(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const btn = event.target.closest("[data-action]");
    const index = parseInt(btn.dataset.settlementIndex);
    const kingdom = foundry.utils.deepClone(app.kingdom);
    const s = kingdom.settlements?.[index];
    if (!s) return;
    const threshold = SETTLEMENT_THRESHOLDS[s.stage];
    if (threshold === null || (s.completedSegments ?? 0) < threshold) {
      ui.notifications.warn("Not enough completed segments to advance.");
      return;
    }
    const nextMap = { village: "town", town: "city", city: "metropolis" };
    const next = nextMap[s.stage];
    if (!next) return;
    s.completedSegments = (s.completedSegments ?? 0) - threshold;
    s.stage = next;
    ui.notifications.info(`${s.name} has grown into a ${next.charAt(0).toUpperCase() + next.slice(1)}!`);
    await app.saveKingdom(kingdom);
  }

export async function onAddStructure(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const index = parseInt(event.target.closest("[data-action]").dataset.settlementIndex);
    const kingdom = foundry.utils.deepClone(app.kingdom);
    const s = kingdom.settlements?.[index];
    if (!s) return;
    s.structures ??= [];
    s.structures.push({ id: foundry.utils.randomID(), name: "New Structure", notes: "" });
    await app.saveKingdom(kingdom);
  }

export async function onRemoveStructure(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const id = event.target.closest("[data-action]").dataset.structureId;
    const kingdom = foundry.utils.deepClone(app.kingdom);
    for (const s of kingdom.settlements ?? []) {
      const before = (s.structures ?? []).length;
      s.structures = (s.structures ?? []).filter(x => x.id !== id);
      if (s.structures.length !== before) break;
    }
    await app.saveKingdom(kingdom);
  }

  /** Handle an actor dropped onto the armies drop zone. */
export async function onArmyDrop(event) {
    event.preventDefault();
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    if (data.type !== "Actor") {
      ui.notifications.warn("Only actors can be dropped as armies.");
      return;
    }
    const actor = await fromUuid(data.uuid);
    if (!actor) return;
    if (actor.type !== "army") {
      ui.notifications.warn(`${actor.name} is not an Army actor — only PF2e army actors can be added here.`);
      return;
    }

    const kingdom = foundry.utils.deepClone(this.kingdom);
    kingdom.armies ??= [];
    if (kingdom.armies.some(a => a.actorUuid === data.uuid)) {
      ui.notifications.warn(`${actor.name} is already listed.`);
      return;
    }

    // Recruit gate: adding an army spends a recruit credit earned by finishing a
    // Recruit project. With none available, the GM may override.
    const credits = kingdom.recruitCredits ?? 0;
    if (credits > 0) {
      kingdom.recruitCredits = credits - 1;
    } else {
      const proceed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "No recruit credit" },
        content: `<p>You have no completed recruitment available — by the rules, finish a <strong>Recruit Army</strong> project first.</p><p>Add <strong>${esc(actor.name)}</strong> anyway (GM override)?</p>`,
        yes: { label: "Add anyway" },
        no:  { label: "Cancel" },
      });
      if (!proceed) return;
    }

    kingdom.armies.push({
      id: foundry.utils.randomID(),
      actorUuid: data.uuid,
      name: actor.name,
      notes: "",
    });
    await this.saveKingdom(kingdom);
  }

export async function onRemoveArmy(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const btn = event.target.closest("[data-action]");
    const id = btn.dataset.armyId;
    const kingdom = foundry.utils.deepClone(app.kingdom);
    const army = kingdom.armies?.find(a => a.id === id);
    if (!army) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      content: `Remove <strong>${army.name}</strong> from the army list?`,
      yes: { label: "Remove" },
      no:  { label: "Cancel" },
    });
    if (!confirmed) return;
    kingdom.armies = kingdom.armies.filter(a => a.id !== id);
    await app.saveKingdom(kingdom);
  }

export async function onOpenArmySheet(event) {
    const btn = event.target.closest("[data-action]");
    const uuid = btn.dataset.actorUuid;
    if (!uuid) return;
    const actor = await fromUuid(uuid).catch(() => null);
    actor?.sheet?.render(true);
  }

  /** Escape a string for safe interpolation into dialog HTML. */
function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  /** Prompt for a leader (defaulting to the General). Returns the chosen leader or null. */
async function pickLeader(leaders, title, promptHtml) {
    let defaultIdx = leaders.findIndex(l => /general/i.test(l.role ?? ""));
    if (defaultIdx < 0) defaultIdx = 0;
    const options = leaders.map((l, i) =>
      `<option value="${i}"${i === defaultIdx ? " selected" : ""}>${esc(l.name)}${l.role ? ` (${esc(l.role)})` : ""}</option>`
    ).join("");
    const chosen = await foundry.applications.api.DialogV2.prompt({
      window: { title },
      content: `${promptHtml}<select id="nk-leader-pick" style="width:100%;margin-top:4px;">${options}</select>`,
      ok: { label: "Create Project", callback: (_e, button) => button.form.querySelector("#nk-leader-pick").value },
      rejectClose: false,
    });
    if (chosen == null) return null;
    return leaders[parseInt(chosen)] ?? null;
  }

  /** Add a project to a leader, enforcing the 3-active / one-per-complexity limits. */
function tryAddProject(leader, project) {
    leader.projects ??= [];
    const active = leader.projects.filter(p => !p.complete);
    if (active.length >= 3) {
      ui.notifications.warn(`${leader.name} already has 3 active projects.`);
      return false;
    }
    if (active.some(p => p.complexity === project.complexity)) {
      ui.notifications.warn(`${leader.name} already has a ${project.complexity}-segment project.`);
      return false;
    }
    leader.projects.push(project);
    return true;
  }

  /**
   * Create a pre-filled army project (Move / Train / Outfit) on a chosen leader.
   * Reuses the project-clock mechanic; results are applied on the PF2e army sheet.
   */
export async function onCreateArmyProject(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const btn = event.target.closest("[data-action]");
    const armyId = btn.dataset.armyId;
    const kind = btn.dataset.kind ?? "move";
    const CFG = {
      move:   { complexity: 4, verb: "Move",   skill: "Warfare Lore, Survival" },
      train:  { complexity: 6, verb: "Train",  skill: "Warfare Lore, Athletics" },
      outfit: { complexity: 6, verb: "Outfit", skill: "Crafting, Warfare Lore" },
    };
    const cfg = CFG[kind] ?? CFG.move;

    const kingdom = foundry.utils.deepClone(app.kingdom);
    const army = (kingdom.armies ?? []).find(a => a.id === armyId);
    if (!army) return;
    const leaders = kingdom.leaders ?? [];
    if (!leaders.length) { ui.notifications.warn("Add a leader first."); return; }

    const leader = await pickLeader(
      leaders,
      `${cfg.verb} ${army.name}`,
      `<p>Create a ${cfg.complexity}-segment <strong>${cfg.verb} ${esc(army.name)}</strong> project for which leader?</p>`
    );
    if (!leader) return;

    const ok = tryAddProject(leader, {
      id: foundry.utils.randomID(),
      name: `${cfg.verb} ${army.name}`,
      complexity: cfg.complexity,
      filled: 0,
      skill: cfg.skill,
      notes: "",
      complete: false,
      xpReward: PROJECT_XP[cfg.complexity] ?? 1,
    });
    if (!ok) return;
    await app.saveKingdom(kingdom);
    ui.notifications.info(`${cfg.verb} project for ${army.name} added to ${leader.name}.`);
  }

  /**
   * Create a 10-segment "Recruit Army" project, its DC bumped by the army-count
   * penalty. Completing it earns a recruit credit (spent when adding a new army).
   */
export async function onRecruitArmy() {
    const app = /** @type {KingdomApplication} */ (this);
    const kingdom = foundry.utils.deepClone(app.kingdom);
    const leaders = kingdom.leaders ?? [];
    if (!leaders.length) { ui.notifications.warn("Add a leader first."); return; }

    const { allowance } = armyAllowance(kingdom);
    const penalty = recruitPenalty((kingdom.armies ?? []).length, allowance, kingdom.settings?.recruitDcStep);
    const dc = (LEVEL_DC[kingdom.level] ?? 0) + penalty;

    const leader = await pickLeader(
      leaders,
      "Recruit Army",
      `<p>Create a 10-segment <strong>Recruit Army</strong> project (DC ${dc}${penalty ? ` — +${penalty} for fielding over your allowance of ${allowance}` : ""}) for which leader?</p>`
    );
    if (!leader) return;

    const ok = tryAddProject(leader, {
      id: foundry.utils.randomID(),
      name: "Recruit Army",
      complexity: 10,
      filled: 0,
      skill: "Diplomacy, Warfare Lore",
      notes: "",
      complete: false,
      xpReward: PROJECT_XP[10] ?? 3,
      kind: "recruit",
      dcBonus: penalty,
    });
    if (!ok) return;
    await app.saveKingdom(kingdom);
    ui.notifications.info(`Recruitment project (DC ${dc}) added to ${leader.name}.`);
  }

export async function onAddEffect() {
    const app = /** @type {KingdomApplication} */ (this);
    const kingdom = foundry.utils.deepClone(app.kingdom);
    kingdom.ongoingEffects ??= [];
    kingdom.ongoingEffects.push({
      id: foundry.utils.randomID(),
      name: "New Effect",
      description: "",
      turnsRemaining: null,
    });
    await app.saveKingdom(kingdom);
  }

export async function onRemoveEffect(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const btn = event.target.closest("[data-action]");
    const id = btn.dataset.effectId;
    const kingdom = foundry.utils.deepClone(app.kingdom);
    kingdom.ongoingEffects = (kingdom.ongoingEffects ?? []).filter(e => e.id !== id);
    await app.saveKingdom(kingdom);
  }

export async function onAddFaction() {
    const app = /** @type {KingdomApplication} */ (this);
    const kingdom = foundry.utils.deepClone(app.kingdom);
    kingdom.factions ??= [];
    kingdom.factions.push({
      id: foundry.utils.randomID(),
      name: "New Faction",
      relationType: "",
      reputation: 0,
      notes: "",
      history: [],
    });
    await app.saveKingdom(kingdom);
  }

export async function onRemoveFaction(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const id = event.target.closest("[data-action]").dataset.factionId;
    const kingdom = foundry.utils.deepClone(app.kingdom);
    const faction = (kingdom.factions ?? []).find(f => f.id === id);
    if (!faction) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      content: `Remove faction <strong>${esc(faction.name)}</strong> and its history?`,
      yes: { label: "Remove" },
      no:  { label: "Cancel" },
    });
    if (!confirmed) return;
    kingdom.factions = kingdom.factions.filter(f => f.id !== id);
    await app.saveKingdom(kingdom);
  }

export async function onFactionRepAdjust(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const btn = event.target.closest("[data-action]");
    const id = btn.dataset.factionId;
    const delta = parseInt(btn.dataset.delta) || 0;
    const kingdom = foundry.utils.deepClone(app.kingdom);
    const faction = (kingdom.factions ?? []).find(f => f.id === id);
    if (!faction) return;
    faction.reputation = clampReputation((faction.reputation ?? 0) + delta);
    await app.saveKingdom(kingdom);
  }

export async function onFactionLog(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const id = event.target.closest("[data-action]").dataset.factionId;
    const kingdom = foundry.utils.deepClone(app.kingdom);
    const faction = (kingdom.factions ?? []).find(f => f.id === id);
    if (!faction) return;
    faction.history ??= [];
    faction.history.unshift({ id: foundry.utils.randomID(), date: await getPf2eDate(), text: "" });
    await app.saveKingdom(kingdom);
  }

export async function onFactionLogRemove(event) {
    const app = /** @type {KingdomApplication} */ (this);
    const btn = event.target.closest("[data-action]");
    const factionId = btn.dataset.factionId, entryId = btn.dataset.entryId;
    const kingdom = foundry.utils.deepClone(app.kingdom);
    const faction = (kingdom.factions ?? []).find(f => f.id === factionId);
    if (!faction) return;
    faction.history = (faction.history ?? []).filter(h => h.id !== entryId);
    await app.saveKingdom(kingdom);
  }

export async function onToggleHexesOverride() {
    const app = /** @type {KingdomApplication} */ (this);
    const kingdom = foundry.utils.deepClone(app.kingdom);
    kingdom.hexesManualOverride = !kingdom.hexesManualOverride;
    await app.saveKingdom(kingdom);
  }

export async function onExportData() {
    const app = /** @type {KingdomApplication} */ (this);
    const kingdom = app.kingdom;
    const catalog = game.settings.get(MODULE_ID, "catalogData");
    const payload = {
      exportedAt: new Date().toISOString(),
      moduleVersion: game.modules.get(MODULE_ID)?.version ?? "unknown",
      kingdom,
      catalog,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (kingdom.name ?? "kingdom").replace(/[^a-z0-9_-]/gi, "_");
    a.href = url;
    a.download = `${safeName}-export.json`;
    a.click();
    URL.revokeObjectURL(url);
    ui.notifications.info("Kingdom data exported.");
  }

export async function onImportData() {
    const app = /** @type {KingdomApplication} */ (this);
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      content: "<p><strong>This will overwrite all current kingdom data</strong> with the imported file. This cannot be undone.</p><p>Continue?</p>",
      yes: { label: "Import & Overwrite" },
      no:  { label: "Cancel" },
    });
    if (!confirmed) return;

    const file = await new Promise(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
      input.click();
    });
    if (!file) return;

    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      ui.notifications.error("Failed to read file — not valid JSON.");
      return;
    }

    if (!payload.kingdom) {
      ui.notifications.error("Invalid export file — missing kingdom data.");
      return;
    }

    await app.saveKingdom(payload.kingdom);
    if (payload.catalog) await app.saveCatalog(payload.catalog);
    ui.notifications.info("Kingdom data imported successfully.");
  }

export async function onCatalogReset() {
    const app = /** @type {KingdomApplication} */ (this);
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      content: "<p>Remove <strong>all</strong> events from this world's catalog? You can re-import them from a JSON pack afterwards.</p>",
      yes: { label: "Clear All" },
      no:  { label: "Cancel" },
    });
    if (!confirmed) return;
    await app.saveCatalog([]);
    ui.notifications.info("Event catalog cleared.");
  }

/** Download the current event catalog as a shareable JSON pack. */
export async function onCatalogExport() {
    const events = foundry.utils.deepClone(eventCatalog());
    if (!events.length) {
      ui.notifications.warn("The event catalog is empty — nothing to export.");
      return;
    }
    const payload = {
      type: "narrative-kingdom-event-catalog",
      exportedAt: new Date().toISOString(),
      moduleVersion: game.modules.get(MODULE_ID)?.version ?? "unknown",
      count: events.length,
      events,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "narrative-kingdom-events.json";
    a.click();
    URL.revokeObjectURL(url);
    ui.notifications.info(`Exported ${events.length} event${events.length === 1 ? "" : "s"}.`);
  }

/** Import an event pack (JSON) into this world's catalog, replacing the current one. */
export async function onCatalogImport() {
    const app = /** @type {KingdomApplication} */ (this);
    const file = await new Promise(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
      input.click();
    });
    if (!file) return;

    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      ui.notifications.error("Failed to read file — not valid JSON.");
      return;
    }

    // Accept a bare array, or an object wrapping { events: [...] } / { catalog: [...] }.
    const raw = Array.isArray(data) ? data
      : Array.isArray(data?.events) ? data.events
      : Array.isArray(data?.catalog) ? data.catalog
      : null;
    if (!raw) {
      ui.notifications.error("Invalid event pack — expected a JSON array of events (or an { events: [...] } object).");
      return;
    }
    const events = raw.filter(e => e && typeof e === "object" && typeof e.name === "string");
    if (!events.length) {
      ui.notifications.error("No valid events found in the file.");
      return;
    }

    const existing = eventCatalog().length;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      content: `<p>Import <strong>${events.length}</strong> event${events.length === 1 ? "" : "s"}? This <strong>replaces</strong> the current catalog${existing ? ` (${existing} event${existing === 1 ? "" : "s"})` : ""}.</p>`,
      yes: { label: "Import & Replace" },
      no:  { label: "Cancel" },
    });
    if (!confirmed) return;

    await app.saveCatalog(events);
    ui.notifications.info(`Imported ${events.length} event${events.length === 1 ? "" : "s"}.`);
  }

export async function onAdvanceLevel() {
    const app = /** @type {KingdomApplication} */ (this);
    const kingdom = foundry.utils.deepClone(app.kingdom);
    const xpNeeded = kingdom.xpToNextLevel ?? ((kingdom.leaders?.length ?? 0) * xpMultiplier(kingdom));
    const liveHexes = getKingmakerClaimedHexes();
    const hexesClaimed = (liveHexes !== null && !kingdom.hexesManualOverride) ? liveHexes : (kingdom.hexesClaimed ?? 1);
    const maxLevel = effectiveMaxLevel(kingdom, hexesClaimed);

    if (kingdom.xp < xpNeeded) {
      ui.notifications.warn(`Not enough XP to level up (need ${xpNeeded}, have ${kingdom.xp}).`);
      return;
    }
    if (kingdom.level >= maxLevel) {
      ui.notifications.warn(`Kingdom is already at the maximum level (${maxLevel}).`);
      return;
    }

    kingdom.xp -= xpNeeded;
    kingdom.level += 1;
    // Reset threshold and peak for the next level based on current roster.
    kingdom.peakLeaderCount = kingdom.leaders?.length ?? 0;
    kingdom.xpToNextLevel = kingdom.peakLeaderCount * xpMultiplier(kingdom);

    const newBenefit = KINGDOM_BENEFITS.find(b => b.level === kingdom.level);
    if (newBenefit) {
      ui.notifications.info(`Kingdom reached level ${kingdom.level}! New benefit: ${newBenefit.name}`);
    }

    await app.saveKingdom(kingdom);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

function checkLevelUp(kingdom, app) {
    const xpNeeded = kingdom.xpToNextLevel ?? ((kingdom.leaders?.length ?? 0) * xpMultiplier(kingdom));
    const liveHexes = getKingmakerClaimedHexes();
    const hexesClaimed = (liveHexes !== null && !kingdom.hexesManualOverride) ? liveHexes : (kingdom.hexesClaimed ?? 1);
    const maxLevel = effectiveMaxLevel(kingdom, hexesClaimed);
    if (kingdom.xp >= xpNeeded && kingdom.level < maxLevel) {
      ui.notifications.info(`Kingdom has enough XP to level up! Click "Level Up" to advance.`);
    }
  }

async function recordTurnHistory(kingdom, eventName) {
    kingdom.turnHistory ??= [];
    const date = await getPf2eDate();
    // Net XP change over the turn: project rewards + resolved events (3 XP each) − absentees.
    const projectXp = (kingdom.turn.completedProjects ?? []).reduce((sum, p) => sum + (p.xpReward ?? 0), 0);
    const eventXp   = (kingdom.turn.completedEvents ?? []).length * 3;
    const xpGained  = projectXp + eventXp - (kingdom.turn.absentCount ?? 0);
    kingdom.turnHistory.push({
      number:            kingdom.turnNumber,
      date:              date ?? null,
      xpGained,
      event:             eventName ?? "—",
      completedProjects: foundry.utils.deepClone(kingdom.turn.completedProjects ?? []),
      completedEvents:   foundry.utils.deepClone(kingdom.turn.completedEvents  ?? []),
      absentCount:       kingdom.turn.absentCount ?? 0,
      notes:             "",
    });
  }
