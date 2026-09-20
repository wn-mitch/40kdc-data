import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(HERE, "../../..");

export const REPO_ROOT = process.env.ROUND4B_REPO_ROOT ?? DEFAULT_REPO_ROOT;
export const ABILITIES_ROOT = process.env.ROUND4B_ABILITIES_ROOT ?? resolve(REPO_ROOT, "../40kdc-abilities");
export const ROUND4B_ROOT = process.env.ROUND4B_RUNTIME_ROOT ?? join(REPO_ROOT, "_private", "round4b");
export const DATASET_PATH = process.env.ROUND4B_DATASET_PATH ?? join(ROUND4B_ROOT, "round4b-dataset.json");
export const MODEL_ROOT = process.env.ROUND4B_MODEL_ROOT ?? join(ROUND4B_ROOT, "model");
export const MODEL_INPUT_PATH = process.env.ROUND4B_MODEL_INPUT_PATH ?? join(MODEL_ROOT, "round4b-source-input.json");
export const MODEL_PROMPT_PATH = process.env.ROUND4B_MODEL_PROMPT_PATH ?? join(MODEL_ROOT, "round4b-decomposition-prompt.json");
export const MODEL_OUTPUT_ROOT = process.env.ROUND4B_MODEL_OUTPUT_ROOT ?? join(MODEL_ROOT, "outputs");
export const EVALUATOR_ROOT = process.env.ROUND4B_EVALUATOR_ROOT ?? join(ROUND4B_ROOT, "evaluator");
export const EVALUATOR_ANNOTATIONS_PATH = process.env.ROUND4B_EVALUATOR_ANNOTATIONS_PATH ?? join(EVALUATOR_ROOT, "round4b-source-semantic-annotations.json");
export const MANIFEST_PATH = process.env.ROUND4B_MANIFEST_PATH ?? join(ROUND4B_ROOT, "round4b-manifest.json");
export const FREEZE_MARKER_PATH = join(ROUND4B_ROOT, "FREEZE");
