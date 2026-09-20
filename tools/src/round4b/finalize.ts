import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { hashFile } from "./hash.js";
import { writeJson } from "./manifest.js";
import { EVALUATOR_ROOT, MODEL_OUTPUT_ROOT, ROUND4B_ROOT } from "./paths.js";

const artifactPaths = [
  join(ROUND4B_ROOT, "round4b-dataset.json"),
  join(ROUND4B_ROOT, "round4b-manifest.json"),
  join(ROUND4B_ROOT, "model", "round4b-source-input.json"),
  join(ROUND4B_ROOT, "model", "round4b-decomposition-prompt.json"),
  ...["luna", "silver-a", "silver-b", "silver-c", "sol-ceiling"].map((model) => join(MODEL_OUTPUT_ROOT, `round4b-${model}-output.json`)),
  join(EVALUATOR_ROOT, "round4b-source-semantic-annotations.json"),
  join(EVALUATOR_ROOT, "round4b-model-evaluation.json"),
  join(EVALUATOR_ROOT, "round4b-agreement-analysis.json"),
  join(EVALUATOR_ROOT, "round4b-assembly-results.json"),
  join(EVALUATOR_ROOT, "round4b-adjudicated-atom-control.json"),
  join(EVALUATOR_ROOT, "round4b-jev-adjudication.json"),
  join(EVALUATOR_ROOT, "round4b-terra-escalation-tickets.json"),
  join(ROUND4B_ROOT, "terra", "round4b-terra-batch-input.json"),
  join(ROUND4B_ROOT, "terra", "round4b-terra-results.json"),
  join(EVALUATOR_ROOT, "round4b-terra-results.json"),
  join(EVALUATOR_ROOT, "round4b-terra-adjudication.json"),
  join(EVALUATOR_ROOT, "round4b-routing-simulation.json"),
  join(EVALUATOR_ROOT, "round4b-isolation-audit.json"),
  join(EVALUATOR_ROOT, "round4b-evaluation.json"),
  join(EVALUATOR_ROOT, "round4b-report.md"),
] as const;

function main(): void {
  const missing = artifactPaths.filter((path) => !existsSync(path));
  if (missing.length) throw new Error(`Round 4B finalization is missing artifacts: ${missing.join(", ")}`);
  const artifacts = Object.fromEntries(artifactPaths.map((path) => [relative(ROUND4B_ROOT, path), hashFile(path)]));
  writeJson(join(ROUND4B_ROOT, "round4b-final-manifest.json"), {
    run_id: "round4b-49033b39bc94f929",
    status: "complete",
    outcome_policy: "unrescued",
    artifact_count: artifactPaths.length,
    artifacts,
  });
  process.stdout.write(`finalized ${artifactPaths.length} Round 4B artifacts\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
