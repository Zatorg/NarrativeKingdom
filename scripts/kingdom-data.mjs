/**
 * Narrative Kingdom Management — data model, constants, and pure helpers.
 * Extracted from narrative-kingdom.mjs so the data/model layer is separate from
 * the ApplicationV2 UI and the module wiring.
 */
import { MODULE_ID } from "./constants.mjs";
import { KINGDOM_EVENTS_CATALOG } from "./kingdom-events-catalog.mjs";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Live reference to the events catalog — uses saved overrides if present, else the imported default */
export function eventCatalog() {
  try {
    const saved = game.settings.get(MODULE_ID, "catalogData");
    if (Array.isArray(saved) && saved.length) return saved;
  } catch { /* settings not yet registered on first call */ }
  return KINGDOM_EVENTS_CATALOG;
}

/** XP reward per clock complexity */
export const PROJECT_XP = { 4: 1, 6: 2, 10: 3 };

/** Segments required to advance a settlement to the next stage */
export const SETTLEMENT_THRESHOLDS = { village: 20, town: 40, city: 80, metropolis: null };
export const SETTLEMENT_NEXT_STAGE  = { village: "Town", town: "City", city: "Metropolis", metropolis: null };

// ─── Army command economy ────────────────────────────────────────────────────

/** Settlement development tiers — drive the free army allowance. */
export const SETTLEMENT_TIER = { village: 1, town: 2, city: 3, metropolis: 4 };

/** Tuning (hardcoded for now; candidates for GM settings later). */
export const ARMY_TIER_FACTOR = 0.4; // free armies ≈ round(Σ settlement tiers × factor)
export const RECRUIT_DC_STEP  = 2;   // recruit DC rises this much per army over the allowance

/** Free army allowance from combined settlement development (min 1). */
export function armyAllowance(kingdom) {
  const factor = kingdom.settings?.armyTierFactor ?? ARMY_TIER_FACTOR;
  const tierSum = (kingdom.settlements ?? [])
    .reduce((sum, s) => sum + (SETTLEMENT_TIER[s.stage] ?? 1), 0);
  return { tierSum, allowance: Math.max(1, Math.round(tierSum * factor)) };
}

/** Recruit-DC penalty for raising the (armyCount+1)-th army given the allowance. */
export function recruitPenalty(armyCount, allowance, step = RECRUIT_DC_STEP) {
  return Math.max(0, (armyCount + 1) - allowance) * step;
}

// ─── Kingdom events ──────────────────────────────────────────────────────────

/**
 * Resolve a kingdom event from its green/red clock, or null if not yet decided.
 * Reach the threshold in green → success, in red → failure; fill the clock with
 * neither decisive → neutral.
 */
export function eventOutcome(green, red, size, threshold) {
  const t = Math.min(size, Math.max(1, threshold ?? 7));
  const g = green ?? 0, r = red ?? 0;
  if (g >= t) return "success";
  if (r >= t) return "failure";
  if (g + r >= size) return "neutral";
  return null;
}

/** PF2e Earn Income — approx. income per day by level (a successful result). */
// Max gp/day a leader can Earn Income at each kingdom level, using the best
// proficiency available at that level (expert by L3, master by L7, legendary by
// L15) — from the PF2e Remaster "Income Earned" table (Player Core).
export const EARN_INCOME_PER_DAY = {
  0: 0.05, 1: 0.2, 2: 0.3, 3: 0.5, 4: 0.8, 5: 1, 6: 2, 7: 2.5, 8: 3, 9: 4, 10: 6,
  11: 8, 12: 10, 13: 15, 14: 20, 15: 28, 16: 40, 17: 55, 18: 90, 19: 130, 20: 200, 21: 200,
};

/**
 * Normalize an event outcome to { rp, gm }.
 * A legacy string is treated as GM-only mechanics (no player-facing RP text) so
 * old saved events never leak mechanics to players.
 */
