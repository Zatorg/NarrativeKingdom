/**
 * Narrative Kingdom — Camping System
 * Simple 3-roll camping system for PF2e (Kingmaker zones).
 *
 * Roll 1 — Prepare Camp   : best Survival or Stealth vs Zone DC
 * Roll 2 — Cook Meal      : Survival, Crafting, or Cooking Lore vs Zone DC
 * Roll 3 — Night Watch    : flat check vs Encounter DC
 */

import { MODULE_ID } from "./constants.mjs";

// ─── Camping Zones ───────────────────────────────────────────────────────────

export const CAMPING_ZONES = [
  { zone: 0,  name: "Brevoy",                zoneDC: 14, encounterDC: 12 },
  { zone: 1,  name: "Rostland Hinterlands",  zoneDC: 15, encounterDC: 12 },
  { zone: 2,  name: "Greenbelt",             zoneDC: 16, encounterDC: 14 },
  { zone: 3,  name: "Tuskwater",             zoneDC: 18, encounterDC: 12 },
  { zone: 4,  name: "Kamelands",             zoneDC: 19, encounterDC: 12 },
  { zone: 5,  name: "Narlmarches",           zoneDC: 20, encounterDC: 14 },
  { zone: 6,  name: "Sellen Hills",          zoneDC: 20, encounterDC: 12 },
  { zone: 7,  name: "Dunsward",              zoneDC: 18, encounterDC: 12 },
  { zone: 8,  name: "Nomen Heights",         zoneDC: 24, encounterDC: 12 },
  { zone: 9,  name: "Tors of Levenies",      zoneDC: 28, encounterDC: 16 },
  { zone: 10, name: "Hooktongue",            zoneDC: 32, encounterDC: 14 },
  { zone: 11, name: "Drelev",                zoneDC: 28, encounterDC: 12 },
  { zone: 12, name: "Tiger Lords",           zoneDC: 28, encounterDC: 12 },
  { zone: 13, name: "Rushlight",             zoneDC: 26, encounterDC: 12 },
  { zone: 14, name: "Glenebon Lowlands",     zoneDC: 30, encounterDC: 12 },
  { zone: 15, name: "Pitax",                 zoneDC: 29, encounterDC: 12 },
  { zone: 16, name: "Glenebon Uplands",      zoneDC: 35, encounterDC: 12 },
  { zone: 17, name: "Numeria",               zoneDC: 36, encounterDC: 12 },
  { zone: 18, name: "Thousand Voices",       zoneDC: 43, encounterDC: 14 },
  { zone: 19, name: "Branthlend Mountains",  zoneDC: 41, encounterDC: 16 },
];

// ─── Skill Helpers ───────────────────────────────────────────────────────────

/**
 * Return available Roll-1 skill choices for an actor.
 * Candidates: survival, stealth.
 */
function getRoll1Skills(actor) {
  return ["survival", "stealth"]
    .filter(slug => actor.skills?.[slug])
    .map(slug => ({
      slug,
      label: actor.skills[slug].label ?? _capitalize(slug),
      mod:   actor.skills[slug].mod   ?? 0,
    }));
}

/**
 * Return available Roll-2 skill choices for an actor.
 * Candidates: survival, crafting, any lore whose label contains "cooking".
 */
function getRoll2Skills(actor) {
  const results = [];
  for (const slug of ["survival", "crafting"]) {
    if (actor.skills?.[slug]) {
      results.push({
        slug,
        label: actor.skills[slug].label ?? _capitalize(slug),
        mod:   actor.skills[slug].mod   ?? 0,
      });
    }
  }
  // Add any cooking lore skill
  if (actor.skills) {
    for (const [slug, skill] of Object.entries(actor.skills)) {
      if (slug === "survival" || slug === "crafting") continue;
      const label = skill.label ?? slug;
      if (label.toLowerCase().includes("cooking")) {
        results.push({ slug, label, mod: skill.mod ?? 0 });
      }
    }
  }
  return results;
}

