import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { hashJson } from "../round4/hash.js";
import { bumpWorkbenchRevision, withTransaction } from "./db.js";
import { LUNA_MODEL, lunaStdinEnvelope, LunaRunError } from "./luna-schema.js";
import {
  extractAssistantJson, OMP_KILL_GRACE_MS, OMP_MAX_TIME_MS, ompArgs, ompBinary, OmpTransportError, ompVersion,
  overlayYaml, runOmpProcess,
} from "./omp-driver.js";
import { DeepSeekCallError, deepseekKey, deepseekModelCall, DEEPSEEK_MODEL, type DeepSeekUsage, type ModelCall } from "./leaf-proposals-llm.js";
import { failLunaRun, importLuna, serializeLunaRequest, type LunaExecution, type LunaFailure, type LunaImportSummary, type PreparedRequest } from "./proposal.js";

/** A claimed run may be abandoned only after the subprocess deadline plus this grace. */
export const ABANDON_AFTER_MS = OMP_MAX_TIME_MS + OMP_KILL_GRACE_MS;

type RunRow = { id: number; status: string; config_json: string; output_json: string | null; model: string; model_version: string; created_at: string };

type RunConfig = {
  request_path?: string;
  input_hash?: string;
  system_prompt_hash?: string;
  requested_model?: string;
  transport?: string;
  predecessor_run_id?: number | null;
  execution?: LunaExecution | null;
  request_abilities?: Array<{ ability_version_id: number; faction_id: string; ability_id: string; source_hash: string }>;
};

/** Browser- and CLI-visible state of one source-decomposition run. */
export type LunaRunView = {
  run_id: string;
  state: "prepared" | "claimed" | "completed" | "failed";
  transport: string | null;
  model: string;
  model_version: string;
  requested_model: string | null;
  predecessor_run_id: number | null;
  successor_run_id: number | null;
  started_at: string | null;
  abandonable_at: string | null;
  failure: (LunaFailure & { ended_at?: string }) | null;
  summary: LunaImportSummary | null;
  ability_version_ids: number[];
};

function runRow(db: DatabaseSync, runId: number): RunRow {
  const row = db.prepare("SELECT id, status, config_json, output_json, model, model_version, created_at FROM model_runs WHERE id = ?").get(runId) as RunRow | undefined;
  if (!row) throw new LunaRunError(404, `Unknown Luna model run ${runId}.`);
  return row;
}

function runConfig(row: RunRow): RunConfig {
  const config = JSON.parse(row.config_json) as RunConfig;
  if (!Array.isArray(config.request_abilities)) throw new LunaRunError(422, `Model run ${row.id} is not a source-decomposition run.`);
  return config;
}

function parseRunId(value: unknown): number {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^[1-9]\d*$/u.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new LunaRunError(422, "run_id must be a model run ID.");
  }
  return Number(text);
}

/** Read a run's state without changing it. */
export function lunaRunView(db: DatabaseSync, runIdValue: unknown): LunaRunView {
  const row = runRow(db, parseRunId(runIdValue));
  const config = runConfig(row);
  const execution = config.execution ?? null;
  const output = row.output_json ? JSON.parse(row.output_json) as { failure?: LunaFailure & { ended_at?: string } } : null;
  const successor = db.prepare("SELECT id FROM model_runs WHERE json_extract(config_json, '$.predecessor_run_id') = ? LIMIT 1").get(row.id) as { id: number } | undefined;
  const summary = row.status === "completed" ? importSummary(db, row.id) : null;
  return {
    run_id: String(row.id),
    state: row.status === "pending" ? (execution ? "claimed" : "prepared") : row.status as "completed" | "failed",
    transport: config.transport ?? null,
    model: row.model,
    model_version: row.model_version,
    requested_model: config.requested_model ?? null,
    predecessor_run_id: config.predecessor_run_id ?? null,
    successor_run_id: successor?.id ?? null,
    started_at: execution?.started_at ?? null,
    abandonable_at: row.status !== "pending"
      ? null
      : execution ? new Date(Date.parse(execution.started_at) + ABANDON_AFTER_MS).toISOString() : row.created_at,
    failure: row.status === "failed" ? output?.failure ?? { stage: "import", reason_code: "LEGACY_FAILURE", message: "This run failed before failure reasons were recorded." } : null,
    summary,
    ability_version_ids: (config.request_abilities ?? []).map((ability) => ability.ability_version_id),
  };
}

