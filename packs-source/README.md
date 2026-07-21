# Compendium source

This directory is the **source of truth** for the module's Foundry compendium
packs — one JSON file per document. The packs Foundry actually loads live under
`packs/` as built LevelDB databases, which are **gitignored build artifacts**.

## Workflow

- Edit content in the JSON here, then rebuild the loadable pack: `npm run pack`
- Or edit inside Foundry (unlock the compendium, change items), then sync the
  changes back to this source: `npm run unpack`

Run these with the world **closed** (or sitting on the Setup screen) so the pack
database isn't locked by a running Foundry instance.

`npm run pack` is also required **after a fresh clone** (and before packaging a
release), since `packs/` is not committed — the module can't load a pack that
hasn't been built yet.
