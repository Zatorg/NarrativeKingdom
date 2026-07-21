/**
 * Narrative Kingdom Management — Foundry VTT v14 Module
 * Implements the Narrative Kingdom Management system for PF2e
 */
import { MODULE_ID } from "./constants.mjs";
import { registerHexColoringSettings, registerHexColoringHooks } from "./hex-coloring.mjs";
import { CampingApplication, defaultCampingState } from "./camping.mjs";
import { KingdomApplication, registerHelpers } from "./kingdom-app.mjs";
import {
  applyKingdomFieldPatch, applyKingdomOp, defaultKingdom, migrateKingdom, KINGDOM_DATA_VERSION,
} from "./kingdom-data.mjs";

// ─── Module Initialisation ───────────────────────────────────────────────────

Hooks.once("init", () => {
  // Register hex coloring settings
  registerHexColoringSettings();

  // Register settings
  game.settings.register(MODULE_ID, "kingdomData", {
    name: "Kingdom Data",
    hint: "Internal storage for Narrative Kingdom Management data.",
    scope: "world",
    config: false,
    type: Object,
    default: defaultKingdom(),
  });

  game.settings.register(MODULE_ID, "catalogData", {
    name: "Event Catalog Data",
    hint: "Custom event catalog overrides.",
    scope: "world",
    config: false,
    type: Array,
    default: [],
  });

  game.settings.register(MODULE_ID, "campingState", {
    name: "Camping State",
    hint: "Shared camping window state.",
    scope: "world",
    config: false,
    type: Object,
    default: defaultCampingState(),
  });

  game.settings.register(MODULE_ID, "nkFontSize", {
    name: "Narrative Kingdom — Font Size",
    hint: "Scale the text size of the Kingdom and Camping windows. 100 = default. The window size scales proportionally.",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 80, max: 150, step: 5 },
    default: 100,
    onChange: () => {
      NarrativeKingdom._instance?.applyFontScale();
      CampingApplication._instance?.applyFontScale();
    },
  });

  // Register partials under short alias names so HBS files don't embed the module ID
  const p = (name) => `modules/${MODULE_ID}/templates/partials/${name}.hbs`;
  foundry.applications.handlebars.loadTemplates({
    "nk-turn-tab":          p("turn-tab"),
    "nk-projects-tab":      p("projects-tab"),
    "nk-events-tab":        p("events-tab"),
    "nk-benefits-tab":      p("benefits-tab"),
    "nk-leaders-tab":       p("leaders-tab"),
    "nk-clock":             p("clock"),
    "nk-catalog-tab":       p("catalog-tab"),
    "nk-history-tab":       p("history-tab"),
    "nk-settlements-tab":   p("settlements-tab"),
    "nk-armies-tab":        p("armies-tab"),
    "nk-notes-tab":         p("notes-tab"),
    "nk-relations-tab":     p("relations-tab"),
    "nk-rules-tab":         p("rules-tab"),
    "nk-settings-tab":      p("settings-tab"),
    "nk-camping-travel-tab": p("camping-travel-tab"),
    "nk-camping-camp-tab":  p("camping-camp-tab"),
  });

  // Register camping sheet template
  foundry.applications.handlebars.loadTemplates([
    `modules/${MODULE_ID}/templates/camping-sheet.hbs`,
  ]);

  registerHelpers();
});

// Register hex coloring canvas hooks (canvasReady, updateSetting, toolbar button)
registerHexColoringHooks();

