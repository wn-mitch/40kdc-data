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
 * ability — see {@link IngestRecord}) and does three things, all *non-agentic*:
 *
 *   1. Seeds an empty-modifier stub into `data/enrichment/<faction>/abilities.json`
 *      for any new ability (idempotent; additive `unit_ids` merge for known ids),
 *      so `author:propose`/`apply` have a live target to fill.
 *   2. Writes/merges `data/_audit/author-input/<faction>.json` in the exact
 *      `AuthorInputEntry` shape `author:propose` consumes — carrying the raw text
 *      as `src.description`, marked `resolved`. The pipeline then runs unchanged:
 *      the model only classifies, TypeScript assembles + AJV-validates + the
 *      verifier judges fidelity + the gate decides what `apply` splices.
 *   3. Writes a durable **raw-text lookup store** keyed by `ability_id`, in a
 *      sibling directory *outside this repo* (default `../40kdc-abilities`), so
 *      raw ability text can be recovered from an ability key. The store is its own
 *      git repo (auto-`git init`ed), separate from 40kdc-data, which tracks
 *      mechanics only — GW prose never lands in 40kdc-data.
 *
 * IP posture matches `author-seed.ts`: only the ability *name* (a factual label)
 * and an empty placeholder effect are written into the repo. The raw rule text
 * goes to git-ignored author-input (transient, for the classify pass to read) and
 * to the out-of-repo raw-text store — never into committed enrichment data.
 *
 * The DSL itself is NOT authored here. This tool emits no effect tree of its own
 * beyond the empty stub; the real mechanic is authored downstream by the
 * constrained classify→assemble→verify→gate workflow.
 *
 * Usage:
 *   npx tsx tools/src/author-ingest.ts <manifest.json> [--dry-run]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { kebab } from "./author-seed.js";
import { hasEmptyModifier } from "./audit-coverage.js";
import type { AuthorInputEntry, SourceRule } from "./author-input.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DATA_ROOT = resolve(__dirname, "../../data");
const ENRICHMENT_ROOT = resolve(DATA_ROOT, "enrichment");
const INPUT_DIR = resolve(DATA_ROOT, "_audit", "author-input");
/**
 * Out-of-repo raw-text store — its own git repo, sibling to 40kdc-data. Resolved
 * relative to this file, so the skill always finds it regardless of cwd. Override
 * with RAW_TEXT_STORE.
 */
const RAW_TEXT_STORE = process.env.RAW_TEXT_STORE ?? resolve(__dirname, "../../../40kdc-abilities");

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
  /** Raw GW rule text. Goes ONLY to git-ignored author-input + the sibling store. */
  raw_text: string;
  /** Explicit ability_id override; defaults to kebab(name). */
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

/** A raw-text lookup record in the out-of-repo store, keyed by ability_id. */
export interface RawTextRecord {
  ability_id: string;
  name: string;
  faction_id: string;
  /** Owning detachment for detachment/stratagem/enhancement abilities; null otherwise. */
  detachment_id: string | null;
  unit_ids: string[];
  ability_type: string;
  game_version: { edition: string; dataslate: string };
  source: { kind: string; ref: string; phases: string[] | null };
  raw_text: string;
}

export interface IngestResult {
  /** The faction's abilities array after seeding (existing + new stubs). */
  abilities: Json[];
  /** Merged author-input entries for this faction (existing + this run). */
  authorInput: AuthorInputEntry[];
  /** Raw-text records produced this run (only for records with raw_text). */
  rawText: RawTextRecord[];
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
    // Empty-modifier placeholder — hasEmptyModifier() == true, so the pipeline
    // treats it as a stub to fill. propose/apply overwrite effect+scope.
    effect: { type: "stat-modifier", target: "unit", modifier: {} },
    scope: { range: "unit", duration: "permanent" },
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
    abilities, authorInput: [], rawText: [], created: 0, mergedUnits: 0, deletedAbilityIds: [], mergedIntoAuthored: [], unresolved: [],
  };

  for (const rec of records) {
    const id = rec.ability_id ?? kebab(rec.name);
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
          if (!hasEmptyModifier(entry.effect)) result.mergedIntoAuthored.push({ ability_id: id, unit_id: u });
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
    if (description === "") {
      result.unresolved.push({ ability_id: id, name: rec.name, reason: "no raw_text provided" });
      continue;
    }

    // 3. Raw-text lookup record (only when we actually have text to store).
    result.rawText.push({
      ability_id: id,
      name: rec.name,
      faction_id: rec.faction_id ?? faction,
      detachment_id: entry.detachment_id ?? rec.detachment_id ?? null,
      unit_ids: entry.unit_ids,
      ability_type: entry.ability_type,
      game_version: entry.game_version,
      source: { kind: rec.source_kind ?? "json", ref: rec.source_ref ?? "", phases: rec.phases ?? null },
      raw_text: description,
    });
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
  const incomingIds = new Set(records.map((record) => record.ability_id ?? kebab(record.name)));
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
    const id = record.ability_id ?? kebab(record.name);
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
  for (const rawText of result.rawText) {
    const ability = abilities.get(rawText.ability_id);
    if (!ability) continue;
    rawText.name = ability.name;
    rawText.faction_id = ability.faction_id ?? scope.faction_id;
    rawText.detachment_id = ability.detachment_id ?? null;
    rawText.unit_ids = [...(ability.unit_ids ?? [])];
    rawText.ability_type = ability.ability_type;
    rawText.game_version = { ...ability.game_version };
  }
  result.authorInput = result.authorInput.filter((entry) => !deleted.has(entry.ability_id));
  result.deletedAbilityIds = [...deleted];
  return result;
}

