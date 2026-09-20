import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelOutputEnvelope, SourceOnlyModelInput, StageManifest } from "./contracts.js";
import { hashFile, hashJson } from "./hash.js";
import { appendStage, readJson, readRunManifest, requireAbsent, writeJson, writeRunManifest } from "./manifest.js";
import { MANIFEST_PATH, MODEL_INPUT_PATH, MODEL_OUTPUT_ROOT, MODEL_PROMPT_PATH } from "./paths.js";
import { validateGroundedModelOutput } from "./prompt.js";
import { identityKey } from "./shared.js";

const ARMS = [
  { directory: "luna", model_id: "luna", actual_agent: "luna", output: "round4b-luna-output.json" },
  { directory: "silver-a", model_id: "silver-a", actual_agent: "task", output: "round4b-silver-a-output.json" },
  { directory: "silver-b", model_id: "silver-b", actual_agent: "task", output: "round4b-silver-b-output.json" },
  { directory: "silver-c", model_id: "silver-c", actual_agent: "task", output: "round4b-silver-c-output.json" },
  { directory: "sol-ceiling", model_id: "sol-ceiling", actual_agent: "sol", output: "round4b-sol-ceiling-output.json" },
] as const;

interface BatchArtifact {
  run_id: string;
  model_id: string;
  actual_agent: string;
  batch_id: number;
  prompt_hash: string;
  records: ModelOutputEnvelope[];
}

function aggregateArm(
  arm: (typeof ARMS)[number],
  input: SourceOnlyModelInput,
  promptHash: string,
): string {
  const destination = join(MODEL_OUTPUT_ROOT, arm.output);
  requireAbsent(destination, `${arm.model_id} aggregate`);
  const metadataErrors: string[] = [];
  const batches = [1, 2, 3].map((batch) => readJson<BatchArtifact>(join(MODEL_OUTPUT_ROOT, arm.directory, `batch-${batch}.json`)));
  const records = batches.flatMap((batch, index) => {
    if (batch.run_id !== input.run_id || batch.model_id !== arm.model_id || batch.actual_agent !== arm.actual_agent || batch.batch_id !== index + 1) {
      throw new Error(`${arm.model_id} batch ${index + 1} identity metadata does not match frozen run`);
    }
    if (batch.prompt_hash !== promptHash) metadataErrors.push(`batch ${index + 1} reported prompt hash ${batch.prompt_hash}; frozen hash is ${promptHash}`);
    if (batch.records.length !== 10) throw new Error(`${arm.model_id} batch ${index + 1} must contain ten records`);
    return batch.records;
  });
  if (records.length !== input.records.length) throw new Error(`${arm.model_id} must contain all frozen records`);
  const seen = new Set<string>();
  const validationErrors: Record<string, string[]> = {};
  for (const [index, record] of records.entries()) {
    const expected = input.records[index];
    const identity = identityKey(record);
    if (!expected || identity !== identityKey(expected) || seen.has(identity)) {
      throw new Error(`${arm.model_id} record order or identity drift at index ${index}`);
    }
    seen.add(identity);
    const errors = validateGroundedModelOutput(expected, record);
    if (errors.length) validationErrors[identity] = errors;
  }
  const requestHashes = input.records.map((record) => hashJson({ model_id: arm.model_id, prompt_hash: promptHash, record }));
  const artifact = {
    run_id: input.run_id,
    model_id: arm.model_id,
    actual_agent: arm.actual_agent,
    prompt_hash: promptHash,
    execution: {
      mode: "independent-agent-batches",
      requests: input.records.length,
      latency_ms: null,
      input_tokens: null,
      output_tokens: null,
      cost_usd: null,
      accounting_status: "unavailable-from-agent-runtime",
    },
    request_hashes: requestHashes,
    metadata_errors: metadataErrors,
    validation_errors: validationErrors,
    records,
  };
  writeJson(destination, artifact);
  return hashFile(destination);
}

function main(): void {
  const manifest = readRunManifest(MANIFEST_PATH);
  const input = readJson<SourceOnlyModelInput>(MODEL_INPUT_PATH);
  const prompt = JSON.parse(readFileSync(MODEL_PROMPT_PATH, "utf8")) as unknown;
  const promptHash = hashJson(prompt);
  const results = ARMS.map((arm) => ({ arm, outputHash: aggregateArm(arm, input, promptHash) }));
  const stage: StageManifest = {
    stage: "model",
    created_at: new Date().toISOString(),
    input_hashes: { source_input: hashFile(MODEL_INPUT_PATH), decomposition_prompt: hashFile(MODEL_PROMPT_PATH) },
    output_hashes: Object.fromEntries(results.map(({ arm, outputHash }) => [arm.model_id, outputHash])),
    prompt_hash: promptHash,
    model: ARMS.map((arm) => `${arm.model_id}:${arm.actual_agent}`).join(","),
  };
  const next = appendStage(manifest, stage);
  const { manifest_hash: _, ...body } = next;
  writeRunManifest(MANIFEST_PATH, body);
  process.stdout.write(`${input.run_id}: aggregated ${ARMS.length} independent model arms\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
