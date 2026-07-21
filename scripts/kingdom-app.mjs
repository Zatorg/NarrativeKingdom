/**
 * Narrative Kingdom Management — the KingdomApplication (ApplicationV2 sheet)
 * and its Handlebars helpers. Extracted from narrative-kingdom.mjs.
 */
import { MODULE_ID } from "./constants.mjs";
import {
  eventCatalog, PROJECT_XP, SETTLEMENT_THRESHOLDS, SETTLEMENT_NEXT_STAGE, KINGDOM_BENEFITS,
  getKingmakerClaimedHexes, hexesForLevel, hexLevelCap, getPf2eDate, xpMultiplier,
  LEVEL_DC, DC_ADJUSTMENTS, effectiveMaxLevel, clampXp, applyKingdomFieldPatch, applyKingdomOp, defaultKingdom,
  armyAllowance, recruitPenalty, eventOutcome, normalizeOutcome, parseEventLevelMod, eventDC, factionStanding, clampReputation, EARN_INCOME_PER_DAY,
} from "./kingdom-data.mjs";
import {
  onLeaderDrop,
  onStartNewTurn,
  onEndTurn,
  onCompleteProjectPhase,
  onBeginWeek,
  onAdvanceDay,
  onTriggerEvent,
  onSkipEvent,
  onAddProject,
  onRemoveProject,
  onRollResult,
  onTurnAid,
  onAidProject,
  onAddEvent,
  onAddRandomEvent,
  onRemoveEvent,
  onEventRoll,
  onAddLeader,
  onRemoveLeader,
  onResetKingdom,
  onCatalogAdd,
  onCatalogEdit,
  onCatalogRemove,
  onAddSettlement,
  onRemoveSettlement,
  onSettlementAddSegments,
  onSettlementAdvanceStage,
  onAddStructure,
  onRemoveStructure,
  onArmyDrop,
  onRemoveArmy,
  onOpenArmySheet,
  onCreateArmyProject,
  onRecruitArmy,
  onAddEffect,
  onRemoveEffect,
  onAddFaction,
  onRemoveFaction,
  onFactionRepAdjust,
  onFactionLog,
  onFactionLogRemove,
  onToggleHexesOverride,
  onExportData,
  onImportData,
  onCatalogReset,
  onCatalogExport,
  onCatalogImport,
  onAdvanceLevel,
} from "./kingdom-actions.mjs";

// V14 compat: TextEditor moved to foundry.applications.ux.TextEditor.implementation
const TextEditor = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;

// ─── KingdomApplication ──────────────────────────────────────────────────────

