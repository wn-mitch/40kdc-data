import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(HERE, "../../..");
export const REPO_ROOT = process.env.ROUND4_REPO_ROOT ?? DEFAULT_REPO_ROOT;
export const TOOLS_ROOT = join(REPO_ROOT, "tools");
/** The private MFM dump the freeze reads prose from. */
export const DUMP_PATH = process.env.ROUND4_DUMP_PATH ?? join(REPO_ROOT, "_private", "dump.json");
export const ROUND4_ROOT = process.env.ROUND4_RUNTIME_ROOT ?? join(REPO_ROOT, "_private", "round4");
export const DATASET_PATH = process.env.ROUND4_DATASET_PATH ?? join(ROUND4_ROOT, "round4-dataset.json");
export const EVALUATOR_ROOT = process.env.ROUND4_EVALUATOR_ROOT ?? join(ROUND4_ROOT, "evaluator");
export const ANNOTATIONS_PATH = process.env.ROUND4_ANNOTATIONS_PATH ?? join(EVALUATOR_ROOT, "round4-semantic-annotations.json");
export const PROCESS_A_ROOT = join(ROUND4_ROOT, "process-a");
export const PROCESS_INPUT = process.env.ROUND4_PROCESS_INPUT ?? join(PROCESS_A_ROOT, "input");
export const PROCESS_APP = process.env.ROUND4_PROCESS_APP ?? join(PROCESS_A_ROOT, "app");
export const PROCESS_OUTPUT = process.env.ROUND4_PROCESS_OUTPUT ?? join(PROCESS_A_ROOT, "output");
export const MANIFEST_PATH = process.env.ROUND4_MANIFEST_PATH ?? join(ROUND4_ROOT, "run-manifest.json");
export const REPORT_PATH = process.env.ROUND4_REPORT_PATH ?? join(ROUND4_ROOT, "round4-report.md");
export const GOLD_ROOT = process.env.ROUND4_GOLD_ROOT ?? resolve(REPO_ROOT, "../40kdc-jev-orks/_private/parser/gold");
