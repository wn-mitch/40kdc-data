/**
 * Ingest raw abilities from *outside the army-assist archive* (a PDF a human
 * extracted, or a foreign JSON dump) into the canonical DSL-authoring pipeline.
 *
 * `author-input.ts` can only resolve source rule text by chaining through the
 * army-assist archive (`loadArchive`/`resolveSource`). Abilities that live only
 * in a rulebook PDF, or in some other tool's JSON, have no archive entry — so
 * there's no way to feed them to `author:propose`. This tool is that front door.
 *
 * It takes a normalized **ingest manifest** (a JSON array; one record per
 * ability — see {@link IngestRecord}) and does two things, both *non-agentic*:
 *
 *   1. Seeds a stub (`stub: true`, effect `no-effect`) into `data/enrichment/<faction>/abilities.json`
 *      for any new ability (idempotent; additive `unit_ids` merge for known ids),
 *      so `author:propose`/`apply` have a live target to fill.
 *   2. Writes/merges `data/_audit/author-input/<faction>.json` in the exact
 *      `AuthorInputEntry` shape `author:propose` consumes — carrying the raw text
 *      as `src.description`, marked `resolved`. The pipeline then runs unchanged:
 *      the model only classifies, TypeScript assembles + AJV-validates + the
 *      verifier judges fidelity + the gate decides what `apply` splices.
 *
 * A snapshot manifest also projects the faction's `phase-mappings.json`.
 *
 * IP posture matches `author-seed.ts`: only the ability *name* (a factual label)
 * and an empty placeholder effect are written into the repo. The raw rule text
 * goes only to git-ignored author-input (transient, for the classify pass to
 * read) — never into committed enrichment data. The canonical prose of every
 * ability is the private MFM dump, read through `mfm/record-prose.ts`.
 *
 * The DSL itself is NOT authored here. This tool emits no effect tree of its own
 * beyond the empty stub; the real mechanic is authored downstream by the
 * constrained classify→assemble→verify→gate workflow.
 *
 * Usage:
 *   npx tsx tools/src/author-ingest.ts <manifest.json> [--dry-run]
 */
import { suffixed } from "./mfm/mirror/identity.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { kebab } from "./author-seed.js";
import { STUB_EFFECT, isStubEntry } from "./audit-coverage.js";
import type { AuthorInputEntry, SourceRule } from "./author-input.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DATA_ROOT = resolve(__dirname, "../../data");
const ENRICHMENT_ROOT = resolve(DATA_ROOT, "enrichment");
const INPUT_DIR = resolve(DATA_ROOT, "_audit", "author-input");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const readJSON = (p: string): Json => JSON.parse(readFileSync(p, "utf-8"));

const STUB_AUTHORED_BY = "40kdc-community";
const STUB_VERSION = "2025-q3";
const STUB_GAME_VERSION = { edition: "11th", dataslate: "pre-launch-provisional" };
const ABILITY_TYPES = new Set(["core", "faction", "detachment", "unit", "enhancement", "stratagem"]);
const BEHAVIORS = new Set(["passive", "activated", "reactive", "aura"]);

/** One raw ability, as extracted by the skill from a PDF or foreign JSON. */
export interface IngestRecord {
  /** kebab faction id == enrichment directory name (e.g. "orks"). Required. */
  faction: string;
  /** Human-readable ability name (a factual label — safe to commit). Required. */
  name: string;
  /** Raw GW rule text. Goes ONLY to git-ignored author-input. */
  raw_text: string;
  /** Explicit ability_id override; defaults to `<kebab(name)>-<faction>`. */
  ability_id?: string;
  unit_ids?: string[];
  ability_type?: string;
  behavior?: string;
  faction_id?: string | null;
  detachment_id?: string | null;
  phases?: string[];
  /** Provenance, e.g. "codex-orks-2024.pdf#p43" or an archive datasheet_id. */
  source_ref?: string;
  source_kind?: "pdf" | "json" | "image";
  game_version?: { edition: string; dataslate: string };
}

export interface IngestResult {
  /** The faction's abilities array after seeding (existing + new stubs). */
  abilities: Json[];
  /** Merged author-input entries for this faction (existing + this run). */
  authorInput: AuthorInputEntry[];
  created: number;
  mergedUnits: number;
  /** Ability ids removed by snapshot replacement. Empty for additive ingestion. */
  deletedAbilityIds: string[];
  /** Merges into an already-authored (non-stub) entry — surfaced for review. */
  mergedIntoAuthored: { ability_id: string; unit_id: string }[];
  /** Records carrying no usable raw_text — seeded but left unresolved for input. */
  unresolved: { ability_id: string; name: string; reason: string }[];
}

