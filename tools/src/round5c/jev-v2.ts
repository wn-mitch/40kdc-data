import type { DatabaseSync } from "node:sqlite";

import { LEAF_ROLES, normalizeFingerprintParameters, reviewedFamily, type LeafRole } from "./contracts.js";
import { choices, freeText, numeric, prefillFromSource, type Property } from "./leaf-prefill.js";
import { cachedEmbeddings, type Embedder } from "./embeddings.js";
import { dot } from "./leaf-knn.js";
import { askChoice, askYesNo, DEFAULT_JEV_CONCURRENCY, enumCriteria, JevBudget, JEV_MODEL, NONE_OF_THESE, type JevClient, type JevRequestLog } from "./jev-core.js";
import { decidedSurfaces, segmentSpans, type DecidedSurface, type SegmentPiece } from "./jev-v2-segment.js";
import type { Span } from "./jev-proposer.js";
import { mapWithConcurrency } from "./concurrency.js";
import type { JevCache } from "./jev-cache.js";

/**
 * Jev v2: segment each untiled span against decided surfaces first (`jev-v2-segment.ts`), then
 * for each non-connective piece ask one narrowed choice *per role* — that role's surface-narrowed
 * candidate families plus "none" — instead of v1's single full-registry role-then-family walk. A
 * piece can resolve in more than one role at once (compound wording carrying two leaves); every
 * role that resolves gets its own parameter pass, seeded from the matched surface where it
 * applies. See `jev-v2-rounds.ts` for the stamp-and-spread orchestration built on top of this.
 */

export type JevV2RoleResolution = {
  role: LeafRole;
  candidate_family_ids: string[];
  status: "proposed" | "partial" | "unanswered" | "skipped-budget";
  family_id: string | null;
  family_version: number | null;
  family_confidence: number | null;
  parameters: Record<string, unknown>;
  unresolved_parameters: string[];
  requests: number;
};

export type JevV2PieceResult = {
  ability_version_id: number;
  faction_id: string;
  ability_id: string;
  fragment: string;
  start_byte: number;
  end_byte: number;
  text: string;
  segment_kind: SegmentPiece["kind"];
  matched_family_id: string | null;
  match_score: number | null;
  resolutions: JevV2RoleResolution[];
};

export type JevV2Result = {
  model: string;
  confidence_floor: number;
  spend_cap_usd: number;
  segmentation_threshold: number;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_latency_ms: number;
  requests: number;
  budget_exhausted: boolean;
  pieces: JevV2PieceResult[];
  /** How often one piece resolved a family in more than one role at once. */
  multi_role_pieces: number;
  log: JevRequestLog[];
};

export type JevV2Options = {
  confidenceFloor?: number;
  spendCapUsd?: number;
  timeoutMs?: number;
  /** Calibrated separately; see `calibrateThreshold` in jev-v2-segment.ts. */
  segmentationThreshold: number;
  /** How many of a piece's nearest decided surfaces (within one role) become its choice list. */
  k?: number;
  /** How many pieces to resolve concurrently. Each piece's own role/parameter asks stay
   * sequential (a parameter question genuinely depends on which family the role question
   * picked) — concurrency is across pieces, which are independent of each other. */
  concurrency?: number;
  /** Durable answer cache, shared across rounds/runs; see `jev-cache.ts`. Omit for no caching. */
  cache?: JevCache;
};

type V2Opts = Required<Omit<JevV2Options, "segmentationThreshold" | "cache">> & { cache?: JevCache };
const DEFAULT_OPTIONS: Required<Omit<JevV2Options, "segmentationThreshold" | "cache">> = { confidenceFloor: 0.6, spendCapUsd: 2, timeoutMs: 60_000, k: 5, concurrency: DEFAULT_JEV_CONCURRENCY };

const embedText = (text: string) => text.replace(/\*\*/gu, "").replace(/\s+/gu, " ").trim();

/** The families of a piece's k nearest decided surfaces *within one role*, nearest first, deduplicated. */
function nearestFamiliesInRole(vector: Float32Array, decided: readonly DecidedSurface[], decidedVectors: readonly Float32Array[], role: LeafRole, k: number): string[] {
  const scored: Array<{ index: number; sim: number }> = [];
  decided.forEach((surface, index) => {
    if (surface.role !== role) return;
    scored.push({ index, sim: dot(vector, decidedVectors[index]!) });
  });
  scored.sort((left, right) => right.sim - left.sim);
  const families: string[] = [];
  for (const { index } of scored) {
    const id = decided[index]!.family_id;
    if (!families.includes(id)) families.push(id);
    if (families.length >= k) break;
  }
  return families;
}

