import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";

import { canonicalize } from "../round4/hash.js";
import { diceTableInvariantErrors } from "../integrity.js";
import { effectToBuffs } from "../cruncher/from-dsl.js";
import type { BuffSource, EngineContext } from "../cruncher/buffs.js";
import { openWorkbench } from "./db.js";
import { refreshSources, type SourceRefreshReport } from "./source.js";
import { reapplyLeafSurfaces, untiledRuns, type ApplyReport } from "./leaves.js";
import { getCurrentCoverage } from "./coverage.js";
import { localEmbedder } from "./embeddings.js";
import { runLeafProposals, listLeafProposals, type ListedProposal, type ProposalPiece } from "./leaf-proposals.js";
import { confirmSurface, LeafError } from "./leaves.js";
import { compileLeaves, type CompileLeaf, type Compiled } from "./compile.js";
import { coreCheckErrors } from "./core-checks.js";
import { checkEntry, entryWithMechanics, resolveAbilityEntity, round5cDataRoot } from "./entries.js";
import { prepareLuna, type PrepareLunaOptions } from "./proposal.js";

type DatabaseType = DatabaseSync;
const DatabaseSyncCtor = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new (path: string): DatabaseType };

/**
 * Step 8b: scripted, cost-ordered DSL construction from `_private/dump.json` text, run against
 * a workbench database COPY (never the live `_private/round5c/workbench.sqlite`). No network or
 * DeepSeek calls happen anywhere in this module; every pass is deterministic given the corpus.
 *
 * Order (cheapest first): refresh sources -> reapply decided leaf surfaces -> a bounded loop of
 * deterministic proposal passes (split cuts, prefill, predicateProposal, via the existing
 * leaf-proposals pipeline restricted to non-probabilistic pieces) -> compile every ability whose
 * source is now fully tiled -> gate each compile (schema, describer round-trip, integrity,
 * cruncher) -> report residue clusters and a DeepSeek cost estimate for what is left, computed on
 * a throwaway DB clone so the estimate never mutates the caller's database.
 */

export type Pipeline8bOptions = {
  reviewer?: string;
  /** Upper bound on deterministic-confirm rounds; a round that confirms nothing stops the loop. */
  maxConfirmRounds?: number;
  /** Describer round-trip cosine-similarity floor a compiled entry's render must clear to "pass". */
  describerSimilarityFloor?: number;
};

const DEFAULT_OPTIONS: Required<Pipeline8bOptions> = {
  reviewer: "pipeline-8b",
  maxConfirmRounds: 5,
  describerSimilarityFloor: 0.55,
};

export type AutoConfirmReport = {
  rounds: number;
  confirmed: number;
  skipped_probabilistic: number;
  errors: Array<{ surface: string; reason: string }>;
};

export type GateFailure = { faction_id: string; ability_id: string; reason: string; detail: string };

export type CompileGateReport = {
  abilities_total: number;
  fully_tiled: number;
  compile_attempted: number;
  compile_ok: number;
  compile_errors: Record<string, number>;
  gated: number;
  no_data_entry: number;
  schema_pass: number;
  core_checks_pass: number;
  integrity_pass: number;
  describer_pass: number;
  describer_scores: number[];
  cruncher_no_regression: number;
  all_gates_pass: number;
  failures: GateFailure[];
};

export type ResidueCluster = { cluster: number; occurrences: number; closes: number; sample_texts: string[] };

export type ResidueReport = {
  untiled_abilities: number;
  untiled_spans: number;
  clusters: ResidueCluster[];
};

export type CostEstimate = {
  residue_ability_count: number;
  requests: number;
  fixed_bytes_per_request: number;
  variable_bytes_total: number;
  variable_bytes_average_per_ability: number;
  prefix_cache: { stable_prefix: boolean; finding: string };
};

export type Pipeline8bReport = {
  refresh: SourceRefreshReport;
  reapply: ApplyReport;
  auto_confirm: AutoConfirmReport;
  compile: CompileGateReport;
  residue: ResidueReport;
  cost_estimate: CostEstimate;
};