export interface ReplacementScope {
  faction_id: string;
  game_version: { edition: string; dataslate: string };
  unit_ids: string[];
  detachment_ids: string[];
}

export interface SnapshotManifest {
  records: IngestRecord[];
  replace_scope: ReplacementScope;
}

function newStub(rec: IngestRecord, abilityId: string): Json {
  const abilityType = rec.ability_type && ABILITY_TYPES.has(rec.ability_type) ? rec.ability_type : "unit";
  const behavior = rec.behavior && BEHAVIORS.has(rec.behavior) ? rec.behavior : "passive";
  const stub: Json = {
    ability_id: abilityId,
    name: rec.name,
    authored_by: STUB_AUTHORED_BY,
    game_version: { ...(rec.game_version ?? STUB_GAME_VERSION) },
    version: STUB_VERSION,
    // Placeholder — isStubEntry() == true, so the pipeline treats it as a stub to
    // fill. propose/apply overwrite effect+scope and drop `stub`.
    stub: true,
    effect: { ...STUB_EFFECT },
    scope: { duration: "permanent" },
    unit_ids: [...(rec.unit_ids ?? [])],
    ability_type: abilityType,
    behavior,
  };
  if (rec.faction_id) stub.faction_id = rec.faction_id;
  if (rec.detachment_id) stub.detachment_id = rec.detachment_id;
  return stub;
}

/**
 * Pure core: fold a faction's ingest records into its existing abilities +
 * author-input. No I/O — the unit test drives this directly.
 *
 * id policy mirrors `author-seed`: a matching `ability_id` is the *same* game
 * ability (additive `unit_ids` merge, never clobbering the effect). Distinct
 * variants must arrive with distinct names (so `kebab` already differs, e.g.
 * "Deadly Demise D3" → `deadly-demise-d3`); we never auto-suffix, which would
 * wrongly split a shared ability like Deep Strike across units.
 */
export function ingestFaction(
  faction: string,
  records: IngestRecord[],
  existingAbilities: Json[],
  existingInput: AuthorInputEntry[],
): IngestResult {
  const abilities: Json[] = existingAbilities.map((a) => ({ ...a, unit_ids: [...(a.unit_ids ?? [])] }));
  const byId = new Map<string, Json>(abilities.map((a) => [a.ability_id, a]));
  const inputById = new Map<string, AuthorInputEntry>(existingInput.map((e) => [e.ability_id, e]));
  const result: IngestResult = {
    abilities, authorInput: [], created: 0, mergedUnits: 0, deletedAbilityIds: [], mergedIntoAuthored: [], unresolved: [],
  };

  for (const rec of records) {
    const id = ingestRecordId(rec);
    if (!id) {
      result.unresolved.push({ ability_id: "", name: rec.name, reason: "name has no sluggable characters" });
      continue;
    }

    // 1. Seed stub or additively merge unit links into the existing entry.
    let entry = byId.get(id);
    if (entry) {
      if (rec.detachment_id && entry.detachment_id == null) entry.detachment_id = rec.detachment_id;
      for (const u of rec.unit_ids ?? []) {
        if (!entry.unit_ids.includes(u)) {
          entry.unit_ids.push(u);
          result.mergedUnits++;
          if (!isStubEntry(entry)) result.mergedIntoAuthored.push({ ability_id: id, unit_id: u });
        }
      }
    } else {
      entry = newStub(rec, id);
      abilities.push(entry);
      byId.set(id, entry);
      result.created++;
    }

    // 2. Build the canonical author-input record. Empty raw_text → resolved:false
    //    (seeded but skipped by propose, which filters on `resolved`).
    const description = (rec.raw_text ?? "").trim();
    const src: SourceRule = {
      datasheet_id: rec.source_ref ?? "",
      src_type: rec.source_kind ?? "ingest",
      parameter: null,
      phases: rec.phases ?? null,
      description,
    };
    const inputEntry: AuthorInputEntry = {
      faction,
      ability_id: id,
      name: rec.name,
      unit_ids: entry.unit_ids,
      target: null,
      scope: entry.scope ?? null,
      faction_id: rec.faction_id ?? null,
      ability_type: entry.ability_type ?? null,
      resolved: description !== "",
      ...(description !== "" ? { src } : { reason: "no raw_text provided" }),
    };
    inputById.set(id, inputEntry);
    if (description === "") result.unresolved.push({ ability_id: id, name: rec.name, reason: "no raw_text provided" });
  }

  result.authorInput = Array.from(inputById.values());
  return result;
}