export class KingdomApplication extends foundry.applications.api.ApplicationV2 {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "narrative-kingdom",
    classes: ["narrative-kingdom"],
    tag: "div",
    window: {
      title: "Narrative Kingdom Management",
      resizable: true,
      minimizable: true,
    },
    position: { width: 1060, height: 680 },
    actions: {
      "start-new-turn":        onStartNewTurn,
      "end-turn":              onEndTurn,
      "complete-project-phase":onCompleteProjectPhase,
      "trigger-event":         onTriggerEvent,
      "skip-event":            onSkipEvent,
      "add-project":           onAddProject,
      "remove-project":        onRemoveProject,
      "roll-result":           onRollResult,
      "aid-project":           onAidProject,
      "turn-aid":              onTurnAid,
      "add-event":             onAddEvent,
      "add-random-event":      onAddRandomEvent,
      "remove-event":          onRemoveEvent,
      "event-roll":            onEventRoll,
      "add-leader":            onAddLeader,
      "remove-leader":         onRemoveLeader,
      "advance-level":         onAdvanceLevel,
      "reset-kingdom":         onResetKingdom,
      "begin-week":            onBeginWeek,
      "advance-day":           onAdvanceDay,
      "catalog-add":           onCatalogAdd,
      "catalog-edit":          onCatalogEdit,
      "catalog-remove":        onCatalogRemove,
      "catalog-reset":         onCatalogReset,
      "catalog-export":        onCatalogExport,
      "catalog-import":        onCatalogImport,
      "add-settlement":           onAddSettlement,
      "remove-settlement":         onRemoveSettlement,
      "settlement-add-segments":   onSettlementAddSegments,
      "settlement-advance-stage":  onSettlementAdvanceStage,
      "add-structure":             onAddStructure,
      "remove-structure":          onRemoveStructure,
      "remove-army":           onRemoveArmy,
      "open-army-sheet":       onOpenArmySheet,
      "army-project":          onCreateArmyProject,
      "recruit-army":          onRecruitArmy,
      "add-effect":            onAddEffect,
      "remove-effect":         onRemoveEffect,
      "add-faction":           onAddFaction,
      "remove-faction":        onRemoveFaction,
      "faction-rep":           onFactionRepAdjust,
      "faction-log":           onFactionLog,
      "faction-log-remove":    onFactionLogRemove,
      "export-data":           onExportData,
      "import-data":           onImportData,
      "toggle-hexes-override": onToggleHexesOverride,
    },
  };

  /** @type {string} */
  activeTab = "turn";

  /** Client-side view state: settlement indices currently expanded to full detail. */
  expandedSettlements = new Set();

  /** Last font-scale percentage applied via setPosition — avoids resizing the window
   *  (and clobbering a user's manual resize) on every save/render. */
  #lastFontPct = null;

  /** Optimistic cache: non-GMs write here immediately so the UI doesn't flicker back to old data
   *  while waiting for the GM to confirm the socket-routed save. Cleared on updateSetting. */
  #pendingKingdom = null;

  /** @returns {object} the kingdom data stored in the world's module settings */
  get kingdom() {
    return this.#pendingKingdom ?? game.settings.get(MODULE_ID, "kingdomData");
  }

  async saveKingdom(data) {
    if (game.user.isGM) {
      this.#pendingKingdom = null;
      await game.settings.set(MODULE_ID, "kingdomData", data);
    } else {
      this.#pendingKingdom = data;
      game.socket.emit(`module.${MODULE_ID}`, { action: "saveKingdom", data });
    }
    this.render();
  }

  /** Called by the updateSetting hook once the authoritative data is confirmed. */
  clearPendingKingdom() {
    this.#pendingKingdom = null;
  }

  /**
   * Apply a semantic operation (see applyKingdomOp) instead of writing a full
   * snapshot. The GM applies it onto freshly-read authoritative data; a non-GM
   * applies it optimistically and relays the op (not a snapshot) to the GM, so a
   * concurrent per-entity edit by another player is never clobbered.
   * @returns {Promise<object>} the applyKingdomOp info (for notifications)
   */
  async applyOp(op) {
    const base = game.user.isGM ? game.settings.get(MODULE_ID, "kingdomData") : this.kingdom;
    const kingdom = foundry.utils.deepClone(base);
    const info = applyKingdomOp(kingdom, op);
    if (info?.ok === false) return info; // rejected — nothing to persist
    if (game.user.isGM) {
      this.#pendingKingdom = null;
      await game.settings.set(MODULE_ID, "kingdomData", kingdom);
    } else {
      this.#pendingKingdom = kingdom;
      game.socket.emit(`module.${MODULE_ID}`, { action: "opKingdom", op });
    }
    this.render();
    return info;
  }

  async saveCatalog(data) {
    if (game.user.isGM) {
      await game.settings.set(MODULE_ID, "catalogData", data);
    } else {
      game.socket.emit(`module.${MODULE_ID}`, { action: "saveCatalog", data });
    }
    this.render();
  }

  /** @override */
  async _prepareContext(_options) {
    const kingdom = this.kingdom;
    const level = kingdom.level;
    const leaderCount = kingdom.leaders.length;
    // xpToNextLevel is locked when first set and only resets on level-up,
    // so removing leaders mid-level can't reduce the cost.
    const xpNeeded = kingdom.xpToNextLevel ?? (leaderCount * xpMultiplier(kingdom));

    // Prefer live hex count from pf2e-kingmaker if available, unless manually overridden
    const liveHexes = getKingmakerClaimedHexes();
    const hexesAvailableLive = liveHexes !== null;
    const hexesLinked = hexesAvailableLive && !kingdom.hexesManualOverride;
    const hexesClaimed = hexesLinked ? liveHexes : (kingdom.hexesClaimed ?? 1);

    const hexLevelCapValue = hexLevelCap(hexesClaimed);
    const maxLevel = effectiveMaxLevel(kingdom, hexesClaimed);
    const nextLevel = Math.min(20, level + 1);
    const hexesForNextLevel = hexesForLevel(nextLevel);
    const hexesNeededMore = Math.max(0, hexesForNextLevel - hexesClaimed);
    const hexProgression = Array.from({ length: 20 }, (_, i) => ({
      level: i + 1,
      hexesNeeded: hexesForLevel(i + 1),
      current: (i + 1) === level,
    }));

    // Annotate leaders with project helper flags
    const standardDCValue = LEVEL_DC[level] ?? 0;
    const turnCurrentDay = kingdom.turn?.currentDay ?? 0;
    const leaders = kingdom.leaders.map(leader => {
      const projects = (leader.projects ?? []).map(p => {
        const mod = p.dcMod ?? 0;
        const bonus = p.dcBonus ?? 0; // mandatory offset (e.g. recruit army-count penalty)
        return {
          ...p,
          dcMod: mod,
          dcBonus: bonus,
          effectiveDC: standardDCValue + mod + bonus,
          dcLabel: (DC_ADJUSTMENTS.find(a => a.mod === mod)?.label) ?? "Standard",
          dcOptions: DC_ADJUSTMENTS.map(a => ({
            mod: a.mod, label: a.label, dc: standardDCValue + a.mod + bonus, selected: a.mod === mod,
          })),
          pips: Array.from({ length: p.complexity }, (_, i) => ({ filled: i < (p.filled ?? 0) })),
        };
      });
      const activeProjects = projects.filter(p => !p.complete);
      return {
        ...leader,
        projects,
        projectCount: activeProjects.length,
        canAddProject: activeProjects.length < 3,
        hasComplexity4:  activeProjects.some(p => p.complexity === 4),
        hasComplexity6:  activeProjects.some(p => p.complexity === 6),
        hasComplexity10: activeProjects.some(p => p.complexity === 10),
        actedToday: turnCurrentDay > 0 && (leader.lastActedDay === turnCurrentDay),
      };
    });

    // Compute starting green points for new events based on benefits
    let eventStartGreen = 0;
    const hasProblemSolvers   = level >= 7;
    const hasNothingCanStopUs = level >= 14;
    if (hasNothingCanStopUs) eventStartGreen = 2;
    else if (hasProblemSolvers) eventStartGreen = 1;
    const eventClockSize = 10;

    // Benefits
    const benefits = KINGDOM_BENEFITS.map(b => ({
      ...b,
      unlocked: level >= b.level,
    }));

    // Hydrate active events with catalog data for any fields missing on saved objects
    // (covers events added before the structured catalog existed)
    const activeEvents = (kingdom.activeEvents ?? []).map(ev => {
      let e = ev;
      if (!ev.description) {                    // hydrate legacy events from the catalog
        const entry = eventCatalog().find(x => x.name === ev.name);
        if (entry) e = {
          ...ev,
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
      // Split each outcome into { rp (players), gm (mechanics) }; legacy strings stay GM-only.
      const outcomesView = {
        success: normalizeOutcome(e.outcomes?.success),
        neutral: normalizeOutcome(e.outcomes?.neutral),
        failure: normalizeOutcome(e.outcomes?.failure),
      };
      const resolvedView = (e.resolved && e.outcomeResult) ? outcomesView[e.outcomeResult] : null;
      const levelMod = parseEventLevelMod(e.subtitle);
      const eventLevel = Math.max(0, Math.min(25, (level ?? 1) + levelMod));
      return { ...e, outcomesView, resolvedView, levelMod, eventLevel, eventDC: eventDC(level, levelMod) };
    });

    // Enrich leader notes and project notes for inline link rendering
    for (const leader of leaders) {
      leader.notesEnriched = await TextEditor.enrichHTML(leader.notes ?? "", { async: true });
      for (const project of leader.projects ?? []) {
        project.notesEnriched = await TextEditor.enrichHTML(project.notes ?? "", { async: true });
      }
    }

    // Enrich event notes
    for (const ev of activeEvents) {
      ev.notesEnriched = await TextEditor.enrichHTML(ev.notes ?? "", { async: true });
    }

    // Settlements
    const settlements = kingdom.settlements ?? [];
    const hasCapital = settlements.some(s => s.isCapital);

    // Enrich settlement notes
    for (let si = 0; si < settlements.length; si++) {
      const s = settlements[si];
      s.notesEnriched             = await TextEditor.enrichHTML(s.notes            ?? "", { async: true });
      s.importantPeopleEnriched   = await TextEditor.enrichHTML(s.importantPeople  ?? "", { async: true });
      // Progress toward next stage
      const threshold   = SETTLEMENT_THRESHOLDS[s.stage] ?? null;
      const segs        = s.completedSegments ?? 0;
      s.threshold       = threshold;
      s.nextStageLabel  = SETTLEMENT_NEXT_STAGE[s.stage] ?? null;
      s.progressPct     = threshold ? Math.min(100, Math.round((segs / threshold) * 100)) : 100;
      s.canAdvance      = threshold !== null && segs >= threshold;
      s.expanded        = this.expandedSettlements.has(si);
    }

    // Enrich kingdom-level notes
    const notesEnrichedKingdom = await TextEditor.enrichHTML(kingdom.notes ?? "", { async: true });

    // Enrich ongoing effects
    const ongoingEffects = await Promise.all(
      (kingdom.ongoingEffects ?? []).map(async (eff) => ({
        ...eff,
        descriptionEnriched: await TextEditor.enrichHTML(eff.description ?? "", { async: true }),
        expiring: eff.turnsRemaining != null && eff.turnsRemaining <= 1,
      }))
    );

    // Armies — resolve live actor data for each linked UUID
    const armies = await Promise.all(
      (kingdom.armies ?? []).map(async (entry) => {
        const actor = entry.actorUuid ? await fromUuid(entry.actorUuid).catch(() => null) : null;
        const hp    = actor?.system?.attributes?.hp;
        const actorLevel = actor?.system?.details?.level?.value ?? actor?.system?.details?.cr?.value ?? null;
        const notesEnriched = await TextEditor.enrichHTML(entry.notes ?? "", { async: true });
        // Live conditions/effects applied to the army actor (Weary, Mired, etc.)
        const conditions = actor ? [
          ...(actor.itemTypes?.condition ?? []).map(c => ({ name: c.name, value: c.system?.value?.value ?? null })),
          ...(actor.itemTypes?.effect    ?? []).map(e => ({ name: e.name, value: e.system?.badge?.value ?? null })),
        ] : [];
        return {
          ...entry,
          notesEnriched,
          // Live fields from actor
          displayName:  actor?.name          ?? entry.name ?? "Unknown",
          img:          actor?.img           ?? "icons/svg/mystery-man.svg",
          hpValue:      hp?.value            ?? null,
          hpMax:        hp?.max              ?? null,
          routThreshold: hp?.routThreshold   ?? null,
          level:         actorLevel,
          expectedLevel: kingdom.level,           // armies fight at the kingdom's level
          levelMismatch: actorLevel != null && actorLevel !== kingdom.level,
          conditions,
          hasConditions: conditions.length > 0,
          routed:       (hp?.value != null && hp?.routThreshold != null) ? hp.value <= hp.routThreshold : false,
          actorMissing: !actor,
        };
      })
    );

    // Army command economy — free allowance from settlement development, recruit-DC ramp
    const { tierSum: armyTierSum, allowance: armyAllowanceValue } = armyAllowance(kingdom);
    const armyPenalty = recruitPenalty(armies.length, armyAllowanceValue, kingdom.settings?.recruitDcStep);
    const armyInfo = {
      count:     armies.length,
      allowance: armyAllowanceValue,
      tierSum:   armyTierSum,
      penalty:   armyPenalty,
      recruitDC: (LEVEL_DC[level] ?? 0) + armyPenalty,
      atOrOver:  armies.length >= armyAllowanceValue,
      credits:   kingdom.recruitCredits ?? 0,
      kingdomLevel: level,
    };

    // Compute turn phase — back-fill for saves that pre-date the phase field
    const turn = { ...(kingdom.turn ?? {}) };
    if (!turn.phase) {
      if (turn.projectPhaseComplete) turn.phase = turn.eventPhaseComplete ? "complete" : "week";
      else if (turn.eventPhaseComplete) turn.phase = "projects";
      else turn.phase = "event";
    }

    // Precompute 7-day pip states for the template (avoids index arithmetic in Handlebars)
    const currentDay = turn.currentDay ?? 0;
    turn.dayPips = Array.from({ length: 7 }, (_, i) => ({
      day:     i + 1,
      filled:  i < currentDay,
      current: i === currentDay - 1,
    }));

    // Faction relations (PF2e reputation standings)
    const factions = (kingdom.factions ?? []).map(f => {
      const rep = clampReputation(f.reputation ?? 0);
      const standing = factionStanding(rep);
      return { ...f, reputation: rep, standingKey: standing.key, standingLabel: standing.label, history: f.history ?? [] };
    });

    return {
      kingdom: {
        ...kingdom,
        turn,
        factions,
        leaders,
        activeEvents,
        settlements,
        hasCapital,
        xpNeeded,
        maxLevel,
        hexesClaimed,
        hexesLinked,
        hexesAvailableLive,
        canLevelUp: kingdom.xp >= xpNeeded && level < maxLevel,
        eventClockSize,
        eventStartGreen,
        hasProblemSolvers,
        hasNothingCanStopUs,
        hexLevelCap: hexLevelCapValue,
        hexesForNextLevel,
        hexesNeededMore,
        nextLevel,
        notesEnriched: notesEnrichedKingdom,
        ongoingEffects,
        standardDC: LEVEL_DC[level] ?? null,
        earnIncomePerDay:  EARN_INCOME_PER_DAY[level] ?? null,
        earnIncomePerWeek: (EARN_INCOME_PER_DAY[level] ?? 0) * 7,
      },
      benefits,
      hexProgression,
      activeTab: (!game.user.isGM && this.activeTab === "catalog") ? "turn" : this.activeTab,
      isGM: game.user.isGM,
      eventCatalog: eventCatalog().map(e => ({ name: e.name })),
      fullCatalog: eventCatalog(),
      turnHistory: [...(kingdom.turnHistory ?? [])].reverse(),
      armies, // newest first
      armyInfo,
    };
  }

  /** @override */
  async _renderHTML(context, _options) {
    const content = await foundry.applications.handlebars.renderTemplate(
      `modules/${MODULE_ID}/templates/kingdom-sheet.hbs`,
      context
    );
    const div = document.createElement("div");
    div.innerHTML = content;
    return div;
  }

  /** @override */
  _onRender(_context, _options) {
    this.applyFontScale();
  }

  applyFontScale() {
    const BASE_W = 1060;
    const BASE_H = 680;
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

  /** @override */
  _replaceHTML(result, content, _options) {
    const activePane = content.querySelector(".nk-tab-content:not(.hidden)");
    const scrollTop = activePane?.scrollTop ?? 0;

    content.innerHTML = result.innerHTML;
    this._attachListeners(content);

    // Restore scroll position
    if (scrollTop > 0) {
      const newPane = content.querySelector(".nk-tab-content:not(.hidden)");
      if (newPane) newPane.scrollTop = scrollTop;
    }
  }

  _attachListeners(html) {
    // Tab switching
    html.querySelectorAll(".nk-tab-btn").forEach(btn => {
      btn.addEventListener("click", ev => {
        const tab = ev.currentTarget.dataset.tab;
        // Guard: non-GMs cannot access the catalog tab
        if (tab === "catalog" && !game.user.isGM) return;
        this.activeTab = tab;
        this.render();
      });
    });

    // Settlement cards: expand/collapse (client-side view state)
    html.querySelectorAll(".nk-settlement-toggle").forEach(el => {
      el.addEventListener("click", ev => {
        ev.preventDefault();
        const idx = parseInt(ev.currentTarget.dataset.settlementIndex);
        if (Number.isNaN(idx)) return;
        if (this.expandedSettlements.has(idx)) this.expandedSettlements.delete(idx);
        else this.expandedSettlements.add(idx);
        this.render();
      });
    });

    // Kingdom name: ✎ reveals an inline rename field (saves on blur/Enter via the
    // standard field-change handler)
    const titleEl = html.querySelector(".nk-title");
    if (titleEl) {
      const editBtn = titleEl.querySelector(".nk-title-edit");
      const input   = titleEl.querySelector("input[name='name']");
      const display = titleEl.querySelector(".nk-title-display");
      editBtn?.addEventListener("click", () => {
        display.classList.add("hidden");
        editBtn.classList.add("hidden");
        input.classList.remove("hidden");
        input.focus();
        input.select();
        const onKey = (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } };
        input.addEventListener("keydown", onKey);
        input.addEventListener("blur", () => {
          input.removeEventListener("keydown", onKey);
          input.classList.add("hidden");
          display.classList.remove("hidden");
          editBtn.classList.remove("hidden");
        }, { once: true });
      });
    }

    // Auto-save text inputs / textareas on change
    html.querySelectorAll("input[type=text], input[type=number], textarea").forEach(el => {
      el.addEventListener("change", () => this.#onFieldChange(el));
    });

    // Checkboxes and radio buttons
    html.querySelectorAll("input[type=checkbox], input[type=radio], select").forEach(el => {
      if (el.classList.contains("nk-complexity-select")) return; // ephemeral — not a saved field
      if (el.classList.contains("nk-event-catalog-select")) return; // ephemeral — picker, not a saved field
      el.addEventListener("change", () => this.#onFieldChange(el));
    });

    // Click-to-edit enriched notes fields
    html.querySelectorAll(".nk-notes-display").forEach(display => {
      display.addEventListener("click", (ev) => {
        // Let link clicks pass through without entering edit mode
        if (ev.target.closest("a")) return;
        const field = display.closest(".nk-notes-field");
        const ta = field?.querySelector("textarea");
        if (!ta) return;
        display.classList.add("hidden");
        ta.classList.remove("hidden");
        ta.focus();
        ta.addEventListener("blur", () => {
          ta.classList.add("hidden");
          display.classList.remove("hidden");
        }, { once: true });
      });
    });

    // Leader drag-drop from Actors directory
    const dropZone = html.querySelector(".nk-leaders-drop-zone");
    if (dropZone) {
      dropZone.addEventListener("dragover", ev => {
        ev.preventDefault();
        dropZone.classList.add("nk-drag-over");
      });
      dropZone.addEventListener("dragleave", ev => {
        if (!dropZone.contains(ev.relatedTarget)) {
          dropZone.classList.remove("nk-drag-over");
        }
      });
      dropZone.addEventListener("drop", ev => {
        dropZone.classList.remove("nk-drag-over");
        onLeaderDrop.call(this, ev);
      });
    }

    // Army drag-drop from Actors directory
    const armyDropZone = html.querySelector(".nk-armies-drop-zone");
    if (armyDropZone) {
      armyDropZone.addEventListener("dragover", ev => {
        ev.preventDefault();
        armyDropZone.classList.add("nk-drag-over");
      });
      armyDropZone.addEventListener("dragleave", ev => {
        if (!armyDropZone.contains(ev.relatedTarget)) {
          armyDropZone.classList.remove("nk-drag-over");
        }
      });
      armyDropZone.addEventListener("drop", ev => {
        armyDropZone.classList.remove("nk-drag-over");
        onArmyDrop.call(this, ev);
      });
    }

    // Autocomplete for project skill fields.
    this.#attachSkillAutocomplete(html);
  }

  /** Skills offered by the project skill-field autocomplete. */
  static #SKILLS = [
    "Acrobatics", "Arcana", "Athletics", "Crafting", "Deception", "Diplomacy",
    "Intimidation", "Medicine", "Nature", "Occultism", "Perception", "Performance",
    "Religion", "Society", "Stealth", "Survival", "Thievery", "Warfare Lore",
  ];

  /**
   * Attach a lightweight autocomplete to each project skill input. It completes the
   * current comma-separated token, so both single- and multi-skill fields work.
   * Selections don't save mid-edit (kept smooth for multi-skill); the field saves
   * on blur via the existing change handler.
   */
  #attachSkillAutocomplete(html) {
    const SKILLS = KingdomApplication.#SKILLS;
    // Clear any dropdown orphaned by a previous render.
    document.querySelectorAll(".nk-autocomplete").forEach(b => b.remove());
    html.querySelectorAll(".nk-project-skill-input").forEach(input => {
      let box = null, items = [], active = -1, dirty = false;

      const close = () => { box?.remove(); box = null; items = []; active = -1; };
      const tokenBounds = () => {
        const v = input.value, caret = input.selectionStart ?? v.length;
        const start = v.lastIndexOf(",", caret - 1) + 1;
        let end = v.indexOf(",", caret); if (end < 0) end = v.length;
        return { start, end, token: v.slice(start, end).trim() };
      };
      const highlight = () => box?.querySelectorAll(".nk-ac-item")
        .forEach((el, i) => el.classList.toggle("active", i === active));

      const render = () => {
        const q = tokenBounds().token.toLowerCase();
        const matches = q
          ? SKILLS.filter(s => s.toLowerCase().includes(q) && s.toLowerCase() !== q).slice(0, 8)
          : [];
        if (!matches.length) { close(); return; }
        if (!box) {
          box = document.createElement("div");
          box.className = "nk-autocomplete";
          document.body.appendChild(box); // escape the tab's overflow + the window's transform
        }
        const rect = input.getBoundingClientRect();
        box.style.top = `${rect.bottom}px`;
        box.style.left = `${rect.left}px`;
        box.style.minWidth = `${rect.width}px`;
        items = matches; active = -1;
        box.innerHTML = matches.map((m, i) => `<div class="nk-ac-item" data-i="${i}">${m}</div>`).join("");
        box.querySelectorAll(".nk-ac-item").forEach(el =>
          el.addEventListener("mousedown", ev => { ev.preventDefault(); choose(+el.dataset.i); }));
      };

      const choose = (i) => {
        const skill = items[i]; if (!skill) return;
        const { start, end } = tokenBounds();
        const head = input.value.slice(0, start).replace(/[\s,]*$/, "");
        const tail = input.value.slice(end).replace(/^[\s,]*/, "");
        const newHead = (head ? head + ", " : "") + skill + ", ";
        input.value = newHead + tail;
        input.focus();
        input.setSelectionRange(newHead.length, newHead.length);
        dirty = true;
        close();
      };

      input.addEventListener("input", render);
      input.addEventListener("focus", render);
      input.addEventListener("blur", () => {
        setTimeout(close, 150); // let a click on an item register first
        if (dirty) { dirty = false; input.dispatchEvent(new Event("change", { bubbles: true })); }
      });
      input.addEventListener("keydown", (ev) => {
        if (!box) return;
        if (ev.key === "ArrowDown")    { active = Math.min(active + 1, items.length - 1); highlight(); ev.preventDefault(); }
        else if (ev.key === "ArrowUp") { active = Math.max(active - 1, 0); highlight(); ev.preventDefault(); }
        else if (ev.key === "Enter")   { if (active >= 0) { choose(active); ev.preventDefault(); } }
        else if (ev.key === "Escape")  { close(); }
      });
    });
  }

  /** Handle an actor dropped onto the leaders drop zone. */
  /** Persist a single changed form field via a targeted patch (reduces multi-user clobbering). */
  async #onFieldChange(el) {
    if (!el?.name) return;
    await this.saveFieldPatch({
      name:    el.name,
      value:   el.value,
      checked: el.checked,
      type:    el.type,
    });
  }

  /**
   * Apply a single field patch. The GM re-applies it onto the latest authoritative
   * data so concurrent edits to *different* fields don't overwrite each other.
   */
  async saveFieldPatch(patch) {
    if (game.user.isGM) {
      this.#pendingKingdom = null;
      const kingdom = foundry.utils.deepClone(game.settings.get(MODULE_ID, "kingdomData"));
      applyKingdomFieldPatch(kingdom, patch);
      await game.settings.set(MODULE_ID, "kingdomData", kingdom);
    } else {
      const kingdom = foundry.utils.deepClone(this.kingdom);
      applyKingdomFieldPatch(kingdom, patch);
      this.#pendingKingdom = kingdom;
      game.socket.emit(`module.${MODULE_ID}`, { action: "patchKingdom", patch });
    }
    this.render();
  }
}

// ─── Handlebars Helpers ──────────────────────────────────────────────────────

export function registerHelpers() {
  Handlebars.registerHelper("nkTimes", function(n, options) {
    let result = "";
    for (let i = 0; i < n; i++) {
      const data = Handlebars.createFrame(options.data);
      data.index = i;
      data.first = i === 0;
      data.last  = i === (n - 1);
      result += options.fn(this, { data });
    }
    return result;
  });

  // Returns the CSS class for a clock segment in event (dual-colour) mode.
  // Segments 0..(greenFilled-1) are green, then (redFilled) segments are red, rest empty.
  Handlebars.registerHelper("nkSegmentClass", function(index, greenFilled, redFilled) {
    if (typeof greenFilled !== "number" || typeof redFilled !== "number") return "";
    if (index < greenFilled) return "green";
    if (index < greenFilled + redFilled) return "red";
    return "";
  });

  Handlebars.registerHelper("lt",  (a, b) => a < b);
  Handlebars.registerHelper("gte", (a, b) => a >= b);
  Handlebars.registerHelper("eq",  (a, b) => a === b);
  Handlebars.registerHelper("inc", (n) => n + 1);
  Handlebars.registerHelper("dec", (n) => n - 1);
}
