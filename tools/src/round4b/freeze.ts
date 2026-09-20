import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sourceDigest } from "../source-digest.js";
import { selectRound4BCohort, type SourceIndex } from "./cohort.js";
import type { FrozenAbility, FrozenDataset, RunManifest } from "./contracts.js";
import { hashFile, hashJson, sha256Bytes } from "./hash.js";
import { requireAbsent, writeJson, writeRunManifest } from "./manifest.js";
import { createSourceOnlyModelInput, MODEL_OUTPUT_JSON_SCHEMA } from "./prompt.js";
import {
  ABILITIES_ROOT,
  DATASET_PATH,
  FREEZE_MARKER_PATH,
  MANIFEST_PATH,
  MODEL_INPUT_PATH,
  MODEL_ROOT,
  ROUND4B_ROOT,
} from "./paths.js";

function titleFromId(id: string): string {
  return id.split("-").map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : part).join(" ");
}

export function freezeDataset(sourceIndex: SourceIndex, now = new Date()): FrozenDataset {
  const selection = selectRound4BCohort(sourceIndex);
  const records: FrozenAbility[] = selection.map((candidate) => {
    const sourceBytes = Buffer.from(candidate.assembled.source_text, "utf8");
    const sourceFile = `${candidate.faction_id}.json`;
    return {
      faction_id: candidate.faction_id,
      ability_id: candidate.ability_id,
      name: titleFromId(candidate.ability_id),
      selection: candidate.selection,
      card: {
        source_kind: candidate.assembled.source_kind,
        fields: candidate.assembled.source_fragments.map((fragment) => fragment.label),
      },
      source_locator: `${join(ABILITIES_ROOT, sourceFile)}#/${candidate.ability_id}`,
      source_text: candidate.assembled.source_text,
      source_bytes_base64: sourceBytes.toString("base64"),
      source_byte_length: sourceBytes.length,
      source_hash: candidate.source_hash,
      source_digest: sourceDigest(candidate.assembled.source_text),
      source_provenance: {
        repository: "40kdc-abilities",
        file: sourceFile,
        record_pointer: `/${candidate.ability_id}`,
      },
      source_fragments: candidate.assembled.source_fragments,
    };
  });
  const cohort_hash = hashJson(records.map(({ faction_id, ability_id, selection, source_hash }) => ({ faction_id, ability_id, selection, source_hash })));
  return {
    run_id: `round4b-${cohort_hash.slice(0, 16)}`,
    contract_version: 1,
    frozen_at: now.toISOString(),
    cohort_hash,
    records,
  };
}

function assertFreezeOutputsAbsent(): void {
  requireAbsent(DATASET_PATH, "Round 4B frozen dataset");
  requireAbsent(MODEL_INPUT_PATH, "Round 4B source-only model input");
  requireAbsent(MANIFEST_PATH, "Round 4B run manifest");
  requireAbsent(FREEZE_MARKER_PATH, "Round 4B freeze marker");
}

function main(): void {
  assertFreezeOutputsAbsent();
  const indexPath = join(ABILITIES_ROOT, "index.json");
  const sourceIndex = JSON.parse(readFileSync(indexPath, "utf8")) as SourceIndex;
  const dataset = freezeDataset(sourceIndex);
  const modelInput = createSourceOnlyModelInput(dataset);

  mkdirSync(ROUND4B_ROOT, { recursive: true });
  mkdirSync(MODEL_ROOT, { recursive: true });
  writeJson(DATASET_PATH, dataset);
  writeJson(MODEL_INPUT_PATH, modelInput);

  const manifest: RunManifest = {
    run_id: dataset.run_id,
    contract_version: 1,
    frozen_at: dataset.frozen_at,
    cohort_hash: dataset.cohort_hash,
    dataset_hash: hashFile(DATASET_PATH),
    model_input_hash: hashFile(MODEL_INPUT_PATH),
    stages: [{
      stage: "freeze",
      created_at: dataset.frozen_at,
      input_hashes: { source_index: sha256Bytes(readFileSync(indexPath)) },
      output_hashes: {
        dataset: hashFile(DATASET_PATH),
        source_only_model_input: hashFile(MODEL_INPUT_PATH),
        model_output_schema: hashJson(MODEL_OUTPUT_JSON_SCHEMA),
      },
      prompt_hash: hashJson(MODEL_OUTPUT_JSON_SCHEMA),
      model: null,
    }],
  };
  writeRunManifest(MANIFEST_PATH, manifest);
  writeFileSync(FREEZE_MARKER_PATH, `${dataset.run_id}\n`);
  process.stdout.write(`${dataset.run_id}: froze ${dataset.records.length} source records\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
