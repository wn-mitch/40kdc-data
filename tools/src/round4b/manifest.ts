import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RunManifest, StageManifest } from "./contracts.js";
import { hashJson, verifyHash } from "./hash.js";

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeRunManifest(path: string, manifest: Omit<RunManifest, "manifest_hash">): void {
  writeJson(path, { ...manifest, manifest_hash: hashJson(manifest) });
}

export function readRunManifest(path: string): RunManifest {
  const manifest = readJson<RunManifest>(path);
  if (manifest.manifest_hash) {
    const { manifest_hash, ...body } = manifest;
    verifyHash("Round 4B run manifest", manifest_hash, hashJson(body));
  }
  return manifest;
}

export function appendStage(manifest: RunManifest, stage: StageManifest): RunManifest {
  if (manifest.stages.some((entry) => entry.stage === stage.stage)) {
    throw new Error(`Round 4B stage ${stage.stage} is already frozen in the manifest`);
  }
  return { ...manifest, stages: [...manifest.stages, stage] };
}

export function requireAbsent(path: string, label: string): void {
  if (existsSync(path)) throw new Error(`${label} already exists; frozen Round 4B outputs are immutable`);
}