/** Replace only the inventory-owned portion of a faction without discarding shared/uncovered owners. */
export function ingestSnapshot(
  manifest: SnapshotManifest,
  existingAbilities: Json[],
  existingInput: AuthorInputEntry[],
): IngestResult {
  const { replace_scope: scope, records } = manifest;
  const coveredUnits = new Set(scope.unit_ids);
  const coveredDetachments = new Set(scope.detachment_ids);
  const incomingIds = new Set(records.map((record) => ingestRecordId(record)));
  const deleted = new Set<string>();
  const retained = existingAbilities.flatMap((ability) => {
    const unitIds = (ability.unit_ids ?? []).filter((id: string) => !coveredUnits.has(id));
    const coveredOwner = (ability.unit_ids ?? []).some((id: string) => coveredUnits.has(id));
    const coveredDetachment = ability.detachment_id != null && coveredDetachments.has(ability.detachment_id);
    if (!incomingIds.has(ability.ability_id) && (coveredDetachment || (coveredOwner && unitIds.length === 0))) {
      deleted.add(ability.ability_id);
      return [];
    }
    return [{ ...ability, unit_ids: unitIds }];
  });
  const retainedInput = existingInput
    .filter((entry) => !deleted.has(entry.ability_id))
    .map((entry) => ({
      ...entry,
      unit_ids: entry.unit_ids.filter((id) => !coveredUnits.has(id)),
    }));
  const result = ingestFaction(
    scope.faction_id,
    records,
    retained,
    retainedInput,
  );
  const abilities = new Map(result.abilities.map((ability) => [ability.ability_id, ability]));
  const authorInputById = new Map(result.authorInput.map((entry) => [entry.ability_id, entry]));
  for (const record of records) {
    const id = ingestRecordId(record);
    const ability = abilities.get(id);
    if (!ability) continue;
    ability.name = record.name;
    ability.game_version = { ...(record.game_version ?? scope.game_version) };
    ability.ability_type = record.ability_type ?? ability.ability_type;
    ability.behavior = record.behavior ?? ability.behavior;
    ability.faction_id = record.faction_id ?? scope.faction_id;
    if (record.detachment_id) ability.detachment_id = record.detachment_id;
    else delete ability.detachment_id;
    const input = authorInputById.get(id);
    if (input) {
      input.name = ability.name;
      input.unit_ids = [...(ability.unit_ids ?? [])];
      input.faction_id = ability.faction_id ?? scope.faction_id;
      input.ability_type = ability.ability_type;
    }
  }
  result.authorInput = result.authorInput.filter((entry) => !deleted.has(entry.ability_id));
  result.deletedAbilityIds = [...deleted];
  return result;
}

const PHASE_IDS = new Set(["command", "movement", "shooting", "charge", "fight"]);

/**
 * A record's ability id: its explicit `ability_id`, else the one identity rule (`mfm:mirror`):
 * the name slug with its faction suffix (`<name>-<faction>`, bare in `_core`). Empty when the name
 * has no sluggable characters.
 */
function ingestRecordId(record: IngestRecord): string {
  if (record.ability_id) return record.ability_id;
  const slug = kebab(record.name);
  // A core ability is one `_core` record under its bare id.
  return slug ? suffixed(slug, record.ability_type === "core" ? "_core" : record.faction) : slug;
}