function _capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Return the slug of the skill with the highest modifier from a skills array. */
function bestSkillSlug(skills) {
  if (!skills.length) return null;
  return skills.reduce((best, s) => (s.mod > best.mod ? s : best), skills[0]).slug;
}

/**
 * Infer party speed (ft) from the slowest participant.
 * Falls back to 25 ft if no actors can be resolved synchronously.
 */
function inferPartySpeed(participants) {
  let slowest = Infinity;
  for (const p of participants) {
    const actor = p.actorUuid ? fromUuidSync(p.actorUuid) : null;
    const spd = actor?.system?.attributes?.speed?.total
             ?? actor?.system?.attributes?.speed?.value
             ?? null;
    if (spd !== null && spd < slowest) slowest = spd;
  }
  return slowest === Infinity ? 25 : slowest;
}

/** Return activities per day from speed (Table 3-6). */
function activitiesPerDay(speedFt, forcedMarch) {
  let base;
  if (speedFt <= 10)      base = 0.5;
  else if (speedFt <= 25) base = 1;
  else if (speedFt <= 40) base = 2;
  else if (speedFt <= 55) base = 3;
  else                    base = 4;
  // Forced march: +1 Travel activity (represented as +1 to total slots, but only Travel allowed)
  if (forcedMarch) base = Math.max(1, base) + 1;
  return base;
}

/** Return Travel activities needed to cross one hex for given (effective) terrain. */
function travelCost(terrainType, road) {
  const effective = road
    ? { "open": "open", "difficult": "open", "greater-difficult": "difficult" }[terrainType] ?? terrainType
    : terrainType;
  return { "open": 1, "difficult": 2, "greater-difficult": 3 }[effective] ?? 1;
}

// ─── Chat Message Helpers ────────────────────────────────────────────────────

// Roll notes shown in the PF2e chat card for the degree that was rolled.
const PREPARE_CAMP_NOTES = [
  { selector: "all", outcome: ["criticalSuccess"], text: "Encounter DC <strong>+2</strong> tonight." },
  { selector: "all", outcome: ["success"],         text: "No bonus or penalty tonight." },
  { selector: "all", outcome: ["failure"],         text: "Encounter DC <strong>−2</strong> tonight." },
  { selector: "all", outcome: ["criticalFailure"], text: "Encounter DC <strong>−4</strong> tonight." },
];

const COOK_MEAL_NOTES = [
  { selector: "all", outcome: ["criticalSuccess"], text: "All PCs gain <strong>Well-Fed</strong>: +1 to all saves and full HP recovery." },
  { selector: "all", outcome: ["success"],         text: "All PCs gain <strong>Good Meal</strong>: +1 to their next save." },
  { selector: "all", outcome: ["failure"],         text: "Normal rest — no meal bonus." },
  { selector: "all", outcome: ["criticalFailure"], text: "One random PC is <strong>Sickened 1</strong> until morning." },
];

async function postFlatCheckMessage(roll, dc) {
  const total   = roll.total;
  const success = total >= dc;

  const cls     = success ? "nk-failure" : "nk-success"; // meeting DC = BAD (encounter)
  const label   = success ? "Encounter!" : "Quiet Night";
  const outcome = success
    ? `A random encounter occurs`
    : `The night passes without incident.`;

  const flavor = `
    <div class="nk-camp-chat">
      <div class="nk-camp-chat-header">Night Watch — Flat Check vs DC ${dc}</div>
      <div class="nk-camp-outcome">
        <strong class="${cls}">${label}</strong> — ${outcome}
      </div>
    </div>`;

  await roll.toMessage(
    { flavor, speaker: ChatMessage.getSpeaker() },
    { rollMode: CONST.DICE_ROLL_MODES.BLIND }
  );
  return success; // true = encounter triggered
}

// ─── Meal Effect Application ────────────────────────────────────────────────