/** Pieces confirmSurface can accept with zero probabilistic input: an exact match to an already
 * decided surface (confidence 1, no embedding vote breaking the tie), or a predicate the wording
 * states outright (`predicateProposal`, tagged `basis: "wording"`). Everything else — the kNN
 * vote branch of `classify()` — is left as a proposal for a human or model to review later. */
function isDeterministicPiece(piece: ProposalPiece): boolean {
  return piece.confidence === 1 || piece.basis === "wording";
}

function piecesOf(proposal: ListedProposal): ProposalPiece[] | null {
  if (proposal.kind !== "direct" && proposal.kind !== "decomposition") return null;
  const named = proposal.pieces.filter((piece): piece is ProposalPiece => Boolean((piece as { family_id?: unknown }).family_id));
  if (named.length !== proposal.pieces.length) return null;
  return named.every(isDeterministicPiece) ? named : null;
}

/** One round: propose (local embeddings only), then confirm every deterministic proposal found. */
async function confirmRound(db: DatabaseSync, reviewer: string): Promise<{ confirmed: number; skipped: number; errors: Array<{ surface: string; reason: string }> }> {
  await runLeafProposals(db, localEmbedder());
  const listing = listLeafProposals(db, { limit: 100000 });
  let confirmed = 0;
  let skipped = 0;
  const errors: Array<{ surface: string; reason: string }> = [];
  for (const cluster of listing.clusters) {
    for (const proposal of cluster.proposals) {
      const pieces = piecesOf(proposal);
      if (!pieces) {
        if (proposal.kind === "direct" || proposal.kind === "decomposition") skipped += 1;
        continue;
      }
      for (const piece of pieces) {
        try {
          confirmSurface(db, {
            reviewer, exact_text: piece.text, family_id: piece.family_id, family_version: piece.family_version, parameters: piece.parameters,
          });
          confirmed += 1;
        } catch (error) {
          const reason = error instanceof LeafError ? error.message : error instanceof Error ? error.message : String(error);
          errors.push({ surface: proposal.surface, reason });
        }
      }
    }
  }
  return { confirmed, skipped, errors };
}

async function runAutoConfirm(db: DatabaseSync, reviewer: string, maxRounds: number): Promise<AutoConfirmReport> {
  let rounds = 0;
  let confirmed = 0;
  let skipped = 0;
  const errors: Array<{ surface: string; reason: string }> = [];
  for (; rounds < maxRounds; rounds += 1) {
    const round = await confirmRound(db, reviewer);
    confirmed += round.confirmed;
    skipped = round.skipped; // only the last round's count is meaningful: earlier skips may resolve later
    errors.push(...round.errors);
    if (round.confirmed === 0) { rounds += 1; break; }
  }
  return { rounds, confirmed, skipped_probabilistic: skipped, errors };
}

/** Leaves for every ability whose source is now fully tiled, keyed by ability_version_id. */
function tiledLeaves(db: DatabaseSync): Map<number, { faction_id: string; ability_id: string; source_text: string; leaves: CompileLeaf[] }> {
  const coverage = getCurrentCoverage(db);
  const abilities = db.prepare(`SELECT id, faction_id, ability_id, source_text FROM abilities WHERE current = 1`)
    .all() as Array<{ id: number; faction_id: string; ability_id: string; source_text: string }>;
  const leaves = new Map<number, CompileLeaf[]>();
  for (const row of db.prepare(`
    SELECT source_spans.ability_version_id, source_spans.start_byte, source_spans.end_byte, source_spans.fragment, semantic_families.role,
      fingerprints.family_id, fingerprints.family_version, fingerprints.parameters_json
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id AND abilities.current = 1
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    JOIN semantic_families ON semantic_families.id = fingerprints.family_id AND semantic_families.version = fingerprints.family_version
    WHERE annotations.status = 'active'
  `).all() as Array<{ ability_version_id: number; start_byte: number; end_byte: number; fragment: string; role: string; family_id: string; family_version: number; parameters_json: string }>) {
    const list = leaves.get(row.ability_version_id) ?? [];
    list.push({
      role: row.role, family_id: row.family_id, family_version: row.family_version, parameters: JSON.parse(row.parameters_json) as Record<string, unknown>,
      start_byte: row.start_byte, end_byte: row.end_byte, fragment: row.fragment,
    });
    leaves.set(row.ability_version_id, list);
  }
  const result = new Map<number, { faction_id: string; ability_id: string; source_text: string; leaves: CompileLeaf[] }>();
  for (const ability of abilities) {
    const view = coverage.get(ability.id);
    const own = leaves.get(ability.id);
    if (!view || !own?.length || untiledRuns(view).length > 0) continue;
    result.set(ability.id, { faction_id: ability.faction_id, ability_id: ability.ability_id, source_text: ability.source_text, leaves: own });
  }
  return result;
}