function importSummary(db: DatabaseSync, runId: number): LunaImportSummary {
  const proposals = db.prepare("SELECT status, count(*) AS total FROM proposals WHERE model_run_id = ? GROUP BY status").all(runId) as Array<{ status: string; total: number }>;
  const structural = db.prepare("SELECT count(*) AS total FROM source_atom_proposals WHERE model_run_id = ?").get(runId) as { total: number };
  const candidates = db.prepare("SELECT count(DISTINCT candidate_id) AS total FROM family_candidate_evidence WHERE model_run_id = ?").get(runId) as { total: number };
  // Recovered from `proposals.reason_json`, which `parseResponseBody`'s per-span degrade tags
  // with description "Rejected: <reason>" (see proposal.ts). `dropped_covered_spans` leaves no
  // row at all — it's a silent drop by design — so it can't be recomputed here; `runDeepSeekArm`
  // overlays the live count from the import call that actually ran instead.
  const rejected = db.prepare(`
    SELECT count(*) AS total FROM proposals
    WHERE model_run_id = ? AND role = 'UNRESOLVED' AND reason_json LIKE '%"description":"Rejected:%'
  `).get(runId) as { total: number };
  return {
    proposals: proposals.filter((row) => row.status !== "unresolved").reduce((total, row) => total + Number(row.total), 0),
    unresolved: proposals.filter((row) => row.status === "unresolved").reduce((total, row) => total + Number(row.total), 0),
    structural: Number(structural.total),
    candidates: Number(candidates.total),
    rejected_spans: Number(rejected.total),
    dropped_covered_spans: 0,
  };
}

function assertSourcesCurrent(db: DatabaseSync, config: RunConfig): void {
  for (const ability of config.request_abilities ?? []) {
    const current = db.prepare("SELECT 1 FROM abilities WHERE id = ? AND source_hash = ? AND current = 1").get(ability.ability_version_id, ability.source_hash);
    if (!current) throw new LunaRunError(409, `Source ${ability.faction_id}/${ability.ability_id} changed after this run was prepared; prepare a new run.`);
  }
}

/**
 * Atomically claim a prepared run for one runner. A claimed, completed, or failed run is
 * refused with 409, so competing CLI and browser runners can never both execute it.
 */
export function claimLunaRun(db: DatabaseSync, runIdValue: unknown, options: { omp_version: string; now?: Date }): LunaExecution {
  const runId = parseRunId(runIdValue);
  return withTransaction(db, () => {
    const row = runRow(db, runId);
    const config = runConfig(row);
    if (row.status !== "pending") throw new LunaRunError(409, `Luna model run ${runId} is already ${row.status}; prepare a new run to retry.`);
    if (config.execution) throw new LunaRunError(409, `Luna model run ${runId} is already claimed since ${config.execution.started_at}.`);
    if (config.transport !== "omp-json") throw new LunaRunError(422, `Luna model run ${runId} was prepared for offline import, not OMP.`);
    assertSourcesCurrent(db, config);
    const execution: LunaExecution = { owner: randomUUID(), started_at: (options.now ?? new Date()).toISOString(), omp_version: options.omp_version };
    const claimed = db.prepare(`
      UPDATE model_runs SET config_json = json_set(config_json, '$.execution', json(?))
      WHERE id = ? AND status = 'pending' AND json_extract(config_json, '$.execution') IS NULL
    `).run(JSON.stringify(execution), runId);
    if (claimed.changes !== 1) throw new LunaRunError(409, `Luna model run ${runId} was claimed by another runner.`);
    bumpWorkbenchRevision(db);
    return execution;
  });
}

/**
 * Close a stranded run as failed with an explicit reason. An unclaimed run closes at once; a
 * claimed run only after its subprocess deadline plus grace, so a live invocation is never
 * pre-empted. A late subprocess result then fails its owner guard and cannot import.
 */
