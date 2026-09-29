import type { DatabaseSync } from "node:sqlite";

import type { LeafRole } from "./contracts.js";
import type { Embedder } from "./embeddings.js";
import { type CompileLeaf, leafFragment } from "./compile.js";
import { CompileError } from "./compile-fragments.js";
import { confirmSurface, LeafError, reapplyLeafSurfaces } from "./leaves.js";
import { pilotSpans, type Span } from "./jev-proposer.js";
import { runJevV2Proposer, type JevV2PieceResult, type JevV2Result } from "./jev-v2.js";
import { JevBudget } from "./jev-core.js";
import { runCompileGates, type CompileGateReport } from "./pipeline-8b-gates.js";
import type { PilotAbility } from "./pilot-sample.js";

/**
 * Stamp-and-spread orchestration on top of `jev-v2.ts`: each round asks Jev about whatever is
 * still untiled, stamps every clean answer as a genuinely decided leaf surface, then lets
 * `reapplyLeafSurfaces` (the existing, unmodified mechanism) spread that decision to every other
 * occurrence of the exact same wording before the next round asks anything. Stops when a round
 * adds nothing new, at `maxRounds`, or once `spendCapUsd` is spent across every round combined.
 */

export type StampLog = {
  round: number;
  batch_id: string;
  ability_id: string;
  faction_id: string;
  start_byte: number;
  end_byte: number;
  text: string;
  role: LeafRole;
  family_id: string;
  family_version: number;
  parameters: Record<string, unknown>;
};

export type RoundReport = {
  round: number;
  untiled_spans_at_start: number;
  jev_requests: number;
  jev_cost_usd: number;
  multi_role_pieces: number;
  new_stamps: number;
  /** Spans that closed this round without their own direct Jev ask resolving them — the effect
   * of `reapplyLeafSurfaces` spreading this round's (or an earlier round's) stamps onto other
   * occurrences of the same wording. Approximate: total spans closed this round, minus spans
   * that were both asked about and became fully tiled. */
  spread_resolved_spans: number;
  abilities_fully_tiled: number;
  abilities_compiled: number;
  abilities_gates_passed: number;
};

export type JevV2RoundsOptions = {
  segmentationThreshold: number;
  confidenceFloor?: number;
  spendCapUsd?: number;
  maxRounds?: number;
  describerSimilarityFloor?: number;
  reviewerPrefix?: string;
};

export type JevV2RoundsResult = {
  rounds: RoundReport[];
  total_cost_usd: number;
  spend_cap_usd: number;
  stamps: StampLog[];
  /** The last round's raw Jev output, kept for inspection (the earlier rounds' are summarized
   * in `rounds`, not retained in full — they've already been folded into stamps). */
  last_round_jev: JevV2Result | null;
};

const DEFAULT_FLOOR = 0.6;
const DEFAULT_MAX_ROUNDS = 5;
const DEFAULT_SPEND_CAP = 2;

function spanKey(span: { ability_id: string; start_byte: number; end_byte: number }): string {
  return `${span.ability_id}:${span.start_byte}-${span.end_byte}`;
}

/** Every resolution across a piece that cleared the floor and is eligible to stamp: a real
 * family (not "unanswered"/"skipped-budget"), confident enough, and — separately — whose
 * compile fragment actually validates (checked by the caller, since that needs a try/catch per
 * leaf and this stays a pure filter). */
function eligibleResolutions(piece: JevV2PieceResult, confidenceFloor: number) {
  return piece.resolutions.filter((resolution) =>
    (resolution.status === "proposed" || resolution.status === "partial")
    && resolution.family_id !== null && resolution.family_version !== null
    && (resolution.family_confidence ?? 0) >= confidenceFloor
    // Only a *fully* resolved leaf (every required parameter present) is stamped — a partial
    // one is real progress but not yet a decided leaf, so it isn't spread corpus-wide.
    && resolution.status === "proposed");
}

function compileFragmentValidates(piece: JevV2PieceResult, resolution: { role: LeafRole; family_id: string; family_version: number; parameters: Record<string, unknown> }): boolean {
  const leaf: CompileLeaf = {
    role: resolution.role, family_id: resolution.family_id, family_version: resolution.family_version, parameters: resolution.parameters,
    start_byte: piece.start_byte, end_byte: piece.end_byte, fragment: piece.fragment,
  };
  try {
    leafFragment(leaf);
    return true;
  } catch (error) {
    if (error instanceof CompileError) return false;
    throw error;
  }
}

