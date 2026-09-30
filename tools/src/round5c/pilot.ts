import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { getAbilityCoverage } from "./coverage.js";
import { assertNotLiveWorkbench, openWorkbench, openWorkbenchReadOnly, workbenchPath } from "./db.js";
import { runDeepSeekArm, type DeepSeekArmResult } from "./deepseek-pilot.js";
import { buildTypeSafeClient, type JevClient } from "./jev-core.js";
import { classifySpans, jevSignalsFor, jevSpendFor, type JevClassifyReport } from "./jev-classify.js";
import { deepseekReservationUsd, DEEPSEEK_FLASH_MODEL, DEFAULT_MAX_TOKENS, type DeepSeekReasoningEffort, type ModelCall } from "./leaf-proposals-llm.js";
import { untiledRuns, reapplyLeafSurfaces } from "./leaves.js";
import { abandonLunaRun } from "./luna-run.js";
import { runGatesOnly } from "./pipeline-8b.js";
import type { AbilityGateResult } from "./pipeline-8b-gates.js";
import { evaluateStep, fragmentHandle, freezeProposals, reviewedAbilities, runAccounting, stepRuns, type StepEvaluation, type StepManifest } from "./pilot-report.js";
import type { PilotSample } from "./pilot-sample.js";
import { buildSchedule, nextSlice, readSchedule, scheduleHash, writeSchedule, type PilotSchedule } from "./pilot-schedule.js";

/**
 * One Fibonacci pilot step: label a small, disjoint cohort of abilities end to end on a copy of
 * the workbench, then stop for Will's review before the next, larger step may start.
 *
 * Stages, each resumable from the database: select (from the persisted schedule), propagate
 * (trusted surfaces into the cohort first, so the model only labels residue), segment (DeepSeek,
 * two abilities per request, spend reserved before sending), classify (Jev's independent family
 * and parameter answer per span), freeze (the proposals as they stand before review), gates
 * (compile and gate the cohort under a pilot view: trusted leaves plus this step's proposals;
 * results are reports, never approvals), report.
 *
 * Nothing here writes trusted rows or decides a proposal. Every stage is scoped to the cohort.
 */

export type PilotStepOptions = {
  step: string;
  /** Take the next N scheduled abilities (a new step), or `abilities` explicitly. */
  next?: number;
  abilities?: number[];
  samplePath?: string;
  seed?: number;
  /** Abilities never scheduled (the earlier pilots' cohort). */
  exclude?: number[];
  spendCapUsd?: number;
  jevCapUsd?: number;
  model?: string;
  reasoningEffort?: DeepSeekReasoningEffort;
  maxTokens?: number;
  concurrency?: number;
  dbPath?: string;
  artifactDirectory?: string;
  /** Test doubles for the two paid transports. */
  deepseekCall?: ModelCall;
  jevClient?: JevClient;
};

export type PilotAbilityReport = {
  ability_version_id: number; faction_id: string; ability_id: string; kind: string | null; source_hash: string;
  trusted_leaves_before: number;
  spans: Array<{
    handle: string; role: string; status: string; family: string | null; parameters: Record<string, unknown> | null; reason: string | null;
    jev: Array<{ family_id: string; probability: number }>; jev_parameters: Record<string, unknown> | null; jev_agrees: boolean | null;
  }>;
  untiled: string[];
  gate: AbilityGateResult | null;
};

export type PilotStepReport = {
  step: string; db_path: string; schedule: string; ability_version_ids: number[];
  stages: Record<string, { seconds: number; [key: string]: unknown }>;
  spend: ReturnType<typeof runAccounting> & { jev_usd: number };
  abilities: PilotAbilityReport[];
  evaluation: StepEvaluation;
};

const DEFAULT_SEED = 5;
const EARLIER_PILOT_ABILITIES = [41, 147, 209, 312, 479];

function artifactDirectory(options: PilotStepOptions): string {
  return resolve(options.artifactDirectory ?? process.env.ROUND5C_ARTIFACT_DIR ?? resolve(workbenchPath(options.dbPath), ".."));
}