export function normalizeOutcome(o) {
  if (o == null) return { rp: "", gm: "" };
  if (typeof o === "string") return { rp: "", gm: o };
  return { rp: o.rp ?? "", gm: o.gm ?? "" };
}

/**
 * Parse an event's "Event +N" / "Event −N" subtitle into an integer level
 * modifier (0 when absent). The event is treated as being this many levels
 * above the kingdom, which sets its check DC (see LEVEL_DC).
 */
export function parseEventLevelMod(subtitle) {
  const m = String(subtitle ?? "").match(/([+\-−])\s*(\d+)/);
  if (!m) return 0;
  return (m[1] === "+" ? 1 : -1) * parseInt(m[2], 10);
}

/** The DC a kingdom event's checks are rolled against, given the kingdom level. */
export function eventDC(kingdomLevel, subtitleOrMod) {
  const mod = typeof subtitleOrMod === "number" ? subtitleOrMod : parseEventLevelMod(subtitleOrMod);
  const lvl = Math.max(0, Math.min(25, (kingdomLevel ?? 1) + mod));
  return LEVEL_DC[lvl] ?? null;
}

/**
 * PF2e Reputation subsystem standings. A faction's Reputation Points are clamped
 * to −50…50 and fall into one of these named tiers.
 */
export const FACTION_STANDINGS = [
  { min: 30,  max: 50,  key: "revered",  label: "Revered"  },
  { min: 15,  max: 29,  key: "admired",  label: "Admired"  },
  { min: 5,   max: 14,  key: "liked",    label: "Liked"    },
  { min: -4,  max: 4,   key: "ignored",  label: "Ignored"  },
  { min: -14, max: -5,  key: "disliked", label: "Disliked" },
  { min: -29, max: -15, key: "hated",    label: "Hated"    },
  { min: -50, max: -30, key: "hunted",   label: "Hunted"   },
];

/** Clamp Reputation Points to the PF2e −50…50 range. */
export function clampReputation(points) {
  return Math.max(-50, Math.min(50, Math.round(Number(points) || 0)));
}

/** The PF2e standing tier for a Reputation Points total (defaults to Ignored). */
export function factionStanding(points) {
  const p = clampReputation(points);
  return FACTION_STANDINGS.find(s => p >= s.min && p <= s.max) ?? FACTION_STANDINGS[3];
}

/** Kingdom Benefits table (level → benefit) */
export const KINGDOM_BENEFITS = [
  { level: 1,  name: "Leader's Charisma +1",     key: "charisma1",        description: "Leaders gain +1 status bonus to Request, Coerce, Lie, or Make an Impression against creatures who respect or fear their authority." },
  { level: 2,  name: "Insider Trading",           key: "insiderTrading",   description: "Leaders may purchase common items of the kingdom's level or lower from within their kingdom." },
  { level: 3,  name: "Collect Taxes",             key: "collectTaxes",     description: "Each leader earns gold as a successful Earn Income result at the kingdom's level, multiplied by 7 (one week)." },
  { level: 4,  name: "Gifts of Gratitude",        key: "giftsGratitude",   description: "Players may choose a free common or uncommon consumable of level 6 or lower." },
  { level: 5,  name: "Leader's Charisma +2",      key: "charisma2",        description: "The status bonus from Leader's Charisma increases to +2." },
  { level: 6,  name: "Know Thy Enemy",            key: "knowEnemy",        description: "+1 status bonus when attempting to Recall Knowledge about a location or people in the kingdom." },
  { level: 7,  name: "Problem Solvers",           key: "problemSolvers",   description: "Kingdom Events start with 1 green success point already on the clock." },
  { level: 8,  name: "Stockpile",                  key: "stockpile",        description: "Once per kingdom turn, each leader may claim one common consumable of item level equal to the kingdom's current level or lower from the kingdom's stores." },
  { level: 9,  name: "Lay of the Land",           key: "layOfLand",        description: "Leaders may perform one additional activity when using hexploration." },
  { level: 10, name: "Leader's Charisma +3",      key: "charisma3",        description: "The status bonus from Leader's Charisma increases to +3." },
  { level: 11, name: "Easy Snack",                key: "easySnack",        description: "Leaders are always considered well-fed when hexploring the kingdom." },
  { level: 12, name: "Monster Slayers",           key: "monsterSlayers",   description: "+2 status bonus when attempting to Recall Knowledge on a creature in the kingdom." },
  { level: 13, name: "No Mountain High Enough",   key: "noMountain",       description: "When hexploring the kingdom, treat Difficult Terrain as standard terrain." },
  { level: 14, name: "Nothing Can Stop Us!",      key: "nothingStopUs",    description: "Kingdom Events start with 2 green success points already on the clock." },
  { level: 15, name: "Leader's Charisma +4",      key: "charisma4",        description: "The status bonus from Leader's Charisma increases to +4." },
  { level: 16, name: "Insider Trading (Uncommon)", key: "insiderUncommon",  description: "The kingdom's trade network has matured. Leaders may purchase uncommon items of the kingdom's level or lower from within their kingdom." },
  { level: 17, name: "One Banner, One Flag",      key: "oneBanner",        description: "When Aiding another leader's project, treat the result as one degree of success higher." },
  { level: 18, name: "Prosperous Kingdom",        key: "prosperousKingdom",description: "Collect Taxes is treated as a Critical Success on the Earn Income table for the kingdom's level." },
  { level: 19, name: "Gifts of the Gods",         key: "giftsGods",        description: "Each leader may pick one rare item of item level 20 or lower." },
  { level: 20, name: "Lords of the Inner Sea",    key: "lordsInnerSea",    description: "You gain the Leader's Charisma bonus regardless of who you speak to anywhere in the Inner Sea region." },
];

