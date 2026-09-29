import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openWorkbench } from "./db.js";
import { importHitTrain, repairRelatedVariantProposals } from "./migration.js";
import { abandonLunaRun, lunaRunView, runLuna } from "./luna-run.js";
import { importLuna, prepareLuna, type LunaMode, type PrepareLunaOptions } from "./proposal.js";
import { getQueue } from "./queue.js";
import { getDashboard, getPrivateExport } from "./review.js";
import { getPublicationReport, preparePublication, publishPublication, reconcilePublicationBatches } from "./publish.js";
import { leafDescriberAudit } from "./leaf-describer-audit.js";
import { runLeafProposals } from "./leaf-proposals.js";
import { localEmbedder } from "./embeddings.js";
import { reapplyLeafSurfaces } from "./leaves.js";
import { refreshSources } from "./source.js";
import { runGatesOnly, runPipeline8b } from "./pipeline-8b.js";
import { selectPilotSample, type PilotSample } from "./pilot-sample.js";
import { buildTypeSafeClient, pilotSpans, runJevProposer } from "./jev-proposer.js";
import { runDeepSeekArm } from "./deepseek-pilot.js";
import { calibrateThreshold } from "./jev-v2-segment.js";
import { runJevV2Rounds } from "./jev-v2-rounds.js";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));

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

function preparePublicationOptions(args: string[]): { faction_id: string; entry_ids: string[] } {
  const factionId = args[0];
  const serializedEntryIds = args[1];
  if (!factionId || !serializedEntryIds || args.length > 2) {
    throw new Error("prepare-publication requires a faction id and comma-separated compiled entry ids.");
  }
  return { faction_id: factionId, entry_ids: serializedEntryIds.split(",").map((id) => id.trim()).filter(Boolean) };
}