export function abandonLunaRun(db: DatabaseSync, body: unknown, now: Date = new Date()): LunaRunView {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new LunaRunError(422, "Expected {run_id, reason}.");
  const input = body as Record<string, unknown>;
  const runId = parseRunId(input.run_id);
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason || reason.length > 500) throw new LunaRunError(422, "Abandoning a run requires a reason of 1 to 500 characters.");
  withTransaction(db, () => {
    const row = runRow(db, runId);
    const config = runConfig(row);
    if (row.status !== "pending") throw new LunaRunError(409, `Luna model run ${runId} is already ${row.status}.`);
    const execution = config.execution ?? null;
    if (execution) {
      const deadline = Date.parse(execution.started_at) + ABANDON_AFTER_MS;
      if (now.getTime() < deadline) {
        throw new LunaRunError(409, `Luna model run ${runId} is still inside its deadline; it can be abandoned after ${new Date(deadline).toISOString()}.`);
      }
    }
    const failure: LunaFailure = { stage: "abandon", reason_code: execution ? "ABANDONED_AFTER_DEADLINE" : "ABANDONED_UNCLAIMED", message: reason };
    const changed = db.prepare(`
      UPDATE model_runs SET status = 'failed', output_json = ?
      WHERE id = ? AND status = 'pending' AND json_extract(config_json, '$.execution.owner') IS ?
    `).run(JSON.stringify({ failure: { ...failure, ended_at: now.toISOString() } }), runId, execution?.owner ?? null);
    if (changed.changes !== 1) throw new LunaRunError(409, `Luna model run ${runId} changed while it was being abandoned.`);
    bumpWorkbenchRevision(db);
  });
  return lunaRunView(db, runId);
}

/** Injection points for deterministic tests; production uses the installed binary. */
export type LunaRunOptions = {
  binary?: string;
  now?: Date;
  hardKillMs?: number;
  maxTimeMs?: number;
  /**
   * Which transport executes the run's already-prepared request. `"omp"` (default) spawns the
   * `omp` CLI against the `openai-codex/gpt-5.6-luna` profile, unchanged. `"deepseek"` sends the
   * exact same request bytes (`serializeLunaRequest`'s fixed-prefix-first form; see
   * `PreparedLuna`) as the user message to DeepSeek's chat completions API instead, with the
   * request's own `instructions` as the system message — a transport swap, not a second request
   * format. Either way the reply is validated and imported through the same `importLuna`.
   */
  transport?: "omp" | "deepseek";
  /** Test injection point for the `"deepseek"` transport, mirroring `binary` for `"omp"`. */
  deepseekCall?: ModelCall;
  /**
   * The DeepSeek model id actually being called (`DEEPSEEK_MODEL` by default). The wire request's
   * `requested_model` field — which the instructions tell the model to echo back verbatim — is
   * stamped with this, not a hardcoded profile name; passing the wrong one here makes the model
   * truthfully echo a model it isn't, which `importLuna` then (correctly) rejects as a
   * self-reported/observed mismatch. Also selects the default transport when `deepseekCall` is
   * not supplied.
   */
  deepseekModel?: string;
};

/** The claimed invocation a background runner must finish. */
export type ClaimedLunaRun = { run_id: number; execution: LunaExecution };

/**
 * Probe the transport and claim the run. Throws 503 when the transport is unavailable (the
 * `omp` binary, or `DEEPSEEK_API_KEY`), before any claim.
 */
export async function startLunaRun(db: DatabaseSync, runIdValue: unknown, options: LunaRunOptions = {}): Promise<ClaimedLunaRun> {
  const runId = parseRunId(runIdValue);
  lunaRunView(db, runId);
  let version: string;
  if (options.transport === "deepseek") {
    // A test supplying its own `deepseekCall` doesn't need a real key to probe.
    if (!options.deepseekCall) {
      try {
        deepseekKey();
      } catch (error) {
        throw new LunaRunError(503, error instanceof Error ? error.message : "DEEPSEEK_API_KEY is unavailable.");
      }
    }
    version = "deepseek-transport";
  } else {
    try {
      version = await ompVersion(options.binary ?? ompBinary());
    } catch (error) {
      if (error instanceof OmpTransportError) throw new LunaRunError(503, error.message);
      throw error;
    }
  }
  return { run_id: runId, execution: claimLunaRun(db, runId, { omp_version: version, now: options.now }) };
}

function transportFailure(error: unknown): LunaFailure {
  if (error instanceof OmpTransportError) return { stage: "transport", reason_code: error.reason_code, message: error.message, exit_code: error.exit_code };
  if (error instanceof LunaRunError) return { stage: "transport", reason_code: "PRECONDITION", message: error.message };
  return { stage: "transport", reason_code: "UNEXPECTED", message: error instanceof Error ? error.message.slice(0, 500) : "Unexpected transport failure." };
}