// ─── Kingmaker Integration ─────────────────────────────────────────────────────

/**
 * Return the number of claimed hexes from the pf2e-kingmaker module, or null
 * if that module is not active / the region map isn't loaded yet.
 * Access path: kingmaker.region.hexes (Collection of KingmakerHex)
 * Each hex has data.claimed: boolean
 */
export function getKingmakerClaimedHexes() {
  try {
    const km = globalThis.kingmaker;
    if (!km?.region?.hexes) return null;
    return km.region.hexes.filter(h => h.data?.claimed).length;
  } catch {
    return null;
  }
}

/**
 * Hexes required to reach a given kingdom level.
 * Formula: round(0.4·L² − 0.5·L + 1) — calibrated so that
 *   L5 ≈ 10 hexes, L14 ≈ 50 hexes, L20 ≈ 100 hexes.
 */
export function hexesForLevel(level) {
  return Math.max(1, Math.round(0.4 * level * level - 0.5 * level + 1));
}

/** Returns the highest kingdom level (1-20) achievable with the given hex count. */
export function hexLevelCap(hexesClaimed) {
  for (let l = 20; l >= 1; l--) {
    if (hexesForLevel(l) <= hexesClaimed) return l;
  }
  return 0;
}

/** Read the current PF2e world-clock date as a display string, or null if unavailable. */
export async function getPf2eDate() {
  try {
    const wc = game.pf2e?.worldClock;
    if (!wc) return null;
    // _prepareContext returns { date: "Toilday, 9th of Sarenith, 4726 AR", ... }
    const ctx = await wc._prepareContext({});
    if (typeof ctx?.date === "string" && ctx.date) return ctx.date;
    // Direct getter fallback
    const month = wc.month;
    const year  = wc.year;
    const era   = wc.era ?? "AR";
    if (month && year) return `${month} ${year} ${era}`;
    return null;
  } catch { return null; }
}

/** Return the XP cost per leader from kingdom settings (default 5). */
export function xpMultiplier(kingdom) {
  return kingdom.settings?.xpPerLeader ?? 5;
}

// PF2e level-based DCs (GM Core p.52)
export const LEVEL_DC = {0:14,1:15,2:16,3:18,4:19,5:20,6:22,7:23,8:24,9:26,10:27,11:28,12:30,13:31,14:32,15:34,16:35,17:36,18:38,19:39,20:40,21:42,22:44,23:46,24:48,25:50};