export function projectPhaseMappings(
  existing: Json[],
  manifest: SnapshotManifest,
  deletedAbilityIds: readonly string[],
  activeAbilityIds?: ReadonlySet<string>,
): Json[] {
  const replacedIds = new Set([
    ...manifest.records.map(ingestRecordId),
    ...deletedAbilityIds,
  ]);
  const projected = existing.filter((mapping) =>
    mapping.source_type !== "ability" ||
    (!replacedIds.has(mapping.source_id) && (activeAbilityIds == null || activeAbilityIds.has(mapping.source_id))),
  );
  for (const record of manifest.records) {
    if (!record.phases?.length) continue;
    const phases = [...new Set(record.phases.map((phase) => phase.trim().toLowerCase()))];
    for (const phase of phases) {
      if (!PHASE_IDS.has(phase)) {
        throw new Error(`invalid phase "${phase}" for ${record.ability_id ?? record.name}`);
      }
    }
    projected.push({
      source_id: ingestRecordId(record),
      source_type: "ability",
      phases,
      game_version: { ...(record.game_version ?? manifest.replace_scope.game_version) },
      authored_by: STUB_AUTHORED_BY,
    });
  }
  return projected;
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const inputs = args.filter((a) => !a.startsWith("--"));
  if (inputs.length === 0) {
    console.error("Usage: npx tsx tools/src/author-ingest.ts <manifest.json | dir>... [--dry-run]");
    process.exit(1);
  }

  // Accept any mix of manifest files and directories. A directory ingests every
  // *.json inside (sorted), so you can keep one manifest per faction (e.g.
  // _private/manifests/orks.manifest.json) and run the whole folder in one go.
  const manifestFiles: string[] = [];
  for (const input of inputs) {
    const p = resolve(input);
    if (!existsSync(p)) { console.error(`Not found: ${input} — skipping.`); continue; }
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).filter((f) => f.endsWith(".json")).sort()) manifestFiles.push(resolve(p, f));
    } else {
      manifestFiles.push(p);
    }
  }

  const records: IngestRecord[] = [];
  const snapshots = new Map<string, SnapshotManifest>();
  for (const f of manifestFiles) {
    const parsed = readJSON(f);
    if (Array.isArray(parsed)) {
      records.push(...parsed);
      continue;
    }
    if (parsed?.records && parsed?.replace_scope && Array.isArray(parsed.records)) {
      const snapshot = parsed as SnapshotManifest;
      if (snapshots.has(snapshot.replace_scope.faction_id)) throw new Error(`Multiple snapshots for ${snapshot.replace_scope.faction_id}`);
      snapshots.set(snapshot.replace_scope.faction_id, snapshot);
      records.push(...snapshot.records);
      continue;
    }
    console.error(`${f}: not a JSON ingest array or snapshot manifest — skipping.`);
  }
  if (records.length === 0) {
    console.error("No ingest records found in the given manifest(s).");
    process.exit(1);
  }

  // Group records by faction; one pass per faction file (each record carries its
  // own `faction`, so a manifest may mix factions or be one-per-faction).
  const byFaction = new Map<string, IngestRecord[]>();
  for (const r of records) {
    if (!r.faction) { console.error(`Record "${r.name}" has no faction — skipping.`); continue; }
    (byFaction.get(r.faction) ?? byFaction.set(r.faction, []).get(r.faction)!).push(r);
  }

  let totalCreated = 0, totalMerged = 0, totalUnresolved = 0;
  const review: { faction: string; ability_id: string; unit_id: string }[] = [];

  for (const [faction, recs] of byFaction) {
    const abilitiesPath = resolve(ENRICHMENT_ROOT, faction, "abilities.json");
    const existingAbilities: Json[] = existsSync(abilitiesPath) ? readJSON(abilitiesPath) : [];
    const inputPath = resolve(INPUT_DIR, `${faction}.json`);
    const existingInput: AuthorInputEntry[] = existsSync(inputPath) ? readJSON(inputPath) : [];

    const snapshot = snapshots.get(faction);
    const r = snapshot
      ? ingestSnapshot(snapshot, existingAbilities, existingInput)
      : ingestFaction(faction, recs, existingAbilities, existingInput);
    totalCreated += r.created;
    totalMerged += r.mergedUnits;
    totalUnresolved += r.unresolved.length;
    review.push(...r.mergedIntoAuthored.map((m) => ({ faction, ...m })));
    console.log(
      `  ${faction}: ${recs.length} records → +${r.created} stubs, ${r.mergedUnits} unit links merged, ` +
        `${r.unresolved.length} unresolved`,
    );

    if (snapshot) {
      const phasePath = resolve(ENRICHMENT_ROOT, faction, "phase-mappings.json");
      const existingMappings: Json[] = existsSync(phasePath) ? readJSON(phasePath) : [];
      const projectedMappings = projectPhaseMappings(existingMappings, snapshot, r.deletedAbilityIds, new Set(r.abilities.map((ability) => ability.ability_id as string)));
      if (!dryRun) writeFileSync(phasePath, JSON.stringify(projectedMappings, null, 2) + "\n");
    }
    if (!dryRun) {
      mkdirSync(resolve(ENRICHMENT_ROOT, faction), { recursive: true });
      writeFileSync(abilitiesPath, JSON.stringify(r.abilities, null, 2) + "\n");
      mkdirSync(INPUT_DIR, { recursive: true });
      writeFileSync(inputPath, JSON.stringify(r.authorInput, null, 2) + "\n");
    }
  }

  console.log(
    `\n${totalCreated} stubs created, ${totalMerged} unit links merged, ` +
      `${totalUnresolved} unresolved.` +
      (review.length ? ` ${review.length} merged into authored entries — review.` : "") +
      (dryRun ? " (dry run — nothing written)" : ""),
  );
  console.log("Next: cd tools && npm run author:propose -- <faction> → author:review → author:apply → validate");
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).replace(/\.\w+$/, "") === fileURLToPath(import.meta.url).replace(/\.\w+$/, "");
if (isMain) main();
