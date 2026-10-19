import { resolve } from "node:path";

import type { ComparePhase } from "../compare.js";

export const DEFAULT_HC_FACTIONS = [
  "chaos-space-marines",
  "adeptus-mechanicus",
  "death-guard",
  "tau-empire",
] as const;

export interface MatrixCatalog {
  factionIds: ReadonlySet<string>;
  targetIds: readonly string[];
}

export interface MatrixConfig {
  factionIds: string[];
  targetIds: string[];
  phases: ComparePhase[];
  outputPath: string;
  bodyguardLimit: number;
  attachmentLimit: number;
  finalistLimit: number;
  detail: boolean;
  perFiveSensitivity: boolean;
  droppedArmyRules: string[];
  dpBudget: number;
  maxDetachments: number;
}

function list(value: string | undefined, fallback: readonly string[], name: string): string[] {
  const values = value === undefined ? [...fallback] : value.split(",").map((item) => item.trim()).filter(Boolean);
  if (values.length === 0) throw new Error(`${name} must contain at least one id`);
  const duplicate = values.find((item, index) => values.indexOf(item) !== index);
  if (duplicate) throw new Error(`${name} contains duplicate id ${duplicate}`);
  return values;
}

function limit(value: string | undefined, name: string): number {
  if (value === undefined || value === "Infinity") return Infinity;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer or Infinity`);
  return parsed;
}

export function parseMatrixConfig(
  env: Readonly<Record<string, string | undefined>>,
  catalog: MatrixCatalog,
  cwd = process.cwd(),
): MatrixConfig {
  const factionIds = list(env.HC_FACTIONS, DEFAULT_HC_FACTIONS, "HC_FACTIONS");
  for (const id of factionIds) {
    if (!catalog.factionIds.has(id)) throw new Error(`HC_FACTIONS contains unknown faction ${id}`);
  }

  const requestedTargets = list(env.HC_TARGETS, ["all"], "HC_TARGETS");
  if (requestedTargets.includes("all") && requestedTargets.length !== 1) {
    throw new Error("HC_TARGETS=all cannot be combined with explicit target ids");
  }
  const targetIds = requestedTargets[0] === "all" ? [...catalog.targetIds] : requestedTargets;
  const knownTargets = new Set(catalog.targetIds);
  for (const id of targetIds) {
    if (!knownTargets.has(id)) throw new Error(`HC_TARGETS contains unknown target ${id}`);
  }

  const phases = list(env.HC_PHASES, ["shooting", "fight"], "HC_PHASES") as ComparePhase[];
  for (const phase of phases) {
    if (phase !== "shooting" && phase !== "fight") throw new Error(`HC_PHASES contains unsupported phase ${phase}`);
  }

  const output = env.HC_OUTPUT?.trim() || "_private/velochy/damage-matrix.json";
  if (!output.endsWith(".json")) throw new Error("HC_OUTPUT must name a .json file");

  return {
    factionIds,
    targetIds,
    phases,
    outputPath: resolve(cwd, output),
    bodyguardLimit: limit(env.HC_BODYGUARDS, "HC_BODYGUARDS"),
    attachmentLimit: limit(env.HC_TOP, "HC_TOP"),
    finalistLimit: limit(env.HC_DEEP, "HC_DEEP"),
    detail: env.HC_DETAIL === "1",
    perFiveSensitivity: env.HC_PER5 === "1",
    droppedArmyRules: env.HC_DROP_RULE ? list(env.HC_DROP_RULE, [], "HC_DROP_RULE") : [],
    dpBudget: 3,
    maxDetachments: 3,
  };
}

export function serializableConfig(config: MatrixConfig): Record<string, unknown> {
  const finite = (value: number) => Number.isFinite(value) ? value : "Infinity";
  return {
    factions: config.factionIds,
    targets: config.targetIds,
    phases: config.phases,
    output: config.outputPath,
    bodyguardLimit: finite(config.bodyguardLimit),
    attachmentLimit: finite(config.attachmentLimit),
    finalistLimit: finite(config.finalistLimit),
    perFiveSensitivity: config.perFiveSensitivity,
    droppedArmyRules: config.droppedArmyRules,
    dpBudget: config.dpBudget,
    maxDetachments: config.maxDetachments,
  };
}
