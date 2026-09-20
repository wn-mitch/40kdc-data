import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FrozenDataset, StageManifest } from "./contracts.js";
import { hashFile, hashJson } from "./hash.js";
import { readJson, readRunManifest, writeJson } from "./manifest.js";
import { DATASET_PATH, MANIFEST_PATH, PROCESS_INPUT, PROCESS_OUTPUT } from "./paths.js";

const reason = process.argv.slice(2).join(" ").trim();
if (!reason) throw new Error("Usage: direct-blocked.ts <blocked reason>");
const outputPath = join(PROCESS_OUTPUT, "round4-direct-results.raw.json");
const stagePath = join(PROCESS_OUTPUT, "round4-direct-results.manifest.json");
if (existsSync(outputPath) || existsSync(stagePath)) throw new Error("Direct-control output already exists");

const dataset = readJson<FrozenDataset>(DATASET_PATH);
const manifest = readRunManifest(MANIFEST_PATH);
if (manifest.run_id !== dataset.run_id) throw new Error("Frozen run id does not match the manifest");
writeJson(outputPath, {
  run_id: dataset.run_id,
  requested_model: "deepseek-reasoner",
  status: "blocked",
  blocked_reason: reason,
  results: [],
});
const stage: StageManifest = {
  run_id: dataset.run_id,
  stage: "direct",
  created_at: new Date().toISOString(),
  input_hashes: {
    dataset: manifest.dataset_hash,
    schema_context: hashFile(join(PROCESS_INPUT, "schema-context.json")),
  },
  bundle_hashes: { parser: manifest.parser_bundle_hash ?? "" },
  output_hashes: { direct: hashFile(outputPath) },
  model: "deepseek-reasoner",
  prompt_hash: hashJson({ status: "blocked", reason }),
  question_catalog_hash: manifest.question_catalog_hash,
  request_hashes: [],
};
writeJson(stagePath, stage);
