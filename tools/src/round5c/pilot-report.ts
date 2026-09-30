import type { DatabaseSync } from "node:sqlite";

import { HUMAN_REVIEWERS } from "./authority.js";
import { jevSignalsFor } from "./jev-classify.js";

/**
 * What one pilot step produced, read from the database alone (no writes): every span the model
 * cut for each ability with its label and Jev's independent answer, the spend, and, once Will
 * has reviewed the step, how much repair the labels needed. The comparison is against the
 * step's frozen manifest (the proposals as they stood before review) so later model runs or
 * review never change what the step is measured on.
 */

export type FrozenProposal = {
  proposal_id: number; span_id: number; ability_version_id: number; fragment: string; start_byte: number; end_byte: number;
  exact_text: string; role: string; status: string; family_id: string | null; family_version: number | null;
  parameters: Record<string, unknown> | null; reason: string | null;
  /** `semantic-span`: a span the model cut (labelled, novel, or labelled then rejected at import);
   * `unresolved-region`: source it left or declared unlabelled; `connective`/others as recorded. */
  kind: string;
};

export type StepManifest = {
  step: string;
  ability_version_ids: number[];
  source_hashes: string[];
  run_ids: number[];
  frozen_at: string | null;
  proposals: FrozenProposal[];
};

export type RepairClass = "unchanged" | "expanded" | "shrunk" | "split" | "merged" | "added" | "removed";

export type StepEvaluation = {
  reviewed_abilities: number[];
  unreviewed_abilities: number[];
  repairs: Record<RepairClass, number> | null;
  repairs_per_text: number | null;
  segmentation_unchanged_rate: number | null;
  deepseek_family: { correct: number; compared: number } | null;
  jev_family: { top1: number; top3: number; compared: number } | null;
  jev_parameters: { agreed: number; asked: number } | null;
  notes: string[];
};


/** Freeze a step's proposals as they stand now (read only; the caller persists the manifest). */
export function freezeProposals(db: DatabaseSync, runIds: readonly number[]): FrozenProposal[] {
  if (runIds.length === 0) return [];
  return (db.prepare(`
    SELECT proposals.id AS proposal_id, source_spans.id AS span_id, source_spans.ability_version_id, source_spans.fragment,
      source_spans.start_byte, source_spans.end_byte, source_spans.exact_text, proposals.role, proposals.status,
      fingerprints.family_id, fingerprints.family_version, fingerprints.parameters_json, proposals.reason_json
    FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
    LEFT JOIN fingerprints ON fingerprints.id = proposals.fingerprint_id
    WHERE proposals.model_run_id IN (${runIds.map(Number).join(",")})
    ORDER BY source_spans.ability_version_id, source_spans.start_byte, proposals.id
  `).all() as Array<Omit<FrozenProposal, "parameters" | "reason"> & { parameters_json: string | null; reason_json: string }>).map((row) => {
    const reason = JSON.parse(row.reason_json) as { type?: string; description?: string; rejection?: string; span_status?: string };
    const { parameters_json: parameters, reason_json: _reason, ...rest } = row;
    return {
      ...rest,
      kind: reason.type ?? (row.role === "CONNECTIVE" ? "connective" : "unknown"),
      parameters: parameters ? JSON.parse(parameters) as Record<string, unknown> : null,
      reason: reason.rejection ?? reason.description ?? (reason.span_status && reason.span_status !== "EXISTING" ? reason.span_status : null),
    };
  });
}

/** Model runs a step made, found by the pilot tag on each run. */
export function stepRuns(db: DatabaseSync, step: string): Array<{ id: number; status: string; cost_usd: number | null; latency_ms: number | null; output_json: string | null; abilities: number[] }> {
  return (db.prepare(`
    SELECT id, status, cost_usd, latency_ms, output_json, config_json FROM model_runs
    WHERE json_extract(config_json, '$.pilot.step') = ? ORDER BY id
  `).all(step) as Array<{ id: number; status: string; cost_usd: number | null; latency_ms: number | null; output_json: string | null; config_json: string }>).map((row) => ({
    id: row.id, status: row.status, cost_usd: row.cost_usd, latency_ms: row.latency_ms, output_json: row.output_json,
    abilities: (JSON.parse(row.config_json) as { request_abilities: Array<{ ability_version_id: number }> }).request_abilities.map((item) => item.ability_version_id),
  }));
}

