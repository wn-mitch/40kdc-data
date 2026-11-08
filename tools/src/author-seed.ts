/**
 * Seed ability stubs (`stub: true`, effect `no-effect`) for units that have *zero* enrichment
 * abilities (#NN). The DSL authoring pipeline (`author-input` → `author-batch`)
 * only fleshes stubs that already exist — it iterates `isStubEntry`
 * entries and never invents new ones. So a unit with `ability_ids: []` is
 * invisible to it: no stub, nothing to flesh, stays a bare statline forever.
 *
 * This tool closes that gap. For every unit whose core `ability_ids` is empty,
 * it walks the same archive join `author-input` uses —
 *
 *   core unit.name → archive Datasheet (name + faction code) → datasheet_id
 *     → every ability on that datasheet (Datasheets_abilities)
 *
 * — and writes one stub (`stub: true`) per resolved ability into
 * `data/enrichment/<faction>/abilities.json`. The stubs then flow through the
 * normal `author-input → author-batch propose/apply` workflow like any other.
 *
 * IP posture: the archive's rule `description` is GW text and is **never**
 * written to the repo. Only the ability *name* (a factual label, as the
 * existing dataset already stores) and a `no-effect` placeholder effect are
 * emitted; the real mechanic is authored downstream by the classify step, which
 * reads the description transiently and emits structured DSL (no prose).
 *
 * Dedup is conservative — it never rewrites an authored ability:
 * Dedup keys on `ability_id` (the project's own ability identity — that's how
 * `link-abilities` reverse-links). Within a single faction file a matching
 * `ability_id` is the same game ability, so we add the unit to that entry's
 * `unit_ids` (purely additive — never touches the effect). Merges into an
 * already-authored entry are flagged in the report for review, since a rare
 * same-name/different-rule collision would surface there.
 *
 * Unresolved units/abilities (no datasheet match — selectable-power pools like
 * the C'tan, name mismatches, Legends not in the archive) are reported to
 * `data/_audit/seed-unresolved.json` for hand-authoring, never silently dropped.
 *
 * Usage:
 *   npx tsx tools/src/author-seed.ts <faction|--all> [--dry-run]
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadArchive, type ArchiveIndex, type SourceRule } from "./author-input.js";
import { STUB_EFFECT, isStubEntry } from "./audit-coverage.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DATA_ROOT = resolve(__dirname, "../../data");
const ENRICHMENT_ROOT = resolve(DATA_ROOT, "enrichment");
const CORE_ROOT = resolve(DATA_ROOT, "core");
const UNRESOLVED_PATH = resolve(DATA_ROOT, "_audit", "seed-unresolved.json");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const readJSON = (p: string): Json => JSON.parse(readFileSync(p, "utf-8"));

const STUB_AUTHORED_BY = "40kdc-community";
const STUB_VERSION = "2025-q3";
const STUB_GAME_VERSION = { edition: "11th", dataslate: "pre-launch-provisional" };

/** Minimal enrichment ability entry the seed tool authors. */
export interface SeededAbility {
  ability_id: string;
  name: string;
  authored_by: string;
  game_version: { edition: string; dataslate: string };
  version: string;
  stub: true;
  effect: { type: "no-effect" };
  scope: { duration: "permanent" };
  unit_ids: string[];
  ability_type: "unit";
  behavior: "passive";
}

export interface UnresolvedEntry {
  faction: string;
  unit_id: string;
  unit_name: string;
  reason: string;
}