export async function runJevV2Rounds(
  db: DatabaseSync, embedder: Embedder, client: Parameters<typeof runJevV2Proposer>[2], sample: readonly PilotAbility[], options: JevV2RoundsOptions,
): Promise<JevV2RoundsResult> {
  const confidenceFloor = options.confidenceFloor ?? DEFAULT_FLOOR;
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const spendCapUsd = options.spendCapUsd ?? DEFAULT_SPEND_CAP;
  const abilityVersionIds = new Set(sample.map((ability) => ability.ability_version_id));
  const budget = new JevBudget(spendCapUsd);

  const rounds: RoundReport[] = [];
  const stamps: StampLog[] = [];
  let lastRoundJev: JevV2Result | null = null;

  for (let round = 1; round <= maxRounds; round += 1) {
    if (budget.exhausted()) break;
    reapplyLeafSurfaces(db); // idempotent; propagates every prior round's stamps first
    const spansAtStart: Span[] = pilotSpans(db, sample);
    if (spansAtStart.length === 0) break; // nothing left in the sample to ask about
    const askedKeys = new Set(spansAtStart.map((span) => spanKey(span)));

    const costBefore = budget.totalCostUsd;
    const jevResult = await runJevV2Proposer(db, embedder, client, spansAtStart, {
      segmentationThreshold: options.segmentationThreshold, confidenceFloor, spendCapUsd,
    }, { budget });
    lastRoundJev = jevResult;

    let newStamps = 0;
    for (const piece of jevResult.pieces) {
      for (const resolution of eligibleResolutions(piece, confidenceFloor)) {
        if (!compileFragmentValidates(piece, { role: resolution.role, family_id: resolution.family_id!, family_version: resolution.family_version!, parameters: resolution.parameters })) continue;
        try {
          const confirmed = confirmSurface(db, {
            reviewer: `${options.reviewerPrefix ?? "jev-v2"}-round-${round}`, exact_text: piece.text,
            family_id: resolution.family_id, family_version: resolution.family_version, parameters: resolution.parameters,
          });
          stamps.push({
            round, batch_id: confirmed.batch_id, ability_id: piece.ability_id, faction_id: piece.faction_id,
            start_byte: piece.start_byte, end_byte: piece.end_byte, text: piece.text,
            role: resolution.role, family_id: resolution.family_id!, family_version: resolution.family_version!, parameters: resolution.parameters,
          });
          newStamps += 1;
        } catch (error) {
          if (!(error instanceof LeafError)) throw error; // a genuine conflict (surface already means something else) — skip, don't stamp
        }
      }
    }

    reapplyLeafSurfaces(db); // spread this round's stamps before measuring what's left
    const spansAtEnd: Span[] = pilotSpans(db, sample);
    const stillUntiledAskedSpans = spansAtEnd.filter((span) => askedKeys.has(spanKey(span))).length;
    const askedSpansClosedDirectly = askedKeys.size - stillUntiledAskedSpans;
    const totalClosedThisRound = spansAtStart.length - spansAtEnd.length;
    const spreadResolvedSpans = Math.max(0, totalClosedThisRound - askedSpansClosedDirectly);

    const gateReport: CompileGateReport = await runCompileGates(db, embedder, options.describerSimilarityFloor ?? 0.55, abilityVersionIds);
    rounds.push({
      round, untiled_spans_at_start: spansAtStart.length, jev_requests: jevResult.requests,
      jev_cost_usd: Math.round((budget.totalCostUsd - costBefore) * 1e8) / 1e8, multi_role_pieces: jevResult.multi_role_pieces,
      new_stamps: newStamps, spread_resolved_spans: spreadResolvedSpans,
      abilities_fully_tiled: gateReport.fully_tiled, abilities_compiled: gateReport.compile_ok, abilities_gates_passed: gateReport.all_gates_pass,
    });

    if (newStamps === 0) break; // converged: nothing left this round's asks could add
  }

  return { rounds, total_cost_usd: budget.totalCostUsd, spend_cap_usd: spendCapUsd, stamps, last_round_jev: lastRoundJev };
}
