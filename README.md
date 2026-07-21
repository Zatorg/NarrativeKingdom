# Narrative Kingdom Management

A lighter, narrative take on the Pathfinder 2e Kingmaker **kingdom subsystem** for
[Foundry VTT](https://foundryvtt.com/). It keeps the army combat intact as well as
the balance of the campaign. Being more hands-on it will require more creative work
by the parties involved.

- **System:** PF2e · **Foundry:** v12–v14

> **Built with AI.** A part of this module was written with the help of
> **[Claude](https://www.anthropic.com/claude) (Anthropic's Claude Code)**, directed and
> reviewed by a professional. While I read through everything at least once, if you plan to
> build on it, read the code yourself, it is not that big.

## What it does

- **GM-run Kingdom Turns** — the GM starts and ends each turn; leaders work the week in between.
- **Projects** — each leader pursues up to three endeavour clocks (build, recruit, anything), rolled vs. the kingdom DC.
- **Kingdom Events** — dual green/red threshold clocks with their own DC; unresolved events decay at turn's end.
- **XP, Levelling & Benefits** — earn XP from finished projects and resolved events; level up (capped by claimed hexes) to unlock per-level benefits.
- **Settlements** — grow Village → Metropolis; track structures & landmarks; settlement tiers set your free army allowance.
- **Armies** — recruit and run PF2e **army actors** through leader projects; combat is delegated to those actors' own sheets.
- **Relations** — a faction reputation tracker using the PF2e reputation standings, with a dated history log.
- **Camping / Travel** — a companion helper for downtime on the road.

Full in-app rules live on the sheet's **Rules** tab.

## Install

In Foundry's **Add-on Modules → Install Module**, paste the manifest URL:

```
https://github.com/Zatorg/NarrativeKingdom/releases/latest/download/module.json
```

Then enable **Narrative Kingdom Management** in your world. Open it from the party header
button in the sidebar.

## Backups

All kingdom data lives in one world setting. Use **GM Settings → Export** to save a JSON
backup at any time, and **Import** to restore it. The schema migrates forward automatically
on load, so older saves keep working.

## Events

The module does not yet contain any kingdom events and they need to be manually filled or imported via a JSON file.

## Development

The repo *is* the module — for live editing, symlink/junction it into your Foundry
`Data/modules/` folder and reload (F5) to see changes.

```
scripts/   kingdom-data.mjs (model + migration) · kingdom-app.mjs (sheet) ·
           kingdom-actions.mjs (handlers) · narrative-kingdom.mjs (entry) · camping.mjs · hex-coloring.mjs
templates/ Handlebars partials per tab
styles/    narrative-kingdom.css
packs-source/  compendium JSON (committed) → built into packs/ (gitignored) via `npm run pack`
```

See `DESIGN.md` for the architecture and mechanics.

## Credits

Inspired by **[Narrative Kingdom Management](https://github.com/Knightish-writes/narrative-kingdom-management-pf2e)**
by Knightish-writes — a rules writeup for a lighter, story-first kingdom subsystem. This module
is an independent, clean-room implementation of that idea in code; no text or code from that
project (which is GPL-3.0) is copied here.

## Legal & licensing

- **Code** — © 2026 Lemon Supreme, released under the [MIT License](LICENSE).
- **Unofficial fan content.** This is an independent, non-commercial module. It is **not**
  published, endorsed, sponsored, or approved by Paizo Inc. *Pathfinder*, *Pathfinder Second
  Edition*, and *Kingmaker* are trademarks of Paizo Inc., referenced here only to describe
  compatibility.
- **Game rules.** The module builds on the Pathfinder Second Edition rules, which Paizo
  releases as Open Game Content under the OGL 1.0a (and, for Remaster material, the ORC
  License). Only game *mechanics* are used as a system reference — no Paizo rules text or
  artwork is bundled. Compendium effect icons are path references to the assets of the
  installed PF2e system, not copies.
- **Foundry VTT.** Distributed as a free module under Foundry's module-developer terms; no
  Foundry core code is included.
