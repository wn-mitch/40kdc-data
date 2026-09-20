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
import { failLunaRun, importLuna, type LunaExecution, type LunaFailure, type LunaImportSummary } from "./proposal.js";

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
  return {
    proposals: proposals.filter((row) => row.status !== "unresolved").reduce((total, row) => total + Number(row.total), 0),
    unresolved: proposals.filter((row) => row.status === "unresolved").reduce((total, row) => total + Number(row.total), 0),
    structural: Number(structural.total),
    candidates: Number(candidates.total),
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
};

/** The claimed invocation a background runner must finish. */
export type ClaimedLunaRun = { run_id: number; execution: LunaExecution };

/**
 * Probe the binary and claim the run. Throws 503 when omp is unavailable, before any claim.
 */
export async function startLunaRun(db: DatabaseSync, runIdValue: unknown, options: LunaRunOptions = {}): Promise<ClaimedLunaRun> {
  const runId = parseRunId(runIdValue);
  lunaRunView(db, runId);
  let version: string;
  try {
    version = await ompVersion(options.binary ?? ompBinary());
  } catch (error) {
    if (error instanceof OmpTransportError) throw new LunaRunError(503, error.message);
    throw error;
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
  let outcome: { error: unknown } | { response: ReturnType<typeof extractAssistantJson> };
  try {
    const request = JSON.parse(requestText) as { instructions?: unknown };
    if (hashJson(request) !== config.input_hash) throw new LunaRunError(409, "The request artifact no longer matches the run's input hash.");
    if (typeof request.instructions !== "string" || hashJson({ instructions: request.instructions }) !== config.system_prompt_hash) {
      throw new LunaRunError(409, "The request artifact's instructions no longer match the run's system prompt hash.");
    }
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
  } catch (error) {
    outcome = { error };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const db = openDb();
  try {
    if ("error" in outcome) {
      failLunaRun(db, claimed.run_id, claimed.execution.owner, transportFailure(outcome.error));
    } else {
      const version = claimed.execution.omp_version ?? "unknown";
      try {
        assertSourcesCurrent(db, config);
        importLuna(db, { run_id: String(claimed.run_id), response: outcome.response.body }, {
          owner: claimed.execution.owner,
          model: outcome.response.model,
          model_version: version,
          latency_ms: outcome.response.latency_ms,
          cost_usd: outcome.response.cost_usd,
        });
      } catch (error) {
        // importLuna already failed the run for invalid content; stale source fails here.
        if (error instanceof LunaRunError && error.status === 409 && /changed after this run/u.test(error.message)) {
          failLunaRun(db, claimed.run_id, claimed.execution.owner, { stage: "import", reason_code: "SOURCE_STALE", message: error.message });
        }
      }
    }
    return lunaRunView(db, claimed.run_id);
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
