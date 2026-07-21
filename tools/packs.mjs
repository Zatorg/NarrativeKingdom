#!/usr/bin/env node
/**
 * Build / extract this module's Foundry compendium packs.
 *
 *   npm run unpack   built LevelDB (packs/<name>)  →  JSON source (packs-source/<name>)
 *   npm run pack     JSON source (packs-source/<name>)  →  built LevelDB (packs/<name>)
 *
 * The JSON under packs-source/ is the committed source of truth; the LevelDB
 * directories under packs/ are gitignored build artifacts that Foundry loads.
 * Run these with the world CLOSED (or at the Setup screen) so the pack database
 * isn't locked by a running Foundry instance.
 *
 * Pack list is read from module.json, so it stays correct if packs are added.
 */
import { compilePack, extractPack } from "@foundryvtt/foundryvtt-cli";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(root, "module.json"), "utf8"));
const packs = manifest.packs ?? [];

const mode = process.argv[2];
if (!["pack", "unpack"].includes(mode)) {
  console.error("Usage: node tools/packs.mjs <pack|unpack>");
  process.exit(1);
}
if (!packs.length) {
  console.log("No packs declared in module.json — nothing to do.");
  process.exit(0);
}

for (const p of packs) {
  const built  = path.join(root, p.path);                  // e.g. packs/camping-effects
  const source = path.join(root, "packs-source", p.name);  // e.g. packs-source/camping-effects
  if (mode === "unpack") {
    console.log(`unpack  ${p.path}  →  packs-source/${p.name}`);
    await extractPack(built, source, { yaml: false, log: true, clean: true });
  } else {
    console.log(`pack    packs-source/${p.name}  →  ${p.path}`);
    await compilePack(source, built, { yaml: false, log: true });
  }
}
console.log("Done.");
