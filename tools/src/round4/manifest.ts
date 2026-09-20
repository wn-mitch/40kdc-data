import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { StageManifest } from "./contracts.js";
import { hashFile, hashJson, verifyHash } from "./hash.js";

export interface RunManifest {
  run_id: string;
  contract_version: 1;
  frozen_at: string;
  dataset_hash: string;
  parser_bundle_hash: string | null;
  composer_bundle_hash: string | null;
  question_catalog_hash: string | null;
  annotation_hash: string;
  direct_price_table: {
    version: string;
    input_per_million_usd: number;
    output_per_million_usd: number;
  };
  stages: StageManifest[];
  manifest_hash?: string;
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function readRunManifest(path: string): RunManifest {
  const manifest = readJson<RunManifest>(path);
  if (manifest.manifest_hash) {
    const { manifest_hash: expected, ...body } = manifest;
    verifyHash("run manifest", expected, hashJson(body));
  }
  return manifest;
}

export function writeRunManifest(path: string, manifest: Omit<RunManifest, "manifest_hash">): void {
  writeJson(path, { ...manifest, manifest_hash: hashJson(manifest) });
}

export function upsertStage(path: string, stage: StageManifest): void {
  const current = readRunManifest(path);
  const stages = current.stages.filter((item) => item.stage !== stage.stage);
  stages.push(stage);
  const { manifest_hash: _, ...body } = current;
  writeRunManifest(path, { ...body, stages });
}

export function verifyFrozenInputs(
  manifest: RunManifest,
  datasetPath: string,
  parserBundlePath?: string,
): void {
  verifyHash("dataset", manifest.dataset_hash, hashFile(datasetPath));
  if (parserBundlePath) {
    if (!manifest.parser_bundle_hash) throw new Error("Parser bundle is not frozen in the run manifest");
    verifyHash("parser bundle", manifest.parser_bundle_hash, hashFile(parserBundlePath));
  }
}

export function requireAbsent(path: string, label: string): void {
  if (existsSync(path)) throw new Error(`${label} already exists; start a new run id instead of mutating frozen output`);
}