async function resolveRole(
  client: JevClient, role: LeafRole, pieceKey: string, piece: SegmentPiece, candidateFamilyIds: readonly string[], decided: readonly DecidedSurface[],
  budget: JevBudget, opts: V2Opts,
): Promise<JevV2RoleResolution> {
  const base: JevV2RoleResolution = {
    role, candidate_family_ids: [...candidateFamilyIds], status: "unanswered", family_id: null, family_version: null,
    family_confidence: null, parameters: {}, unresolved_parameters: [], requests: 0,
  };
  if (budget.exhausted()) return { ...base, status: "skipped-budget" };
  const state = { source_text: piece.text, instruction: "Judge only the marked local span of a Warhammer 40,000 ability's rules text." };
  const candidateFamilies = candidateFamilyIds.map((id) => reviewedFamily(id, decided.find((d) => d.family_id === id)!.family_version));
  const answer = await askChoice(client, opts.timeoutMs, budget, pieceKey, "family", state,
    `Which of these ${role.toLowerCase()} families (or none) does this piece express?`,
    enumCriteria(candidateFamilyIds, (id) => candidateFamilies.find((f) => f.id === id)?.description.slice(0, 140) ?? null), opts.cache);
  base.requests += 1;
  if (!answer || answer.selected === NONE_OF_THESE) return base;
  if (answer.confidence < opts.confidenceFloor) {
    base.family_id = answer.selected; base.family_confidence = answer.confidence;
    return base;
  }
  const family = candidateFamilies.find((f) => f.id === answer.selected)!;
  base.family_id = family.id;
  base.family_version = family.version;
  base.family_confidence = answer.confidence;

  const matchedSeed = piece.matched_surface && piece.matched_surface.family_id === family.id ? piece.matched_surface.parameters : {};
  const properties = (family.parameterSchema as { properties?: Record<string, Property> }).properties ?? {};
  const parameters: Record<string, unknown> = { ...matchedSeed, ...prefillFromSource(family, piece.text) };
  const unresolved: string[] = [];
  for (const [name, property] of Object.entries(properties)) {
    if (Object.hasOwn(parameters, name)) continue;
    if (budget.exhausted()) { unresolved.push(name); continue; }
    const options = choices(property);
    if (property.type === "boolean") {
      const yesNo = await askYesNo(client, opts.timeoutMs, budget, pieceKey, state, `Does "${family.label}"'s "${name}" parameter hold for this piece?`, opts.cache);
      base.requests += 1;
      if (yesNo && yesNo.confidence >= opts.confidenceFloor) parameters[name] = yesNo.value;
      else unresolved.push(name);
    } else if (options.length > 0) {
      const paramAnswer = await askChoice(client, opts.timeoutMs, budget, pieceKey, "parameter", state,
        `What is "${family.label}"'s "${name}" parameter for this piece?`, enumCriteria(options), opts.cache);
      base.requests += 1;
      if (paramAnswer && paramAnswer.selected !== NONE_OF_THESE && paramAnswer.confidence >= opts.confidenceFloor) parameters[name] = paramAnswer.selected;
      else unresolved.push(name);
    } else {
      unresolved.push(name);
    }
  }
  base.parameters = parameters;
  base.unresolved_parameters = unresolved;
  try {
    normalizeFingerprintParameters(family.id, parameters, family.version);
    const required = new Set((family.parameterSchema as { required?: string[] }).required ?? []);
    base.status = unresolved.some((name) => required.has(name)) ? "partial" : "proposed";
  } catch {
    base.status = "partial";
  }
  return base;
}