const MEAL_EFFECT_UUIDS = {
  wellFed:    "Compendium.narrative-kingdom.camping-effects.Item.MnPqozL1D6SxwUiw",
  goodMeal:   "Compendium.narrative-kingdom.camping-effects.Item.nNBPIZHZqtDIvVoj",
  sickened:   "Compendium.pf2e.conditionitems.Item.fesd1n5eVhpCSS18",
};

/** All meal-effect sourceIds we manage, used to strip stale effects. */
const MEAL_EFFECT_SOURCE_IDS = new Set(Object.values(MEAL_EFFECT_UUIDS));

/**
 * Remove any previously applied camping meal effects from an actor.
 * Matches on sourceId so it works regardless of item name changes.
 */
async function stripMealEffects(actor) {
  const toDelete = actor.items
    .filter(i => MEAL_EFFECT_SOURCE_IDS.has(i.sourceId ?? i.flags?.core?.sourceId))
    .map(i => i.id);
  if (toDelete.length) await actor.deleteEmbeddedDocuments("Item", toDelete);
}

/**
 * Apply meal effects to participant actors based on the cook roll degree.
 * degree 3 (crit success) → Well-Fed on all
 * degree 2 (success)      → Good Meal on all
 * degree 1 (failure)      → nothing
 * degree 0 (crit failure) → Sickened 1 on one random participant
 */
async function applyMealEffects(degree, participants) {
  if (degree === 1) return; // failure — no effect

  if (degree === 0) {
    // Crit failure: strip positive meal effects then apply Sickened 1 to one random participant
    if (!participants.length) return;
    const target = participants[Math.floor(Math.random() * participants.length)];
    const actor  = await fromUuid(target.actorUuid).catch(() => null);
    if (!actor) return;
    await stripMealEffects(actor);
    const source = await fromUuid(MEAL_EFFECT_UUIDS.sickened).catch(() => null);
    if (!source) { console.warn("[Camping] Could not find Sickened condition UUID."); return; }
    await actor.createEmbeddedDocuments("Item", [source.toObject()]);
    ui.notifications.info(`${actor.name} got Sickened 1 from the terrible meal.`);
    return;
  }

  // degree 2 or 3: strip any stale meal effect, then apply fresh one to all
  const effectUuid = degree === 3 ? MEAL_EFFECT_UUIDS.wellFed : MEAL_EFFECT_UUIDS.goodMeal;
  const effectName = degree === 3 ? "Well-Fed"  : "Good Meal";
  const source = await fromUuid(effectUuid).catch(() => null);
  if (!source) { console.warn(`[Camping] Could not find effect UUID for ${effectName}.`); return; }

  const applied = [];
  for (const p of participants) {
    const actor = await fromUuid(p.actorUuid).catch(() => null);
    if (!actor) continue;
    await stripMealEffects(actor);
    // Only apply if actor doesn't already have this exact effect
    const alreadyHas = actor.items.some(i =>
      (i.sourceId ?? i.flags?.core?.sourceId) === effectUuid
    );
    if (!alreadyHas) {
      await actor.createEmbeddedDocuments("Item", [source.toObject()]);
      applied.push(actor.name);
    }
  }
  if (applied.length) {
    ui.notifications.info(`${effectName} applied to: ${applied.join(", ")}.`);
  }
}

// ─── Default shared state ───────────────────────────────────────────────────

export function defaultCampingState() {
  return {
    // shared
    participants:        [],
    // travel
    travelSpeedOverride: null,   // ft, null = infer from participants
    terrainType:         "open", // "open" | "difficult" | "greater-difficult"
    road:                false,
    forcedMarch:         false,
    activitiesUsed:      0,
    // camping
    roll1ActorUuid:      null,
    roll1Skill:          "survival",
    roll2ActorUuid:      null,
    roll2Skill:          "survival",
    zoneIndex:           0,
    keepWatch:           true,
    prepareDCMod:        0,
  };
}

// ─── CampingApplication ──────────────────────────────────────────────────────

