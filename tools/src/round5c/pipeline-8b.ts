import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";

import { openWorkbench } from "./db.js";
import { refreshSources, type SourceRefreshReport } from "./source.js";
import { reapplyLeafSurfaces, untiledRuns, type ApplyReport } from "./leaves.js";
import { getCurrentCoverage, type CoverageView } from "./coverage.js";
import { localEmbedder, type Embedder } from "./embeddings.js";
import { runLeafProposals, listLeafProposals, type ListedProposal, type ProposalPiece } from "./leaf-proposals.js";
import { machineActor } from "./authority.js";
import { confirmSurface, LeafError } from "./leaves.js";
import { prepareLuna, serializeLunaRequest, type PrepareLunaOptions, type PreparedRequest } from "./proposal.js";
import { lunaStdinEnvelope } from "./luna-schema.js";
import { runCompileGates, type CompileGateReport, type GateFailure, type LeverDiff } from "./pipeline-8b-gates.js";

export { classifyUnsupported } from "./pipeline-8b-gates.js";
export type { CompileGateReport, GateFailure, LeverDiff } from "./pipeline-8b-gates.js";

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
async function confirmRound(db: DatabaseSync, embedder: Embedder, reviewer: string): Promise<{ confirmed: number; skipped: number; errors: Array<{ surface: string; reason: string }> }> {
  await runLeafProposals(db, embedder);
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
            exact_text: piece.text, family_id: piece.family_id, family_version: piece.family_version, parameters: piece.parameters,
          }, machineActor(reviewer));
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

async function runAutoConfirm(db: DatabaseSync, embedder: Embedder, reviewer: string, maxRounds: number): Promise<AutoConfirmReport> {
  let rounds = 0;
  let confirmed = 0;
  let skipped = 0;
  const errors: Array<{ surface: string; reason: string }> = [];
  for (; rounds < maxRounds; rounds += 1) {
    const round = await confirmRound(db, embedder, reviewer);
    confirmed += round.confirmed;
    skipped = round.skipped; // only the last round's count is meaningful: earlier skips may resolve later
    errors.push(...round.errors);
    if (round.confirmed === 0) { rounds += 1; break; }
  }
  return { rounds, confirmed, skipped_probabilistic: skipped, errors };
}

