import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { canonicalize, hashJson } from "../round4/hash.js";
import {
  REVIEWED_FAMILY_REGISTRY,
  SEMANTIC_ROLES,
  familyRole,
  validateFingerprint,
  type SemanticRole,
} from "./contracts.js";
import { getCurrentCoverage, type UncoveredInterval } from "./coverage.js";
import { bumpWorkbenchRevision, exactSpan, initializeWorkbench, insertSpan, withTransaction } from "./db.js";
import {
  asRecord, assertExactKeys, fragmentFor, nonblank, nonnegativeInteger, parseFragments, parseQualifiers,
  positiveFiniteNumber, safeInteger,
  type CurrentAbility, type Fragment, type JsonRecord, type ParsedConnective, type ParsedQualifier,
  type ParsedResponse, type ParsedSemanticSpan, type ParsedStructural, type ParsedUnresolved,
} from "./luna-parse.js";
import { recordCandidateSuggestion } from "./ontology-store.js";
import { insertStructuralProposal } from "./atoms-store.js";
import {
  CONNECTIVE_KINDS, LEGACY_PROMPT_VERSION, LEGACY_REQUEST_SCHEMA_VERSION, LUNA_INSTRUCTIONS_V2, LUNA_MODEL, LunaRunError,
  PROMPT_VERSION, REQUEST_SCHEMA_VERSION, RESPONSE_SCHEMA_V2,
} from "./luna-schema.js";
import { anchorExactText, parseHypothesis, parseQualifiersV2, parseStructuralSpans } from "./luna-v2.js";

/**
 * Bytes of ability payload one request may carry, over its fixed instructions, examples and
 * family registry. The registry grows with every leaf family, so it sits outside the budget.
 */
const ABILITY_BUDGET_BYTES = 48 * 1024;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 15;
const repositoryRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const defaultArtifactDirectory = resolve(repositoryRoot, "_private", "round5c");

const roleCues: Record<SemanticRole | "CONNECTIVE", readonly string[]> = {
  CONDITION: ["if", "while", "unless", "below", "leading"],
  EVENT: ["when", "each time", "after", "before", "whenever"],
  EFFECT: ["re-roll", "add", "subtract", "gain", "lose", "spend", "set"],
  DURATION: ["until", "end of"],
  CONNECTIVE: ["and", "or", "then", "while", "if"],
};

type ConfirmedSpan = {
  fragment: string;
  start_byte: number;
  end_byte: number;
  exact_text: string;
  role: SemanticRole;
  family_id: string;
  family_version: number;
  parameters: Record<string, unknown>;
};

type RequestAbility = {
  faction_id: string;
  ability_id: string;
  source_hash: string;
  source_text: string;
  /** Every word and punctuation token as [start_byte, end_byte, text]; span offsets come from these. */
  byte_tokens: Array<[number, number, string]>;
  fragments: Fragment[];
  confirmed_spans: ConfirmedSpan[];
  uncovered_regions: UncoveredInterval[];
};

type RequestAbilityConfig = {
  ability_version_id: number;
  faction_id: string;
  ability_id: string;
  source_hash: string;
  uncovered_regions: Array<{ fragment: string; start_byte: number; end_byte: number }>;
};

export type PreparedRequest = {
  schema_version: number;
  prompt_version: string;
  instructions: string;
  requested_model: string;
  response_schema: typeof RESPONSE_SCHEMA_V2;
  registry: Array<{
    id: string;
    version: number;
    role: SemanticRole;
    parameter_schema: Record<string, unknown>;
  }>;
  confirmed_examples: Array<ConfirmedSpan & {
    faction_id: string;
    ability_id: string;
    source_hash: string;
  }>;
  lexical_vocabulary: {
    role_cues: Record<SemanticRole | "CONNECTIVE", readonly string[]>;
    known_forms: string[];
  };
  abilities: RequestAbility[];
};

/**
 * Persisted run provenance. `execution` is null until one runner claims the run; only that
 * owner may complete or fail it. v1 rows predate `transport` and the provenance hashes.
 */
type ModelRunConfig = {
  schema_version: number;
  request_schema_version: number;
  request_path: string;
  request_bytes: number;
  transport?: "omp-json";
  requested_model?: string;
  mode?: LunaMode;
  input_hash?: string;
  system_prompt_hash?: string;
  predecessor_run_id?: number | null;
  execution?: LunaExecution | null;
  request_abilities: RequestAbilityConfig[];
  manual_review_abilities: Array<{
    ability_version_id: number;
    faction_id: string;
    ability_id: string;
    source_hash: string;
    reason: "oversized-complete-ability";
  }>;
};

type ModelRun = {
  id: number;
  input_hash: string;
  config_json: string;
  status: string;
};

/** Claim held by exactly one runner while an OMP subprocess works on a run. */
export type LunaExecution = { owner: string; started_at: string; omp_version?: string | null };

export type PreparedLuna = {
  run_id: string;
  input_hash: string;
  request_path: string;
  request: unknown;
};

function requestedLimit(options: { limit?: number } | undefined): number {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new RangeError(`Luna batch limit must be an integer from 1 through ${MAX_LIMIT}.`);
  }
  return limit;
}

function currentAbilities(db: DatabaseSync): CurrentAbility[] {
  return db.prepare(`
    SELECT id, faction_id, ability_id, source_hash, source_text, fragments_json
    FROM abilities
    WHERE current = 1
    ORDER BY faction_id, ability_id, id
  `).all() as CurrentAbility[];
}

function parseParameters(value: unknown, label: string): Record<string, unknown> {
  return asRecord(value, label);
}

function confirmedSpans(db: DatabaseSync, abilityVersionId: number): ConfirmedSpan[] {
  const rows = db.prepare(`
    SELECT source_spans.fragment, source_spans.start_byte, source_spans.end_byte, source_spans.exact_text,
      semantic_families.role, fingerprints.family_id, fingerprints.family_version, fingerprints.parameters_json
    FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    JOIN semantic_families ON semantic_families.id = fingerprints.family_id
      AND semantic_families.version = fingerprints.family_version
    WHERE annotations.status = 'active' AND source_spans.ability_version_id = ?
    ORDER BY source_spans.start_byte, source_spans.end_byte, annotations.id
  `).all(abilityVersionId) as Array<{
    fragment: string;
    start_byte: number;
    end_byte: number;
    exact_text: string;
    role: SemanticRole;
    family_id: string;
    family_version: number;
    parameters_json: string;
  }>;
  return rows.map((row) => ({
    fragment: row.fragment,
    start_byte: row.start_byte,
    end_byte: row.end_byte,
    exact_text: row.exact_text,
    role: row.role,
    family_id: row.family_id,
    family_version: row.family_version,
    parameters: parseParameters(JSON.parse(row.parameters_json), "fingerprint.parameters_json"),
  }));
}