export const DC_ADJUSTMENTS = [
  { label: "Incredibly easy", mod: -10, rarity: null },
  { label: "Very easy",       mod: -5,  rarity: null },
  { label: "Easy",            mod: -2,  rarity: null },
  { label: "Standard",        mod:  0,  rarity: null },
  { label: "Hard",            mod: +2,  rarity: "Uncommon" },
  { label: "Very hard",       mod: +5,  rarity: "Rare" },
  { label: "Incredibly hard", mod: +10, rarity: "Unique" },
];

/** Return the effective max kingdom level, honouring the ignoreHexCap setting. */
export function effectiveMaxLevel(kingdom, hexesClaimed) {
  const partyMax = kingdom.partyLevel ?? 1;
  if (kingdom.settings?.ignoreHexCap) return Math.min(20, partyMax);
  return Math.min(partyMax, hexLevelCap(hexesClaimed));
}

// ─── XP Helper ───────────────────────────────────────────────────────────────

/** Cap kingdom.xp so it cannot exceed the threshold needed for the next level. */
export function clampXp(kingdom) {
  const cap = kingdom.xpToNextLevel ?? ((kingdom.leaders?.length ?? 0) * xpMultiplier(kingdom));
  if (cap > 0) kingdom.xp = Math.min(kingdom.xp, cap);
}

/**
 * Apply a single form-field change to a kingdom object in place.
 *
 * Field edits are routed through this targeted patcher (rather than writing a whole
 * snapshot of the form) so that two users editing *different* fields at the same time
 * don't clobber each other: each change touches only the one field it represents, and
 * the GM re-applies the patch onto the latest authoritative data.
 *
 * @param {object} kingdom  Kingdom data (mutated in place).
 * @param {{name:string,value:string,checked:boolean,type:string}} patch
 */
