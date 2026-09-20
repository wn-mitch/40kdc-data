import type { DatabaseSync } from "node:sqlite";

import { runDeepSeekWork, WorkError, type WorkImportReport } from "./work.js";

/**
 * Background execution of prepared DeepSeek work runs. A request only validates and starts a
 * job; the model call runs on its own connection, and the page polls `workJobView`. Nothing
 * holds a database transaction or the browser's write lock while the model is thinking.
 */

export type WorkJob = {
  run_id: string;
  state: "running" | "completed" | "failed";
  started_at: string;
  finished_at: string | null;
  report: WorkImportReport | null;
  /** Why the last attempt failed; the prepared run stays pending and can be run again. */
  error: string | null;
};

const jobs = new Map<string, WorkJob>();

function parseRunId(value: unknown): string {
  const runId = typeof value === "number" ? String(value) : value;
  if (typeof runId !== "string" || !/^[1-9]\d*$/u.test(runId) || !Number.isSafeInteger(Number(runId))) {
    throw new WorkError(422, "run_id must be a model run ID.");
  }
  return runId;
}

/**
 * Validate a prepared run and start it in the background. Refuses a missing key (503), an
 * unknown (404) or terminal (409) run, and a run this server is already executing (409).
 */
export function startWorkJob(db: DatabaseSync, openDb: () => DatabaseSync, body: unknown, run = runDeepSeekWork): WorkJob {
  const input = body !== null && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const runId = parseRunId(input.run_id);
  if (!process.env.DEEPSEEK_API_KEY) throw new WorkError(503, "DEEPSEEK_API_KEY is not configured on the workbench server.");
  const row = db.prepare("SELECT status FROM model_runs WHERE id = ?").get(Number(runId)) as { status: string } | undefined;
  if (!row) throw new WorkError(404, `Unknown work run ${runId}.`);
  if (row.status !== "pending") throw new WorkError(409, `Work run ${runId} is already ${row.status}.`);
  if (jobs.get(runId)?.state === "running") throw new WorkError(409, `Work run ${runId} is already running.`);
  const job: WorkJob = { run_id: runId, state: "running", started_at: new Date().toISOString(), finished_at: null, report: null, error: null };
  jobs.set(runId, job);
  void (async () => {
    const jobDb = openDb();
    try {
      job.report = await run(jobDb, { run_id: runId });
      job.state = "completed";
    } catch (error) {
      job.state = "failed";
      job.error = error instanceof Error ? error.message : String(error);
    } finally {
      job.finished_at = new Date().toISOString();
      jobDb.close();
    }
  })();
  return { ...job };
}

/** The persisted run status plus this server's latest job for it, if any. */
export function workJobView(db: DatabaseSync, runIdValue: unknown): { run_id: string; status: string; purpose: string | null; item_ids: string[]; job: WorkJob | null } {
  const runId = parseRunId(runIdValue);
  const row = db.prepare("SELECT status, config_json FROM model_runs WHERE id = ?").get(Number(runId)) as { status: string; config_json: string } | undefined;
  if (!row) throw new WorkError(404, `Unknown work run ${runId}.`);
  const config = JSON.parse(row.config_json) as { purpose?: string; items?: Array<{ item_id?: string }> };
  const job = jobs.get(runId);
  return {
    run_id: runId,
    status: row.status,
    purpose: config.purpose ?? null,
    item_ids: (config.items ?? []).map((item) => item.item_id ?? "").filter(Boolean),
    job: job ? { ...job } : null,
  };
}
