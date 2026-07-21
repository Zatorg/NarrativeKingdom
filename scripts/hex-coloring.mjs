/**
 * Hex Exploration Coloring
 *
 * Draws a colored overlay on the Kingmaker region map based on each hex's
 * exploration state (reconnoitered / mapped / claimed).
 *
 * Adapted from pf2e-kingmaker-helper by reyzor1991
 * https://github.com/reyzor1991/pf2e-kingmaker-helper/blob/master/src/main.js
 */

import { MODULE_ID } from "./constants.mjs";

// ─── Utilities ───────────────────────────────────────────────────────────────

const normalize = (val, max, min) => (val - min) / (max - min);

const hexToAlpha = (alphaHexString) =>
  parseFloat(normalize(parseInt(alphaHexString, 16), 255, 0).toFixed(2));

/** Split an 8-char hex string "#rrggbbAA" into { rgb: "#rrggbb", alpha: 0-255 } */
function splitStoredColor(stored) {
  const rgb   = stored.substring(0, 7);           // "#rrggbb"
  const alpha = parseInt(stored.substring(7), 16); // 0-255
  return { rgb, alpha: isNaN(alpha) ? 38 : alpha };
}

/** Combine a "#rrggbb" string and a 0-255 integer back into "#rrggbbAA" */
function combineColor(rgb, alpha) {
  return rgb + alpha.toString(16).padStart(2, "0");
}

// ─── Hex helpers ─────────────────────────────────────────────────────────────

function getHexes(filter) {
  return Object.entries(
    foundry.utils.deepClone(game.settings.get("pf2e-kingmaker", "state").hexes)
  )
    .filter((data) => filter(data[1], Number(data[0])))
    .map((a) => Number(a[0]))
    .map((n) => kingmaker.region.hexes.get(n))
    .filter((h) => !!h);
}

function createPolygon(hex) {
  const v = canvas.grid.getVertices(hex);
  for (const i of v) {
    i.x += hex.center.x;
    i.y += hex.center.y - 158;
  }
  return new PIXI.Polygon(v);
}

function createPolygons(hexes) {
  return hexes.map((h) => createPolygon(h));
}

function fillColor(g, polygons, color, alpha) {
  g.beginFill(color, alpha).lineStyle({
    color,
    width: game.settings.get(MODULE_ID, "hexOutlineWidth"),
  });
  for (const polygon of polygons) {
    g.drawShape(polygon);
  }
  g.endFill();
}

function getColor(name) {
  const val = game.settings.get(MODULE_ID, name);
  return {
    color: Color.from(val.substring(0, val.length - 2)),
    alpha: hexToAlpha(val.substring(val.length - 2)),
  };
}

// ─── Layer ───────────────────────────────────────────────────────────────────

class ColoredHexLayer extends PIXI.Container {
  constructor() {
    super();
    this.visible = game.settings.get(MODULE_ID, "showColoredHexes");
  }

  draw() {
    this.children.forEach((c) => c.destroy());
    if (!this.visible) return;
    const g = this.addChild(new PIXI.Graphics());
    this._drawColored(g);
  }

  _drawColored(g) {
    this._drawColorByType(g, (h) => h.exploration === 1 && !h.claimed, getColor("reconnoiteredHexColor"));
    this._drawColorByType(g, (h) => h.exploration === 2 && !h.claimed, getColor("mappedHexColor"));
    this._drawColorByType(g, (h) => h.claimed, getColor("claimedHexColor"));
  }

  _drawColorByType(g, filter, color) {
    fillColor(g, createPolygons(getHexes(filter)), color.color, color.alpha);
  }
}

// ─── Color Settings UI (ApplicationV2) ───────────────────────────────────────

const COLOR_SETTINGS = [
  { key: "reconnoiteredHexColor", label: "Reconnoitered",  default: "#00ff0026" },
  { key: "mappedHexColor",        label: "Mapped",         default: "#0000ff26" },
  { key: "claimedHexColor",       label: "Claimed",        default: "#ff000026" },
];

class HexColorSettingsApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "nk-hex-color-settings",
    classes: ["narrative-kingdom", "nk-hex-color-settings"],
    tag: "div",
    window: {
      title: "Hex Exploration Colors",
      resizable: false,
      minimizable: false,
    },
    position: { width: 420 },
    actions: {
      "save":  HexColorSettingsApp.#onSave,
      "reset": HexColorSettingsApp.#onReset,
    },
  };

  /** Build the inline HTML — no external template needed. */
  async _renderHTML(_context, _options) {
    const rows = COLOR_SETTINGS.map(({ key, label }) => {
      const stored = game.settings.get(MODULE_ID, key);
      const { rgb, alpha } = splitStoredColor(stored);
      const alphaPct = Math.round((alpha / 255) * 100);
      // Compose an rgba() for the live preview swatch
      const r = parseInt(rgb.slice(1, 3), 16);
      const g = parseInt(rgb.slice(3, 5), 16);
      const b = parseInt(rgb.slice(5, 7), 16);
      const swatchColor = `rgba(${r},${g},${b},${(alpha / 255).toFixed(2)})`;
      return `
        <div class="form-group nk-color-row" data-key="${key}">
          <label>${label}</label>
          <div class="nk-color-controls">
            <input type="color" class="nk-color-rgb" value="${rgb}" title="Pick colour">
            <input type="range" class="nk-color-alpha" min="0" max="255" value="${alpha}"
                   title="Opacity">
            <span class="nk-alpha-label">${alphaPct}%</span>
            <div class="nk-color-swatch" style="--nk-swatch-color:${swatchColor};"></div>
          </div>
        </div>`;
    }).join("");

    const outlineWidth = game.settings.get(MODULE_ID, "hexOutlineWidth");

    return `
      <form class="standard-form">
        ${rows}
        <div class="form-group">
          <label>Outline Width</label>
          <div class="form-fields">
            <input type="number" name="hexOutlineWidth" min="0" max="20" value="${outlineWidth}"
                   style="width:5rem;">
            <span class="units">px</span>
          </div>
        </div>
        <footer class="form-footer">
          <button type="button" data-action="reset">
            <i class="fa-solid fa-rotate-left"></i> Defaults
          </button>
          <button type="button" data-action="save">
            <i class="fa-solid fa-floppy-disk"></i> Save
          </button>
        </footer>
      </form>`;
  }

  /** Inject the rendered HTML into the window content area. */
  _replaceHTML(result, content, _options) {
    content.innerHTML = result;
    this._attachLiveListeners(content);
  }

  /** Wire up live preview: alpha slider ↔ swatch ↔ percentage label. */
  _attachLiveListeners(content) {
    content.querySelectorAll(".nk-color-row").forEach((row) => {
      const colorInput = row.querySelector(".nk-color-rgb");
      const alphaInput = row.querySelector(".nk-color-alpha");
      const label      = row.querySelector(".nk-alpha-label");
      const swatch     = row.querySelector(".nk-color-swatch");

      const update = () => {
        const alpha   = parseInt(alphaInput.value, 10);
        const alphaPct = Math.round((alpha / 255) * 100);
        label.textContent = `${alphaPct}%`;
        const hex = colorInput.value;
        const r   = parseInt(hex.slice(1, 3), 16);
        const g   = parseInt(hex.slice(3, 5), 16);
        const b   = parseInt(hex.slice(5, 7), 16);
        const overlay = `rgba(${r},${g},${b},${(alpha / 255).toFixed(2)})`;
        // Paint the color over the checkerboard background via a CSS custom property
        swatch.style.setProperty("--nk-swatch-color", overlay);
      };

      alphaInput.addEventListener("input", update);
      colorInput.addEventListener("input", update);
    });
  }

  /** Collect form values and save to settings. */
  static async #onSave(event, button) {
    const form    = button.closest("form");
    const content = button.closest(".window-content");

    for (const { key } of COLOR_SETTINGS) {
      const row   = content.querySelector(`.nk-color-row[data-key="${key}"]`);
      const rgb   = row.querySelector(".nk-color-rgb").value;
      const alpha = parseInt(row.querySelector(".nk-color-alpha").value, 10);
      await game.settings.set(MODULE_ID, key, combineColor(rgb, alpha));
    }

    const outlineEl = form.querySelector("[name='hexOutlineWidth']");
    await game.settings.set(MODULE_ID, "hexOutlineWidth", Number(outlineEl.value));

    game.narrativeKingdomHexLayer?.draw();
    this.close();
  }

  /** Restore factory defaults. */
  static async #onReset() {
    for (const { key, default: def } of COLOR_SETTINGS) {
      await game.settings.set(MODULE_ID, key, def);
    }
    await game.settings.set(MODULE_ID, "hexOutlineWidth", 0);
    game.narrativeKingdomHexLayer?.draw();
    this.render();
  }
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function registerHexColoringSettings() {
  // Visibility toggle — managed by the toolbar button, not shown in the config menu
  game.settings.register(MODULE_ID, "showColoredHexes", {
    scope: "client",
    config: false,
    requiresReload: false,
    type: Boolean,
    default: false,
  });

  // Color values are managed through the dedicated menu below (config: false)
  game.settings.register(MODULE_ID, "reconnoiteredHexColor", {
    scope: "client",
    config: false,
    default: "#00ff0026",
    type: String,
    onChange: () => game.narrativeKingdomHexLayer?.draw(),
  });

  game.settings.register(MODULE_ID, "mappedHexColor", {
    scope: "client",
    config: false,
    default: "#0000ff26",
    type: String,
    onChange: () => game.narrativeKingdomHexLayer?.draw(),
  });

  game.settings.register(MODULE_ID, "claimedHexColor", {
    scope: "client",
    config: false,
    default: "#ff000026",
    type: String,
    onChange: () => game.narrativeKingdomHexLayer?.draw(),
  });

  game.settings.register(MODULE_ID, "hexOutlineWidth", {
    scope: "client",
    config: false,
    default: 0,
    type: Number,
    onChange: () => game.narrativeKingdomHexLayer?.draw(),
  });

  // Settings menu entry — opens the color picker UI
  game.settings.registerMenu(MODULE_ID, "hexColors", {
    name: "Hex Exploration Colors",
    label: "Configure Colors…",
    hint: "Choose overlay colors and opacity for each exploration state.",
    icon: "fa-solid fa-droplet",
    type: HexColorSettingsApp,
    restricted: false,
  });
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function registerHexColoringHooks() {
  // Toolbar toggle button
  Hooks.on("getSceneControlButtons", (controls) => {
    if (typeof kingmaker === "undefined") return;
    if (!kingmaker?.region?.active) return;

    const tokenControls = controls.tokens;
    if (!tokenControls) return;

    tokenControls.tools["nk-show-colored-hexes"] = {
      name: "nk-show-colored-hexes",
      order: 98,
      title: "Toggle Hex Exploration Colors",
      icon: "fa-solid fa-globe",
      visible: true,
      toggle: true,
      active: !!game.settings.get(MODULE_ID, "showColoredHexes"),
      onChange: async () => {
        const next = !game.settings.get(MODULE_ID, "showColoredHexes");
        await game.settings.set(MODULE_ID, "showColoredHexes", next);
        if (game.narrativeKingdomHexLayer) {
          game.narrativeKingdomHexLayer.visible = next;
          game.narrativeKingdomHexLayer.draw();
        }
      },
    };
  });

  // Create the layer when the canvas (re-)initialises
  Hooks.on("canvasReady", () => {
    if (typeof kingmaker === "undefined") return;
    if (!kingmaker?.region?.active) return;

    game.narrativeKingdomHexLayer = new ColoredHexLayer();
    canvas.interface.grid.addChild(game.narrativeKingdomHexLayer);
    game.narrativeKingdomHexLayer.draw();
  });

  // Redraw whenever the pf2e-kingmaker state changes (hex explored / claimed)
  Hooks.on("updateSetting", (setting) => {
    if (setting.key === "pf2e-kingmaker.state") {
      game.narrativeKingdomHexLayer?.draw();
    }
  });
}