function selectedExamples(db: DatabaseSync): PreparedRequest["confirmed_examples"] {
  const rows = db.prepare(`
    SELECT abilities.faction_id, abilities.ability_id, abilities.source_hash,
      source_spans.fragment, source_spans.start_byte, source_spans.end_byte, source_spans.exact_text,
      semantic_families.role, fingerprints.family_id, fingerprints.family_version, fingerprints.parameters_json
    FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    JOIN semantic_families ON semantic_families.id = fingerprints.family_id
      AND semantic_families.version = fingerprints.family_version
    WHERE annotations.status = 'active' AND abilities.current = 1
    ORDER BY annotations.id
    LIMIT 24
  `).all() as Array<{
    faction_id: string;
    ability_id: string;
    source_hash: string;
    fragment: string;
    start_byte: number;
    end_byte: number;
    exact_text: string;
    role: SemanticRole;
    family_id: string;
    family_version: number;
    parameters_json: string;
  }>;
  return rows.map((row) => ({
    faction_id: row.faction_id,
    ability_id: row.ability_id,
    source_hash: row.source_hash,
    fragment: row.fragment,
    start_byte: row.start_byte,
    end_byte: row.end_byte,
    exact_text: row.exact_text,
    role: row.role,
    family_id: row.family_id,
    family_version: row.family_version,
    parameters: parseParameters(JSON.parse(row.parameters_json), "fingerprint.parameters_json"),
  }));
}

function activeRegistry(db: DatabaseSync): PreparedRequest["registry"] {
  const rows = db.prepare(`
    SELECT id, version, role, parameter_schema_json
    FROM semantic_families
    WHERE status = 'active'
    ORDER BY id, version
  `).all() as Array<{ id: string; version: number; role: SemanticRole; parameter_schema_json: string }>;
  if (rows.length !== REVIEWED_FAMILY_REGISTRY.filter((family) => !family.deprecated).length) throw new Error("The persisted reviewed semantic registry is incomplete.");
  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    role: row.role,
    parameter_schema: asRecord(JSON.parse(row.parameter_schema_json), `semantic_families.${row.id}.parameter_schema_json`),
  }));
}

function requestBase(db: DatabaseSync): Omit<PreparedRequest, "abilities"> {
  const examples = selectedExamples(db);
  const knownForms = [...new Set(examples.map((example) => example.exact_text))].sort((left, right) => left.localeCompare(right));
  return {
    schema_version: REQUEST_SCHEMA_VERSION,
    prompt_version: PROMPT_VERSION,
    instructions: LUNA_INSTRUCTIONS_V2,
    requested_model: LUNA_MODEL,
    response_schema: RESPONSE_SCHEMA_V2,
    registry: activeRegistry(db),
    confirmed_examples: examples,
    lexical_vocabulary: { role_cues: roleCues, known_forms: knownForms },
  };
}

function requestAbility(ability: CurrentAbility, uncovered: UncoveredInterval[], db: DatabaseSync): RequestAbility {
  const fragments = parseFragments(JSON.parse(ability.fragments_json), ability.source_text, "abilities.fragments_json");
  return {
    faction_id: ability.faction_id,
    ability_id: ability.ability_id,
    source_hash: ability.source_hash,
    source_text: ability.source_text,
    byte_tokens: byteTokens(ability.source_text),
    fragments,
    confirmed_spans: confirmedSpans(db, ability.id),
    uncovered_regions: uncovered.map((region) => ({ ...region })),
  };
}

/**
 * Word and punctuation tokens with exact UTF-8 byte boundaries. Models misplace raw byte
 * counts; choosing spans from token boundaries keeps every offset exact.
 */
export function byteTokens(source: string): Array<[number, number, string]> {
  const tokens: Array<[number, number, string]> = [];
  for (const match of source.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*|[^\s\p{L}\p{N}]/gu)) {
    const start = Buffer.byteLength(source.slice(0, match.index), "utf8");
    tokens.push([start, start + Buffer.byteLength(match[0], "utf8"), match[0]]);
  }
  return tokens;
}

function canonicalBytes(request: PreparedRequest): number {
  return Buffer.byteLength(canonicalize(request), "utf8");
}

/**
 * The request's wire bytes, with every field but `abilities` serialized first and `abilities`
 * last. `canonicalize()` sorts a request's top-level keys alphabetically for hashing, which
 * happens to put "abilities" — the one field that differs on every call — ahead of the large,
 * request-to-request stable "confirmed_examples"/"instructions"/"lexical_vocabulary"/"registry"/
 * "response_schema"/"schema_version" fields. Two requests built from the same registry and
 * confirmed examples then share no leading bytes at all, so a model transport that caches by
 * prompt prefix (DeepSeek's included) gets nothing to reuse. Moving "abilities" to the end makes
 * everything before it byte-identical across such requests, so the fixed ~tens-of-KB part is a
 * real shared prefix. `input_hash` (order-independent; recomputed with `hashJson`, which still
 * canonicalizes with the original alphabetical order) is unaffected by this — it hashes the
 * parsed object, not this literal string.
 */
export function serializeLunaRequest(request: PreparedRequest): string {
  const { abilities, ...fixed } = request;
  const fixedJson = canonicalize(fixed);
  return `${fixedJson.slice(0, -1)},"abilities":${canonicalize(abilities)}}`;
}

function manualGapDescription(): string {
  return "Complete ability exceeds the 48 KiB Luna ability budget and requires manual review.";
}

function recordManualOversize(db: DatabaseSync, abilities: readonly CurrentAbility[]): void {
  const description = manualGapDescription();
  const insert = db.prepare(`
    INSERT INTO gaps (ability_version_id, type, status, description, batch_id)
    SELECT ?, 'LEAF_GAP', 'open', ?, NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM gaps
      WHERE ability_version_id = ? AND type = 'LEAF_GAP' AND status = 'open' AND description = ?
    )
  `);
  for (const ability of abilities) insert.run(ability.id, description, ability.id, description);
}

function requestArtifactDirectory(): string {
  return resolve(process.env.ROUND5C_ARTIFACT_DIR ?? defaultArtifactDirectory);
}

/**
 * Which source a Luna request asks about. `coverage` sends every uncovered region of the
 * lowest-coverage abilities. `residue` sends only uncovered source that no pending or
 * unresolved proposal already claims, largest residue first, so Luna works where human review
 * has nothing queued.
 */
export type LunaMode = "coverage" | "residue";

function requestedMode(options: { mode?: unknown } | undefined): LunaMode {
  const mode = options?.mode ?? "coverage";
  if (mode !== "coverage" && mode !== "residue") throw new RangeError("Luna mode must be coverage or residue.");
  return mode;
}

function residueBytes(regions: readonly UncoveredInterval[]): number {
  return regions.reduce((total, region) => total + region.end_byte - region.start_byte, 0);
}

/** Options for one prepared source-decomposition request. */
export type PrepareLunaOptions = {
  limit?: number;
  mode?: LunaMode;
  faction_id?: string;
  /** Analyze exactly this current source version. */
  ability_version_id?: number;
  /** Re-prepare the abilities of this failed run as a new, linked run. */
  retry_of?: number;
};

