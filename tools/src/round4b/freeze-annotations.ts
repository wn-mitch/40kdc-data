import type { FrozenDataset, StageManifest } from "./contracts.js";
import type { AnnotationArtifact } from "./evaluation.js";
import { hashFile } from "./hash.js";
import { appendStage, readJson, readRunManifest, writeRunManifest } from "./manifest.js";
import { DATASET_PATH, EVALUATOR_ANNOTATIONS_PATH, MANIFEST_PATH } from "./paths.js";
import { validateGroundedModelOutput } from "./prompt.js";
import { identityKey } from "./shared.js";

function main(): void {
  const manifest = readRunManifest(MANIFEST_PATH);
  if (!manifest.stages.some((stage) => stage.stage === "model")) {
    throw new Error("Round 4B model outputs must be serialized before evaluator annotations are loaded");
  }
  if (manifest.annotation_hash) throw new Error("Round 4B evaluator annotations are already frozen");
  const dataset = readJson<FrozenDataset>(DATASET_PATH);
  const artifact = readJson<AnnotationArtifact>(EVALUATOR_ANNOTATIONS_PATH);
  if (artifact.run_id !== manifest.run_id || artifact.annotations.length !== dataset.records.length) {
    throw new Error("Round 4B evaluator annotation identity/count mismatch");
  }
  if (artifact.review?.status !== "completed" || artifact.review.reviewed_count !== dataset.records.length) {
    throw new Error("Round 4B evaluator annotations require completed independent review");
  }
  const sourceByKey = new Map(dataset.records.map((record) => [identityKey(record), record]));
  const seen = new Set<string>();
  for (const annotation of artifact.annotations) {
    const identity = identityKey(annotation);
    const source = sourceByKey.get(identity);
    if (!source || seen.has(identity) || annotation.source_hash !== source.source_hash) {
      throw new Error(`Round 4B annotation identity/source mismatch: ${identity}`);
    }
    seen.add(identity);
    const errors = validateGroundedModelOutput(source, {
      contract_version: 1,
      run_id: manifest.run_id,
      faction_id: annotation.faction_id,
      ability_id: annotation.ability_id,
      source_hash: annotation.source_hash,
      atoms: annotation.atoms,
      relations: annotation.relations,
      diagnostics: annotation.diagnostics,
    });
    if (errors.length) throw new Error(`Invalid evaluator annotation ${identity}: ${errors.join("; ")}`);
  }
  const annotationHash = hashFile(EVALUATOR_ANNOTATIONS_PATH);
  const stage: StageManifest = {
    stage: "annotations",
    created_at: new Date().toISOString(),
    input_hashes: { dataset: hashFile(DATASET_PATH) },
    output_hashes: { evaluator_annotations: annotationHash },
    prompt_hash: null,
    model: "manual-source-adjudication+astra-review",
  };
  const next = appendStage({ ...manifest, annotation_hash: annotationHash }, stage);
  const { manifest_hash: _, ...body } = next;
  writeRunManifest(MANIFEST_PATH, body);
  process.stdout.write(`${manifest.run_id}: froze ${artifact.annotations.length} reviewed annotations (${annotationHash})\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