/** Spend and token totals over a set of runs; a run whose cost the API never reported counts as unknown. */
export function runAccounting(runs: ReturnType<typeof stepRuns>): {
  runs: number; completed: number; failed: number; pending: number; cost_usd: number; unknown_cost_runs: number;
  tokens: { prompt: number; cache_hit: number; cache_miss: number; completion: number; reasoning: number };
} {
  const tokens = { prompt: 0, cache_hit: 0, cache_miss: 0, completion: 0, reasoning: 0 };
  let cost = 0;
  let unknown = 0;
  for (const run of runs) {
    const output = run.output_json ? JSON.parse(run.output_json) as { usage?: Record<string, number> | null; cost_unknown?: boolean } : {};
    const usage = output.usage;
    if (usage) {
      tokens.prompt += usage.prompt_tokens ?? 0; tokens.cache_hit += usage.prompt_cache_hit_tokens ?? 0; tokens.cache_miss += usage.prompt_cache_miss_tokens ?? 0;
      tokens.completion += usage.completion_tokens ?? 0; tokens.reasoning += usage.reasoning_tokens ?? 0;
    }
    if (run.cost_usd !== null) cost += run.cost_usd;
    else if (output.cost_unknown || (run.status === "failed" && usage === undefined && !/"stage":"abandon"/u.test(run.output_json ?? ""))) unknown += 1;
  }
  return {
    runs: runs.length, completed: runs.filter((run) => run.status === "completed").length, failed: runs.filter((run) => run.status === "failed").length,
    pending: runs.filter((run) => run.status === "pending").length, cost_usd: cost, unknown_cost_runs: unknown, tokens,
  };
}

/** Abilities Will marked reviewed after looking at the whole source (a human whole-context review). */
export function reviewedAbilities(db: DatabaseSync, ids: readonly number[]): Set<number> {
  if (ids.length === 0) return new Set();
  return new Set((db.prepare(`
    SELECT ability_version_id, reviewed_by FROM ability_reviews
    WHERE whole_context_checked = 1 AND ability_version_id IN (${ids.map(Number).join(",")})
  `).all() as Array<{ ability_version_id: number; reviewed_by: string | null }>)
    .filter((row) => row.reviewed_by !== null && HUMAN_REVIEWERS.has(row.reviewed_by))
    .map((row) => row.ability_version_id));
}

type HumanRow = { ability_version_id: number; fragment: string; start_byte: number; end_byte: number; family_id: string; parameters: Record<string, unknown> };

/** Trusted leaves Will's review produced for these abilities: rows written after the freeze. */
function reviewedRows(db: DatabaseSync, ids: readonly number[], frozenAt: string): HumanRow[] {
  return (db.prepare(`
    SELECT source_spans.ability_version_id, source_spans.fragment, source_spans.start_byte, source_spans.end_byte, fingerprints.family_id, fingerprints.parameters_json
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    WHERE annotations.status = 'active' AND annotations.authority_kind IN ('human', 'derived') AND annotations.created_at > ?
      AND source_spans.ability_version_id IN (${ids.map(Number).join(",")})
  `).all(frozenAt) as Array<Omit<HumanRow, "parameters"> & { parameters_json: string }>).map(({ parameters_json: parameters, ...row }) => ({ ...row, parameters: JSON.parse(parameters) as Record<string, unknown> }));
}

const overlaps = (left: { fragment: string; start_byte: number; end_byte: number }, right: { fragment: string; start_byte: number; end_byte: number }) =>
  left.fragment === right.fragment && left.start_byte < right.end_byte && right.start_byte < left.end_byte;

/**
 * Compare the frozen model segmentation with Will's reviewed leaves, ability by ability. Only
 * abilities he marked reviewed count, and only leaves written after the freeze: anything trusted
 * before it was never the model's to cut.
 */
