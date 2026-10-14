import { readFileSync, writeFileSync } from "node:fs";
import type { CandidateAbilityResult, FrozenDataset, StageManifest } from "./contracts.js";
import { generateCandidates } from "./candidates.js";
import { runJev } from "./jev.js";
import { runDirectControl } from "./direct-control.js";
import { hashFile, hashJson, sha256Bytes, verifyHash } from "./hash.js";
import type { RunManifest } from "./manifest.js";

const INPUT = "/run/input";
const OUTPUT = "/run/output";
const APP = "/run/app";
const datasetPath = `${INPUT}/round4-dataset.json`;
const manifestPath = `${INPUT}/run-manifest.json`;
const bundlePath = `${APP}/parser.mjs`;

function readJson<T>(path: string): T { return JSON.parse(readFileSync(path, "utf8")) as T; }
function writeJson(path: string, value: unknown): void { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }

function verifyManifest(manifest: RunManifest): FrozenDataset {
  if (!manifest.parser_bundle_hash) throw new Error("Parser bundle is not frozen");
  verifyHash("dataset", manifest.dataset_hash, hashFile(datasetPath));
  verifyHash("parser bundle", manifest.parser_bundle_hash, hashFile(bundlePath));
  const dataset = readJson<FrozenDataset>(datasetPath);
  if (dataset.run_id !== manifest.run_id) throw new Error("Run id mismatch between dataset and manifest");
  return dataset;
}

function stageManifest(
  manifest: RunManifest,
  stage: StageManifest["stage"],
  outputPath: string,
  model: string | null,
  promptHash: string | null,
  requestHashes: string[],
): StageManifest {
  return {
    run_id: manifest.run_id,
    stage,
    created_at: new Date().toISOString(),
    input_hashes: { dataset: manifest.dataset_hash },
    bundle_hashes: { parser: manifest.parser_bundle_hash as string },
    output_hashes: { [stage]: hashFile(outputPath) },
    model,
    prompt_hash: promptHash,
    question_catalog_hash: manifest.question_catalog_hash,
    request_hashes: requestHashes,
  };
}

async function runCandidates(dataset: FrozenDataset, manifest: RunManifest): Promise<void> {
  const results = dataset.records.map((record) => ({ ...generateCandidates(record), primary_stratum: record.primary_stratum }));
  if (results.length !== 32) throw new Error(`Candidate output must preserve 32 rows; received ${results.length}`);
  const raw = {
    run_id: dataset.run_id,
    dataset_hash: manifest.dataset_hash,
    parser_bundle_hash: manifest.parser_bundle_hash,
    question_catalog_hash: manifest.question_catalog_hash,
    records: results,
  };
  const outputPath = `${OUTPUT}/round4-candidates.raw.json`;
  writeJson(outputPath, raw);
  writeJson(`${OUTPUT}/round4-candidates.manifest.json`, stageManifest(manifest, "candidates", outputPath, null, null, []));
}

async function runJevStage(dataset: FrozenDataset, manifest: RunManifest): Promise<void> {
  const candidatesPath = `${OUTPUT}/round4-candidates.raw.json`;
  const candidateManifest = readJson<StageManifest>(`${OUTPUT}/round4-candidates.manifest.json`);
  verifyHash("candidate output", candidateManifest.output_hashes.candidates as string, hashFile(candidatesPath));
  const candidates = readJson<{ records: Array<CandidateAbilityResult & { primary_stratum?: string }> }>(candidatesPath);
  const raw = await runJev(candidates.records);
  const outputPath = `${OUTPUT}/round4-jev-results.raw.json`;
  writeJson(outputPath, { run_id: dataset.run_id, ...raw });
  writeJson(`${OUTPUT}/round4-jev-results.manifest.json`, stageManifest(
    manifest,
    "jev",
    outputPath,
    "jev-latest",
    hashJson({ instruction: "local-question-only", model: "jev-latest" }),
    raw.requests.map((request) => request.request_hash),
  ));
}

async function runDirectStage(dataset: FrozenDataset, manifest: RunManifest): Promise<void> {
  const schemaContext = readJson<unknown>(`${INPUT}/schema-context.json`);
  const results = [];
  for (const record of dataset.records) results.push(await runDirectControl(record, schemaContext, manifest.direct_price_table));
  const outputPath = `${OUTPUT}/round4-direct-results.raw.json`;
  writeJson(outputPath, { run_id: dataset.run_id, requested_model: "deepseek-reasoner", results });
  writeJson(`${OUTPUT}/round4-direct-results.manifest.json`, stageManifest(
    manifest,
    "direct",
    outputPath,
    "deepseek-reasoner",
    hashJson({ schema: schemaContext, output: "semantic-graph" }),
    results.map((result) => result.request_hash),
  ));
}

async function main(): Promise<void> {
  const stage = process.argv[2];
  const manifest = readJson<RunManifest>(manifestPath);
  const dataset = verifyManifest(manifest);
  if (stage === "candidates") await runCandidates(dataset, manifest);
  else if (stage === "jev") await runJevStage(dataset, manifest);
  else if (stage === "direct") await runDirectStage(dataset, manifest);
  else throw new Error(`Unknown Process A stage: ${stage ?? "<missing>"}`);
}

await main();
