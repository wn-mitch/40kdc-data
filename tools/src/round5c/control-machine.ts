import { assertNotLiveWorkbench, openWorkbench, openWorkbenchReadOnly, workbenchPath } from "./db.js";
import { runDeepSeekArm } from "./deepseek-pilot.js";
import { buildTypeSafeClient } from "./jev-core.js";
import { classifySpans, jevSpendFor } from "./jev-classify.js";
import { deepseekReservationUsd, DEEPSEEK_FLASH_MODEL, DEFAULT_MAX_TOKENS } from "./leaf-proposals-llm.js";
import { runAccounting, stepRuns } from "./pilot-report.js";
import { getAbilityCoverage } from "./coverage.js";

/**
 * The pilot's paid stages as standalone commands over a named batch, for work outside a
 * Fibonacci step (a bulk segmentation pass the frontier then reviews). Both refuse the live
 * workbench, resume from the database (runs are tagged with the batch name, as a pilot step's
 * are), and with `dryRun` plan only: no run rows, no request files, no calls.
 *
 * Neither writes a trusted row or decides a proposal; their output is proposals and Jev signals.
 */

export type BatchOptions = { batch: string; abilities: number[]; spendCapUsd?: number; model?: string; concurrency?: number; dryRun: boolean };

function checkBatch(batch: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(batch)) throw Object.assign(new Error("A batch name is lowercase letters, digits and hyphens."), { code: "INVALID_ARGUMENT" });
}

/** Segment the named abilities with DeepSeek (two per request) under the batch's spend cap. */
export async function segmentBatch(options: BatchOptions): Promise<Record<string, unknown>> {
  checkBatch(options.batch);
  const path = workbenchPath();
  assertNotLiveWorkbench(path, "segment");
  const model = options.model ?? DEEPSEEK_FLASH_MODEL;
  const spendCapUsd = options.spendCapUsd ?? 0.5;
  if (options.dryRun) {
    const db = openWorkbenchReadOnly(path);
    try {
      const done = new Set(stepRuns(db, options.batch).filter((run) => run.status === "completed").flatMap((run) => run.abilities));
      const todo = options.abilities.filter((id) => !done.has(id) && getAbilityCoverage(db, id).residue.length > 0);
      const requests = Math.ceil(todo.length / 2);
      return {
        batch: options.batch, model, to_segment: todo.length, already_segmented: options.abilities.filter((id) => done.has(id)).length,
        requests, worst_case_usd: requests * deepseekReservationUsd(96 * 1024, DEFAULT_MAX_TOKENS, model), spend_cap_usd: spendCapUsd,
        prior_spend_usd: runAccounting(stepRuns(db, options.batch)).cost_usd,
      };
    } finally {
      db.close();
    }
  }
  const db = openWorkbench(path);
  try {
    const done = new Set(stepRuns(db, options.batch).filter((run) => run.status === "completed").flatMap((run) => run.abilities));
    const remaining = new Set(options.abilities.filter((id) => !done.has(id)));
    if (remaining.size === 0) return { batch: options.batch, skipped: "every ability already has a completed run" };
    const result = await runDeepSeekArm(db, () => openWorkbench(path), remaining, {
      model, reasoningEffort: "low", maxTokens: DEFAULT_MAX_TOKENS, abilitiesPerRequest: 2, concurrency: options.concurrency ?? 4,
      maxRequests: remaining.size + Math.ceil(remaining.size / 2), spendCapUsd,
      priorSpendUsd: runAccounting(stepRuns(db, options.batch)).cost_usd, pilot: { step: options.batch, model },
    });
    return {
      batch: options.batch, requests: result.requests, cost_usd: result.total_cost_usd, budget_exhausted: result.budget_exhausted,
      unknown_cost_runs: result.unknown_cost_runs,
      failures: result.runs.filter((run) => run.failure).map((run) => `${run.run_id}: ${run.failure!.stage}/${run.failure!.reason_code}: ${run.failure!.message}`),
    };
  } finally {
    db.close();
  }
}

/** Ask Jev for a family ranking and parameters on every span the batch's runs proposed. */
export async function classifyBatch(options: Omit<BatchOptions, "abilities" | "model" | "concurrency">): Promise<Record<string, unknown>> {
  checkBatch(options.batch);
  const path = workbenchPath();
  assertNotLiveWorkbench(path, "classify");
  const db = options.dryRun ? openWorkbenchReadOnly(path) : openWorkbench(path);
  try {
    const runIds = stepRuns(db, options.batch).filter((run) => run.status === "completed").map((run) => run.id);
    const all = db.prepare(`
      SELECT DISTINCT source_spans.id AS span_id, source_spans.exact_text AS text, abilities.source_type AS kind, source_spans.fragment,
        EXISTS (SELECT 1 FROM span_signals WHERE span_signals.span_id = source_spans.id AND span_signals.source = 'jev-family') AS classified
      FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id JOIN abilities ON abilities.id = source_spans.ability_version_id
      WHERE proposals.model_run_id IN (${runIds.join(",") || "NULL"}) AND proposals.role NOT IN ('CONNECTIVE', 'RESOURCE')
    `).all() as Array<{ span_id: number; text: string; kind: string | null; fragment: string; classified: number }>;
    const spans = all.filter((span) => span.classified === 0);
    const spendCapUsd = options.spendCapUsd ?? 0.2;
    // The cap covers the whole batch: what earlier invocations spent on its spans counts.
    const priorSpendUsd = jevSpendFor(db, all.map((span) => span.span_id));
    if (options.dryRun) return { batch: options.batch, runs: runIds.length, spans_to_classify: spans.length, prior_spend_usd: priorSpendUsd, spend_cap_usd: spendCapUsd };
    const { report } = await classifySpans(db, buildTypeSafeClient(), spans, { spendCapUsd, priorSpendUsd });
    return { batch: options.batch, runs: runIds.length, ...report };
  } finally {
    db.close();
  }
}
