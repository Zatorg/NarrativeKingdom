/**
 * Kingdom Events Catalog — Narrative Kingdom Framework
 *
 * The module ships with **no prefilled events**. Populate this world's catalog on the
 * Catalog tab by adding events by hand or importing a JSON event pack (Catalog → Import…).
 * Imported/edited catalogs are stored per world in the `catalogData` setting; this array
 * is only the built-in fallback used when a world has no saved catalog of its own.
 *
 * Event shape: { name, subtitle, traits[], location, description, checks[], outcomes, resolution, special }.
 *   outcomes  {{success:{rp,gm}, neutral:{rp,gm}, failure:{rp,gm}}}
 *             rp = narrative shown to everyone on resolution; gm = mechanics shown only to
 *             the GM. (A legacy plain string is treated as GM-only mechanics.)
 *
 * Clock resolution: Crit ±2, Success/Failure ±1 green/red. Reach the threshold (default 7)
 * in green → Success, in red → Failure; fill with neither decisive → Neutral. Neglected
 * events gain red each turn.
 */
export const KINGDOM_EVENTS_CATALOG = [];