/** kebab-case slug matching the entity-id pattern `^[a-z0-9][a-z0-9-]*[a-z0-9]$`. */
export function kebab(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function newStub(abilityId: string, name: string, unitId: string): SeededAbility {
  return {
    ability_id: abilityId,
    name,
    authored_by: STUB_AUTHORED_BY,
    game_version: { ...STUB_GAME_VERSION },
    version: STUB_VERSION,
    stub: true,
    effect: { ...STUB_EFFECT },
    scope: { duration: "permanent" },
    unit_ids: [unitId],
    ability_type: "unit",
    behavior: "passive",
  };
}

export interface SeedResult {
  /** The faction's abilities array after seeding (live entries + new stubs). */
  abilities: Json[];
  /** Count of stub entries newly created. */
  created: number;
  /** Count of units merged into an existing entry's unit_ids. */
  merged: number;
  /**
   * Merges into an already-authored (non-stub) entry — surfaced for review so a
   * rare same-id/different-rule collision can be caught. Purely informational;
   * the merge still happened (additive unit_ids).
   */
  mergedIntoAuthored: { ability_id: string; unit_id: string }[];
  unresolved: UnresolvedEntry[];
}

/**
 * Pure core: given a faction's existing abilities + its empty units, return the
 * seeded abilities array plus a report. No I/O — the unit test drives this with
 * a fake {@link ArchiveIndex}.
 */
export function seedFaction(
  faction: string,
  archive: ArchiveIndex,
  emptyUnits: { id: string; name: string }[],
  existing: Json[],
): SeedResult {
  const code = archive.factionCode(faction);
  const abilities: Json[] = existing.map((a) => ({ ...a, unit_ids: [...(a.unit_ids ?? [])] }));
  const byId = new Map<string, Json>(abilities.map((a) => [a.ability_id, a]));
  const result: SeedResult = { abilities, created: 0, merged: 0, mergedIntoAuthored: [], unresolved: [] };

  const addUnit = (entry: Json, unitId: string): void => {
    if (!entry.unit_ids.includes(unitId)) {
      entry.unit_ids.push(unitId);
      result.merged++;
    }
  };

  for (const unit of emptyUnits) {
    if (!code) {
      result.unresolved.push({ faction, unit_id: unit.id, unit_name: unit.name, reason: "no archive faction code" });
      continue;
    }
    const dsIds = archive.datasheetsFor(unit.name, code);
    if (dsIds.length === 0) {
      result.unresolved.push({ faction, unit_id: unit.id, unit_name: unit.name, reason: "no matching datasheet in archive" });
      continue;
    }
    // Collect this unit's datasheet abilities, deduped by normalized name.
    const seen = new Set<string>();
    const abilitiesForUnit: Array<[string, Omit<SourceRule, "datasheet_id">]> = [];
    for (const dsId of dsIds) {
      for (const [name, rule] of archive.abilitiesFor(dsId)) {
        const k = name.toLowerCase().trim();
        if (seen.has(k)) continue;
        seen.add(k);
        abilitiesForUnit.push([name, rule]);
      }
    }
    if (abilitiesForUnit.length === 0) {
      result.unresolved.push({ faction, unit_id: unit.id, unit_name: unit.name, reason: "datasheet carries no abilities in archive" });
      continue;
    }

    for (const [name] of abilitiesForUnit) {
      const id = kebab(name);
      if (!id) continue; // unsluggable name (e.g. all punctuation) — skip
      const existingEntry = byId.get(id);
      if (existingEntry) {
        const before = existingEntry.unit_ids.includes(unit.id);
        addUnit(existingEntry, unit.id);
        // Flag merges into authored entries (not stubs) for review.
        if (!before && !isStubEntry(existingEntry)) {
          result.mergedIntoAuthored.push({ ability_id: id, unit_id: unit.id });
        }
        continue;
      }
      const stub = newStub(id, name, unit.id);
      abilities.push(stub);
      byId.set(id, stub);
      result.created++;
    }
  }
  return result;
}

function listEmptyUnits(faction: string): { id: string; name: string }[] {
  const unitsPath = resolve(CORE_ROOT, faction, "units.json");
  if (!existsSync(unitsPath)) return [];
  return (readJSON(unitsPath) as Json[])
    .filter((u) => Array.isArray(u.ability_ids) && u.ability_ids.length === 0)
    .map((u) => ({ id: u.id, name: u.name }));
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  // The faction selector is either the literal "--all" or a bare faction name.
  const arg = args.includes("--all") ? "--all" : args.find((a) => !a.startsWith("--"));
  if (!arg) {
    console.error("Usage: npx tsx tools/src/author-seed.ts <faction|--all> [--dry-run]");
    process.exit(1);
  }
  const archive = loadArchive();
  const factions =
    arg === "--all"
      ? readdirSync(ENRICHMENT_ROOT, { withFileTypes: true })
          .filter((e) => e.isDirectory() && e.name !== "_example")
          .map((e) => e.name)
      : [arg];

  const allUnresolved: UnresolvedEntry[] = [];
  const allReview: { faction: string; ability_id: string; unit_id: string }[] = [];
  let totalCreated = 0;
  let totalMerged = 0;
  for (const faction of factions) {
    const emptyUnits = listEmptyUnits(faction);
    if (emptyUnits.length === 0) continue;
    const abilitiesPath = resolve(ENRICHMENT_ROOT, faction, "abilities.json");
    const existing: Json[] = existsSync(abilitiesPath) ? readJSON(abilitiesPath) : [];
    const r = seedFaction(faction, archive, emptyUnits, existing);
    totalCreated += r.created;
    totalMerged += r.merged;
    allUnresolved.push(...r.unresolved);
    allReview.push(...r.mergedIntoAuthored.map((m) => ({ faction, ...m })));
    console.log(
      `  ${faction}: ${emptyUnits.length} empty units → +${r.created} stubs, ${r.merged} merged (${r.mergedIntoAuthored.length} into authored), ${r.unresolved.length} unresolved`,
    );
    if (!dryRun && (r.created > 0 || r.merged > 0)) {
      writeFileSync(abilitiesPath, JSON.stringify(r.abilities, null, 2) + "\n");
    }
  }

  if (!dryRun) {
    mkdirSync(resolve(DATA_ROOT, "_audit"), { recursive: true });
    writeFileSync(
      UNRESOLVED_PATH,
      JSON.stringify({ unresolved: allUnresolved, mergedIntoAuthored: allReview }, null, 2) + "\n",
    );
  }
  console.log(
    `\n${totalCreated} stubs created, ${totalMerged} unit links merged ` +
      `(${allReview.length} into authored — review), ${allUnresolved.length} unresolved.` +
      (dryRun ? " (dry run — nothing written)" : ` Report → ${UNRESOLVED_PATH}`),
  );
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).replace(/\.\w+$/, "") === fileURLToPath(import.meta.url).replace(/\.\w+$/, "");
if (isMain) main();