function stepDirectory(options: PilotStepOptions): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(options.step)) throw Object.assign(new Error("A step name is lowercase letters, digits and hyphens."), { code: "INVALID_STEP" });
  return resolve(artifactDirectory(options), "pilot-steps", options.step);
}

function readManifest(options: PilotStepOptions): StepManifest | null {
  const path = resolve(stepDirectory(options), "manifest.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as StepManifest : null;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadSchedule(db: DatabaseSync, options: PilotStepOptions): { schedule: PilotSchedule; persisted: boolean } {
  const existing = readSchedule(artifactDirectory(options));
  if (existing) return { schedule: existing, persisted: true };
  const samplePath = resolve(options.samplePath ?? resolve(artifactDirectory(options), "..", "pilot", "sample.json"));
  if (!existsSync(samplePath)) throw Object.assign(new Error(`No pilot sample at ${samplePath}; pass --sample.`), { code: "SAMPLE_MISSING" });
  const sample = JSON.parse(readFileSync(samplePath, "utf8")) as PilotSample;
  return { schedule: buildSchedule(db, sample, samplePath, options.seed ?? DEFAULT_SEED, options.exclude ?? EARLIER_PILOT_ABILITIES), persisted: false };
}

/** The step's cohort, and which earlier step must be fully reviewed before it may start. */
function plan(db: DatabaseSync, options: PilotStepOptions): { schedule: PilotSchedule; persisted: boolean; ids: number[]; isNew: boolean; blockedBy: { step: string; unreviewed: number[] } | null } {
  const { schedule, persisted } = loadSchedule(db, options);
  const taken = schedule.taken.find((entry) => entry.step === options.step);
  if (taken) return { schedule, persisted, ids: taken.ability_version_ids, isNew: false, blockedBy: null };
  const ids = options.abilities ?? nextSlice(schedule, options.next ?? 0).map((item) => item.ability_version_id);
  if (ids.length === 0) throw Object.assign(new Error("A new step needs --next N or --abilities."), { code: "EMPTY_STEP" });
  const elsewhere = ids.filter((id) => schedule.taken.some((entry) => entry.ability_version_ids.includes(id)));
  if (elsewhere.length > 0) throw Object.assign(new Error(`Ability versions ${elsewhere.join(", ")} already belong to another step.`), { code: "ABILITY_IN_OTHER_STEP" });
  const previous = schedule.taken.at(-1);
  const unreviewed = previous ? previous.ability_version_ids.filter((id) => !reviewedAbilities(db, previous.ability_version_ids).has(id)) : [];
  return { schedule, persisted, ids, isNew: true, blockedBy: previous && unreviewed.length > 0 ? { step: previous.step, unreviewed } : null };
}

/** What a step would do and cost, without writing anything or calling any model. */
export function planPilotStep(options: PilotStepOptions): Record<string, unknown> {
  const path = workbenchPath(options.dbPath);
  assertNotLiveWorkbench(path, "pilot-step");
  const db = openWorkbenchReadOnly(path);
  try {
    const planned = plan(db, options);
    const model = options.model ?? DEEPSEEK_FLASH_MODEL;
    const residue = planned.ids.map((id) => ({ ability_version_id: id, residue_regions: getAbilityCoverage(db, id).residue.length }));
    const requests = Math.ceil(residue.filter((item) => item.residue_regions > 0).length / 2);
    const typical = db.prepare(`
      SELECT AVG(cost_usd) AS average FROM model_runs WHERE status = 'completed' AND cost_usd IS NOT NULL AND json_extract(output_json, '$.usage') IS NOT NULL AND model = ?
    `).get(model) as { average: number | null };
    return {
      step: options.step, db_path: path, new_step: planned.isNew, schedule_persisted: planned.persisted, schedule: scheduleHash(planned.schedule),
      ability_version_ids: planned.ids, blocked_by_unreviewed_step: planned.blockedBy, residue,
      estimate: {
        requests, model,
        worst_case_usd: requests * deepseekReservationUsd(96 * 1024, options.maxTokens ?? DEFAULT_MAX_TOKENS, model),
        typical_usd: typical.average === null ? null : requests * typical.average,
        spend_cap_usd: options.spendCapUsd ?? 0.5,
      },
    };
  } finally {
    db.close();
  }
}

/** Run (or resume) one step on a copy of the workbench. */
export async function runPilotStep(options: PilotStepOptions): Promise<PilotStepReport> {
  const path = workbenchPath(options.dbPath);
  assertNotLiveWorkbench(path, "pilot-step");
  const directory = stepDirectory(options);
  const db = openWorkbench(path);
  const stages: PilotStepReport["stages"] = {};
  const timed = async <T>(name: string, run: () => Promise<T> | T, summarize: (value: T) => Record<string, unknown> = () => ({})): Promise<T> => {
    const started = Date.now();
    const value = await run();
    stages[name] = { seconds: (Date.now() - started) / 1000, ...summarize(value) };
    return value;
  };
  try {
    const planned = plan(db, options);
    if (planned.blockedBy) {
      throw Object.assign(new Error(`Step ${planned.blockedBy.step} is not fully reviewed (ability versions ${planned.blockedBy.unreviewed.join(", ")}); mark each reviewed before starting ${options.step}.`), { code: "PREVIOUS_STEP_UNREVIEWED" });
    }
    const ids = planned.ids;
    const scope = new Set(ids);
    if (planned.isNew) {
      planned.schedule.taken.push({ step: options.step, ability_version_ids: ids });
      writeSchedule(artifactDirectory(options), planned.schedule);
    }
    let manifest = readManifest(options) ?? {
      step: options.step, ability_version_ids: ids,
      source_hashes: (db.prepare(`SELECT source_hash FROM abilities WHERE id IN (${ids.join(",")}) ORDER BY id`).all() as Array<{ source_hash: string }>).map((row) => row.source_hash),
      run_ids: [], frozen_at: null, proposals: [],
    };

    await timed("propagate", () => reapplyLeafSurfaces(db, scope), (report) => ({ applied: report.applied, blocked: report.blocked.length }));

    const model = options.model ?? DEEPSEEK_FLASH_MODEL;
    const arm = await timed("segment", async (): Promise<DeepSeekArmResult | null> => {
      // A run still pending from an interrupted attempt is abandoned once past its deadline; one
      // inside it means another process may be running this step, so stop rather than double-spend.
      for (const run of stepRuns(db, options.step).filter((item) => item.status === "pending")) {
        abandonLunaRun(db, { run_id: String(run.id), reason: `Resuming pilot step ${options.step}.` });
      }
      const done = new Set(stepRuns(db, options.step).filter((run) => run.status === "completed").flatMap((run) => run.abilities));
      const remaining = new Set(ids.filter((id) => !done.has(id)));
      if (remaining.size === 0) return null;
      const prior = runAccounting(stepRuns(db, options.step)).cost_usd;
      return runDeepSeekArm(db, () => openWorkbench(path), remaining, {
        model, reasoningEffort: options.reasoningEffort ?? "low", maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        abilitiesPerRequest: 2, concurrency: options.concurrency ?? 4, maxRequests: remaining.size + Math.ceil(remaining.size / 2),
        spendCapUsd: options.spendCapUsd ?? 0.5, priorSpendUsd: prior, pilot: { step: options.step, model },
        ...(options.deepseekCall ? { deepseekCall: options.deepseekCall } : {}),
      });
    }, (result) => result === null ? { skipped: "every ability already has a completed run" } : {
      requests: result.requests, cost_usd: result.total_cost_usd, budget_exhausted: result.budget_exhausted, unknown_cost_runs: result.unknown_cost_runs,
      failures: result.runs.filter((run) => run.failure).map((run) => `${run.run_id}: ${run.failure!.stage}/${run.failure!.reason_code}: ${run.failure!.message}`),
    });
    void arm;
    const runIds = stepRuns(db, options.step).filter((run) => run.status === "completed").map((run) => run.id);

    const spans = db.prepare(`
      SELECT source_spans.id AS span_id, source_spans.exact_text AS text, abilities.source_type AS kind
      FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id JOIN abilities ON abilities.id = source_spans.ability_version_id
      WHERE proposals.model_run_id IN (${runIds.join(",") || "NULL"}) AND proposals.role NOT IN ('CONNECTIVE', 'RESOURCE')
    `).all() as Array<{ span_id: number; text: string; kind: string | null }>;
    await timed("classify", async () => {
      const spent = jevSpendFor(db, spans.map((span) => span.span_id));
      return classifySpans(db, options.jevClient ?? buildTypeSafeClient(), spans, { spendCapUsd: options.jevCapUsd ?? 0.2, priorSpendUsd: spent });
    }, ({ report }: { report: JevClassifyReport }) => ({ ...report }));

    // Freeze once; re-freeze only while nothing in the step is reviewed yet (a resumed step whose
    // later runs completed), so review is always measured against what Will actually saw.
    const unfrozenRuns = runIds.some((id) => !manifest.run_ids.includes(id));
    if (!manifest.frozen_at || (unfrozenRuns && reviewedAbilities(db, ids).size === 0)) {
      manifest = { ...manifest, run_ids: runIds, frozen_at: new Date().toISOString(), proposals: freezeProposals(db, runIds) };
      writeJson(resolve(directory, "manifest.json"), manifest);
    }

    const gates = await timed("gates", () => runGatesOnly(db, { abilityVersionIds: scope, view: { overlayRunIds: runIds } }),
      (result) => ({ fully_tiled: result.compile.fully_tiled, compile_ok: result.compile.compile_ok, all_gates_pass: result.compile.all_gates_pass }));

    const report = buildReport(db, options, path, planned.schedule, manifest, gates.compile.abilities, stages);
    writeJson(resolve(directory, "report.json"), report);
    writeFileSync(resolve(directory, "report.md"), renderMarkdown(report), "utf8");
    return report;
  } finally {
    db.close();
  }
}

/** The step's report from the database and its manifest, after review; writes nothing. */
export function reportPilotStep(options: PilotStepOptions): PilotStepReport {
  const path = workbenchPath(options.dbPath);
  const manifest = readManifest(options);
  if (!manifest) throw Object.assign(new Error(`Step ${options.step} has no manifest; run it first.`), { code: "STEP_NOT_RUN" });
  const saved = resolve(stepDirectory(options), "report.json");
  const previous = existsSync(saved) ? JSON.parse(readFileSync(saved, "utf8")) as PilotStepReport : null;
  const db = openWorkbenchReadOnly(path);
  try {
    const schedule = readSchedule(artifactDirectory(options));
    if (!schedule) throw Object.assign(new Error("No pilot schedule."), { code: "SCHEDULE_MISSING" });
    const gates = new Map((previous?.abilities ?? []).map((item) => [item.ability_version_id, item.gate]));
    return buildReport(db, options, path, schedule, manifest, [...gates.values()].filter((gate): gate is AbilityGateResult => gate !== null), previous?.stages ?? {});
  } finally {
    db.close();
  }
}

function buildReport(
  db: DatabaseSync, options: PilotStepOptions, path: string, schedule: PilotSchedule, manifest: StepManifest,
  gates: readonly AbilityGateResult[], stages: PilotStepReport["stages"],
): PilotStepReport {
  const runs = stepRuns(db, options.step);
  const jev = jevSignalsFor(db, manifest.proposals.map((proposal) => proposal.span_id));
  const abilities = (db.prepare(`SELECT id, faction_id, ability_id, source_type, source_hash FROM abilities WHERE id IN (${manifest.ability_version_ids.join(",") || "NULL"}) ORDER BY id`)
    .all() as Array<{ id: number; faction_id: string; ability_id: string; source_type: string | null; source_hash: string }>).map((ability): PilotAbilityReport => {
    const trusted = db.prepare(`
      SELECT count(*) AS n FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
      WHERE annotations.status = 'active' AND annotations.authority_kind IN ('human', 'derived') AND source_spans.ability_version_id = ? AND annotations.created_at <= ?
    `).get(ability.id, manifest.frozen_at ?? new Date().toISOString()) as { n: number };
    const coverage = getAbilityCoverage(db, ability.id, { overlayRunIds: manifest.run_ids });
    return {
      ability_version_id: ability.id, faction_id: ability.faction_id, ability_id: ability.ability_id, kind: ability.source_type, source_hash: ability.source_hash,
      trusted_leaves_before: trusted.n,
      spans: manifest.proposals.filter((proposal) => proposal.ability_version_id === ability.id).map((proposal) => {
        const signal = jev.get(proposal.span_id);
        return {
          handle: fragmentHandle(proposal.exact_text), role: proposal.role, status: proposal.status,
          family: proposal.family_id ? `${proposal.family_id}@${proposal.family_version}` : null, parameters: proposal.parameters, reason: proposal.reason,
          jev: signal?.ranked.slice(0, 3) ?? [], jev_parameters: signal?.parameters ?? null,
          jev_agrees: signal && proposal.family_id ? signal.ranked[0]?.family_id === proposal.family_id : null,
        };
      }),
      untiled: untiledRuns(coverage).map((run) => fragmentHandle(run.text)),
      gate: gates.find((gate) => gate.ability_version_id === ability.id) ?? null,
    };
  });
  return {
    step: options.step, db_path: path, schedule: scheduleHash(schedule), ability_version_ids: manifest.ability_version_ids, stages,
    spend: { ...runAccounting(runs), jev_usd: jevSpendFor(db, manifest.proposals.map((proposal) => proposal.span_id)) },
    abilities, evaluation: evaluateStep(db, manifest),
  };
}

/** The label table Will reads before reviewing a step. */
export function renderMarkdown(report: PilotStepReport): string {
  const lines = [`# Pilot step ${report.step}`, "", `Abilities: ${report.ability_version_ids.join(", ")}. Spend: $${report.spend.cost_usd.toFixed(4)} DeepSeek (${report.spend.unknown_cost_runs} runs of unknown cost), $${report.spend.jev_usd.toFixed(4)} Jev.`, ""];
  for (const ability of report.abilities) {
    const gate = ability.gate;
    const outcome = !gate ? `not fully tiled (${ability.untiled.join("; ") || "no residue"})`
      : gate.compile_errors.length > 0 ? `compile failed: ${gate.compile_errors[0]}`
        : gate.gates?.all ? "compiles, all gates pass" : `compiles; gates: ${Object.entries(gate.gates ?? {}).filter(([key, value]) => typeof value === "boolean" && !value && key !== "all").map(([key]) => key).join(", ") || gate.gates?.status}`;
    lines.push(`## ${ability.faction_id}/${ability.ability_id} (${ability.ability_version_id}, ${ability.kind ?? "?"})`, "", `${ability.trusted_leaves_before} trusted leaves before; ${outcome}.`, "");
    lines.push("| Span | Role | DeepSeek | Parameters | Jev top 3 | Status |", "|---|---|---|---|---|---|");
    for (const span of ability.spans) {
      const jev = span.jev.map((item) => `${item.family_id} ${item.probability.toFixed(2)}`).join(", ");
      lines.push(`| ${span.handle.replace(/\|/gu, "/")} | ${span.role} | ${span.family ?? "—"} | ${span.parameters ? JSON.stringify(span.parameters).replace(/\|/gu, "/") : "—"} | ${jev || "—"} | ${span.status}${span.reason ? `: ${span.reason.slice(0, 80).replace(/\|/gu, "/")}` : ""} |`);
    }
    lines.push("");
  }
  const evaluation = report.evaluation;
  lines.push("## After review", "", evaluation.repairs ? `Repairs: ${JSON.stringify(evaluation.repairs)}; per text ${evaluation.repairs_per_text?.toFixed(2)}.` : "Not reviewed yet.", ...evaluation.notes.map((note) => `- ${note}`), "");
  return `${lines.join("\n")}\n`;
}