export function applyKingdomFieldPatch(kingdom, patch) {
  const { name, value, checked } = patch ?? {};
  if (!name) return;
  let m;

  switch (name) {
    case "name":        kingdom.name = value; return;
    case "partyLevel":  kingdom.partyLevel = parseInt(value) || 1; return;
    case "kingdomLevel": {
      const newLevel = Math.max(1, Math.min(20, parseInt(value) || 1));
      if (newLevel !== kingdom.level) {
        kingdom.level = newLevel;
        kingdom.peakLeaderCount = kingdom.leaders?.length ?? 0;
        kingdom.xpToNextLevel = kingdom.peakLeaderCount * xpMultiplier(kingdom);
      }
      return;
    }
    case "kingdomXp":   kingdom.xp = Math.max(0, parseInt(value) || 0); clampXp(kingdom); return;
    case "hexesClaimed": kingdom.hexesClaimed = parseInt(value) || 0; return;
    case "kingdomNotes": kingdom.notes = value; return;
    case "settings-xpPerLeader": {
      kingdom.settings ??= {};
      const newMult = Math.max(1, parseInt(value) || 5);
      if (newMult !== kingdom.settings.xpPerLeader) {
        kingdom.settings.xpPerLeader = newMult;
        const peak = kingdom.peakLeaderCount ?? kingdom.leaders?.length ?? 0;
        kingdom.xpToNextLevel = peak * newMult;
        clampXp(kingdom);
      }
      return;
    }
    case "settings-ignoreHexCap":
      kingdom.settings ??= {};
      kingdom.settings.ignoreHexCap = !!checked;
      return;
    case "settings-armyTierFactor": {
      kingdom.settings ??= {};
      const f = parseFloat(value);
      kingdom.settings.armyTierFactor = Number.isFinite(f) ? Math.max(0.05, f) : ARMY_TIER_FACTOR;
      return;
    }
    case "settings-recruitDcStep": {
      kingdom.settings ??= {};
      const v = parseInt(value);
      kingdom.settings.recruitDcStep = Number.isFinite(v) ? Math.max(0, v) : RECRUIT_DC_STEP;
      return;
    }
    case "settings-eventThreshold": {
      kingdom.settings ??= {};
      const v = parseInt(value);
      kingdom.settings.eventThreshold = Number.isFinite(v) ? Math.min(20, Math.max(2, v)) : 7;
      return;
    }
    case "settings-eventDecayPerTurn": {
      kingdom.settings ??= {};
      const v = parseInt(value);
      kingdom.settings.eventDecayPerTurn = Number.isFinite(v) ? Math.max(0, v) : 1;
      return;
    }
    case "settlement-capital": {
      const idx = parseInt(value);
      (kingdom.settlements ?? []).forEach((s, i) => { s.isCapital = i === idx; });
      return;
    }
  }

  if ((m = name.match(/^leader-attended-(\d+)$/))) { const l = kingdom.leaders?.[+m[1]]; if (l) l.attendedTurn = !!checked; return; }
  if ((m = name.match(/^leader-name-(\d+)$/)))     { const l = kingdom.leaders?.[+m[1]]; if (l) l.name = value; return; }
  if ((m = name.match(/^leader-role-(\d+)$/)))     { const l = kingdom.leaders?.[+m[1]]; if (l) l.role = value; return; }
  if ((m = name.match(/^leader-notes-(\d+)$/)))    { const l = kingdom.leaders?.[+m[1]]; if (l) l.notes = value; return; }

  if ((m = name.match(/^project-(skill|name|notes|dc)-(.+)$/))) {
    const field = m[1], id = m[2];
    for (const l of kingdom.leaders ?? []) {
      const p = (l.projects ?? []).find(pr => pr.id === id);
      if (!p) continue;
      if      (field === "skill") p.skill = value;
      else if (field === "name")  p.name = value;
      else if (field === "notes") p.notes = value;
      else if (field === "dc")    p.dcMod = parseInt(value) || 0;
      return;
    }
    return;
  }

  if ((m = name.match(/^event-(notes|name)-(.+)$/))) {
    const field = m[1], id = m[2];
    const ev = (kingdom.activeEvents ?? []).find(e => e.id === id);
    if (ev) { if (field === "notes") ev.notes = value; else ev.name = value; }
    return;
  }

  if ((m = name.match(/^settlement-(name|location|population|stage|people|notes|segments)-(\d+)$/))) {
    const field = m[1];
    const s = kingdom.settlements?.[+m[2]];
    if (!s) return;
    switch (field) {
      case "name":       s.name = value; break;
      case "location":   s.location = value; break;
      case "population": s.population = parseInt(value) || 0; break;
      case "stage":      s.stage = value; break;
      case "people":     s.importantPeople = value; break;
      case "notes":      s.notes = value; break;
      case "segments":   s.completedSegments = Math.max(0, parseInt(value) || 0); break;
    }
    return;
  }

  if ((m = name.match(/^structure-(name|notes)-(.+)$/))) {
    const field = m[1], id = m[2];
    for (const s of kingdom.settlements ?? []) {
      const st = (s.structures ?? []).find(x => x.id === id);
      if (st) { st[field] = value; return; }
    }
    return;
  }

  if ((m = name.match(/^army-notes-(.+)$/))) {
    const a = (kingdom.armies ?? []).find(ar => ar.id === m[1]);
    if (a) a.notes = value;
    return;
  }

  if ((m = name.match(/^effect-(name|expires|desc)-(.+)$/))) {
    const field = m[1], id = m[2];
    const eff = (kingdom.ongoingEffects ?? []).find(e => e.id === id);
    if (!eff) return;
    if      (field === "name") eff.name = value;
    else if (field === "desc") eff.description = value;
    else if (field === "expires") {
      const val = parseInt(value);
      eff.turnsRemaining = isNaN(val) || String(value ?? "").trim() === "" ? null : Math.max(1, val);
    }
    return;
  }

  if ((m = name.match(/^faction-(name|type|notes)-(.+)$/))) {
    const field = m[1], id = m[2];
    const f = (kingdom.factions ?? []).find(x => x.id === id);
    if (!f) return;
    if      (field === "name")  f.name = value;
    else if (field === "type")  f.relationType = value;
    else if (field === "notes") f.notes = value;
    return;
  }

  if ((m = name.match(/^faction-rep-(.+)$/))) {
    const f = (kingdom.factions ?? []).find(x => x.id === m[1]);
    if (f) f.reputation = clampReputation(value);
    return;
  }

  if ((m = name.match(/^faction-(event|date)-(.+)$/))) {
    const field = m[1] === "date" ? "date" : "text";
    const id = m[2];
    for (const f of kingdom.factions ?? []) {
      const ev = (f.history ?? []).find(h => h.id === id);
      if (ev) { ev[field] = value; return; }
    }
    return;
  }
}