async function proposePiece(
  client: JevClient, piece: SegmentPiece, spanContext: Span, decided: readonly DecidedSurface[], decidedVectors: readonly Float32Array[],
  pieceVector: Float32Array | null, budget: JevBudget, opts: V2Opts,
): Promise<JevV2PieceResult> {
  const pieceKey = `${spanContext.ability_id}:${piece.start_byte}-${piece.end_byte}`;
  const base: JevV2PieceResult = {
    ability_version_id: spanContext.ability_version_id, faction_id: spanContext.faction_id, ability_id: spanContext.ability_id,
    fragment: spanContext.fragment, start_byte: piece.start_byte, end_byte: piece.end_byte, text: piece.text,
    segment_kind: piece.kind, matched_family_id: piece.matched_surface?.family_id ?? null, match_score: piece.match_score, resolutions: [],
  };
  if (piece.kind === "connective") return base;
  if (!pieceVector) return base;

  const resolutions: JevV2RoleResolution[] = [];
  for (const role of LEAF_ROLES) {
    const candidateFamilyIds = nearestFamiliesInRole(pieceVector, decided, decidedVectors, role, opts.k);
    if (candidateFamilyIds.length === 0) continue;
    resolutions.push(await resolveRole(client, role, pieceKey, piece, candidateFamilyIds, decided, budget, opts));
  }
  return { ...base, resolutions };
}

/** Run the Jev v2 (segmentation-narrowed, per-role) proposer over a set of spans, sharing one
 * budget and decided-surface pool if the caller passes them in (for the stamp-and-spread rounds
 * orchestration in jev-v2-rounds.ts); otherwise builds its own for a single standalone pass. */
export async function runJevV2Proposer(
  db: DatabaseSync, embedder: Embedder, client: JevClient, spans: readonly Span[], options: JevV2Options,
  shared: { budget?: JevBudget } = {},
): Promise<JevV2Result> {
  const opts = { ...DEFAULT_OPTIONS, confidenceFloor: options.confidenceFloor ?? DEFAULT_OPTIONS.confidenceFloor,
    spendCapUsd: options.spendCapUsd ?? DEFAULT_OPTIONS.spendCapUsd, timeoutMs: options.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs, k: options.k ?? DEFAULT_OPTIONS.k };
  const budget = shared.budget ?? new JevBudget(opts.spendCapUsd);
  const decided = decidedSurfaces(db);
  const decidedTexts = decided.map((surface) => embedText(surface.text));
  const { vectors: decidedVectors } = await cachedEmbeddings(db, embedder, decidedTexts);

  const segmented = await segmentSpans(db, embedder, spans, { threshold: options.segmentationThreshold });
  const pieceTexts = segmented.flat().filter((piece) => piece.kind !== "connective").map((piece) => embedText(piece.text));
  const { vectors: pieceVectorList } = await cachedEmbeddings(db, embedder, pieceTexts);
  const pieceVectorByText = new Map<string, Float32Array>();
  pieceTexts.forEach((text, index) => pieceVectorByText.set(text, pieceVectorList[index]!));

  const pieces: JevV2PieceResult[] = [];
  let budgetExhausted = false;
  for (let spanIndex = 0; spanIndex < spans.length; spanIndex += 1) {
    const span = spans[spanIndex]!;
    for (const piece of segmented[spanIndex]!) {
      if (budget.exhausted() && piece.kind !== "connective") budgetExhausted = true;
      const vector = piece.kind === "connective" ? null : (pieceVectorByText.get(embedText(piece.text)) ?? null);
      // Sequential, not `Promise.all`: `budget.exhausted()` must reflect every prior request
      // before the next piece decides whether to ask anything at all.
      pieces.push(await proposePiece(client, piece, span, decided, decidedVectors, vector, budget, opts));
    }
  }
  // "Resolved" here means a family was actually chosen with acceptable confidence — "proposed"
  // (every required parameter filled) or "partial" (family confirmed, some parameter still
  // open) both count; "unanswered"/"skipped-budget" don't.
  const multiRolePieces = pieces.filter((piece) => piece.resolutions.filter((r) => r.status === "proposed" || r.status === "partial").length > 1).length;

  return {
    model: JEV_MODEL, confidence_floor: opts.confidenceFloor, spend_cap_usd: opts.spendCapUsd, segmentation_threshold: options.segmentationThreshold,
    total_cost_usd: budget.totalCostUsd, total_input_tokens: budget.totalInputTokens, total_output_tokens: budget.totalOutputTokens,
    total_latency_ms: budget.totalLatencyMs, requests: budget.requests, budget_exhausted: budgetExhausted || budget.exhausted(),
    pieces, multi_role_pieces: multiRolePieces, log: budget.log,
  };
}
