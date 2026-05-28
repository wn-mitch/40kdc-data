#!/usr/bin/env tsx
/**
 * Rube Goldberg machine — round-trips a NewRecruit list through every
 * supported format and walks the linked Dataset API at each end.
 *
 * Loop:
 * ```
 *  seed (newrecruit-json) → import → Roster₀
 *    → export wtc-compact → import
 *    → export wtc-full    → import
 *    → export simple      → import
 *    → export newrecruit-json → import → Rosterₙ
 * ```
 *
 * Asserts `Roster₀ == Rosterₙ` at the Roster level (after stripping
 * `source` + `diagnostics`, which legitimately change across hops). Exits
 * non-zero on divergence. Walks `unit.faction.units` / `weapon.units` /
 * `ability.phases` at each end to demonstrate the cross-reference loops.
 *
 * Strict IP rule: only ids, names, and counts may be printed. No ability
 * description text, no rules text — none of that is stored in the
 * dataset, so we can't accidentally leak it, but be careful adding fields.
 *
 * @packageDocumentation
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Dataset } from "./data/dataset.js";
import { exportRoster, type ExportFormat } from "./export/index.js";
import { importRoster } from "./import/import-roster.js";
import type { Roster } from "./import/types.js";

const SEED_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "conformance",
  "roster",
  "chaos-knights-houndpack",
  "input.newrecruit-json.json",
);

const HOPS: ExportFormat[] = [
  "newrecruit-wtc-compact",
  "newrecruit-wtc-full",
  "newrecruit-simple",
  "newrecruit-json",
];

/** Strip the fields that legitimately change across format hops so the
 *  fixed-point comparison can focus on the structural Roster shape. */
function stable(r: Roster): Record<string, unknown> {
  const x = JSON.parse(JSON.stringify(r)) as Record<string, unknown>;
  delete x.source;
  delete x.diagnostics;
  return x;
}

function rule(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);
}

function walkLinkedApi(label: string, roster: Roster, ds: Dataset): void {
  rule(`${label}: walking the linked Dataset API`);
  console.log(`Roster: ${roster.name} (${roster.units.length} units)`);
  console.log(`  faction_id     = ${roster.faction_id ?? "—"}`);
  console.log(`  detachment_id  = ${roster.detachment_id ?? "—"}`);
  console.log(`  total_computed = ${roster.points.total_computed}`);

  for (const u of roster.units) {
    if (!u.ref.id) {
      console.log(`  · ${u.ref.raw_name}  [unresolved]`);
      continue;
    }
    const unit = ds.units.get(u.ref.id);
    if (!unit) {
      console.log(`  · ${u.ref.id}  [not in dataset]`);
      continue;
    }
    const fac = unit.faction;
    const facUnits = fac?.units.length ?? 0;
    console.log(`  · ${unit.id}  →  faction=${fac?.id ?? "—"} (faction has ${facUnits} units)`);

    for (const w of unit.weapons) {
      const carriers = w.units.length;
      console.log(`      weapon=${w.id}  carried by ${carriers} units`);
    }
    for (const a of unit.abilities) {
      const phaseIds = a.phases.join(",") || "—";
      const carriers = a.units.length;
      console.log(`      ability=${a.id}  phases=[${phaseIds}]  on ${carriers} units`);
    }
  }
}

function main(): number {
  const ds = Dataset.embedded();
  const seedJson = JSON.parse(readFileSync(SEED_PATH, "utf8"));

  rule("seed");
  console.log(`Loading: conformance/roster/chaos-knights-houndpack/input.newrecruit-json.json`);

  const roster0 = importRoster(seedJson, { dataset: ds });
  walkLinkedApi("Roster₀", roster0, ds);

  let current: Roster = roster0;
  for (const [i, fmt] of HOPS.entries()) {
    const text = exportRoster(current, fmt);
    const bytes = Buffer.byteLength(text, "utf8");
    const isJson = fmt === "newrecruit-json";
    const reimported = importRoster(isJson ? JSON.parse(text) : text, { dataset: ds });
    console.log(
      `[hop ${i + 1}/${HOPS.length}] ${fmt}  →  ${bytes.toLocaleString()} bytes  →  reimport: ${reimported.units.length} units (computed ${reimported.points.total_computed} pts)`,
    );
    current = reimported;
  }

  walkLinkedApi("Rosterₙ", current, ds);

  rule("fixed-point check");
  const before = stable(roster0);
  const after = stable(current);
  const equal = JSON.stringify(before) === JSON.stringify(after);
  if (equal) {
    console.log(`Roster₀ == Rosterₙ after ${HOPS.length} format hops (source/diagnostics excluded).`);
    return 0;
  }
  console.error(`Roster₀ ≠ Rosterₙ — round-trip diverged.`);
  return 1;
}

process.exit(main());