/**
 * Resolve a kingdom event: mark it resolved, award XP (Success/Failure 3,
 * Neutral 1) and record it on the current turn. Returns the XP awarded.
 */
export function resolveEvent(kingdom, ev, outcome) {
  ev.resolved = true;
  ev.outcomeResult = outcome;                 // "success" | "neutral" | "failure"
  const xp = outcome === "neutral" ? 1 : 3;
  ev.xpAwarded = xp;
  kingdom.xp = (kingdom.xp ?? 0) + xp;
  clampXp(kingdom);
  kingdom.turn.eventPhaseComplete = true;
  kingdom.turn.completedEvents ??= [];
  const band = normalizeOutcome(ev.outcomes?.[outcome]);
  kingdom.turn.completedEvents.push({
    name: ev.name,
    outcomeResult: outcome,
    outcomeRp: band.rp,
    outcomeGm: band.gm,
    outcomeText: band.gm || band.rp,   // legacy field for older history renderers
    notes: ev.notes ?? "",
  });
  kingdom.turn.eventName ??= ev.name;
  return xp;
}

/**
 * Apply a semantic, id-targeted operation to the kingdom. Unlike a full-snapshot
 * save, an op only touches the entity it names, so the GM can re-apply it onto the
 * latest authoritative data without clobbering concurrent edits (e.g. another
 * player renaming a skill on a different project). The GM always applies ops onto
 * freshly-read data; non-GMs also apply locally for an optimistic UI.
 *
 * @returns {object} info for the caller's notifications, e.g.
 *   { ok:false, reason? }  — rejected, nothing changed
 *   { ok:true, completed?, projectName?, xp?, recruit? }
 */