export function evaluateStep(db: DatabaseSync, manifest: StepManifest): StepEvaluation {
  const notes: string[] = [];
  const reviewed = reviewedAbilities(db, manifest.ability_version_ids);
  const evaluation: StepEvaluation = {
    reviewed_abilities: [...reviewed], unreviewed_abilities: manifest.ability_version_ids.filter((id) => !reviewed.has(id)),
    repairs: null, repairs_per_text: null, segmentation_unchanged_rate: null, deepseek_family: null, jev_family: null, jev_parameters: null, notes,
  };
  if (!manifest.frozen_at) { notes.push("The step has no frozen manifest yet; nothing to compare."); return evaluation; }
  if (reviewed.size === 0) { notes.push("No ability in this step is marked reviewed (whole-context review by a human reviewer)."); return evaluation; }

  // The model's cuts: every semantic span it reported, including ones import rejected. Source it
  // left unlabelled is not a cut; a leaf Will adds there counts as "added".
  const proposals = manifest.proposals.filter((item) => reviewed.has(item.ability_version_id) && item.kind === "semantic-span");
  const human = reviewedRows(db, [...reviewed], manifest.frozen_at);
  const repairs: Record<RepairClass, number> = { unchanged: 0, expanded: 0, shrunk: 0, split: 0, merged: 0, added: 0, removed: 0 };
  const matched: Array<{ proposal: FrozenProposal; human: HumanRow }> = [];
  for (const proposal of proposals) {
    const hits = human.filter((row) => row.ability_version_id === proposal.ability_version_id && overlaps(row, proposal));
    if (hits.length === 0) { repairs.removed += 1; continue; }
    if (hits.length > 1) { repairs.split += 1; continue; }
    const row = hits[0]!;
    const sharers = proposals.filter((other) => other.ability_version_id === row.ability_version_id && overlaps(other, row));
    if (sharers.length > 1) { if (sharers[0] === proposal) repairs.merged += 1; continue; }
    if (row.start_byte === proposal.start_byte && row.end_byte === proposal.end_byte) repairs.unchanged += 1;
    else if (row.start_byte <= proposal.start_byte && row.end_byte >= proposal.end_byte) repairs.expanded += 1;
    else repairs.shrunk += 1;
    matched.push({ proposal, human: row });
  }
  for (const row of human) {
    if (!proposals.some((proposal) => proposal.ability_version_id === row.ability_version_id && overlaps(row, proposal))) repairs.added += 1;
  }
  const edits = repairs.expanded + repairs.shrunk + repairs.split + repairs.merged + repairs.added + repairs.removed;
  evaluation.repairs = repairs;
  evaluation.repairs_per_text = edits / reviewed.size;
  evaluation.segmentation_unchanged_rate = proposals.length === 0 ? null : repairs.unchanged / proposals.length;
  if (proposals.length === 0) notes.push("The model cut no semantic span on the reviewed abilities.");

  // Family accuracy over one-to-one matches (the span's bounds may have been repaired).
  const withFamily = matched.filter((item) => item.proposal.family_id !== null);
  evaluation.deepseek_family = { correct: withFamily.filter((item) => item.proposal.family_id === item.human.family_id).length, compared: withFamily.length };
  const jev = jevSignalsFor(db, matched.map((item) => item.proposal.span_id));
  const askedJev = matched.filter((item) => (jev.get(item.proposal.span_id)?.ranked.length ?? 0) > 0);
  if (askedJev.length === 0) notes.push("Jev answered none of the matched spans.");
  else {
    evaluation.jev_family = {
      top1: askedJev.filter((item) => jev.get(item.proposal.span_id)!.ranked[0]?.family_id === item.human.family_id).length,
      top3: askedJev.filter((item) => jev.get(item.proposal.span_id)!.ranked.slice(0, 3).some((rank) => rank.family_id === item.human.family_id)).length,
      compared: askedJev.length,
    };
    let agreed = 0;
    let asked = 0;
    for (const item of askedJev) {
      const signal = jev.get(item.proposal.span_id)!;
      if (signal.ranked[0]?.family_id !== item.human.family_id || !signal.parameters) continue;
      for (const [name, value] of Object.entries(signal.parameters)) {
        asked += 1;
        if (JSON.stringify(item.human.parameters[name]) === JSON.stringify(value)) agreed += 1;
      }
    }
    evaluation.jev_parameters = asked === 0 ? null : { agreed, asked };
    if (asked === 0) notes.push("No Jev parameter answer lined up with a correct Jev family.");
  }
  return evaluation;
}

/** A 3-6 word handle for a span, for the per-ability label table. */
export function fragmentHandle(text: string): string {
  const words = text.replace(/\*\*/gu, "").trim().split(/\s+/u);
  return words.length <= 6 ? words.join(" ") : `${words.slice(0, 6).join(" ")}…`;
}
