import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { PROCESS_APP, PROCESS_INPUT, PROCESS_OUTPUT } from "./paths.js";

const stage = process.argv[2];
if (!stage || !["candidates", "jev", "direct"].includes(stage)) throw new Error("Usage: run-isolated.ts candidates|jev|direct");
if (!existsSync(`${PROCESS_APP}/parser.mjs`)) throw new Error("Frozen parser bundle is missing; run round4:build-parser first");
const probe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" });
if (probe.status !== 0) throw new Error(`Docker isolation unavailable: ${probe.stderr.trim() || probe.stdout.trim()}`);

const args = [
  "run", "--rm", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
  "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
  "--mount", `type=bind,src=${PROCESS_APP},dst=/run/app,readonly`,
  "--mount", `type=bind,src=${PROCESS_INPUT},dst=/run/input,readonly`,
  "--mount", `type=bind,src=${PROCESS_OUTPUT},dst=/run/output`,
];
if (stage === "candidates") args.push("--network", "none");
else if (stage === "jev") {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("TYPESAFE_API_KEY is required for the Jev arm");
  args.push("--env", "TYPESAFE_API_KEY");
  if (process.env.TYPESAFE_BASE_URL) args.push("--env", "TYPESAFE_BASE_URL");
} else {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY is required for the direct-generation arm");
  args.push("--env", "DEEPSEEK_API_KEY");
  if (process.env.DEEPSEEK_BASE_URL) args.push("--env", "DEEPSEEK_BASE_URL");
}
args.push("node:22-bookworm-slim", "node", "/run/app/parser.mjs", stage);
const result = spawnSync("docker", args, { stdio: "inherit", env: process.env });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Isolated ${stage} stage failed with status ${result.status}`);