export function applyKingdomOp(kingdom, op) {
  switch (op?.type) {
    case "add-project": {
      const leader = kingdom.leaders?.[op.leaderIndex];
      if (!leader) return { ok: false };
      leader.projects ??= [];
      const active = leader.projects.filter(p => !p.complete);
      if (active.length >= 3) return { ok: false, reason: "A leader can have at most 3 ongoing projects." };
      if (active.some(p => p.complexity === op.complexity)) {
        return { ok: false, reason: `A leader already has a ${op.complexity}-segment project.` };
      }
      leader.projects.push({
        id: op.id ?? foundry.utils.randomID(),
        name: "New Project",
        complexity: op.complexity,
        filled: 0,
        skill: "",
        notes: "",
        complete: false,
        xpReward: PROJECT_XP[op.complexity] ?? 1,
      });
      return { ok: true };
    }

    case "remove-project": {
      for (const l of kingdom.leaders ?? []) {
        l.projects = (l.projects ?? []).filter(p => p.id !== op.projectId);
      }
      return { ok: true };
    }

    case "roll-project": {
      const delta = { "crit-success": 2, "success": 1, "failure": 0, "crit-failure": -1 }[op.result] ?? 0;
      const info = { ok: true, completed: false };
      for (const leader of kingdom.leaders ?? []) {
        const project = (leader.projects ?? []).find(p => p.id === op.projectId);
        if (!project) continue;
        project.filled = Math.max(0, Math.min(project.complexity, project.filled + delta));
        if (project.filled >= project.complexity && !project.complete) {
          project.complete = true;
          const xp = project.xpReward ?? PROJECT_XP[project.complexity] ?? 1;
          kingdom.xp = (kingdom.xp ?? 0) + xp;
          clampXp(kingdom);
          kingdom.turn.completedProjects ??= [];
          kingdom.turn.completedProjects.push({
            name: project.name, leaderName: leader.name, complexity: project.complexity, xpReward: xp,
          });
          info.completed = true; info.projectName = project.name; info.xp = xp;
          if (project.kind === "recruit") { kingdom.recruitCredits = (kingdom.recruitCredits ?? 0) + 1; info.recruit = true; }
        }
        break;
      }
      // Mark the acting leader as having spent their action today (week phase only).
      if (op.actingLeaderIndex != null && kingdom.turn?.phase === "week") {
        const acting = kingdom.leaders?.[op.actingLeaderIndex];
        if (acting) acting.lastActedDay = kingdom.turn.currentDay ?? 0;
      }
      return info;
    }

    case "leader-act": {
      if (kingdom.turn?.phase !== "week") return { ok: false };
      const aider = kingdom.leaders?.[op.leaderIndex];
      if (aider) aider.lastActedDay = kingdom.turn.currentDay ?? 0;
      return { ok: true };
    }

    case "event-roll": {
      const ev = (kingdom.activeEvents ?? []).find(e => e.id === op.eventId);
      if (!ev || ev.resolved) return { ok: false };
      const size = ev.clockSize ?? 10;
      const g = ev.greenFilled ?? 0, r = ev.redFilled ?? 0;
      if      (op.result === "crit-success") ev.greenFilled = Math.min(size, g + 2);
      else if (op.result === "success")      ev.greenFilled = Math.min(size, g + 1);
      else if (op.result === "failure")      ev.redFilled   = Math.min(size, r + 1);
      else if (op.result === "crit-failure") ev.redFilled   = Math.min(size, r + 2);
      const outcome = eventOutcome(ev.greenFilled ?? 0, ev.redFilled ?? 0, size, kingdom.settings?.eventThreshold ?? 7);
      const info = { ok: true, eventName: ev.name };
      if (outcome) {
        info.xp = resolveEvent(kingdom, ev, outcome);
        info.resolved = true;
        info.outcome = outcome;
      }
      return info;
    }
  }
  return { ok: false };
}

// ─── Default Kingdom Data ────────────────────────────────────────────────────

/** Current kingdom-data schema version. Bump when adding a migration step in migrateKingdom(). */
export const KINGDOM_DATA_VERSION = 7;

export function defaultKingdom() {
  return {
    dataVersion: KINGDOM_DATA_VERSION,
    name: "New Kingdom",
    level: 1,
    xp: 0,
    xpToNextLevel: null,
    partyLevel: 1,
    hexesClaimed: 1,
    turnNumber: 0,
    turnHistory: [],
    turn: {
      active: false,        // true while a turn is in progress (GM starts/ends it)
      phase: "event",       // "event" | "projects" | "week" | "complete"
      currentDay: 0,
      projectPhaseComplete: false,
      eventPhaseComplete: false,
      absentCount: 0,
      completedProjects: [], // { name, leaderName, complexity, xpReward }
      completedEvents:  [], // { name, outcomeResult, outcomeText }
      eventName: null,
    },
    leaders: [],
    activeEvents: [],
    settlements: [],
    armies: [],
    recruitCredits: 0,
    notes: "",
    ongoingEffects: [],  // { id, name, description, turnsRemaining }  (null = permanent)
    factions: [],        // { id, name, relationType, reputation, notes, history:[{id,date,text}] }
    settings: {
      xpPerLeader: 5,          // XP cost multiplier per leader
      ignoreHexCap: false,     // if true, hex count does not cap kingdom level
      armyTierFactor: ARMY_TIER_FACTOR, // free army allowance = round(Σ settlement tiers × this)
      recruitDcStep: RECRUIT_DC_STEP,   // recruit DC rise per army over the allowance
      eventThreshold: 7,                // green/red pips for a decisive event Success/Failure
      eventDecayPerTurn: 1,             // red pips added to each unresolved event at turn start
    },
  };
}