/** Cosine similarity of two texts under the same local embedder used for leaf proposals — the
 * "workbench's existing similarity measure" the round-trip gate is asked to reuse. */
async function describerSimilarity(rendered: string, sourceText: string): Promise<number> {
  const embedder = localEmbedder();
  const [a, b] = await embedder.embed([rendered, sourceText]);
  let dot = 0;
  for (let i = 0; i < a!.length; i += 1) dot += a![i]! * b![i]!;
  return dot;
}

const CRUNCHER_CONTEXT: EngineContext = { phase: "shooting", attackerStationary: false };

async function gateCompiledAbility(
  dataRoot: string, factionId: string, abilityId: string, compiled: Extract<Compiled, { ok: true }>, sourceText: string, floor: number,
): Promise<{ status: "no-data-entry" } | { status: "gated"; schema: boolean; coreChecks: boolean; integrity: boolean; describer: boolean; describerScore: number | null; crunchNoRegression: boolean; failures: GateFailure[] }> {
  const failures: GateFailure[] = [];
  let resolved;
  try {
    resolved = resolveAbilityEntity(dataRoot, factionId, abilityId);
  } catch {
    return { status: "no-data-entry" };
  }
  const entry = entryWithMechanics(resolved.entry, compiled.mechanics);
  const checked = checkEntry(entry);
  const coreErrors = coreCheckErrors(dataRoot, abilityId, compiled.checks);
  const schema = checked.errors.length === 0;
  const coreChecks = coreErrors.length === 0;
  if (!schema) failures.push({ faction_id: factionId, ability_id: abilityId, reason: "schema", detail: checked.errors.join("; ").slice(0, 300) });
  if (!coreChecks) failures.push({ faction_id: factionId, ability_id: abilityId, reason: "core-checks", detail: coreErrors.join("; ").slice(0, 300) });

  const diceErrors = diceTableInvariantErrors(compiled.mechanics.effect);
  const integrity = diceErrors.length === 0;
  if (!integrity) failures.push({ faction_id: factionId, ability_id: abilityId, reason: "integrity", detail: diceErrors.join("; ").slice(0, 300) });

  let describerScore: number | null = null;
  let describer = false;
  if (checked.rendered_text) {
    describerScore = await describerSimilarity(checked.rendered_text, sourceText);
    describer = describerScore >= floor;
    if (!describer) failures.push({ faction_id: factionId, ability_id: abilityId, reason: "describer-roundtrip", detail: `similarity ${describerScore.toFixed(3)} < ${floor}` });
  } else {
    failures.push({ faction_id: factionId, ability_id: abilityId, reason: "describer-roundtrip", detail: "describer produced no text" });
  }

  const source: BuffSource = { kind: "ability", abilityId, abilityKind: "unit" };
  const newTranslation = effectToBuffs(compiled.mechanics.effect, source, CRUNCHER_CONTEXT);
  // A mirror stub carries no `effect` at all: there is no "before" buff extraction to regress
  // from, so any unsupported branch the fresh compile reports is new information, not a
  // regression, and the gate only reports it. Only an ability the old record already described
  // (a stale compiled entry being re-authored) can regress.
  const oldEffect = (resolved.entry as { effect?: unknown }).effect;
  const oldUnsupported = oldEffect ? effectToBuffs(oldEffect, source, CRUNCHER_CONTEXT).unsupported.length : null;
  const crunchNoRegression = oldUnsupported === null || newTranslation.unsupported.length <= oldUnsupported;
  if (!crunchNoRegression) {
    failures.push({ faction_id: factionId, ability_id: abilityId, reason: "cruncher-regression", detail: `${newTranslation.unsupported.length} unsupported branches vs ${oldUnsupported} before` });
  }

  return { status: "gated", schema, coreChecks, integrity, describer, describerScore, crunchNoRegression, failures };
}

