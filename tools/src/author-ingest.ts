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
  source_kind?: "pdf" | "json";
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
  /** Merges into an already-authored (non-stub) entry — surfaced for review. */
  mergedIntoAuthored: { ability_id: string; unit_id: string }[];
  /** Records carrying no usable raw_text — seeded but left unresolved for input. */
  unresolved: { ability_id: string; name: string; reason: string }[];
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
    abilities, authorInput: [], rawText: [], created: 0, mergedUnits: 0, mergedIntoAuthored: [], unresolved: [],
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

// ─── raw-text store I/O ──────────────────────────────────────────────

const STORE_README = `# 40kdc-abilities — raw ability text store

Out-of-repo lookup mapping \`ability_id\` → original raw ability text, written by
\`40kdc-data\`'s \`author:ingest\`. This pairs each authored Ability DSL entry with
the source prose it was authored from.

This store is its **own git repository**, separate from 40kdc-data. The
\`author:ingest\` tool \`git init\`s it on first run; commit it to version the raw text.

**This is GW-copyrighted text — never commit it into 40kdc-data, which tracks
mechanics only.**

- \`index.json\` — flat \`ability_id → { faction, raw_text }\` for O(1) lookup.
- \`<faction>.json\` — full records (hierarchy + provenance + raw_text) per faction.
`;

/**
 * The store is always its own git-tracked repo (separate from 40kdc-data, which
 * holds mechanics only). Best-effort `git init` on first run — never write a
 * `.gitignore` that would stop the repo tracking its own text. If git is absent
 * the files are still written; the user can init the repo by hand.
 */
function ensureStoreRepo(): void {
  if (existsSync(resolve(RAW_TEXT_STORE, ".git"))) return;
  try {
    execFileSync("git", ["init", "-q", RAW_TEXT_STORE], { stdio: "ignore" });
    console.log(`Initialized raw-text store as a git repo → ${RAW_TEXT_STORE} (commit to version the raw text).`);
  } catch {
    console.warn(`Could not 'git init' the raw-text store (${RAW_TEXT_STORE}). Files written; initialize it as a git repo by hand.`);
  }
}

/**
 * Merge incoming raw-text records into the existing on-disk set, keyed by
 * `ability_id`. **Additive and non-destructive:** every existing entry is kept;
 * an entry for the same `ability_id` is updated in place (its prior text remains
 * in the store's git history); new abilities are appended. Existing entries are
 * never dropped — writing never deletes ability text already in the store.
 */
export function mergeRawTextRecords(existing: RawTextRecord[], incoming: RawTextRecord[]): RawTextRecord[] {
  const merged = new Map<string, RawTextRecord>(existing.map((e) => [e.ability_id, e]));
  for (const r of incoming) merged.set(r.ability_id, r); // updates in place; new ids append
  return Array.from(merged.values());
}

function writeRawTextStore(records: RawTextRecord[]): void {
  mkdirSync(RAW_TEXT_STORE, { recursive: true });
  ensureStoreRepo();
  const readmePath = resolve(RAW_TEXT_STORE, "README.md");
  if (!existsSync(readmePath)) writeFileSync(readmePath, STORE_README);

  // Group this run's records by faction and merge into per-faction files by id.
  const byFaction = new Map<string, RawTextRecord[]>();
  for (const r of records) (byFaction.get(r.faction_id) ?? byFaction.set(r.faction_id, []).get(r.faction_id)!).push(r);
  for (const [faction, recs] of byFaction) {
    const path = resolve(RAW_TEXT_STORE, `${faction}.json`);
    const existing: RawTextRecord[] = existsSync(path) ? readJSON(path) : [];
    writeFileSync(path, JSON.stringify(mergeRawTextRecords(existing, recs), null, 2) + "\n");
  }

  // Update the flat index additively — only ability_ids in this run change; every
  // other existing entry is left intact (never rebuilt-from-scratch / pruned).
  const indexPath = resolve(RAW_TEXT_STORE, "index.json");
  const index: Record<string, { faction: string; raw_text: string }> = existsSync(indexPath) ? readJSON(indexPath) : {};
  for (const r of records) index[r.ability_id] = { faction: r.faction_id, raw_text: r.raw_text };
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
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
  for (const f of manifestFiles) {
    const parsed = readJSON(f);
    if (!Array.isArray(parsed)) { console.error(`${f}: not a JSON array of ingest records — skipping.`); continue; }
    records.push(...parsed);
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

    const r = ingestFaction(faction, recs, existingAbilities, existingInput);
    totalCreated += r.created;
    totalMerged += r.mergedUnits;
    totalUnresolved += r.unresolved.length;
    review.push(...r.mergedIntoAuthored.map((m) => ({ faction, ...m })));
    allRawText.push(...r.rawText);
    console.log(
      `  ${faction}: ${recs.length} records → +${r.created} stubs, ${r.mergedUnits} unit links merged, ` +
        `${r.rawText.length} raw-text records, ${r.unresolved.length} unresolved`,
    );

    if (!dryRun) {
      mkdirSync(resolve(ENRICHMENT_ROOT, faction), { recursive: true });
      writeFileSync(abilitiesPath, JSON.stringify(r.abilities, null, 2) + "\n");
      mkdirSync(INPUT_DIR, { recursive: true });
      writeFileSync(inputPath, JSON.stringify(r.authorInput, null, 2) + "\n");
    }
  }

  if (!dryRun) writeRawTextStore(allRawText);

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