/**
 * Bring a stored kingdom object up to the current schema version, in place.
 * Additive and idempotent — only fills missing structural fields, never discards
 * data. Replaces the ad-hoc back-fills that were scattered through _prepareContext.
 * @param {object} kingdom
 * @returns {{data: object, changed: boolean}}
 */
export function migrateKingdom(kingdom) {
  if (!kingdom || typeof kingdom !== "object") {
    return { data: defaultKingdom(), changed: true };
  }
  let changed = false;
  const from = kingdom.dataVersion ?? 0;

  if (from < 1) {
    const d = defaultKingdom();
    for (const key of ["leaders", "activeEvents", "settlements", "armies", "ongoingEffects", "turnHistory"]) {
      if (!Array.isArray(kingdom[key])) { kingdom[key] = []; changed = true; }
    }
    if (typeof kingdom.settings !== "object" || kingdom.settings === null) {
      kingdom.settings = { ...d.settings }; changed = true;
    } else {
      if (kingdom.settings.xpPerLeader == null)  { kingdom.settings.xpPerLeader = 5;      changed = true; }
      if (kingdom.settings.ignoreHexCap == null) { kingdom.settings.ignoreHexCap = false; changed = true; }
    }
    if (typeof kingdom.turn !== "object" || kingdom.turn === null) { kingdom.turn = { ...d.turn }; changed = true; }
    if (!kingdom.turn.phase) {
      const t = kingdom.turn;
      t.phase = t.projectPhaseComplete ? (t.eventPhaseComplete ? "complete" : "week")
              : (t.eventPhaseComplete ? "projects" : "event");
      changed = true;
    }
  }

  if (from < 2) {
    // Army command economy: recruit credits earned by completing Recruit projects.
    if (typeof kingdom.recruitCredits !== "number") { kingdom.recruitCredits = 0; changed = true; }
  }

  if (from < 3) {
    // Army economy tuning promoted to GM settings.
    kingdom.settings ??= {};
    if (typeof kingdom.settings.armyTierFactor !== "number") { kingdom.settings.armyTierFactor = ARMY_TIER_FACTOR; changed = true; }
    if (typeof kingdom.settings.recruitDcStep  !== "number") { kingdom.settings.recruitDcStep  = RECRUIT_DC_STEP;  changed = true; }
  }

  if (from < 4) {
    // Event resolution v2: decisive threshold + per-turn decay.
    kingdom.settings ??= {};
    if (typeof kingdom.settings.eventThreshold   !== "number") { kingdom.settings.eventThreshold   = 7; changed = true; }
    if (typeof kingdom.settings.eventDecayPerTurn !== "number") { kingdom.settings.eventDecayPerTurn = 1; changed = true; }
  }

  if (from < 5) {
    // Explicit turn lifecycle: the GM starts and ends a turn. A save mid-turn
    // (turnNumber > 0 under the old always-running model) is treated as active.
    kingdom.turn ??= {};
    if (typeof kingdom.turn.active !== "boolean") { kingdom.turn.active = (kingdom.turnNumber ?? 0) > 0; changed = true; }
  }

  if (from < 6) {
    // Faction relations / reputation tracker.
    if (!Array.isArray(kingdom.factions)) { kingdom.factions = []; changed = true; }
  }

  if (from < 7) {
    // Per-settlement structures / notable landmarks.
    for (const s of kingdom.settlements ?? []) {
      if (!Array.isArray(s.structures)) { s.structures = []; changed = true; }
    }
  }

  if (kingdom.dataVersion !== KINGDOM_DATA_VERSION) {
    kingdom.dataVersion = KINGDOM_DATA_VERSION;
    changed = true;
  }
  return { data: kingdom, changed };
}