async function runCompileGates(db: DatabaseSync, floor: number): Promise<CompileGateReport> {
  const dataRoot = round5cDataRoot();
  const tiled = tiledLeaves(db);
  const abilitiesTotal = (db.prepare("SELECT COUNT(*) AS n FROM abilities WHERE current = 1").get() as { n: number }).n;
  const report: CompileGateReport = {
    abilities_total: abilitiesTotal, fully_tiled: tiled.size, compile_attempted: 0, compile_ok: 0, compile_errors: {},
    gated: 0, no_data_entry: 0, schema_pass: 0, core_checks_pass: 0, integrity_pass: 0, describer_pass: 0, describer_scores: [],
    cruncher_no_regression: 0, all_gates_pass: 0, failures: [],
  };
  for (const [, ability] of tiled) {
    report.compile_attempted += 1;
    const compiled = compileLeaves(ability.leaves, ability.source_text);
    if (!compiled.ok) {
      const reason = compiled.errors[0] ?? "unknown";
      report.compile_errors[reason] = (report.compile_errors[reason] ?? 0) + 1;
      continue;
    }
    report.compile_ok += 1;
    const gate = await gateCompiledAbility(dataRoot, ability.faction_id, ability.ability_id, compiled, ability.source_text, floor);
    if (gate.status === "no-data-entry") { report.no_data_entry += 1; continue; }
    report.gated += 1;
    if (gate.schema) report.schema_pass += 1;
    if (gate.coreChecks) report.core_checks_pass += 1;
    if (gate.integrity) report.integrity_pass += 1;
    if (gate.describer) report.describer_pass += 1;
    if (gate.describerScore !== null) report.describer_scores.push(Math.round(gate.describerScore * 1000) / 1000);
    if (gate.crunchNoRegression) report.cruncher_no_regression += 1;
    if (gate.schema && gate.coreChecks && gate.integrity && gate.describer && gate.crunchNoRegression) report.all_gates_pass += 1;
    report.failures.push(...gate.failures);
  }
  return report;
}

function residueReport(db: DatabaseSync): ResidueReport {
  const coverage = getCurrentCoverage(db);
  let untiledAbilities = 0;
  let untiledSpans = 0;
  for (const view of coverage.values()) {
    const runs = untiledRuns(view);
    if (runs.length > 0) { untiledAbilities += 1; untiledSpans += runs.length; }
  }
  const listing = listLeafProposals(db, { limit: 100000, kinds: ["unlabelled"] });
  const clusters: ResidueCluster[] = listing.clusters
    .map((cluster) => ({
      cluster: cluster.cluster, occurrences: cluster.occurrences, closes: cluster.closes,
      sample_texts: [...new Set(cluster.proposals.map((p) => p.sample_text))].slice(0, 3),
    }))
    .sort((left, right) => right.closes - left.closes || right.occurrences - left.occurrences)
    .slice(0, 40);
  return { untiled_abilities: untiledAbilities, untiled_spans: untiledSpans, clusters };
}

/**
 * A DeepSeek cost estimate for the residue, computed by running the real `prepareLuna` request
 * builder against a throwaway VACUUM clone of `db` (never `db` itself, so this makes no lasting
 * change and issues no network call — `prepareLuna` only assembles and writes a request file).
 */