export class CampingApplication extends foundry.applications.api.ApplicationV2 {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "narrative-camping",
    classes: ["narrative-kingdom", "narrative-camping"],
    tag: "div",
    window: {
      title: "Camping",
      resizable: true,
      minimizable: true,
    },
    position: { width: 480, height: 700 },
    actions: {
      "remove-participant":   CampingApplication.#onRemoveParticipant,
      "roll-prepare-camp":    CampingApplication.#onRollPrepareCamp,
      "roll-cook-meal":       CampingApplication.#onRollCookMeal,
      "roll-flat-check":      CampingApplication.#onRollFlatCheck,
      "roll-encounter-table": CampingApplication.#onRollEncounterTable,
      "new-night":            CampingApplication.#onNewNight,
      "clear-party":          CampingApplication.#onClearParty,
      "use-activity":         CampingApplication.#onUseActivity,
      "reset-activities":     CampingApplication.#onResetActivities,
      "rest-party":           CampingApplication.#onRestParty,
    },
  };

  // ── Shared state (backed by world setting, synced via socket) ─────────────

  /** Optimistic cache so the UI doesn't flicker while the GM confirms the save. */
  #pendingState = null;

  /** Local-only tab state — never synced to other clients. */
  #activeTab = "travel";

  /** Last font-scale percentage applied via setPosition — avoids resizing the
   *  window (and clobbering a user's manual resize) on every save/render. */
  #lastFontPct = null;

  get #state() {
    try {
      return this.#pendingState ?? game.settings.get(MODULE_ID, "campingState");
    } catch {
      return defaultCampingState();
    }
  }

  get #zone()        { return CAMPING_ZONES[this.#state.zoneIndex] ?? CAMPING_ZONES[0]; }
  get #zoneDC()      { return this.#zone.zoneDC; }
  get #encounterDC() { return this.#zone.encounterDC + (this.#state.prepareDCMod ?? 0); }

  // Total camp duration in minutes: 8h × N / (N−1) when watching, else 8h flat.
  get #restMinutes() {
    const n = this.#state.participants.length;
    if (!this.#state.keepWatch || n <= 1) return 480;
    return Math.round((8 * 60 * n) / (n - 1));
  }

  async #saveState(data) {
    if (game.user.isGM) {
      this.#pendingState = null;
      await game.settings.set(MODULE_ID, "campingState", data);
    } else {
      this.#pendingState = data;
      game.socket.emit(`module.${MODULE_ID}`, { action: "saveCamping", data });
      this.render();
    }
  }

  clearPendingState() {
    this.#pendingState = null;
  }

  // ── Singleton ─────────────────────────────────────────────────────────────

  static _instance = null;

  static open() {
    if (!CampingApplication._instance) {
      CampingApplication._instance = new CampingApplication();
    }
    CampingApplication._instance.render(true);
  }

  // ── Context ───────────────────────────────────────────────────────────────

  /** @override */
  async _prepareContext(_options) {
    const state = this.#state;

    const roll1Actor = state.roll1ActorUuid
      ? await fromUuid(state.roll1ActorUuid).catch(() => null)
      : null;
    const roll2Actor = state.roll2ActorUuid
      ? await fromUuid(state.roll2ActorUuid).catch(() => null)
      : null;

    const roll1Skills = roll1Actor ? getRoll1Skills(roll1Actor) : [];
    const roll2Skills = roll2Actor ? getRoll2Skills(roll2Actor) : [];

    // Use saved skill if still valid, otherwise fall back to first available
    const roll1Skill = roll1Skills.some(s => s.slug === state.roll1Skill)
      ? state.roll1Skill : (roll1Skills[0]?.slug ?? "survival");
    const roll2Skill = roll2Skills.some(s => s.slug === state.roll2Skill)
      ? state.roll2Skill : (roll2Skills[0]?.slug ?? "survival");

    return {
      participants: state.participants,
      activeTab:    this.#activeTab,
      // ── Travel ──
      travel: (() => {
        const inferredSpeed  = inferPartySpeed(state.participants);
        const speed          = state.travelSpeedOverride ?? inferredSpeed;
        let   apd            = activitiesPerDay(speed, state.forcedMarch);
        // "Lay of the Land" (kingdom level 9): +1 hexploration activity per day
        let   layOfLand      = false;
        try {
          const kLevel = game.settings.get(MODULE_ID, "kingdomData")?.level ?? 0;
          if (kLevel >= 9) { apd += 1; layOfLand = true; }
        } catch { /* kingdom module not initialised yet */ }
        const apdDisplay     = apd === 0.5 ? "½" : String(apd);
        const cost           = travelCost(state.terrainType ?? "open", state.road ?? false);
        const used           = Math.min(state.activitiesUsed ?? 0, Math.ceil(apd));
        const total          = Math.ceil(apd);
        return {
          inferredSpeed,
          speedOverride:  state.travelSpeedOverride ?? "",
          terrainType:    state.terrainType ?? "open",
          road:           state.road ?? false,
          forcedMarch:    state.forcedMarch ?? false,
          layOfLand,
          activitiesUsed: used,
          activitiesTotal: total,
          apdDisplay,
          travelCost:     cost,
          pips: Array.from({ length: total }, (_, i) => ({ filled: i < used })),
        };
      })(),
      // ── Camp ──
      roll1: {
        actorUuid: state.roll1ActorUuid ?? "",
        skill:     roll1Skill,
        skills:    roll1Skills,
        dc:        this.#zoneDC,
        canRoll:   !!(roll1Actor && roll1Skills.length),
      },
      roll2: {
        actorUuid: state.roll2ActorUuid ?? "",
        skill:     roll2Skill,
        skills:    roll2Skills,
        dc:        this.#zoneDC,
        canRoll:   !!(roll2Actor && roll2Skills.length),
      },
      zoneIndex:       state.zoneIndex,
      zoneDC:          this.#zoneDC,
      baseEncounterDC: this.#zone.encounterDC,
      encounterDC:     this.#encounterDC,
      prepareDCMod:    state.prepareDCMod ?? 0,
      zones:           CAMPING_ZONES,
      keepWatch:       state.keepWatch,
      restHours:       Math.floor(this.#restMinutes / 60),
      restMins:        this.#restMinutes % 60,
      isGM:            game.user.isGM,
      currentDate:     await (async () => {
        try {
          const ctx = await game.pf2e?.worldClock?._prepareContext({});
          return (typeof ctx?.date === "string" && ctx.date) ? ctx.date : null;
        } catch { return null; }
      })(),
    };
  }

  // ── Render ────────────────────────────────────────────────────────────────

  /** @override */
  async _renderHTML(context, _options) {
    const html = await foundry.applications.handlebars.renderTemplate(
      `modules/${MODULE_ID}/templates/camping-sheet.hbs`,
      context
    );
    const div = document.createElement("div");
    div.innerHTML = html;
    return div;
  }

  /** @override */
  _replaceHTML(result, content, _options) {
    content.innerHTML = result.innerHTML;
    this._attachListeners(content);
  }

  /** @override */
  _onRender(_context, _options) {
    this.applyFontScale();
  }

  /**
   * Read the campingFontSize client setting and apply it as a CSS font-size
   * on the window element, then resize the window proportionally.
   */
  applyFontScale() {
    const BASE_W = 480;
    const BASE_H = 700;
    let pct = 100;
    try { pct = game.settings.get(MODULE_ID, "nkFontSize") ?? 100; } catch { /* not yet ready */ }
    const scale = pct / 100;
    const el = this.element;
    if (!el) return;
    el.style.fontSize = `${pct}%`;
    // Only resize the window when the font scale actually changes (first render or
    // when the user adjusts the font setting) — never on a routine save/re-render,
    // so a manually resized window keeps its size.
    if (pct !== this.#lastFontPct) {
      this.#lastFontPct = pct;
      this.setPosition({ width: Math.round(BASE_W * scale), height: Math.round(BASE_H * scale) });
    }
  }

  // ── Listeners ─────────────────────────────────────────────────────────────

  _attachListeners(html) {
    // Participants drag-drop zone
    const dropZone = html.querySelector(".nk-camp-drop-zone");
    if (dropZone) {
      dropZone.addEventListener("dragover", ev => {
        ev.preventDefault();
        dropZone.classList.add("nk-drag-over");
      });
      dropZone.addEventListener("dragleave", ev => {
        if (!dropZone.contains(ev.relatedTarget))
          dropZone.classList.remove("nk-drag-over");
      });
      dropZone.addEventListener("drop", ev => {
        dropZone.classList.remove("nk-drag-over");
        this.#onParticipantDrop(ev);
      });
    }

    // Zone selector
    html.querySelector("select[name=camp-zone]")?.addEventListener("change", ev => {
      const s = foundry.utils.deepClone(this.#state);
      s.zoneIndex    = parseInt(ev.currentTarget.value) || 0;
      s.prepareDCMod = 0; // reset camp prep bonus when zone changes
      this.#saveState(s);
    });

    // Roll 1: character selector
    html.querySelector("select[name=roll1-actor]")?.addEventListener("change", ev => {
      const s = foundry.utils.deepClone(this.#state);
      s.roll1ActorUuid = ev.currentTarget.value || null;
      const actor1 = s.roll1ActorUuid ? (fromUuidSync(s.roll1ActorUuid) ?? null) : null;
      s.roll1Skill = bestSkillSlug(actor1 ? getRoll1Skills(actor1) : []) ?? "survival";
      this.#saveState(s);
    });

    // Roll 1: skill selector
    html.querySelector("select[name=roll1-skill]")?.addEventListener("change", ev => {
      const s = foundry.utils.deepClone(this.#state);
      s.roll1Skill = ev.currentTarget.value;
      this.#saveState(s);
    });

    // Roll 2: character selector
    html.querySelector("select[name=roll2-actor]")?.addEventListener("change", ev => {
      const s = foundry.utils.deepClone(this.#state);
      s.roll2ActorUuid = ev.currentTarget.value || null;
      const actor2 = s.roll2ActorUuid ? (fromUuidSync(s.roll2ActorUuid) ?? null) : null;
      s.roll2Skill = bestSkillSlug(actor2 ? getRoll2Skills(actor2) : []) ?? "survival";
      this.#saveState(s);
    });

    // Roll 2: skill selector
    html.querySelector("select[name=roll2-skill]")?.addEventListener("change", ev => {
      const s = foundry.utils.deepClone(this.#state);
      s.roll2Skill = ev.currentTarget.value;
      this.#saveState(s);
    });

    // Night watch toggle
    html.querySelector("input[name=camp-keep-watch]")?.addEventListener("change", ev => {
      const s = foundry.utils.deepClone(this.#state);
      s.keepWatch = ev.currentTarget.checked;
      this.#saveState(s);
    });

    // Tab switching — local only, does not sync to other clients
    html.querySelectorAll(".nk-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        this.#activeTab = btn.dataset.tab;
        this.render();
      });
    });

    // Travel: speed override
    html.querySelector("input[name=travel-speed]")?.addEventListener("change", ev => {
      const s   = foundry.utils.deepClone(this.#state);
      const val = parseInt(ev.currentTarget.value);
      s.travelSpeedOverride = isNaN(val) || val <= 0 ? null : val;
      this.#saveState(s);
    });

    // Travel: terrain type
    html.querySelector("select[name=travel-terrain]")?.addEventListener("change", ev => {
      const s = foundry.utils.deepClone(this.#state);
      s.terrainType = ev.currentTarget.value;
      this.#saveState(s);
    });

    // Travel: road toggle
    html.querySelector("input[name=travel-road]")?.addEventListener("change", ev => {
      const s = foundry.utils.deepClone(this.#state);
      s.road = ev.currentTarget.checked;
      this.#saveState(s);
    });

    // Travel: forced march
    html.querySelector("input[name=travel-forced-march]")?.addEventListener("change", ev => {
      const s = foundry.utils.deepClone(this.#state);
      s.forcedMarch = ev.currentTarget.checked;
      s.activitiesUsed = 0;
      this.#saveState(s);
    });
  }

  // ── Drag-drop: add participant ────────────────────────────────────────────

  async #onParticipantDrop(event) {
    event.preventDefault();
    let data;
    try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }

    if (data.type !== "Actor") {
      ui.notifications.warn("Only actors can be dropped as camping participants.");
      return;
    }
    const actor = await fromUuid(data.uuid).catch(() => null);
    if (!actor) return;

    const state = foundry.utils.deepClone(this.#state);
    if (state.participants.some(p => p.actorUuid === data.uuid)) {
      ui.notifications.warn(`${actor.name} is already in the camping group.`);
      return;
    }

    state.participants.push({ name: actor.name, img: actor.img, actorUuid: data.uuid });

    // Auto-assign first two participants to rolls if none selected yet, picking best skill
    if (!state.roll1ActorUuid) {
      state.roll1ActorUuid = data.uuid;
      state.roll1Skill = bestSkillSlug(getRoll1Skills(actor)) ?? "survival";
    } else if (!state.roll2ActorUuid) {
      state.roll2ActorUuid = data.uuid;
      state.roll2Skill = bestSkillSlug(getRoll2Skills(actor)) ?? "survival";
    }

    await this.#saveState(state);
  }

  // ── Action: remove participant ────────────────────────────────────────────

  static async #onRemoveParticipant(event) {
    const app  = /** @type {CampingApplication} */ (this);
    const btn  = event.target.closest("[data-action]");
    const uuid = btn?.dataset?.uuid;
    if (!uuid) return;

    const state = foundry.utils.deepClone(app.#state);
    state.participants = state.participants.filter(p => p.actorUuid !== uuid);
    if (state.roll1ActorUuid === uuid) state.roll1ActorUuid = null;
    if (state.roll2ActorUuid === uuid) state.roll2ActorUuid = null;

    await app.#saveState(state);
  }

  // ── Action: Roll 1 — Prepare Camp ────────────────────────────────────────

  static async #onRollPrepareCamp() {
    const app   = /** @type {CampingApplication} */ (this);
    const state = app.#state;
    const uuid  = state.roll1ActorUuid;
    const skill = state.roll1Skill;
    const dc    = app.#zoneDC;
    if (!uuid) return;

    const actor = await fromUuid(uuid).catch(() => null);
    if (!actor) return;

    const skillObj = actor.skills?.[skill];
    if (!skillObj) {
      ui.notifications.warn(`${actor.name} does not have the ${skill} skill.`);
      return;
    }

    const OUTCOME_MAP = { criticalSuccess: 3, success: 2, failure: 1, criticalFailure: 0 };
    const DC_MODS    = [-4, -2, 0, 2];
    let degree = null;

    const roll = await skillObj.roll({
      dc:              { value: dc },
      traits:          ["concentrate", "exploration", "move"],
      extraRollNotes:  PREPARE_CAMP_NOTES,
      callback: (_roll, outcome) => { degree = OUTCOME_MAP[outcome] ?? 1; },
    });
    if (!roll || degree === null) return; // dialog cancelled

    await app.#saveState({ ...app.#state, prepareDCMod: DC_MODS[degree] ?? 0 });
  }

  // ── Action: Roll 2 — Cook Meal ────────────────────────────────────────────

  static async #onRollCookMeal() {
    const app   = /** @type {CampingApplication} */ (this);
    const state = app.#state;
    const uuid  = state.roll2ActorUuid;
    const skill = state.roll2Skill;
    const dc    = app.#zoneDC;
    if (!uuid) return;

    const actor = await fromUuid(uuid).catch(() => null);
    if (!actor) return;

    const skillObj = actor.skills?.[skill];
    if (!skillObj) {
      ui.notifications.warn(`${actor.name} does not have the ${skill} skill.`);
      return;
    }

    const OUTCOME_MAP = { criticalSuccess: 3, success: 2, failure: 1, criticalFailure: 0 };
    let degree = null;

    const roll = await skillObj.roll({
      dc:             { value: dc },
      traits:         ["exploration", "manipulate"],
      extraRollNotes: COOK_MEAL_NOTES,
      callback: (_roll, outcome) => { degree = OUTCOME_MAP[outcome] ?? 1; },
    });
    if (!roll || degree === null) return; // dialog cancelled

    await applyMealEffects(degree, app.#state.participants);
  }

  // ── Action: New Night ────────────────────────────────────────────────────
  static async #onNewNight() {
    const app = /** @type {CampingApplication} */ (this);
    // Strip all meal effects from every participant
    for (const p of app.#state.participants) {
      const actor = await fromUuid(p.actorUuid).catch(() => null);
      if (actor) await stripMealEffects(actor);
    }
    // Reset the DC modifier — keep participants and zone selection intact
    await app.#saveState({ ...app.#state, prepareDCMod: 0 });
    ui.notifications.info("New night started — meal effects cleared.");
  }

  // ── Action: Rest for the Night ────────────────────────────────────────────

  static async #onRestParty() {
    const app = /** @type {CampingApplication} */ (this);
    const actors = [];
    for (const p of app.#state.participants) {
      const actor = await fromUuid(p.actorUuid).catch(() => null);
      if (actor) actors.push(actor);
    }
    if (!actors.length) {
      ui.notifications.warn("No participants to rest.");
      return;
    }
    const rest = game.pf2e?.actions?.restForTheNight;
    if (typeof rest === "function") {
      await rest({ actors });
    } else {
      ui.notifications.warn("PF2e 'Rest for the Night' action is unavailable.");
    }
  }

  // ── Action: Roll 3 — Night Watch Flat Check ───────────────────────────────

  static async #onRollFlatCheck() {
    const app = /** @type {CampingApplication} */ (this);
    const dc  = app.#encounterDC;
    const roll = await new Roll("1d20").evaluate();
    await postFlatCheckMessage(roll, dc);
    // Reset the prepare-camp DC modifier now that the night is resolved
    await app.#saveState({ ...app.#state, prepareDCMod: 0 });
  }

  // ── Action: Roll Encounter Table ───────────────────────────────────────────

  static async #onRollEncounterTable() {
    const app  = /** @type {CampingApplication} */ (this);
    const z    = app.#zone;
    const name = `Zone ${String(z.zone).padStart(2, "0")}: ${z.name}`;
    const table = game.tables.find(t => t.name === name);
    if (table) {
      await table.draw({ rollMode: CONST.DICE_ROLL_MODES.BLIND });
    } else {
      ui.notifications.warn(`No RollTable found named “${name}”.`);
    }
  }

  // ── Action: Clear Party ───────────────────────────────────────────────────

  static async #onClearParty() {
    const app = /** @type {CampingApplication} */ (this);
    await app.#saveState({
      ...app.#state,
      participants:   [],
      roll1ActorUuid: null,
      roll2ActorUuid: null,
    });
  }

  // ── Travel actions ────────────────────────────────────────────────────────

  static async #onUseActivity() {
    const app   = /** @type {CampingApplication} */ (this);
    const state = app.#state;
    const spd   = state.travelSpeedOverride ?? inferPartySpeed(state.participants);
    let   total = Math.ceil(activitiesPerDay(spd, state.forcedMarch));
    try { if ((game.settings.get(MODULE_ID, "kingdomData")?.level ?? 0) >= 9) total += 1; } catch {}
    const used  = Math.min((state.activitiesUsed ?? 0) + 1, total);
    await app.#saveState({ ...state, activitiesUsed: used });
  }

  static async #onResetActivities() {
    const app = /** @type {CampingApplication} */ (this);
    await app.#saveState({ ...app.#state, activitiesUsed: 0 });
  }

}
