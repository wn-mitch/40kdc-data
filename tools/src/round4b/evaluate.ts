import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildFrozenModelPrompt } from "./prepare-model.js";
import { ALL_MODEL_IDS, REQUIRED_MODEL_IDS, asRecord, parseModelArtifact } from "./shared.js";
import { hashFile, hashJson, verifyHash } from "./hash.js";
import { readJson, readRunManifest, writeJson } from "./manifest.js";
import {
  DATASET_PATH,
  EVALUATOR_ANNOTATIONS_PATH,
  EVALUATOR_ROOT,
  MANIFEST_PATH,
  MODEL_INPUT_PATH,
  MODEL_OUTPUT_ROOT,
  MODEL_PROMPT_PATH,
  ROUND4B_ROOT,
} from "./paths.js";
import type { FrozenDataset, ModelOutputEnvelope, SourceOnlyModelInput } from "./contracts.js";
import { analyseAgreement } from "./agreement.js";
import { assembleGraphs } from "./assembly.js";
import { evaluateModelArtifacts, type AnnotationArtifact } from "./evaluation.js";
import { renderRound4BReport, type Round4ABaseline } from "./report.js";
import {
  generateEscalationTickets,
  simulateRouting,
  type OptionalStageArtifact,
} from "./routing.js";

const MODEL_FILE_NAMES: Record<(typeof ALL_MODEL_IDS)[number], string> = {
  luna: "round4b-luna-output.json",
  "silver-a": "round4b-silver-a-output.json",
  "silver-b": "round4b-silver-b-output.json",
  "silver-c": "round4b-silver-c-output.json",
  "sol-ceiling": "round4b-sol-ceiling-output.json",
};

const OUTPUT_PATHS = {
  modelEvaluation: join(EVALUATOR_ROOT, "round4b-model-evaluation.json"),
  agreement: join(EVALUATOR_ROOT, "round4b-agreement-analysis.json"),
  assembly: join(EVALUATOR_ROOT, "round4b-assembly-results.json"),
  control: join(EVALUATOR_ROOT, "round4b-adjudicated-atom-control.json"),
  jev: join(EVALUATOR_ROOT, "round4b-jev-adjudication.json"),
  terra: join(EVALUATOR_ROOT, "round4b-terra-adjudication.json"),
  tickets: join(EVALUATOR_ROOT, "round4b-terra-escalation-tickets.json"),
  routing: join(EVALUATOR_ROOT, "round4b-routing-simulation.json"),
  evaluation: join(EVALUATOR_ROOT, "round4b-evaluation.json"),
  report: join(EVALUATOR_ROOT, "round4b-report.md"),
};