function positiveId(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be a positive integer.`);
  return value;
}

function predecessorAbilities(db: DatabaseSync, runId: number): Set<number> {
  const run = db.prepare("SELECT status, config_json FROM model_runs WHERE id = ?").get(runId) as { status: string; config_json: string } | undefined;
  if (!run) throw new LunaRunError(404, `Unknown Luna model run ${runId}.`);
  const config = asRecord(JSON.parse(run.config_json), "model_runs.config_json");
  if (!Array.isArray(config.request_abilities)) throw new LunaRunError(422, `Model run ${runId} is not a source-decomposition run.`);
  if (run.status !== "failed") throw new LunaRunError(409, `Only a failed run can be retried; run ${runId} is ${run.status}.`);
  const successor = db.prepare(`
    SELECT id FROM model_runs WHERE json_extract(config_json, '$.predecessor_run_id') = ? LIMIT 1
  `).get(runId) as { id: number } | undefined;
  if (successor) throw new LunaRunError(409, `Run ${runId} was already retried as run ${successor.id}.`);
  return new Set(config.request_abilities.map((item) => Number(asRecord(item, "request ability").ability_version_id)));
}

/**
 * Prepare a bounded, complete-ability request for the Luna transport. Candidate selection,
 * the pending-run check, the run insert, and the request artifact write happen in one write
 * transaction, so two callers can never claim the same ability. It never invokes a model.
 */
export function prepareLuna(db: DatabaseSync, options: PrepareLunaOptions = {}): PreparedLuna {
  initializeWorkbench(db);
  const limit = requestedLimit(options);
  const mode = requestedMode(options);
  const abilityVersionId = positiveId(options.ability_version_id, "ability_version_id");
  const retryOf = positiveId(options.retry_of, "retry_of");
  const artifactDirectory = requestArtifactDirectory();
  let writtenPath: string | null = null;
  let prepared: PreparedLuna | null;
  try {
    prepared = withTransaction(db, (): PreparedLuna | null => {
      const runs = db.prepare(`
        SELECT DISTINCT json_extract(request_ability.value, '$.ability_version_id') AS id, model_runs.status
        FROM model_runs, json_each(model_runs.config_json, '$.request_abilities') AS request_ability
        WHERE model_runs.status IN ('pending', 'completed')
      `).all() as Array<{ id: number; status: "pending" | "completed" }>;
      const pending = new Set(runs.filter((run) => run.status === "pending").map((run) => Number(run.id)));
      const completed = new Set(runs.filter((run) => run.status === "completed").map((run) => Number(run.id)));
      const retryScope = retryOf === undefined ? null : predecessorAbilities(db, retryOf);
      if (abilityVersionId !== undefined) {
        const target = db.prepare("SELECT current FROM abilities WHERE id = ?").get(abilityVersionId) as { current: number } | undefined;
        if (!target) throw new LunaRunError(404, `Unknown ability version ${abilityVersionId}.`);
        if (target.current !== 1) throw new LunaRunError(409, `Ability version ${abilityVersionId} is no longer the current source.`);
        if (pending.has(abilityVersionId)) throw new LunaRunError(409, `Ability version ${abilityVersionId} already belongs to a pending Luna run.`);
        if (retryScope && !retryScope.has(abilityVersionId)) throw new LunaRunError(422, `Run ${retryOf} did not request ability version ${abilityVersionId}.`);
      }
      const coverage = getCurrentCoverage(db);
      const candidates = currentAbilities(db)
        .filter((ability) => abilityVersionId === undefined || ability.id === abilityVersionId)
        .filter((ability) => retryScope === null || retryScope.has(ability.id))
        .map((ability) => {
          const view = coverage.get(ability.id);
          return { ability, uncovered: (mode === "residue" ? view?.residue : view?.unaccounted) ?? [] };
        })
        .filter((candidate) => candidate.uncovered.length > 0)
        .filter((candidate) => !options.faction_id || candidate.ability.faction_id === options.faction_id)
        .filter((candidate) => !pending.has(candidate.ability.id))
        .sort((left, right) => {
          const byMode = mode === "residue"
            ? residueBytes(right.uncovered) - residueBytes(left.uncovered)
            : (coverage.get(left.ability.id)?.accounted_fraction ?? 0) - (coverage.get(right.ability.id)?.accounted_fraction ?? 0);
          return byMode || left.ability.faction_id.localeCompare(right.ability.faction_id)
            || left.ability.ability_id.localeCompare(right.ability.ability_id) || left.ability.id - right.ability.id;
        });
      if (candidates.length === 0) {
        throw new RangeError(abilityVersionId === undefined
          ? "No current abilities are available with unaccounted reviewable source regions."
          : `Ability version ${abilityVersionId} has no ${mode === "residue" ? "unclaimed" : "unaccounted"} source to analyze.`);
      }

      const base = requestBase(db);
      const maxRequestBytes = canonicalBytes({ ...base, abilities: [] }) + ABILITY_BUDGET_BYTES;
      const selected: Array<{ ability: CurrentAbility; uncovered: UncoveredInterval[]; request: RequestAbility }> = [];
      const oversized: CurrentAbility[] = [];
      // A targeted or retried request re-sends previously analyzed abilities on purpose.
      const fresh = abilityVersionId !== undefined || retryScope !== null
        ? candidates
        : candidates.filter((candidate) => !completed.has(candidate.ability.id));
      for (const candidate of fresh.length ? fresh : candidates) {
        if (selected.length >= limit) break;
        const next = requestAbility(candidate.ability, candidate.uncovered, db);
        if (canonicalBytes({ ...base, abilities: [next] }) > maxRequestBytes) {
          oversized.push(candidate.ability);
          continue;
        }
        const tentative: PreparedRequest = { ...base, abilities: [...selected.map((item) => item.request), next] };
        if (canonicalBytes(tentative) <= maxRequestBytes) selected.push({ ...candidate, request: next });
      }
      recordManualOversize(db, oversized);
      // Commit the oversize gaps, then report: the source stays actionable by manual review.
      if (selected.length === 0) return null;

      const request: PreparedRequest = { ...base, abilities: selected.map((item) => item.request) };
      const serializedRequest = serializeLunaRequest(request);
      const requestBytes = Buffer.byteLength(serializedRequest, "utf8");
      if (requestBytes > maxRequestBytes) throw new Error("Luna request cap enforcement failed.");
      const inputHash = hashJson(request);
      const configFor = (requestPath: string): ModelRunConfig => ({
        schema_version: REQUEST_SCHEMA_VERSION,
        request_schema_version: REQUEST_SCHEMA_VERSION,
        request_path: requestPath,
        request_bytes: requestBytes,
        transport: "omp-json",
        requested_model: LUNA_MODEL,
        mode,
        input_hash: inputHash,
        system_prompt_hash: hashJson({ instructions: request.instructions }),
        predecessor_run_id: retryOf ?? null,
        execution: null,
        request_abilities: selected.map((item): RequestAbilityConfig => ({
          ability_version_id: item.ability.id,
          faction_id: item.ability.faction_id,
          ability_id: item.ability.ability_id,
          source_hash: item.ability.source_hash,
          uncovered_regions: item.uncovered.map(({ fragment, start_byte, end_byte }) => ({ fragment, start_byte, end_byte })),
        })),
        manual_review_abilities: oversized.map((ability) => ({
          ability_version_id: ability.id,
          faction_id: ability.faction_id,
          ability_id: ability.ability_id,
          source_hash: ability.source_hash,
          reason: "oversized-complete-ability" as const,
        })),
      });
      const inserted = db.prepare(`
        INSERT INTO model_runs (model, model_version, prompt_version, input_hash, config_json, output_json, latency_ms, cost_usd, status, created_at)
        VALUES ('external', 'unknown', ?, ?, ?, NULL, NULL, NULL, 'pending', ?)
      `).run(PROMPT_VERSION, inputHash, JSON.stringify(configFor("pending")), new Date().toISOString());
      const runId = String(inserted.lastInsertRowid);
      const requestPath = resolve(artifactDirectory, `luna-${runId}.request.json`);
      db.prepare("UPDATE model_runs SET config_json = ? WHERE id = ?").run(JSON.stringify(configFor(requestPath)), Number(inserted.lastInsertRowid));
      bumpWorkbenchRevision(db);
      mkdirSync(artifactDirectory, { recursive: true });
      writtenPath = requestPath;
      writeFileSync(requestPath, serializedRequest, "utf8");
      return { run_id: runId, input_hash: inputHash, request_path: requestPath, request };
    });
  } catch (error) {
    // A failed commit must not leave an orphaned request artifact behind.
    if (writtenPath) rmSync(writtenPath, { force: true });
    throw error;
  }
  if (!prepared) throw new RangeError("No complete ability fits within the 48 KiB Luna ability budget; oversized abilities were marked for manual review.");
  return prepared;
}

function parseRunId(value: unknown): { runId: string; id: number } {
  const runId = nonblank(value, "body.run_id");
  if (!/^[1-9]\d*$/u.test(runId)) throw new TypeError("body.run_id must be a model run ID.");
  const id = Number(runId);
  if (!Number.isSafeInteger(id)) throw new RangeError("body.run_id is outside the safe SQLite integer range.");
  return { runId, id };
}

function modelRun(db: DatabaseSync, id: number): ModelRun {
  const run = db.prepare("SELECT id, input_hash, config_json, status FROM model_runs WHERE id = ?").get(id) as ModelRun | undefined;
  if (!run) throw new RangeError(`Unknown Luna model run ${id}.`);
  return run;
}

/** The request version a run was prepared under; imports validate against exactly that version. */
function configuredVersion(config: JsonRecord): 1 | 2 {
  for (const version of [LEGACY_REQUEST_SCHEMA_VERSION, REQUEST_SCHEMA_VERSION] as const) {
    if (config.schema_version === version && config.request_schema_version === version) return version;
  }
  throw new Error("Luna model run uses an unsupported request schema version.");
}

function parseConfiguredAbilities(value: unknown): RequestAbilityConfig[] {
  const config = asRecord(value, "model_runs.config_json");
  configuredVersion(config);
  if (!Array.isArray(config.request_abilities) || config.request_abilities.length === 0) {
    throw new Error("Luna model run has no requested abilities.");
  }
  const identities = new Set<string>();
  return config.request_abilities.map((value, index) => {
    const item = asRecord(value, `model_runs.config_json.request_abilities[${index}]`);
    const ability: RequestAbilityConfig = {
      ability_version_id: nonnegativeInteger(item.ability_version_id, `model_runs.config_json.request_abilities[${index}].ability_version_id`),
      faction_id: nonblank(item.faction_id, `model_runs.config_json.request_abilities[${index}].faction_id`),
      ability_id: nonblank(item.ability_id, `model_runs.config_json.request_abilities[${index}].ability_id`),
      source_hash: nonblank(item.source_hash, `model_runs.config_json.request_abilities[${index}].source_hash`),
      uncovered_regions: parseConfiguredUncovered(item.uncovered_regions, `model_runs.config_json.request_abilities[${index}].uncovered_regions`),
    };
    const key = abilityIdentity(ability.faction_id, ability.ability_id, ability.source_hash);
    if (identities.has(key)) throw new Error("Luna model run repeats a requested ability identity.");
    identities.add(key);
    return ability;
  });
}

function parseConfiguredUncovered(value: unknown, label: string): RequestAbilityConfig["uncovered_regions"] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value.map((value, index) => {
    const item = asRecord(value, `${label}[${index}]`);
    assertExactKeys(item, `${label}[${index}]`, ["fragment", "start_byte", "end_byte"]);
    const start = nonnegativeInteger(item.start_byte, `${label}[${index}].start_byte`);
    const end = nonnegativeInteger(item.end_byte, `${label}[${index}].end_byte`);
    if (end <= start) throw new RangeError(`${label}[${index}] has an empty interval.`);
    return { fragment: nonblank(item.fragment, `${label}[${index}].fragment`), start_byte: start, end_byte: end };
  });
}

function abilityIdentity(factionId: string, abilityId: string, sourceHash: string): string {
  return `${factionId}\u0000${abilityId}\u0000${sourceHash}`;
}

function currentAbilityForConfigured(db: DatabaseSync, configured: RequestAbilityConfig): CurrentAbility {
  const ability = db.prepare(`
    SELECT id, faction_id, ability_id, source_hash, source_text, fragments_json
    FROM abilities
    WHERE id = ? AND faction_id = ? AND ability_id = ? AND source_hash = ? AND current = 1
  `).get(
    configured.ability_version_id,
    configured.faction_id,
    configured.ability_id,
    configured.source_hash,
  ) as CurrentAbility | undefined;
  if (!ability) throw new Error(`Requested ability ${configured.faction_id}/${configured.ability_id} is no longer the current source version.`);
  return ability;
}

function parseResponseBody(db: DatabaseSync, response: unknown, inputHash: string, abilities: Map<string, { ability: CurrentAbility; configured: RequestAbilityConfig }>, version: 1 | 2): ParsedResponse {
  const promptVersion = version === 2 ? PROMPT_VERSION : LEGACY_PROMPT_VERSION;
  const root = asRecord(response, "response");
  assertExactKeys(root, "response", ["schema_version", "input_hash", "model", "model_version", "prompt_version", "abilities"], ["latency_ms", "cost_usd"]);
  if (root.schema_version !== version) throw new TypeError(`response.schema_version must be ${version}.`);
  if (nonblank(root.input_hash, "response.input_hash") !== inputHash) throw new Error("response.input_hash does not match the prepared Luna request.");
  const model = nonblank(root.model, "response.model");
  const modelVersion = nonblank(root.model_version, "response.model_version");
  if (nonblank(root.prompt_version, "response.prompt_version") !== promptVersion) throw new Error(`response.prompt_version does not match ${promptVersion}.`);
  if (!Array.isArray(root.abilities)) throw new TypeError("response.abilities must be an array.");
  if (root.abilities.length !== abilities.size) throw new Error("response must include every prepared ability exactly once.");
  const latency = root.latency_ms === undefined ? null : nonnegativeInteger(root.latency_ms, "response.latency_ms");
  const cost = root.cost_usd === undefined ? null : positiveFiniteNumber(root.cost_usd, "response.cost_usd");
  const semanticSpans: ParsedSemanticSpan[] = [];
  const structural: ParsedStructural[] = [];
  const connectives: ParsedConnective[] = [];
  const unresolved: ParsedUnresolved[] = [];
  const seenAbilities = new Set<string>();

  for (const [abilityIndex, value] of root.abilities.entries()) {
    const item = asRecord(value, `response.abilities[${abilityIndex}]`);
    assertExactKeys(
      item,
      `response.abilities[${abilityIndex}]`,
      ["faction_id", "ability_id", "source_hash", "spans", ...(version === 2 ? ["structural_spans"] : []), "connectives", "unresolved_regions"],
    );
    const factionId = nonblank(item.faction_id, `response.abilities[${abilityIndex}].faction_id`);
    const abilityId = nonblank(item.ability_id, `response.abilities[${abilityIndex}].ability_id`);
    const sourceHash = nonblank(item.source_hash, `response.abilities[${abilityIndex}].source_hash`);
    const key = abilityIdentity(factionId, abilityId, sourceHash);
    const configured = abilities.get(key);
    if (!configured) throw new Error(`response.abilities[${abilityIndex}] has an unknown ability identity or source hash.`);
    if (seenAbilities.has(key)) throw new Error(`response repeats ability ${factionId}/${abilityId}.`);
    seenAbilities.add(key);
    const fragments = parseFragments(JSON.parse(configured.ability.fragments_json), configured.ability.source_text, "abilities.fragments_json");

    if (!Array.isArray(item.spans)) throw new TypeError(`response.abilities[${abilityIndex}].spans must be an array.`);
    for (const [spanIndex, value] of item.spans.entries()) {
      const span = asRecord(value, `response.abilities[${abilityIndex}].spans[${spanIndex}]`);
      assertExactKeys(
        span,
        `response.abilities[${abilityIndex}].spans[${spanIndex}]`,
        ["start_byte", "end_byte", "exact_text", "role", "status"],
        ["family_id", "family_version", "parameters", "qualifier_spans", "description", ...(version === 2 ? ["hypothesis"] : [])],
      );
      const reportedStart = nonnegativeInteger(span.start_byte, `response.abilities[${abilityIndex}].spans[${spanIndex}].start_byte`);
      const reportedEnd = nonnegativeInteger(span.end_byte, `response.abilities[${abilityIndex}].spans[${spanIndex}].end_byte`);
      if (reportedEnd <= reportedStart) throw new RangeError(`response.abilities[${abilityIndex}].spans[${spanIndex}] has an empty interval.`);
      const exactText = nonblank(span.exact_text, `response.abilities[${abilityIndex}].spans[${spanIndex}].exact_text`);
      let startByte = reportedStart;
      let endByte = reportedEnd;
      let offsetRepaired = false;
      if (version === 2) {
        const anchored = anchorExactText(configured.ability.source_text, reportedStart, reportedEnd, exactText, `response.abilities[${abilityIndex}].spans[${spanIndex}]`);
        ({ start_byte: startByte, end_byte: endByte } = anchored);
        offsetRepaired = anchored.repaired;
      } else if (exactSpan(configured.ability.source_text, startByte, endByte) !== exactText) {
        throw new Error(`response.abilities[${abilityIndex}].spans[${spanIndex}].exact_text does not match source bytes.`);
      }
      const fragment = fragmentFor(fragments, startByte, endByte);
      const status = nonblank(span.status, `response.abilities[${abilityIndex}].spans[${spanIndex}].status`);
      if (status !== "EXISTING" && status !== "NOVEL" && status !== "UNRESOLVED") {
        throw new TypeError(`response.abilities[${abilityIndex}].spans[${spanIndex}].status is invalid.`);
      }
      const rawRole = nonblank(span.role, `response.abilities[${abilityIndex}].spans[${spanIndex}].role`);
      const reportedRole = rawRole === "UNRESOLVED"
        ? "UNRESOLVED"
        : (SEMANTIC_ROLES as readonly string[]).includes(rawRole)
          ? rawRole as SemanticRole
          : (() => { throw new TypeError(`response.abilities[${abilityIndex}].spans[${spanIndex}].role is invalid.`); })();
      const description = span.description === undefined ? null : nonblank(span.description, `response.abilities[${abilityIndex}].spans[${spanIndex}].description`);
      let qualifiers: ParsedQualifier[];
      if (version === 2) {
        const parsedQualifiers = parseQualifiersV2(span.qualifier_spans, configured.ability, startByte, endByte, `response.abilities[${abilityIndex}].spans[${spanIndex}].qualifier_spans`);
        qualifiers = parsedQualifiers.qualifiers;
        offsetRepaired ||= parsedQualifiers.repaired;
      } else {
        qualifiers = parseQualifiers(
          span.qualifier_spans,
          configured.ability,
          fragments,
          startByte,
          endByte,
          `response.abilities[${abilityIndex}].spans[${spanIndex}].qualifier_spans`,
        );
      }
      let fingerprintId: string | null = null;
      let role: SemanticRole | "UNRESOLVED" = reportedRole;
      if (status === "EXISTING") {
        if (reportedRole === "UNRESOLVED") throw new TypeError("An EXISTING span must declare a semantic role.");
        const familyId = nonblank(span.family_id, `response.abilities[${abilityIndex}].spans[${spanIndex}].family_id`);
        const familyVersion = safeInteger(span.family_version, `response.abilities[${abilityIndex}].spans[${spanIndex}].family_version`);
        if (familyVersion < 1) throw new RangeError("An EXISTING family_version must be positive.");
        const parameters = parseParameters(span.parameters, `response.abilities[${abilityIndex}].spans[${spanIndex}].parameters`);
        if (familyRole(familyId, familyVersion) !== reportedRole) {
          throw new TypeError(`response.abilities[${abilityIndex}].spans[${spanIndex}] role does not match its reviewed family.`);
        }
        fingerprintId = validateFingerprint(db, familyId, parameters, familyVersion, exactText);
        role = reportedRole;
      } else {
        for (const field of ["family_id", "family_version", "parameters"] as const) {
          if (span[field] !== undefined) throw new TypeError(`${field} is only allowed for EXISTING spans.`);
        }
        if (status === "NOVEL" && reportedRole === "UNRESOLVED") throw new TypeError("A NOVEL span must declare a semantic role.");
        if (status === "UNRESOLVED") role = "UNRESOLVED";
      }
      const spanLabel = `response.abilities[${abilityIndex}].spans[${spanIndex}]`;
      if (version === 2 && status === "NOVEL" && span.hypothesis === undefined) {
        throw new TypeError(`${spanLabel} is NOVEL and must carry a hypothesis; return an unresolved region instead if none is justified.`);
      }
      if (status !== "NOVEL" && span.hypothesis !== undefined) throw new TypeError(`${spanLabel}.hypothesis is only allowed for NOVEL spans.`);
      const hypothesis = span.hypothesis === undefined
        ? null
        : parseHypothesis(span.hypothesis, configured.ability, startByte, endByte, `${spanLabel}.hypothesis`);
      semanticSpans.push({
        kind: "semantic",
        ability: configured.ability,
        fragment,
        start_byte: startByte,
        end_byte: endByte,
        exact_text: exactText,
        reported_role: reportedRole,
        role,
        status,
        fingerprint_id: fingerprintId,
        qualifier_spans: qualifiers,
        description,
        hypothesis,
        index: spanIndex,
        offset_repaired: offsetRepaired,
      });
    }
    if (version === 2) {
      structural.push(...parseStructuralSpans(
        item.structural_spans,
        configured.ability,
        fragments,
        semanticSpans.filter((span) => span.ability.id === configured.ability.id),
        `response.abilities[${abilityIndex}].structural_spans`,
      ));
    }

    if (!Array.isArray(item.connectives)) throw new TypeError(`response.abilities[${abilityIndex}].connectives must be an array.`);
    for (const [connectiveIndex, value] of item.connectives.entries()) {
      const connective = asRecord(value, `response.abilities[${abilityIndex}].connectives[${connectiveIndex}]`);
      assertExactKeys(connective, `response.abilities[${abilityIndex}].connectives[${connectiveIndex}]`, ["start_byte", "end_byte", ...(version === 2 ? ["exact_text"] : []), "kind"]);
      let startByte = nonnegativeInteger(connective.start_byte, `response.abilities[${abilityIndex}].connectives[${connectiveIndex}].start_byte`);
      let endByte = nonnegativeInteger(connective.end_byte, `response.abilities[${abilityIndex}].connectives[${connectiveIndex}].end_byte`);
      if (endByte <= startByte) throw new RangeError(`response.abilities[${abilityIndex}].connectives[${connectiveIndex}] has an empty interval.`);
      let connectiveRepaired = false;
      if (version === 2) {
        const anchored = anchorExactText(
          configured.ability.source_text, startByte, endByte,
          nonblank(connective.exact_text, `response.abilities[${abilityIndex}].connectives[${connectiveIndex}].exact_text`),
          `response.abilities[${abilityIndex}].connectives[${connectiveIndex}]`,
        );
        ({ start_byte: startByte, end_byte: endByte } = anchored);
        connectiveRepaired = anchored.repaired;
      } else {
        exactSpan(configured.ability.source_text, startByte, endByte);
      }
      const connectiveKind = nonblank(connective.kind, `response.abilities[${abilityIndex}].connectives[${connectiveIndex}].kind`);
      if (version === 2 && !(CONNECTIVE_KINDS as readonly string[]).includes(connectiveKind)) {
        throw new TypeError(`response.abilities[${abilityIndex}].connectives[${connectiveIndex}].kind is not a connective kind.`);
      }
      connectives.push({
        kind: "connective",
        ability: configured.ability,
        fragment: fragmentFor(fragments, startByte, endByte),
        start_byte: startByte,
        end_byte: endByte,
        connective_kind: connectiveKind,
        offset_repaired: connectiveRepaired,
      });
    }

    if (!Array.isArray(item.unresolved_regions)) throw new TypeError(`response.abilities[${abilityIndex}].unresolved_regions must be an array.`);
    for (const [regionIndex, value] of item.unresolved_regions.entries()) {
      const region = asRecord(value, `response.abilities[${abilityIndex}].unresolved_regions[${regionIndex}]`);
      assertExactKeys(region, `response.abilities[${abilityIndex}].unresolved_regions[${regionIndex}]`, ["start_byte", "end_byte", "description"]);
      const startByte = nonnegativeInteger(region.start_byte, `response.abilities[${abilityIndex}].unresolved_regions[${regionIndex}].start_byte`);
      const endByte = nonnegativeInteger(region.end_byte, `response.abilities[${abilityIndex}].unresolved_regions[${regionIndex}].end_byte`);
      if (endByte <= startByte) throw new RangeError(`response.abilities[${abilityIndex}].unresolved_regions[${regionIndex}] has an empty interval.`);
      exactSpan(configured.ability.source_text, startByte, endByte);
      unresolved.push({
        kind: "unresolved",
        ability: configured.ability,
        fragment: fragmentFor(fragments, startByte, endByte),
        start_byte: startByte,
        end_byte: endByte,
        description: nonblank(region.description, `response.abilities[${abilityIndex}].unresolved_regions[${regionIndex}].description`),
        implicit: false,
      });
    }
  }

  if (seenAbilities.size !== abilities.size) throw new Error("response omitted a prepared ability.");
  return {
    model,
    model_version: modelVersion,
    prompt_version: promptVersion,
    latency_ms: latency,
    cost_usd: cost,
    version,
    semantic_spans: semanticSpans,
    structural,
    connectives,
    unresolved,
  };
}

function responseIntervals(parsed: ParsedResponse, abilityVersionId: number): Array<{ start_byte: number; end_byte: number; label: string }> {
  return [
    ...parsed.semantic_spans.filter((span) => span.ability.id === abilityVersionId).map((span) => ({ start_byte: span.start_byte, end_byte: span.end_byte, label: "semantic span" })),
    // A structural span inside its parent's qualifier is owned by that parent's interval.
    ...parsed.structural.filter((span) => span.ability.id === abilityVersionId && span.parent === null).map((span) => ({ start_byte: span.start_byte, end_byte: span.end_byte, label: "structural span" })),
    ...parsed.connectives.filter((span) => span.ability.id === abilityVersionId).map((span) => ({ start_byte: span.start_byte, end_byte: span.end_byte, label: "connective" })),
    ...parsed.unresolved.filter((span) => span.ability.id === abilityVersionId).map((span) => ({ start_byte: span.start_byte, end_byte: span.end_byte, label: "unresolved region" })),
  ].sort((left, right) => left.start_byte - right.start_byte || left.end_byte - right.end_byte);
}

function assertNoResponseOverlap(parsed: ParsedResponse, abilities: readonly CurrentAbility[]): void {
  for (const ability of abilities) {
    const intervals = responseIntervals(parsed, ability.id);
    for (let index = 1; index < intervals.length; index += 1) {
      const previous = intervals[index - 1]!;
      const current = intervals[index]!;
      if (current.start_byte < previous.end_byte) {
        throw new Error(`Luna response has duplicate or overlapping ${previous.label}/${current.label} regions for ${ability.faction_id}/${ability.ability_id}.`);
      }
    }
  }
}

function intervalOverlaps(left: { start_byte: number; end_byte: number }, right: { start_byte: number; end_byte: number }): boolean {
  return left.start_byte < right.end_byte && right.start_byte < left.end_byte;
}

function assertRegionsAreUncovered(parsed: ParsedResponse, configured: readonly RequestAbilityConfig[]): void {
  const byAbility = new Map(configured.map((ability) => [ability.ability_version_id, ability.uncovered_regions]));
  for (const region of [
    ...parsed.semantic_spans,
    ...parsed.structural,
    ...parsed.connectives,
    ...parsed.unresolved,
  ]) {
    const uncovered = byAbility.get(region.ability.id) ?? [];
    if (!uncovered.some((candidate) => candidate.fragment === region.fragment && intervalOverlaps(candidate, region))) {
      throw new Error(`Luna response region is outside the prepared uncovered source for ${region.ability.faction_id}/${region.ability.ability_id}.`);
    }
  }
}

function trimToMeaningful(source: string, start: number, end: number): { start_byte: number; end_byte: number } | null {
  const text = exactSpan(source, start, end);
  let first: number | null = null;
  let lastEnd = start;
  let offset = start;
  for (const character of text) {
    const width = Buffer.byteLength(character, "utf8");
    if (!/[\s\p{P}]/u.test(character)) {
      first ??= offset;
      lastEnd = offset + width;
    }
    offset += width;
  }
  return first === null ? null : { start_byte: first, end_byte: lastEnd };
}

function omittedIntervals(source: string, uncovered: readonly RequestAbilityConfig["uncovered_regions"][number][], reported: readonly { start_byte: number; end_byte: number }[]): Array<{ fragment: string; start_byte: number; end_byte: number }> {
  const ordered = reported.slice().sort((left, right) => left.start_byte - right.start_byte || left.end_byte - right.end_byte);
  const missing: Array<{ fragment: string; start_byte: number; end_byte: number }> = [];
  for (const region of uncovered) {
    let cursor = region.start_byte;
    for (const interval of ordered) {
      if (interval.end_byte <= cursor) continue;
      if (interval.start_byte >= region.end_byte) break;
      if (interval.start_byte > cursor) {
        const trimmed = trimToMeaningful(source, cursor, Math.min(interval.start_byte, region.end_byte));
        if (trimmed) missing.push({ fragment: region.fragment, ...trimmed });
      }
      cursor = Math.max(cursor, interval.end_byte);
      if (cursor >= region.end_byte) break;
    }
    if (cursor < region.end_byte) {
      const trimmed = trimToMeaningful(source, cursor, region.end_byte);
      if (trimmed) missing.push({ fragment: region.fragment, ...trimmed });
    }
  }
  return missing;
}

function addImplicitUnresolved(
  parsed: ParsedResponse,
  configured: readonly RequestAbilityConfig[],
  currentAbilities: readonly CurrentAbility[],
): void {
  const byId = new Map(currentAbilities.map((ability) => [ability.id, ability]));
  for (const requestAbility of configured) {
    const ability = byId.get(requestAbility.ability_version_id);
    if (!ability) throw new Error("Luna model run points at a missing current ability.");
    const reported = responseIntervals(parsed, ability.id);
    for (const interval of omittedIntervals(ability.source_text, requestAbility.uncovered_regions, reported)) {
      parsed.unresolved.push({
        kind: "unresolved",
        ability,
        fragment: interval.fragment,
        start_byte: interval.start_byte,
        end_byte: interval.end_byte,
        description: "The Luna response did not report this prepared uncovered source region.",
        implicit: true,
      });
    }
  }
}

function assertNoPersistentConflicts(db: DatabaseSync, parsed: ParsedResponse): void {
  const entries = [...parsed.semantic_spans, ...parsed.structural, ...parsed.connectives, ...parsed.unresolved];
  const byAbility = new Map<number, typeof entries>();
  for (const entry of entries) {
    const values = byAbility.get(entry.ability.id);
    if (values) values.push(entry);
    else byAbility.set(entry.ability.id, [entry]);
  }
  for (const [abilityVersionId, regions] of byAbility) {
    const existing = db.prepare(`
      SELECT source_spans.fragment, source_spans.start_byte, source_spans.end_byte
      FROM annotations
      JOIN source_spans ON source_spans.id = annotations.span_id
      WHERE source_spans.ability_version_id = ? AND annotations.status = 'active'
      UNION ALL
      SELECT source_spans.fragment, source_spans.start_byte, source_spans.end_byte
      FROM source_atom_reviews
      JOIN source_spans ON source_spans.id = source_atom_reviews.span_id
      WHERE source_spans.ability_version_id = ? AND source_atom_reviews.status = 'active'
    `).all(abilityVersionId, abilityVersionId) as Array<{ fragment: string; start_byte: number; end_byte: number }>;
    for (const region of regions) {
      if (existing.some((candidate) => candidate.fragment === region.fragment && intervalOverlaps(candidate, region))) {
        throw new Error(`Luna response conflicts with a current reviewed annotation or structural constituent on ability version ${abilityVersionId}.`);
      }
    }
  }
}

function proposalReason(runId: string, inputHash: string, version: 1 | 2, value: JsonRecord): string {
  return JSON.stringify({ source: "luna", schema_version: version, run_id: runId, input_hash: inputHash, ...value });
}

function insertProposal(
  db: DatabaseSync,
  spanId: number,
  fingerprintId: string | null,
  role: SemanticRole | "CONNECTIVE" | "UNRESOLVED",
  status: "pending" | "unresolved",
  runId: number,
  reason: string,
  createdAt: string,
  origin: string,
): number {
  const result = db.prepare(`
    INSERT INTO proposals (span_id, fingerprint_id, role, origin, model_run_id, status, reason_json, score, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `).run(spanId, fingerprintId, role, origin, runId, status, reason, createdAt);
  return Number(result.lastInsertRowid);
}

function insertLeafGap(db: DatabaseSync, abilityVersionId: number, description: string, proposalId: number): void {
  db.prepare("INSERT INTO gaps (ability_version_id, type, status, description, batch_id, proposal_id) VALUES (?, 'LEAF_GAP', 'open', ?, NULL, ?)")
    .run(abilityVersionId, description, proposalId);
}

/**
 * Who produced a response. Only the trusted OMP runner observes the model; an offline file
 * import of a v2 run records `external` and never asserts Luna from response text.
 */
export type LunaProvenance = {
  origin: string;
  model: string;
  model_version: string;
  latency_ms: number | null;
  cost_usd: number | null;
  /** Claim owner that must still hold the run when it completes; null for an unclaimed run. */
  owner: string | null;
};

function persistParsedResponse(db: DatabaseSync, run: ModelRun, parsed: ParsedResponse, rawResponse: unknown, provenance: LunaProvenance): LunaImportSummary {
  const createdAt = new Date().toISOString();
  let proposals = 0;
  let unresolved = 0;
  let structural = 0;
  let candidates = 0;
  const runId = String(run.id);
  const origin = provenance.origin;
  const semanticProposalIds = new Map<ParsedSemanticSpan, number>();

  for (const span of parsed.semantic_spans) {
    const spanId = insertSpan(db, span.ability.id, span.fragment, span.start_byte, span.end_byte, span.exact_text);
    if (span.status === "UNRESOLVED") {
      const proposalId = insertProposal(
        db,
        spanId,
        null,
        "UNRESOLVED",
        "unresolved",
        run.id,
        proposalReason(runId, run.input_hash, parsed.version, {
          type: "semantic-span",
          span_status: span.status,
          reported_role: span.reported_role,
          qualifier_spans: span.qualifier_spans,
          description: span.description,
        }),
        createdAt,
        origin,
      );
      insertLeafGap(db, span.ability.id, span.description ?? "Luna marked this semantic source span unresolved.", proposalId);
      semanticProposalIds.set(span, proposalId);
      unresolved += 1;
      continue;
    }
    const proposalId = insertProposal(
      db,
      spanId,
      span.fingerprint_id,
      span.role as SemanticRole,
      "pending",
      run.id,
      proposalReason(runId, run.input_hash, parsed.version, {
        type: "semantic-span",
        span_status: span.status,
        qualifier_spans: span.qualifier_spans,
        description: span.description,
        ...(span.hypothesis ? { hypothesis: span.hypothesis } : {}),
        ...(span.offset_repaired ? { offset_repaired: true } : {}),
      }),
      createdAt,
      origin,
    );
    semanticProposalIds.set(span, proposalId);
    proposals += 1;
    if (span.status === "NOVEL") {
      insertLeafGap(db, span.ability.id, span.description ?? "Luna marked this source span as a novel semantic leaf.", proposalId);
      const candidate = recordCandidateSuggestion(db, {
        role: span.role,
        exact_text: span.exact_text,
        label: span.hypothesis?.label ?? null,
        distinction: span.hypothesis?.distinction ?? null,
        parameter_hints: span.hypothesis?.parameters.map((parameter) => parameter.name) ?? [],
        span_id: spanId,
        source_hash: span.ability.source_hash,
        proposal_id: proposalId,
        model_run_id: run.id,
      });
      if (candidate !== null) candidates += 1;
    }
  }

  for (const constituent of parsed.structural) {
    const spanId = insertSpan(db, constituent.ability.id, constituent.fragment, constituent.start_byte, constituent.end_byte, constituent.exact_text);
    const parentProposalId = constituent.parent ? semanticProposalIds.get(constituent.parent) ?? null : null;
    insertStructuralProposal(db, {
      span_id: spanId,
      model_run_id: run.id,
      origin,
      kind: constituent.structural_kind,
      description: constituent.description,
      parent_proposal_id: parentProposalId,
      reason: { source: "luna", schema_version: parsed.version, run_id: runId, input_hash: run.input_hash, ...(constituent.offset_repaired ? { offset_repaired: true } : {}) },
      created_at: createdAt,
    });
    structural += 1;
  }

  for (const connective of parsed.connectives) {
    const exactText = exactSpan(connective.ability.source_text, connective.start_byte, connective.end_byte);
    const spanId = insertSpan(db, connective.ability.id, connective.fragment, connective.start_byte, connective.end_byte, exactText);
    insertProposal(
      db,
      spanId,
      null,
      "CONNECTIVE",
      "pending",
      run.id,
      proposalReason(runId, run.input_hash, parsed.version, { type: "connective", connective_kind: connective.connective_kind, ...(connective.offset_repaired ? { offset_repaired: true } : {}) }),
      createdAt,
      origin,
    );
    proposals += 1;
  }

  for (const region of parsed.unresolved) {
    const exactText = exactSpan(region.ability.source_text, region.start_byte, region.end_byte);
    const spanId = insertSpan(db, region.ability.id, region.fragment, region.start_byte, region.end_byte, exactText);
    const proposalId = insertProposal(
      db,
      spanId,
      null,
      "UNRESOLVED",
      "unresolved",
      run.id,
      proposalReason(runId, run.input_hash, parsed.version, {
        type: "unresolved-region",
        description: region.description,
        implicit: region.implicit,
      }),
      createdAt,
      origin,
    );
    insertLeafGap(db, region.ability.id, region.description, proposalId);
    unresolved += 1;
  }

  const completed = db.prepare(`
    UPDATE model_runs
    SET model = ?, model_version = ?, prompt_version = ?, output_json = ?, latency_ms = ?, cost_usd = ?, status = 'completed'
    WHERE id = ? AND status = 'pending' AND json_extract(config_json, '$.execution.owner') IS ?
  `).run(
    provenance.model,
    provenance.model_version,
    parsed.prompt_version,
    JSON.stringify(rawResponse),
    provenance.latency_ms ?? parsed.latency_ms,
    provenance.cost_usd ?? parsed.cost_usd,
    run.id,
    provenance.owner,
  );
  if (completed.changes !== 1) throw new LunaRunError(409, `Luna model run ${runId} was claimed, abandoned, or completed by another runner.`);
  return { proposals, unresolved, structural, candidates };
}

/** Counts of pending review work an import created; none of it is reviewed authority. */
export type LunaImportSummary = { proposals: number; unresolved: number; structural: number; candidates: number };

/** A redacted, source-free reason a run closed without importing anything. */
export type LunaFailure = { stage: "transport" | "parse" | "import" | "abandon"; reason_code: string; message: string; exit_code?: number | null };

/**
 * Close a still-pending run as failed. The owner guard ensures a late or competing runner
 * cannot fail (or later complete) a run it no longer holds. Returns whether this call closed it.
 */
export function failLunaRun(db: DatabaseSync, runId: number, owner: string | null, failure: LunaFailure): boolean {
  return withTransaction(db, () => {
    const changed = db.prepare(`
      UPDATE model_runs SET status = 'failed', output_json = ?
      WHERE id = ? AND status = 'pending' AND json_extract(config_json, '$.execution.owner') IS ?
    `).run(JSON.stringify({ failure: { ...failure, ended_at: new Date().toISOString() } }), runId, owner);
    if (changed.changes === 1) bumpWorkbenchRevision(db);
    return changed.changes === 1;
  });
}

function redactedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown import failure.";
  // Validator messages name identities and offsets, never source prose; bound them anyway.
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

function runExecution(config: JsonRecord): LunaExecution | null {
  const execution = config.execution;
  if (execution === undefined || execution === null) return null;
  const record = asRecord(execution, "model_runs.config_json.execution");
  return { owner: nonblank(record.owner, "execution.owner"), started_at: nonblank(record.started_at, "execution.started_at") };
}

/** Observed model identity and cost from a trusted OMP invocation. */
export type ObservedInvocation = {
  owner: string;
  model: string;
  model_version: string;
  latency_ms: number | null;
  cost_usd: number | null;
};

/**
 * Import one Luna response. Every source identity and UTF-8 boundary is checked before
 * proposals are committed; a malformed response closes the run as failed with a redacted
 * reason and no partial proposals. `observed` is supplied only by the trusted OMP runner,
 * which must hold the run's claim; an offline import may only import an unclaimed run.
 */
export function importLuna(
  db: DatabaseSync,
  body: { run_id: string; response: unknown },
  observed?: ObservedInvocation,
): { run_id: string } & LunaImportSummary {
  initializeWorkbench(db);
  const tentativeBody = asRecord(body, "body");
  const { runId, id } = parseRunId(tentativeBody.run_id);
  const before = modelRun(db, id);
  if (before.status !== "pending") throw new LunaRunError(409, `Luna model run ${runId} has already been imported or failed.`);
  const beforeExecution = runExecution(asRecord(JSON.parse(before.config_json), "model_runs.config_json"));
  if (observed ? beforeExecution?.owner !== observed.owner : beforeExecution !== null) {
    throw new LunaRunError(409, `Luna model run ${runId} is claimed by a running OMP invocation; wait for it or abandon it after its deadline.`);
  }
  const owner = observed?.owner ?? null;
  const rawResponse = tentativeBody.response;

  try {
    const result = withTransaction(db, () => {
      assertExactKeys(tentativeBody, "body", ["run_id", "response"]);
      const run = modelRun(db, id);
      if (run.status !== "pending") throw new LunaRunError(409, `Luna model run ${runId} has already been imported or failed.`);
      const config = asRecord(JSON.parse(run.config_json), "model_runs.config_json");
      const version = configuredVersion(config);
      const configured = parseConfiguredAbilities(config);
      const current = configured.map((item) => ({ configured: item, ability: currentAbilityForConfigured(db, item) }));
      const byIdentity = new Map(current.map((item) => [
        abilityIdentity(item.ability.faction_id, item.ability.ability_id, item.ability.source_hash),
        item,
      ]));
      const parsed = parseResponseBody(db, rawResponse, run.input_hash, byIdentity, version);
      if (observed) {
        const requested = typeof config.requested_model === "string" ? config.requested_model : LUNA_MODEL;
        if (observed.model !== requested) throw new Error(`Observed model ${observed.model} is not the requested ${requested}.`);
        const bare = requested.slice(requested.indexOf("/") + 1);
        if (parsed.model !== requested && parsed.model !== bare) throw new Error("The response's self-reported model conflicts with the observed invocation.");
      }
      const abilities = current.map((item) => item.ability);
      assertNoResponseOverlap(parsed, abilities);
      assertRegionsAreUncovered(parsed, configured);
      addImplicitUnresolved(parsed, configured, abilities);
      assertNoResponseOverlap(parsed, abilities);
      assertNoPersistentConflicts(db, parsed);
      const provenance: LunaProvenance = observed
        ? { origin: "luna", model: observed.model, model_version: observed.model_version, latency_ms: observed.latency_ms, cost_usd: observed.cost_usd, owner }
        : version === LEGACY_REQUEST_SCHEMA_VERSION
          // v1 runs keep their original meaning: the offline transport was the Luna contract.
          ? { origin: "luna", model: parsed.model, model_version: parsed.model_version, latency_ms: null, cost_usd: null, owner: null }
          : { origin: "external", model: "external", model_version: "unverified", latency_ms: null, cost_usd: null, owner: null };
      const inserted = persistParsedResponse(db, run, parsed, rawResponse, provenance);
      bumpWorkbenchRevision(db);
      return { run_id: runId, ...inserted };
    });
    return result;
  } catch (error) {
    // Another runner already closed or took over the run: leave its state alone.
    if (!(error instanceof LunaRunError && error.status === 409)) {
      failLunaRun(db, id, owner, { stage: "import", reason_code: "INVALID_RESPONSE", message: redactedMessage(error) });
    }
    throw error;
  }
}