Hooks.once("ready", async () => {
  // One-time schema migration of stored kingdom data (GM writes the authoritative copy).
  if (game.user.isGM) {
    try {
      const { data, changed } = migrateKingdom(foundry.utils.deepClone(game.settings.get(MODULE_ID, "kingdomData")));
      if (changed) {
        await game.settings.set(MODULE_ID, "kingdomData", data);
        console.log(`[NarrativeKingdom] migrated kingdom data to schema v${KINGDOM_DATA_VERSION}.`);
      }
    } catch (err) {
      console.error("[NarrativeKingdom] kingdom data migration failed:", err);
    }
  }

  // Register a scene control button to open the kingdom sheet
  game.narrativeKingdom = {
    open() {
      if (!NarrativeKingdom._instance) {
        NarrativeKingdom._instance = new KingdomApplication();
      }
      NarrativeKingdom._instance.render(true);
    },
  };

  // Socket: GMs handle save requests from non-GM players
  game.socket.on(`module.${MODULE_ID}`, async (msg) => {
    if (!game.user.isGM) return;
    // Validate the payload before trusting a socket message from another client.
    if (!msg || typeof msg !== "object" || typeof msg.action !== "string") return;
    const isPlainObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
    try {
      switch (msg.action) {
        case "saveKingdom":
          if (!isPlainObject(msg.data)) return;
          await game.settings.set(MODULE_ID, "kingdomData", msg.data);
          break;
        case "patchKingdom": {
          if (!isPlainObject(msg.patch) || typeof msg.patch.name !== "string") return;
          const kingdom = foundry.utils.deepClone(game.settings.get(MODULE_ID, "kingdomData"));
          applyKingdomFieldPatch(kingdom, msg.patch);
          await game.settings.set(MODULE_ID, "kingdomData", kingdom);
          break;
        }
        case "opKingdom": {
          if (!isPlainObject(msg.op) || typeof msg.op.type !== "string") return;
          const kingdom = foundry.utils.deepClone(game.settings.get(MODULE_ID, "kingdomData"));
          applyKingdomOp(kingdom, msg.op);
          await game.settings.set(MODULE_ID, "kingdomData", kingdom);
          break;
        }
        case "saveCatalog":
          if (!Array.isArray(msg.data)) return;
          await game.settings.set(MODULE_ID, "catalogData", msg.data);
          break;
        case "saveCamping":
          if (!isPlainObject(msg.data)) return;
          await game.settings.set(MODULE_ID, "campingState", msg.data);
          break;
        default:
          return; // unknown action — ignore
      }
    } catch (err) {
      console.error(`[NarrativeKingdom] failed to save settings via socket:`, err);
    }
  });
});

// (Scene control buttons intentionally omitted — both tools open from the sidebar party header.)

// Expose for macro / console use
globalThis.NarrativeKingdom = { _instance: null, open: () => game.narrativeKingdom.open() };
globalThis.NarrativeCamping = { open: () => CampingApplication.open() };

// Re-render the open sheet on ALL clients when kingdom or catalog data changes
Hooks.on("updateSetting", (setting) => {
  if (
    (setting.key === `${MODULE_ID}.kingdomData` ||
     setting.key === `${MODULE_ID}.catalogData` ||
     setting.key === "pf2e-kingmaker.state") &&
    NarrativeKingdom._instance?.rendered
  ) {
    NarrativeKingdom._instance.clearPendingKingdom?.();
    NarrativeKingdom._instance.render();
  }

  if (setting.key === `${MODULE_ID}.campingState` && CampingApplication._instance?.rendered) {
    CampingApplication._instance.clearPendingState?.();
    CampingApplication._instance.render();
  }
});

// Also refresh on canvas ready (scene switch) since the region map reinitialises
Hooks.on("canvasReady", () => {
  if (NarrativeKingdom._instance?.rendered) {
    NarrativeKingdom._instance.render();
  }
});

// Override the pf2e-kingmaker "Create Kingdom" button in the Actors sidebar party folder.
// The button lives in renderActorDirectory, not renderPartySheetPF2e — it's always visible
// in the sidebar without opening the party sheet (mirrors pf2e-kingmaker-tools/Icons.kt).
Hooks.on("renderActorDirectory", (_app, html) => {
  const root = (html instanceof HTMLElement) ? html : html[0];
  if (!root) return;

  root.querySelectorAll(".folder[data-party]").forEach(folder => {
    // Avoid injecting twice
    if (folder.querySelector(".nk-sidebar-btn")) return;

    // GMs: hide the pf2e built-in "Create Kingdom" button and replace it
    if (game.user.isGM) {
      const builtinBtn = folder.querySelector("button[data-tooltip='Create Kingdom']");
      if (builtinBtn) {
        builtinBtn.hidden = true;
        builtinBtn.dataset.nkReplaced = "1";
      }
    }

    // Find the folder header actions area to append into
    const header = folder.querySelector(".folder-header") ?? folder;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.classList.add("create-button", "nk-sidebar-btn");
    btn.dataset.tooltip = game.i18n.localize("NARRATIVEKINGDOM.OpenSheet") || "Kingdom";
    btn.innerHTML = `<i class="fa-solid fa-crown"></i>`;
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      game.narrativeKingdom.open();
    });
    header.append(btn);

    const campBtn = document.createElement("button");
    campBtn.type = "button";
    campBtn.classList.add("create-button", "nk-sidebar-btn");
    campBtn.dataset.tooltip = "Camping";
    campBtn.innerHTML = `<i class="fa-solid fa-tent"></i>`;
    campBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      CampingApplication.open();
    });
    header.append(campBtn);
  });
});
