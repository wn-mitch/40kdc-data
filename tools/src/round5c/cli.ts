import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { WorkPurpose } from "./contracts.js";
import type { DatabaseSync } from "node:sqlite";
import { openWorkbench } from "./db.js";
import { importHitTrain, repairRelatedVariantProposals } from "./migration.js";
import { abandonLunaRun, lunaRunView, runLuna } from "./luna-run.js";
import { importLuna, prepareLuna, type LunaMode, type PrepareLunaOptions } from "./proposal.js";
import { getQueue } from "./queue.js";
import { getDashboard, getPrivateExport } from "./review.js";
import { getPublicationReport, preparePublication, publishPublication, reconcilePublicationBatches } from "./publish.js";
import { refreshSources } from "./source.js";
import { hashJson } from "../round4/hash.js";
import { applyStamps, approveStamp, previewStamp, stampApprovalEligibility } from "./stamps.js";
import { importWork, prepareWork } from "./work.js";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));

function prepareWorkOptions(args: string[]): { purpose: WorkPurpose; limit?: number; ids?: string[]; retry_reason?: string } {
  const purpose = args[0] as WorkPurpose | undefined;
  if (!purpose) throw new Error("prepare-work requires a purpose.");
  const options: { purpose: WorkPurpose; limit?: number; ids?: string[]; retry_reason?: string } = { purpose };
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag || value === undefined) throw new Error(`prepare-work flag ${flag ?? "<missing>"} requires a value.`);
    if (flag === "--limit") options.limit = Number(value);
    else if (flag === "--ids") options.ids = value.split(",").map((id) => id.trim()).filter(Boolean);
    else if (flag === "--retry-reason") options.retry_reason = value;
    else throw new Error(`Unknown prepare-work flag ${flag}.`);
  }
  return options;
}
function prepareLunaOptions(args: string[]): PrepareLunaOptions {
  const positional: string[] = [];
  const options: PrepareLunaOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--ability" || arg === "--retry-of") {
      const value = Number(args[index + 1]);
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${arg} requires a positive integer.`);
      if (arg === "--ability") options.ability_version_id = value;
      else options.retry_of = value;
      index += 1;
    } else positional.push(arg);
  }
  options.limit = positional[0] ? Number(positional[0]) : 12;
  options.mode = (positional[1] ?? "coverage") as LunaMode;
  if (positional[2]) options.faction_id = positional[2];
  return options;
}

function preparePublicationOptions(args: string[]): { faction_id: string; draft_ids: string[]; reauthor: boolean } {
  const factionId = args[0];
  const serializedDraftIds = args[1];
  if (!factionId || !serializedDraftIds) {
    throw new Error("prepare-publication requires a faction id and comma-separated draft ids.");
  }
  const flags = args.slice(2);
  if (flags.some((flag) => flag !== "--reauthor")) throw new Error(`Unknown prepare-publication flag ${flags.find((flag) => flag !== "--reauthor")}.`);
  const draftIds = serializedDraftIds.split(",").map((id) => id.trim()).filter(Boolean);
  return { faction_id: factionId, draft_ids: draftIds, reauthor: flags.includes("--reauthor") };
}

type BenchPage = { cursor: string | null; ms: number; preview_hash: string; examples: unknown[] };

function elapsed<T>(work: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = work();
  return { value, ms: Math.round((performance.now() - started) * 10) / 10 };
}

/** Digest of every derived-leaf row, so approval equivalence is checked beyond the returned counts. */
function derivedStateDigest(db: DatabaseSync): string {
  return hashJson({
    applications: db.prepare("SELECT id, stamp_id, stamp_revision, ability_version_id, annotation_id, status, inputs_hash FROM stamp_applications ORDER BY id").all(),
    annotations: db.prepare("SELECT id, span_id, fingerprint_id, status, authority_kind, origin FROM annotations WHERE authority_kind = 'stamp' ORDER BY id").all(),
  });
}

/**
 * Time every stamp preview page (plus a repeat of page one) and, with --approve, the first
 * approvable proposed stamp. Writes nothing unless --approve, and refuses to run against the
 * default workbench: the output is an equivalence oracle, so it must come from a disposable copy.
 */
function benchStamps(db: DatabaseSync, approve: boolean): Record<string, unknown> {
  if (!process.env.ROUND5C_DB) throw new Error("bench-stamps requires ROUND5C_DB to point at a disposable workbench copy.");
  const rows = db.prepare("SELECT id, revision, status FROM stamps ORDER BY id, revision").all() as Array<{ id: string; revision: number; status: string }>;
  const stamps = rows.filter((row) => row.status === "proposed" || row.status === "approved").map((row) => {
    const pages: BenchPage[] = [];
    let cursor: string | null = null;
    let totals: unknown = null;
    do {
      const { value, ms } = elapsed(() => previewStamp(db, row.id, row.revision, cursor ? { cursor } : {}));
      pages.push({ cursor, ms, preview_hash: value.preview_hash, examples: value.examples });
      totals = value.totals;
      cursor = value.next_cursor;
    } while (cursor);
    const repeat = elapsed(() => previewStamp(db, row.id, row.revision));
    return { stamp_id: row.id, revision: row.revision, status: row.status, totals, pages, repeat_ms: repeat.ms, repeat_hash: repeat.value.preview_hash };
  });
  let approval: Record<string, unknown> | null = null;
  if (approve) {
    const target = rows.find((row) => row.status === "proposed" && stampApprovalEligibility(db, row.id, row.revision).approvable);
    if (!target) throw new Error("bench-stamps --approve found no approvable proposed stamp.");
    const preview = elapsed(() => previewStamp(db, target.id, target.revision));
    const result = elapsed(() => approveStamp(db, target.id, target.revision, { reviewer: "bench", preview_hash: preview.value.preview_hash }));
    const { approval_batch_id: _batch, ...counts } = result.value;
    approval = { stamp_id: target.id, revision: target.revision, preview_ms: preview.ms, approve_ms: result.ms, counts, derived_state: derivedStateDigest(db) };
  }
  return { stamps, approval };
}

async function run(command: string | undefined): Promise<void> {
  const commands = ["init", "refresh", "import-hit-train", "repair-related-variants", "prepare-luna", "import-luna", "run-luna", "abandon-luna", "luna-status", "prepare-work", "import-work", "apply-stamps", "prepare-publication", "publish", "export-json", "report", "bench-stamps", "queue"];
  if (!command || !commands.includes(command)) {
    throw new Error("Usage: round5c <init|refresh|import-hit-train|repair-related-variants|prepare-luna [limit] [coverage|residue] [faction-id] [--ability id] [--retry-of run-id]|import-luna <run-id> <response.json>|run-luna <run-id>|abandon-luna <run-id> <reason>|luna-status <run-id>|prepare-work <purpose> [--limit N] [--ids id,...] [--retry-reason text]|import-work <run-id> <response.json>|apply-stamps|prepare-publication <faction-id> <draft-id,...> [--reauthor]|publish <batch-id> <preview-hash>|export-json|report|bench-stamps [--approve]|queue [faction-id]>");
  }
  const db = openWorkbench();
  try {
    if (command === "init") {
      console.log("Round 5C private database initialized.");
    } else if (command === "refresh") {
      console.log(JSON.stringify(refreshSources(db), null, 2));
    } else if (command === "import-hit-train") {
      console.log(JSON.stringify(importHitTrain(db, resolve(root, "_private/round5b-hit-roll")), null, 2));
    } else if (command === "repair-related-variants") {
      console.log(JSON.stringify(repairRelatedVariantProposals(db), null, 2));
    } else if (command === "prepare-luna") {
      const prepared = prepareLuna(db, prepareLunaOptions(process.argv.slice(3)));
      console.log(JSON.stringify({ run_id: prepared.run_id, input_hash: prepared.input_hash, request_path: prepared.request_path }, null, 2));
    } else if (command === "run-luna") {
      const runId = process.argv[3];
      if (!runId) throw new Error("run-luna requires a run id.");
      console.log(JSON.stringify(await runLuna(() => openWorkbench(), runId), null, 2));
    } else if (command === "abandon-luna") {
      const runId = process.argv[3];
      const reason = process.argv.slice(4).join(" ");
      if (!runId || !reason) throw new Error("abandon-luna requires a run id and a reason.");
      console.log(JSON.stringify(abandonLunaRun(db, { run_id: runId, reason }), null, 2));
    } else if (command === "luna-status") {
      if (!process.argv[3]) throw new Error("luna-status requires a run id.");
      console.log(JSON.stringify(lunaRunView(db, process.argv[3]), null, 2));
    } else if (command === "import-luna") {
      const runId = process.argv[3];
      const file = process.argv[4];
      if (!runId || !file) throw new Error("import-luna requires a run id and a response JSON file.");
      console.log(JSON.stringify(importLuna(db, { run_id: runId, response: JSON.parse(readFileSync(file, "utf8")) }), null, 2));
    } else if (command === "prepare-work") {
      const prepared = await prepareWork(db, prepareWorkOptions(process.argv.slice(3)));
      console.log(JSON.stringify({
        run_id: prepared.run_id,
        input_hash: prepared.input_hash,
        request_path: prepared.request_path,
        reused: prepared.reused,
        status: prepared.status,
        oversized: prepared.oversized,
      }, null, 2));
    } else if (command === "import-work") {
      const runId = process.argv[3];
      const file = process.argv[4];
      if (!runId || !file) throw new Error("import-work requires a run id and a response JSON file.");
      console.log(JSON.stringify(await importWork(db, { run_id: runId, response: JSON.parse(readFileSync(file, "utf8")) }), null, 2));
    } else if (command === "apply-stamps") {
      console.log(JSON.stringify(await applyStamps(db), null, 2));
    } else if (command === "prepare-publication") {
      console.log(JSON.stringify(await preparePublication(db, preparePublicationOptions(process.argv.slice(3))), null, 2));
    } else if (command === "publish") {
      const batchId = process.argv[3];
      const previewHash = process.argv[4];
      if (!batchId || !previewHash) throw new Error("publish requires a batch id and preview hash.");
      console.log(JSON.stringify(await publishPublication(db, { batch_id: batchId, preview_hash: previewHash }), null, 2));
    } else if (command === "queue") {
      const started = performance.now();
      const queue = getQueue(db, { factionId: process.argv[3], limit: 200 });
      console.error(`queue computed in ${Math.round(performance.now() - started)} ms`);
      console.log(JSON.stringify(queue, null, 2));
    } else if (command === "bench-stamps") {
      console.log(JSON.stringify(benchStamps(db, process.argv.slice(3).includes("--approve")), null, 2));
    } else if (command === "export-json") {
      const path = resolve(root, "_private/round5c/export.json");
      const exported = getPrivateExport(db);
      writeFileSync(path, `${JSON.stringify(exported, null, 2)}\n`);
      console.log(JSON.stringify({
        exported: path,
        schema_version: exported.schema_version,
        annotations: Array.isArray(exported.annotations) ? exported.annotations.length : 0,
        stamps: Array.isArray(exported.stamps) ? exported.stamps.length : 0,
        applications: Array.isArray(exported.applications) ? exported.applications.length : 0,
        drafts: Array.isArray(exported.drafts) ? exported.drafts.length : 0,
      }));
    } else {
      const recovery = reconcilePublicationBatches(db);
      console.log(JSON.stringify({
        ...getDashboard(db),
        publications: getPublicationReport(db),
        publication_recovery: recovery,
      }, null, 2));
    }
  } finally {
    db.close();
  }
}

await run(process.argv[2]);