/**
 * Execute a claimed run: spawn omp with the prepared request on stdin, parse exactly one
 * assistant JSON object, and import it under the claim's owner token. `openDb` supplies a
 * fresh connection after the subprocess, so a long invocation holds no database lock. Any
 * failure closes the run as failed with a redacted reason and imports nothing.
 */
export async function finishLunaRun(openDb: () => DatabaseSync, claimed: ClaimedLunaRun, options: LunaRunOptions = {}): Promise<LunaRunView> {
  const scratch = mkdtempSync(join(tmpdir(), "round5c-omp-"));
  let requestText: string;
  let config: RunConfig;
  {
    const db = openDb();
    try {
      config = runConfig(runRow(db, claimed.run_id));
      if (!config.request_path) throw new LunaRunError(422, "The run has no request artifact.");
      requestText = readFileSync(config.request_path, "utf8");
    } catch (error) {
      failLunaRun(db, claimed.run_id, claimed.execution.owner, transportFailure(error));
      rmSync(scratch, { recursive: true, force: true });
      const view = lunaRunView(db, claimed.run_id);
      db.close();
      return view;
    }
    db.close();
  }
  type Outcome = { body: Record<string, unknown>; model: string; cost_usd: number | null; latency_ms: number | null; usage?: DeepSeekUsage };
  let outcome: { error: unknown } | { response: Outcome };
  const transport = options.transport ?? "omp";
  try {
    const request = JSON.parse(requestText) as { instructions?: unknown };
    if (hashJson(request) !== config.input_hash) throw new LunaRunError(409, "The request artifact no longer matches the run's input hash.");
    if (typeof request.instructions !== "string" || hashJson({ instructions: request.instructions }) !== config.system_prompt_hash) {
      throw new LunaRunError(409, "The request artifact's instructions no longer match the run's system prompt hash.");
    }
    if (transport === "deepseek") {
      // Same prepared request bytes, same instructions, same envelope — only the transport
      // differs: DeepSeek's chat completions API in place of the omp/gpt-5.6-luna subprocess.
      // LUNA_INSTRUCTIONS_V2 tells the model "the user message is one JSON object
      // {input_hash, request}" and to echo input_hash back verbatim, so the user message must be
      // the same `lunaStdinEnvelope` the omp path sends on stdin, not the bare request — omitting
      // the wrapper (an earlier version of this code did) leaves the model with no input_hash to
      // echo and `importLuna` rejects the reply. `lunaStdinEnvelope` puts `request` first and
      // `input_hash` last, so `requestText`'s stable fixed-prefix-first bytes are still the
      // leading bytes of what DeepSeek actually receives — the prefix-cache property holds.
      //
      // One field is deliberately not "the same bytes": `requested_model`. The on-disk artifact
      // always carries the omp/gpt-5.6-luna profile name (prepareLuna doesn't know the transport
      // yet), and the instructions tell the model to self-report exactly that field back —
      // sending it unedited would have DeepSeek truthfully self-report a model it isn't, which
      // `importLuna` (correctly) then rejects as a self-reported/observed mismatch. Every other
      // field — instructions, registry, confirmed_examples, abilities, schema — is untouched, and
      // this substitution is identical across every deepseek-transport request in a batch, so it
      // does not disturb the shared prefix those requests still get from `serializeLunaRequest`.
      const deepseekModel = options.deepseekModel ?? DEEPSEEK_MODEL;
      const deepseekRequestText = serializeLunaRequest({ ...(request as PreparedRequest), requested_model: deepseekModel });
      const call = options.deepseekCall ?? deepseekModelCall(deepseekModel);
      const reply = await call(request.instructions, lunaStdinEnvelope(config.input_hash!, deepseekRequestText));
      outcome = { response: { body: reply.body, model: reply.model, cost_usd: reply.cost_usd, latency_ms: reply.latency_ms, usage: reply.usage } };
    } else {
      const cwd = join(scratch, "cwd");
      const configPath = join(scratch, "overlay.yml");
      const systemPromptPath = join(scratch, "system-prompt.txt");
      mkdirSync(cwd);
      writeFileSync(configPath, overlayYaml(), "utf8");
      writeFileSync(systemPromptPath, request.instructions, "utf8");
      const requestedModel = config.requested_model ?? LUNA_MODEL;
      const processResult = await runOmpProcess({
        binary: options.binary,
        args: ompArgs({ model: requestedModel, cwd, configPath, systemPromptPath, maxTimeMs: options.maxTimeMs }),
        cwd: scratch,
        stdin: lunaStdinEnvelope(config.input_hash!, requestText),
        hardKillMs: options.hardKillMs,
      });
      const response = extractAssistantJson(processResult.stdout, requestedModel);
      if (response.latency_ms === null) response.latency_ms = processResult.duration_ms;
      outcome = { response };
    }
  } catch (error) {
    outcome = { error };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const db = openDb();
  try {
    // `dropped_covered_spans` leaves no row (a silent, by-design drop), so `lunaRunView`'s
    // DB-recomputed summary can't see it; capture it from the live `importLuna` call instead and
    // overlay it on the view this function returns.
    let liveDroppedCoveredSpans: number | null = null;
    if ("error" in outcome) {
      const accounting = outcome.error instanceof DeepSeekCallError ? outcome.error.accounting : undefined;
      failLunaRun(db, claimed.run_id, claimed.execution.owner, transportFailure(outcome.error), accounting);
    } else {
      const version = transport === "deepseek" ? outcome.response.model : claimed.execution.omp_version ?? "unknown";
      try {
        if (transport === "deepseek") {
          // `importLuna` checks the reply's observed model against the run's own
          // `requested_model`, which `prepareLuna` always stamps as the omp/gpt-5.6-luna profile
          // (chosen at prepare time, before a transport is picked). The transport is chosen here,
          // at run time, so this run's expectation is corrected to match before import — the
          // request itself (instructions, abilities, schema) is untouched.
          db.prepare("UPDATE model_runs SET config_json = json_set(config_json, '$.requested_model', ?) WHERE id = ?")
            .run(outcome.response.model, claimed.run_id);
        }
        assertSourcesCurrent(db, config);
        const imported = importLuna(db, { run_id: String(claimed.run_id), response: outcome.response.body }, {
          owner: claimed.execution.owner,
          model: outcome.response.model,
          model_version: version,
          latency_ms: outcome.response.latency_ms,
          cost_usd: outcome.response.cost_usd,
        });
        liveDroppedCoveredSpans = imported.dropped_covered_spans;
      } catch (error) {
        // importLuna already failed the run for invalid content; stale source fails here.
        if (error instanceof LunaRunError && error.status === 409 && /changed after this run/u.test(error.message)) {
          failLunaRun(db, claimed.run_id, claimed.execution.owner, { stage: "import", reason_code: "SOURCE_STALE", message: error.message });
        }
      }
    }
    if (!("error" in outcome)) {
      // The reply was billed whether or not it imported: keep its usage and cost on the run, also
      // when import rejected the response and closed the run without them.
      db.prepare(`
        UPDATE model_runs SET cost_usd = COALESCE(cost_usd, ?), latency_ms = COALESCE(latency_ms, ?),
          output_json = json_set(COALESCE(output_json, '{}'), '$.usage', json(?))
        WHERE id = ?
      `).run(outcome.response.cost_usd, outcome.response.latency_ms, JSON.stringify(outcome.response.usage ?? null), claimed.run_id);
    }
    const view = lunaRunView(db, claimed.run_id);
    return liveDroppedCoveredSpans !== null && view.summary
      ? { ...view, summary: { ...view.summary, dropped_covered_spans: liveDroppedCoveredSpans } }
      : view;
  } finally {
    db.close();
  }
}

/** Claim and fully execute one run; used by the CLI, which waits for the result. */
export async function runLuna(openDb: () => DatabaseSync, runIdValue: unknown, options: LunaRunOptions = {}): Promise<LunaRunView> {
  const db = openDb();
  let claimed: ClaimedLunaRun;
  try {
    claimed = await startLunaRun(db, runIdValue, options);
  } finally {
    db.close();
  }
  return finishLunaRun(openDb, claimed, options);
}

/** The latest source-decomposition run that requested one ability version, if any. */
export function latestLunaRunForAbility(db: DatabaseSync, abilityVersionId: number): LunaRunView | null {
  if (!Number.isSafeInteger(abilityVersionId) || abilityVersionId < 1) throw new LunaRunError(422, "ability_version_id must be positive.");
  const row = db.prepare(`
    SELECT model_runs.id FROM model_runs, json_each(model_runs.config_json, '$.request_abilities') AS request_ability
    WHERE json_extract(request_ability.value, '$.ability_version_id') = ?
    ORDER BY model_runs.id DESC LIMIT 1
  `).get(abilityVersionId) as { id: number } | undefined;
  return row ? lunaRunView(db, row.id) : null;
}
