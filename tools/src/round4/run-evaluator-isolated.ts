import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { hashFile } from "./hash.js";
import {
  ANNOTATIONS_PATH,
  DATASET_PATH,
  EVALUATOR_ROOT,
  GOLD_ROOT,
  MANIFEST_PATH,
  PROCESS_APP,
  PROCESS_OUTPUT,
  ROUND4_ROOT,
  TOOLS_ROOT,
} from "./paths.js";

const processBRoot = join(ROUND4_ROOT, "process-b");
const appRoot = join(processBRoot, "app");
const inputRoot = join(processBRoot, "input");
const outputRoot = join(processBRoot, "output");
const stagedProcessApp = join(inputRoot, "process-a", "app");
const stagedProcessOutput = join(inputRoot, "process-a", "output");
const stagedGold = join(inputRoot, "gold");
const bundlePath = join(appRoot, "evaluate.mjs");

const anchors = [
  "helm-of-brazen-ire-berzerker-warband-world-eaters",
  "hack-and-slash-berzerker-warband-world-eaters",
  "relentless-rage-world-eaters",
  "deep-strike",
];
const evaluatorArtifacts = [
  "round4-candidates.json",
  "round4-jev-results.json",
  "round4-composition-results.json",
  "round4-direct-generation-results.json",
  "round4-evaluation.json",
];

for (const [path, label] of [
  [DATASET_PATH, "frozen dataset"],
  [ANNOTATIONS_PATH, "semantic annotations"],
  [MANIFEST_PATH, "run manifest"],
  [join(PROCESS_APP, "composer.mjs"), "frozen composer"],
  [join(PROCESS_OUTPUT, "round4-candidates.raw.json"), "candidate output"],
] as const) {
  if (!existsSync(path)) throw new Error(`Missing ${label}: ${path}`);
}

rmSync(processBRoot, { recursive: true, force: true });
mkdirSync(appRoot, { recursive: true });
mkdirSync(stagedProcessApp, { recursive: true });
mkdirSync(stagedProcessOutput, { recursive: true });
mkdirSync(stagedGold, { recursive: true });
mkdirSync(outputRoot, { recursive: true });

const buildResult = await build({
  entryPoints: [join(TOOLS_ROOT, "src", "round4", "evaluate.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  metafile: true,
});
writeFileSync(join(appRoot, "evaluate.meta.json"), `${JSON.stringify(buildResult.metafile, null, 2)}\n`);
const evaluatorBundleHash = hashFile(bundlePath);

copyFileSync(DATASET_PATH, join(inputRoot, "round4-dataset.json"));
copyFileSync(ANNOTATIONS_PATH, join(inputRoot, "round4-semantic-annotations.json"));
copyFileSync(join(PROCESS_APP, "composer.mjs"), join(stagedProcessApp, "composer.mjs"));
copyFileSync(join(PROCESS_APP, "parser.mjs"), join(stagedProcessApp, "parser.mjs"));
cpSync(PROCESS_OUTPUT, stagedProcessOutput, { recursive: true });
if (existsSync(join(PROCESS_OUTPUT, "round4-jev-results.raw.json"))) {
  for (const anchor of anchors) copyFileSync(join(GOLD_ROOT, `${anchor}.json`), join(stagedGold, `${anchor}.json`));
}
copyFileSync(MANIFEST_PATH, join(outputRoot, "run-manifest.json"));

const docker = spawnSync("docker", [
  "run", "--rm", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
  "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--network", "none",
  "--mount", `type=bind,src=${appRoot},dst=/run/app,readonly`,
  "--mount", `type=bind,src=${inputRoot},dst=/run/input,readonly`,
  "--mount", `type=bind,src=${outputRoot},dst=/run/output`,
  "--env", "ROUND4_RUNTIME_ROOT=/run/input",
  "--env", "ROUND4_DATASET_PATH=/run/input/round4-dataset.json",
  "--env", "ROUND4_ANNOTATIONS_PATH=/run/input/round4-semantic-annotations.json",
  "--env", "ROUND4_EVALUATOR_ROOT=/run/output",
  "--env", "ROUND4_PROCESS_APP=/run/input/process-a/app",
  "--env", "ROUND4_PROCESS_OUTPUT=/run/input/process-a/output",
  "--env", "ROUND4_MANIFEST_PATH=/run/output/run-manifest.json",
  "--env", "ROUND4_REPORT_PATH=/run/output/round4-report.md",
  "--env", "ROUND4_GOLD_ROOT=/run/input/gold",
  "--env", `ROUND4_EVALUATOR_BUNDLE_HASH=${evaluatorBundleHash}`,
  "node:22-bookworm-slim", "node", "/run/app/evaluate.mjs",
], { stdio: "inherit" });
if (docker.error) throw docker.error;
if (docker.status !== 0) throw new Error(`Isolated evaluator failed with status ${docker.status}`);

mkdirSync(EVALUATOR_ROOT, { recursive: true });
for (const artifact of evaluatorArtifacts) copyFileSync(join(outputRoot, artifact), join(EVALUATOR_ROOT, artifact));
copyFileSync(join(outputRoot, "run-manifest.json"), MANIFEST_PATH);
copyFileSync(join(outputRoot, "round4-report.md"), join(ROUND4_ROOT, "round4-report.md"));