function optionalPath(stage: "jev" | "terra"): string | null {
  const environment = stage === "jev" ? process.env.ROUND4B_JEV_RESULTS_PATH : process.env.ROUND4B_TERRA_RESULTS_PATH;
  const candidates = [
    environment,
    join(EVALUATOR_ROOT, `round4b-${stage}-results.json`),
    join(ROUND4B_ROOT, stage, `round4b-${stage}-results.json`),
    join(MODEL_OUTPUT_ROOT, `round4b-${stage}-output.json`),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function optionalStage(stage: "jev" | "terra"): OptionalStageArtifact {
  const sourcePath = optionalPath(stage);
  if (!sourcePath) {
    const reason = stage === "jev"
      ? "Not run: the frozen replacement-vs-coexistence tickets lack a self-contained candidate relation proposition, so a Jev call would require inventing evaluator-side inputs after model execution."
      : "terra staged artifact is absent";
    return { status: "not_run", source_path: null, source_hash: null, calls: null, latency_ms: null, cost_usd: null, resolved_ticket_ids: [], raw: null, reason };
  }
  let raw: unknown;
  try {
    raw = readJson<unknown>(sourcePath);
  } catch (error) {
    return { status: "invalid", source_path: sourcePath, source_hash: hashFile(sourcePath), calls: null, latency_ms: null, cost_usd: null, resolved_ticket_ids: [], raw: null, reason: error instanceof Error ? error.message : String(error) };
  }
  const object = asRecord(raw);
  if (!object) return { status: "invalid", source_path: sourcePath, source_hash: hashFile(sourcePath), calls: null, latency_ms: null, cost_usd: null, resolved_ticket_ids: [], raw, reason: `${stage} staged artifact is not an object` };
  if (object.status === "not_run") return { status: "not_run", source_path: sourcePath, source_hash: hashFile(sourcePath), calls: null, latency_ms: null, cost_usd: null, resolved_ticket_ids: [], raw, reason: typeof object.reason === "string" ? object.reason : `${stage} staged artifact reports not_run` };
  const requestHashes = Array.isArray(object.request_hashes) && object.request_hashes.every((value) => typeof value === "string") ? object.request_hashes : [];
  const calls = typeof object.calls === "number" && Number.isInteger(object.calls) && object.calls >= 0
    ? object.calls
    : requestHashes.length || null;
  const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const resolvedTicketIds = Array.isArray(object.resolved_ticket_ids) && object.resolved_ticket_ids.every((value) => typeof value === "string") ? object.resolved_ticket_ids : [];
  return {
    status: "complete",
    source_path: sourcePath,
    source_hash: hashFile(sourcePath),
    calls,
    latency_ms: numberOrNull(object.latency_ms),
    cost_usd: numberOrNull(object.cost_usd),
    resolved_ticket_ids: resolvedTicketIds,
    raw,
  };
}

function readArtifacts(): Record<string, unknown> {
  const artifacts: Record<string, unknown> = {};
  for (const modelId of ALL_MODEL_IDS) {
    const path = join(MODEL_OUTPUT_ROOT, MODEL_FILE_NAMES[modelId]);
    if (existsSync(path)) artifacts[modelId] = readJson<unknown>(path);
  }
  return artifacts;
}

function extractedOutputs(artifacts: Record<string, unknown>): Record<string, ModelOutputEnvelope[]> {
  const output: Record<string, ModelOutputEnvelope[]> = {};
  for (const [modelId, value] of Object.entries(artifacts)) {
    const parsed = parseModelArtifact(value);
    output[modelId] = parsed.value?.records ?? [];
  }
  return output;
}

function readRound4ABaseline(): Round4ABaseline {
  const path = process.env.ROUND4B_ROUND4A_BASELINE_PATH ?? join(ROUND4B_ROOT, "..", "round4", "round4-report.md");
  if (!existsSync(path)) return { status: "not_available", source_hash: null, verdicts: [] };
  const verdicts = readFileSync(path, "utf8").split("\n").filter((line) => /^\d+\. /u.test(line)).slice(0, 10);
  return { status: "available", source_hash: hashFile(path), verdicts };
}

function assertFrozenInputs(dataset: FrozenDataset, input: SourceOnlyModelInput): string {
  const manifest = readRunManifest(MANIFEST_PATH);
  verifyHash("Round 4B frozen dataset", manifest.dataset_hash, hashFile(DATASET_PATH));
  verifyHash("Round 4B model input", manifest.model_input_hash, hashFile(MODEL_INPUT_PATH));
  if (dataset.run_id !== manifest.run_id || dataset.cohort_hash !== manifest.cohort_hash) throw new Error("Round 4B dataset does not match frozen manifest identity");
  if (input.run_id !== dataset.run_id || input.cohort_hash !== dataset.cohort_hash) throw new Error("Round 4B model input does not match frozen dataset identity");
  const promptHash = hashJson(buildFrozenModelPrompt(input));
  if (existsSync(MODEL_PROMPT_PATH)) verifyHash("Round 4B frozen model prompt", promptHash, hashJson(readJson<unknown>(MODEL_PROMPT_PATH)));
  if (manifest.annotation_hash) verifyHash("Round 4B evaluator annotations", manifest.annotation_hash, hashFile(EVALUATOR_ANNOTATIONS_PATH));
  const modelStage = manifest.stages.find((stage) => stage.stage === "model");
  if (modelStage) {
    if (modelStage.prompt_hash !== promptHash) throw new Error("Round 4B model stage prompt hash does not match frozen prompt");
    for (const [modelId, expectedHash] of Object.entries(modelStage.output_hashes)) {
      const fileName = MODEL_FILE_NAMES[modelId as keyof typeof MODEL_FILE_NAMES];
      if (!fileName) continue;
      verifyHash(`Round 4B ${modelId} model artifact`, expectedHash, hashFile(join(MODEL_OUTPUT_ROOT, fileName)));
    }
  }
  return promptHash;
}

function corpusSize(dataset: FrozenDataset): number {
  const value = process.env.ROUND4B_CORPUS_SIZE;
  if (value === undefined) return dataset.records.length;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("ROUND4B_CORPUS_SIZE must be a positive integer");
  return parsed;
}

export async function runEvaluation(): Promise<void> {
  const dataset = readJson<FrozenDataset>(DATASET_PATH);
  const input = readJson<SourceOnlyModelInput>(MODEL_INPUT_PATH);
  const promptHash = assertFrozenInputs(dataset, input);
  const annotations = readJson<AnnotationArtifact>(EVALUATOR_ANNOTATIONS_PATH);
  const artifacts = readArtifacts();
  const modelEvaluation = evaluateModelArtifacts(dataset, annotations, promptHash, artifacts, ALL_MODEL_IDS);
  const missingRequired = REQUIRED_MODEL_IDS.filter((modelId) => modelEvaluation.models[modelId]?.status === "not_run");
  if (missingRequired.length) throw new Error(`Round 4B required model artifacts are absent: ${missingRequired.join(", ")}`);
  const agreement = analyseAgreement(dataset, annotations, modelEvaluation);
  const outputs = extractedOutputs(artifacts);
  const assembly = assembleGraphs(dataset, annotations, outputs, modelEvaluation);
  const jev = optionalStage("jev");
  const terra = optionalStage("terra");
  const tickets = generateEscalationTickets(dataset, outputs, agreement, assembly, terra);
  const routing = simulateRouting(dataset, modelEvaluation, agreement, tickets, jev, terra, corpusSize(dataset));

  writeJson(OUTPUT_PATHS.modelEvaluation, modelEvaluation);
  writeJson(OUTPUT_PATHS.agreement, agreement);
  writeJson(OUTPUT_PATHS.assembly, assembly);
  writeJson(OUTPUT_PATHS.control, assembly.adjudicated_control);
  writeJson(OUTPUT_PATHS.jev, jev);
  writeJson(OUTPUT_PATHS.terra, terra);
  writeJson(OUTPUT_PATHS.tickets, tickets);
  writeJson(OUTPUT_PATHS.routing, routing);
  const manifest = readRunManifest(MANIFEST_PATH);
  const evaluation = {
    run_id: dataset.run_id,
    hashes: {
      manifest: hashFile(MANIFEST_PATH),
      dataset: manifest.dataset_hash,
      model_input: manifest.model_input_hash,
      prompt: promptHash,
      annotations: hashFile(EVALUATOR_ANNOTATIONS_PATH),
      model_artifacts: Object.fromEntries(ALL_MODEL_IDS.map((modelId) => {
        const path = join(MODEL_OUTPUT_ROOT, MODEL_FILE_NAMES[modelId]);
        return [modelId, existsSync(path) ? hashFile(path) : null];
      })),
      artifacts: {
        model_evaluation: hashJson(modelEvaluation),
        agreement: hashJson(agreement),
        assembly: hashJson(assembly),
        adjudicated_control: hashJson(assembly.adjudicated_control),
        jev_adjudication: hashJson(jev),
        terra_adjudication: hashJson(terra),
        terra_tickets: hashJson(tickets),
        routing: hashJson(routing),
      },
    },
    model_evaluation: modelEvaluation,
    agreement,
    assembly,
    adjudicated_atom_control: assembly.adjudicated_control,
    jev_adjudication: jev,
    terra_adjudication: terra,
    terra_escalation_tickets: tickets,
    routing_simulation: routing,
  };
  writeJson(OUTPUT_PATHS.evaluation, evaluation);
  const evaluationHash = hashFile(OUTPUT_PATHS.evaluation);
  const report = renderRound4BReport({
    dataset,
    manifest_hash: hashFile(MANIFEST_PATH),
    evaluation_hash: evaluationHash,
    model_evaluation: modelEvaluation,
    agreement,
    assembly,
    tickets,
    routing,
    jev,
    terra,
    baseline: readRound4ABaseline(),
  });
  writeFileSync(OUTPUT_PATHS.report, report);
  process.stdout.write(`evaluated ${dataset.records.length} Round 4B frozen abilities\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runEvaluation();