const DETACHMENT_ABILITY_TYPES = new Set(["detachment", "enhancement", "stratagem"]);
const PHASE_IDS = new Set(["command", "movement", "shooting", "charge", "fight"]);

function ingestRecordId(record: IngestRecord): string {
  return record.ability_id ?? kebab(record.name);
}

function hasCanonicalCoveredDetachment(
  record: Pick<RawTextRecord, "ability_id" | "ability_type">,
  coveredDetachments: ReadonlySet<string>,
): boolean {
  if (!DETACHMENT_ABILITY_TYPES.has(record.ability_type)) return false;
  for (const detachmentId of coveredDetachments) {
    if (record.ability_id.endsWith(`-${detachmentId}`)) return true;
  }
  return false;
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

export function projectRawTextRecords(
  existing: RawTextRecord[],
  incoming: RawTextRecord[],
  manifest: SnapshotManifest,
): RawTextRecord[] {
  const coveredUnits = new Set(manifest.replace_scope.unit_ids);
  const coveredDetachments = new Set(manifest.replace_scope.detachment_ids);
  const incomingIds = new Set(manifest.records.map(ingestRecordId));
  const projected = new Map<string, RawTextRecord>();
  for (const record of existing) {
    const remainingUnits = (record.unit_ids ?? []).filter((id) => !coveredUnits.has(id));
    const coveredOwner = (record.unit_ids ?? []).some((id) => coveredUnits.has(id));
    const coveredDetachment = record.detachment_id != null && coveredDetachments.has(record.detachment_id);
    const canonicalCoveredDetachment = hasCanonicalCoveredDetachment(record, coveredDetachments);
    if (!incomingIds.has(record.ability_id) && (coveredDetachment || canonicalCoveredDetachment || (coveredOwner && remainingUnits.length === 0))) continue;
    projected.set(record.ability_id, { ...record, unit_ids: remainingUnits });
  }
  const incomingById = new Map(incoming.map((record) => [record.ability_id, record]));
  for (const source of manifest.records) {
    const id = ingestRecordId(source);
    const replacement = incomingById.get(id);
    if (replacement) {
      projected.set(id, replacement);
      continue;
    }
    const prior = projected.get(id);
    if (!prior) continue;
    projected.set(id, {
      ...prior,
      name: source.name,
      faction_id: source.faction_id ?? manifest.replace_scope.faction_id,
      detachment_id: source.detachment_id ?? null,
      unit_ids: [...new Set([...prior.unit_ids, ...(source.unit_ids ?? [])])],
      ability_type: source.ability_type ?? prior.ability_type,
      game_version: { ...(source.game_version ?? manifest.replace_scope.game_version) },
    });
  }
  return [...projected.values()];
}

// ─── raw-text store I/O ──────────────────────────────────────────────

const STORE_README = `# 40kdc-abilities — raw ability text store

Out-of-repo lookup mapping \`faction\` and \`ability_id\` → original raw ability
text, written by \`40kdc-data\`'s \`author:ingest\`. This pairs each authored
Ability DSL entry with the source prose it was authored from.

This store is its **own git repository**, separate from 40kdc-data. The
\`author:ingest\` tool runs \`jj git init\` on first use; commit it to version the raw text.

**This is GW-copyrighted text — never commit it into 40kdc-data, which tracks
mechanics only.**

- \`index.json\` — nested \`faction → ability_id → { faction, raw_text }\` lookup.
- \`<faction>.json\` — full records (hierarchy + provenance + raw_text) per faction.
`;

/**
 * The store is always its own git-backed jj repo, separate from 40kdc-data.
 * Best-effort initialization on first run; an existing jj-only workspace is
 * already a repository even though it intentionally has no `.git` directory.
 */
function ensureStoreRepo(): void {
  if (existsSync(resolve(RAW_TEXT_STORE, ".jj")) || existsSync(resolve(RAW_TEXT_STORE, ".git"))) return;
  try {
    execFileSync("jj", ["git", "init", RAW_TEXT_STORE], { stdio: "ignore" });
    console.log(`Initialized raw-text store as a jj repo → ${RAW_TEXT_STORE} (commit to version the raw text).`);
  } catch {
    console.warn(`Could not initialize the raw-text store (${RAW_TEXT_STORE}). Files written; initialize it as a jj repo by hand.`);
  }
}

/**
 * Merge incoming raw-text records into the existing on-disk set, keyed by
 * `ability_id`. Additive manifests keep every existing entry; snapshot
 * manifests use {@link projectRawTextRecords} to replace only their declared
 * ownership scope.
 */
export function mergeRawTextRecords(existing: RawTextRecord[], incoming: RawTextRecord[]): RawTextRecord[] {
  const merged = new Map<string, RawTextRecord>(existing.map((e) => [e.ability_id, e]));
  for (const r of incoming) merged.set(r.ability_id, r); // updates in place; new ids append
  return Array.from(merged.values());
}

export function buildRawTextIndex(storeRoot: string = RAW_TEXT_STORE): Record<string, Record<string, Json>> {
  const index: Record<string, Record<string, Json>> = {};
  for (const file of readdirSync(storeRoot)) {
    if (!file.endsWith(".json") || file.startsWith("bundle-") || file === "index.json") continue;
    let entries: Json;
    try {
      entries = readJSON(resolve(storeRoot, file));
    } catch {
      continue;
    }
    if (!Array.isArray(entries)) continue;
    const faction = file.replace(/\.json$/, "");
    for (const entry of entries) {
      if (!entry.ability_id) continue;
      const owner = entry.faction_id ?? faction;
      const factionIndex = index[owner] ??= {};
      if (entry.ability_type === "stratagem" && (entry.when || entry.effect)) {
        const indexed: Json = {
          faction: owner,
          when: entry.when ?? "",
          target: entry.target ?? "",
          effect: entry.effect ?? "",
        };
        if (entry.restrictions) indexed.restrictions = entry.restrictions;
        factionIndex[entry.ability_id] = indexed;
      } else if (entry.raw_text) {
        factionIndex[entry.ability_id] = { faction: owner, raw_text: entry.raw_text };
      }
    }
  }
  return index;
}

function writeRawTextStore(records: RawTextRecord[], snapshots: ReadonlyMap<string, SnapshotManifest>): void {
  mkdirSync(RAW_TEXT_STORE, { recursive: true });
  ensureStoreRepo();
  const readmePath = resolve(RAW_TEXT_STORE, "README.md");
  if (!existsSync(readmePath)) writeFileSync(readmePath, STORE_README);

  const byFaction = new Map<string, RawTextRecord[]>();
  for (const record of records) {
    const factionRecords = byFaction.get(record.faction_id);
    if (factionRecords) factionRecords.push(record);
    else byFaction.set(record.faction_id, [record]);
  }
  for (const faction of new Set([...byFaction.keys(), ...snapshots.keys()])) {
    const path = resolve(RAW_TEXT_STORE, `${faction}.json`);
    const existing: RawTextRecord[] = existsSync(path) ? readJSON(path) : [];
    const incoming = byFaction.get(faction) ?? [];
    const snapshot = snapshots.get(faction);
    const projected = snapshot
      ? projectRawTextRecords(existing, incoming, snapshot)
      : mergeRawTextRecords(existing, incoming);
    writeFileSync(path, JSON.stringify(projected, null, 2) + "\n");
  }

  writeFileSync(
    resolve(RAW_TEXT_STORE, "index.json"),
    JSON.stringify(buildRawTextIndex(), null, 2) + "\n",
  );
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

  const allRawText: RawTextRecord[] = [];
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
    allRawText.push(...r.rawText);
    console.log(
      `  ${faction}: ${recs.length} records → +${r.created} stubs, ${r.mergedUnits} unit links merged, ` +
        `${r.rawText.length} raw-text records, ${r.unresolved.length} unresolved`,
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

  if (!dryRun) writeRawTextStore(allRawText, snapshots);

  console.log(
    `\n${totalCreated} stubs created, ${totalMerged} unit links merged, ` +
      `${allRawText.length} raw-text records, ${totalUnresolved} unresolved.` +
      (review.length ? ` ${review.length} merged into authored entries — review.` : "") +
      (dryRun ? " (dry run — nothing written)" : ` Raw-text store → ${RAW_TEXT_STORE}`),
  );
  console.log("Next: cd tools && npm run author:propose -- <faction> → author:review → author:apply → validate");
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).replace(/\.\w+$/, "") === fileURLToPath(import.meta.url).replace(/\.\w+$/, "");
if (isMain) main();