async function run(command: string | undefined): Promise<void> {
  const commands = ["init", "refresh", "import-hit-train", "repair-related-variants", "prepare-luna", "import-luna", "run-luna", "abandon-luna", "luna-status", "prepare-publication", "publish", "export-json", "report", "queue", "leaf-describer-audit", "leaf-proposals", "pipeline-8b", "pipeline-8b-gates-only", "pilot-sample", "jev-pilot", "deepseek-pilot", "calibrate-segmentation", "jev-v2-pilot"];
  if (!command || !commands.includes(command)) {
    throw new Error("Usage: round5c <init|refresh|import-hit-train|repair-related-variants|prepare-luna [limit] [coverage|residue] [faction-id] [--ability id] [--retry-of run-id]|import-luna <run-id> <response.json>|run-luna <run-id>|abandon-luna <run-id> <reason>|luna-status <run-id>|prepare-publication <faction-id> <compiled-entry-id,...>|publish <batch-id> <preview-hash>|export-json|report|queue [faction-id]|leaf-describer-audit|leaf-proposals|pipeline-8b|pipeline-8b-gates-only [sample.json]|pilot-sample [seed] [target-size]|jev-pilot <sample.json> [spend-cap-usd]|deepseek-pilot <sample.json> [max-requests] [spend-cap-usd] [abilities-per-request] [concurrency]|calibrate-segmentation [max-abilities]|jev-v2-pilot <sample.json> <threshold> [spend-cap-usd] [max-rounds]>");
  }
  if (command === "leaf-describer-audit") {
    // Depends only on the registry and the describer, not on the workbench database.
    console.log(JSON.stringify(leafDescriberAudit(), null, 2));
    return;
  }
  const db = openWorkbench();
  try {
    if (command === "init") {
      console.log("Round 5C private database initialized.");
    } else if (command === "refresh") {
      console.log(JSON.stringify({ ...refreshSources(db), leaf_surfaces: reapplyLeafSurfaces(db) }, null, 2));
    } else if (command === "import-hit-train") {
      console.log(JSON.stringify(importHitTrain(db, resolve(root, "_private/round5b-hit-roll")), null, 2));
    } else if (command === "leaf-proposals") {
      const started = Date.now();
      const result = await runLeafProposals(db, localEmbedder());
      console.log(JSON.stringify({ ...result, seconds: Math.round((Date.now() - started) / 100) / 10 }, null, 2));
    } else if (command === "pipeline-8b") {
      const started = Date.now();
      const result = await runPipeline8b(db);
      console.log(JSON.stringify({ ...result, seconds: Math.round((Date.now() - started) / 100) / 10 }, null, 2));
    } else if (command === "pipeline-8b-gates-only") {
      const samplePath = process.argv[3];
      const abilityVersionIds = samplePath
        ? new Set((JSON.parse(readFileSync(samplePath, "utf8")) as PilotSample).abilities.map((ability) => ability.ability_version_id))
        : undefined;
      const started = Date.now();
      const result = await runGatesOnly(db, { abilityVersionIds });
      console.log(JSON.stringify({ ...result, seconds: Math.round((Date.now() - started) / 100) / 10 }, null, 2));
    } else if (command === "pilot-sample") {
      const seed = process.argv[3] ? Number(process.argv[3]) : undefined;
      const targetSize = process.argv[4] ? Number(process.argv[4]) : undefined;
      console.log(JSON.stringify(selectPilotSample(db, { seed, targetSize }), null, 2));
    } else if (command === "jev-pilot") {
      const samplePath = process.argv[3];
      if (!samplePath) throw new Error("jev-pilot requires a pilot sample JSON path.");
      const spendCapUsd = process.argv[4] ? Number(process.argv[4]) : undefined;
      const sample = JSON.parse(readFileSync(samplePath, "utf8")) as PilotSample;
      const spans = pilotSpans(db, sample.abilities);
      const client = buildTypeSafeClient();
      const started = Date.now();
      const result = await runJevProposer(client, spans, { spendCapUsd });
      console.log(JSON.stringify({ ...result, wall_seconds: Math.round((Date.now() - started) / 100) / 10 }, null, 2));
    } else if (command === "deepseek-pilot") {
      const samplePath = process.argv[3];
      if (!samplePath) throw new Error("deepseek-pilot requires a pilot sample JSON path.");
      const maxRequests = process.argv[4] ? Number(process.argv[4]) : undefined;
      const spendCapUsd = process.argv[5] ? Number(process.argv[5]) : undefined;
      const abilitiesPerRequest = process.argv[6] ? Number(process.argv[6]) : undefined;
      const concurrency = process.argv[7] ? Number(process.argv[7]) : undefined;
      const sample = JSON.parse(readFileSync(samplePath, "utf8")) as PilotSample;
      const abilityVersionIds = new Set(sample.abilities.map((ability) => ability.ability_version_id));
      const started = Date.now();
      const result = await runDeepSeekArm(db, () => openWorkbench(), abilityVersionIds, { maxRequests, spendCapUsd, abilitiesPerRequest, concurrency });
      console.log(JSON.stringify({ ...result, wall_seconds: Math.round((Date.now() - started) / 100) / 10 }, null, 2));
    } else if (command === "calibrate-segmentation") {
      const maxAbilities = process.argv[3] ? Number(process.argv[3]) : undefined;
      console.log(JSON.stringify(await calibrateThreshold(db, localEmbedder(), { maxAbilities }), null, 2));
    } else if (command === "jev-v2-pilot") {
      const samplePath = process.argv[3];
      const threshold = process.argv[4] ? Number(process.argv[4]) : undefined;
      if (!samplePath || threshold === undefined) throw new Error("jev-v2-pilot requires a pilot sample JSON path and a calibrated segmentation threshold.");
      const spendCapUsd = process.argv[5] ? Number(process.argv[5]) : undefined;
      const maxRounds = process.argv[6] ? Number(process.argv[6]) : undefined;
      const sample = JSON.parse(readFileSync(samplePath, "utf8")) as PilotSample;
      const client = buildTypeSafeClient();
      const started = Date.now();
      const result = await runJevV2Rounds(db, localEmbedder(), client, sample.abilities, { segmentationThreshold: threshold, spendCapUsd, maxRounds });
      console.log(JSON.stringify({ ...result, wall_seconds: Math.round((Date.now() - started) / 100) / 10 }, null, 2));
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
    } else if (command === "export-json") {
      const path = resolve(root, "_private/round5c/export.json");
      const exported = getPrivateExport(db);
      writeFileSync(path, `${JSON.stringify(exported, null, 2)}\n`);
      console.log(JSON.stringify({
        exported: path,
        schema_version: exported.schema_version,
        annotations: Array.isArray(exported.annotations) ? exported.annotations.length : 0,
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