async function costEstimate(db: DatabaseSync): Promise<CostEstimate> {
  const scratchDir = mkdtempSync(join(tmpdir(), "round5c-8b-cost-"));
  const scratchDb = join(scratchDir, "scratch.sqlite");
  const artifactDir = join(scratchDir, "artifacts");
  db.exec(`VACUUM INTO '${scratchDb.replace(/'/gu, "''")}'`);
  const previousArtifactDir = process.env.ROUND5C_ARTIFACT_DIR;
  process.env.ROUND5C_ARTIFACT_DIR = artifactDir;
  let requests = 0;
  let fixedBytes = 0;
  let variableBytesTotal = 0;
  let residueAbilityCount = 0;
  let firstPrefix: string | null = null;
  let secondPrefix: string | null = null;
  try {
    const clone = new DatabaseSyncCtor(scratchDb);
    try {
      for (;;) {
        let prepared;
        try {
          prepared = prepareLuna(clone, { mode: "residue", limit: 15 } as PrepareLunaOptions);
        } catch (error) {
          if (error instanceof RangeError) break;
          throw error;
        }
        requests += 1;
        const request = prepared.request as { abilities: unknown[] };
        const bytes = Buffer.byteLength(canonicalize(request), "utf8");
        const withoutAbilities = Buffer.byteLength(canonicalize({ ...request, abilities: [] }), "utf8");
        if (fixedBytes === 0) fixedBytes = withoutAbilities;
        variableBytesTotal += bytes - withoutAbilities;
        residueAbilityCount += request.abilities.length;
        const prefix = canonicalize(request).slice(0, 64);
        if (firstPrefix === null) firstPrefix = prefix;
        else if (secondPrefix === null) secondPrefix = prefix;
      }
    } finally {
      clone.close();
    }
  } finally {
    if (previousArtifactDir === undefined) delete process.env.ROUND5C_ARTIFACT_DIR;
    else process.env.ROUND5C_ARTIFACT_DIR = previousArtifactDir;
    rmSync(scratchDir, { recursive: true, force: true });
  }
  const stable = firstPrefix !== null && secondPrefix !== null && firstPrefix === secondPrefix;
  const finding = firstPrefix === null
    ? "No residue abilities to estimate."
    : stable
      ? "Requests share a stable leading prefix; DeepSeek's prefix cache can hit."
      : "canonicalize() sorts PreparedRequest's top-level keys alphabetically, so the per-request "
        + "\"abilities\" field (which sorts before confirmed_examples/instructions/lexical_vocabulary/"
        + "registry/response_schema/schema_version) lands FIRST in the serialized request bytes — the "
        + "one field that changes every request. Every request therefore diverges at byte 0 and the "
        + "large fixed part (instructions + registry + confirmed examples) never lands in a stable "
        + "prefix, so DeepSeek's prefix cache gets a 0% hit rate across requests. Fix (not applied "
        + "here): serialize the wire request with the fixed fields first and \"abilities\" last, e.g. "
        + "build the request body by string-concatenating `canonicalize({...base, abilities: []})` "
        + "minus its trailing \"}\" with `,\"abilities\":${canonicalize(abilities)}}`, or key the "
        + "PreparedRequest type so a dedicated (non-canonicalize) transport serializer emits the fixed "
        + "fields first; input_hash (which must stay order-independent) can keep using canonicalize().";
  return {
    residue_ability_count: residueAbilityCount, requests, fixed_bytes_per_request: fixedBytes,
    variable_bytes_total: variableBytesTotal,
    variable_bytes_average_per_ability: residueAbilityCount ? Math.round(variableBytesTotal / residueAbilityCount) : 0,
    prefix_cache: { stable_prefix: stable, finding },
  };
}

export async function runPipeline8b(db: DatabaseSync, options: Pipeline8bOptions = {}): Promise<Pipeline8bReport> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const refresh = refreshSources(db);
  const reapply = reapplyLeafSurfaces(db);
  const autoConfirm = await runAutoConfirm(db, opts.reviewer, opts.maxConfirmRounds);
  reapplyLeafSurfaces(db); // corpus-wide sweep so every ability sees every surface just confirmed
  const compile = await runCompileGates(db, opts.describerSimilarityFloor);
  const residue = residueReport(db);
  const cost_estimate = await costEstimate(db);
  return { refresh, reapply, auto_confirm: autoConfirm, compile, residue, cost_estimate };
}

/** Standalone entry point for `round5c pipeline-8b` — opens the workbench itself. */
export async function runPipeline8bCli(options: Pipeline8bOptions = {}): Promise<Pipeline8bReport> {
  const db = openWorkbench();
  try {
    return await runPipeline8b(db, options);
  } finally {
    db.close();
  }
}