function residueReport(db: DatabaseSync): ResidueReport {
  // The residue left after this pipeline's own machine confirmations.
  const coverage = getCurrentCoverage(db, { includeMachine: true });
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

/** Bytes two strings share at the start, up to the shorter one's length. */
function sharedPrefixBytes(left: string, right: string): number {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

/**
 * A DeepSeek cost estimate for the residue, computed by running the real `prepareLuna` request
 * builder against a throwaway VACUUM clone of `db` (never `db` itself, so this makes no lasting
 * change and issues no network call — `prepareLuna` only assembles and writes a request file).
 * The wire bytes measured here are exactly what `finishLunaRun` sends on stdin
 * (`lunaStdinEnvelope` wrapped around `serializeLunaRequest`'s output), not a re-derivation.
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
  let firstEnvelope: string | null = null;
  let secondEnvelope: string | null = null;
  try {
    const clone = new DatabaseSyncCtor(scratchDb);
    try {
      // One coverage snapshot for the whole simulated batch: nothing about leaf annotations
      // changes between these ~400 read-only `prepareLuna` calls, so recomputing the full-corpus
      // coverage on every one of them (prepareLuna's own default when no snapshot is given) is
      // pure waste here — see PrepareLunaOptions.coverage.
      const coverage = getCurrentCoverage(clone, { includeMachine: true });
      for (;;) {
        let prepared;
        try {
          prepared = prepareLuna(clone, { mode: "residue", limit: 15, coverage } as PrepareLunaOptions);
        } catch (error) {
          if (error instanceof RangeError) break;
          throw error;
        }
        requests += 1;
        const request = prepared.request as PreparedRequest;
        const serialized = serializeLunaRequest(request);
        const withoutAbilities = Buffer.byteLength(serializeLunaRequest({ ...request, abilities: [] }), "utf8");
        if (fixedBytes === 0) fixedBytes = withoutAbilities;
        variableBytesTotal += Buffer.byteLength(serialized, "utf8") - withoutAbilities;
        residueAbilityCount += request.abilities.length;
        const envelope = lunaStdinEnvelope(prepared.input_hash, serialized);
        if (firstEnvelope === null) firstEnvelope = envelope;
        else if (secondEnvelope === null) secondEnvelope = envelope;
      }
    } finally {
      clone.close();
    }
  } finally {
    if (previousArtifactDir === undefined) delete process.env.ROUND5C_ARTIFACT_DIR;
    else process.env.ROUND5C_ARTIFACT_DIR = previousArtifactDir;
    rmSync(scratchDir, { recursive: true, force: true });
  }
  const sharedBytes = firstEnvelope !== null && secondEnvelope !== null ? sharedPrefixBytes(firstEnvelope, secondEnvelope) : 0;
  // A trivial handful of shared leading bytes (just "{"request":{") is not a cache-worthy prefix;
  // most of the fixed part (registry + confirmed examples + instructions echo) must be shared.
  const stable = firstEnvelope !== null && secondEnvelope !== null && sharedBytes >= fixedBytes - 200;
  const finding = firstEnvelope === null
    ? "No residue abilities to estimate."
    : stable
      ? `Requests share a ${sharedBytes}-byte leading prefix (of ~${fixedBytes} fixed bytes before `
        + "\"abilities\"), so a provider that caches by prompt prefix (DeepSeek's included) reuses it "
        + "across requests instead of reprocessing the registry, confirmed examples and instructions "
        + "echo every time. This is the fixed state after the fix in serializeLunaRequest/"
        + "lunaStdinEnvelope: \"abilities\" now serializes last in the request body, and input_hash "
        + "(which necessarily differs per request) now sits last in the stdin envelope instead of "
        + "first, so no per-request-varying value sits ahead of the shared part."
      : `Requests only share ${sharedBytes} leading bytes out of ~${fixedBytes} fixed bytes — the `
        + "prefix is not stable. If this reappears, check whether something upstream of "
        + "serializeLunaRequest (a varying registry, confirmed-examples selection, or vocabulary) "
        + "changed between requests, or whether a caller bypassed serializeLunaRequest/"
        + "lunaStdinEnvelope and re-serialized the request with plain canonicalize().";
  return {
    residue_ability_count: residueAbilityCount, requests, fixed_bytes_per_request: fixedBytes,
    variable_bytes_total: variableBytesTotal,
    variable_bytes_average_per_ability: residueAbilityCount ? Math.round(variableBytesTotal / residueAbilityCount) : 0,
    prefix_cache: { stable_prefix: stable, finding },
  };
}

export async function runPipeline8b(db: DatabaseSync, options: Pipeline8bOptions = {}): Promise<Pipeline8bReport> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  // One embedder — and, via `cachedEmbeddings`, one warm run of the workbench's own
  // `text_embeddings` cache (model + sha256(text)) — for the whole run. Building a fresh
  // `localEmbedder()` per proposal round or per gated ability reloads the ONNX model each time;
  // that (not a lack of caching) was the real cost of a repeat run.
  const embedder = localEmbedder();
  const refresh = refreshSources(db);
  const reapply = reapplyLeafSurfaces(db);
  const autoConfirm = await runAutoConfirm(db, embedder, opts.reviewer, opts.maxConfirmRounds);
  reapplyLeafSurfaces(db); // corpus-wide sweep so every ability sees every surface just confirmed
  // This pipeline gates its own machine confirmations, so it reads the machine view.
  const compile = await runCompileGates(db, embedder, opts.describerSimilarityFloor, undefined, { includeMachine: true });
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

export type GatesOnlyReport = { compile: CompileGateReport };
export type GatesOnlyOptions = Pick<Pipeline8bOptions, "describerSimilarityFloor"> & {
  /** Restrict compile+gate to this set of ability versions (a pilot sample, for example). */
  abilityVersionIds?: ReadonlySet<number>;
  /** Leaf view; the default trusted view gates only human and derived leaves. */
  view?: CoverageView;
};

/**
 * Re-gate the workbench's current compiles — nothing else. No refresh, no deterministic-confirm
 * pass, no residue report, no cost estimate: those aren't "the gate", and `costEstimate` in
 * particular is not cheap to include here (it drives the real `prepareLuna`, which simulates
 * requests over the *whole* residue corpus by default — fine as a one-off in the full run,
 * ruinous if paid again on every gate iteration, and irrelevant to an arm comparison anyway).
 * Pass `abilityVersionIds` to scope the compile+gate pass itself to a pilot sample instead of
 * every current ability, for a fast per-arm comparison run.
 */
export async function runGatesOnly(db: DatabaseSync, options: GatesOnlyOptions = {}): Promise<GatesOnlyReport> {
  const floor = options.describerSimilarityFloor ?? DEFAULT_OPTIONS.describerSimilarityFloor;
  const embedder = localEmbedder();
  const compile = await runCompileGates(db, embedder, floor, options.abilityVersionIds, options.view ?? {});
  return { compile };
}

/** Standalone entry point for `round5c pipeline-8b-gates-only` — opens the workbench itself. */
export async function runGatesOnlyCli(options: GatesOnlyOptions = {}): Promise<GatesOnlyReport> {
  const db = openWorkbench();
  try {
    return await runGatesOnly(db, options);
  } finally {
    db.close();
  }
}
