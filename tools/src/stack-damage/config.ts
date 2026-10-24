import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ComparePhase } from "../compare.js";
import type { EngineContext } from "../cruncher/index.js";

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
  /** Board and game state every cell assumes, from the `HC_SCENARIO` JSON file. */
  scenario: Scenario;
}

/** The scenario facts a matrix may declare; each is an {@link EngineContext} field. */
export type Scenario = Pick<EngineContext,
  | "battleRound" | "attackerTurn" | "attackerStrength" | "targetStrength" | "attackerDesignations"
  | "targetDesignations" | "attackerStates" | "targetStates" | "targetClosest" | "attackerObjectives"
  | "targetObjectives" | "attackerGuided">;

const STRENGTHS = ["full", "below-starting", "below-half"];
const STATES = ["engaged", "battle-shocked", "hidden"];
const OBJECTIVE_FIELDS: Record<string, (value: unknown) => boolean> = {
  controller: (value) => value === "attacker" || value === "target" || value === "none",
  designations: (value) => Array.isArray(value) && value.every((item) => typeof item === "string"),
  role: (value) => ["central", "expansion", "home", "non-home"].includes(value as string),
  homeOf: (value) => value === "attacker" || value === "target",
  territory: (value) => value === "attacker" || value === "target" || value === "no-mans-land",
  name: (value) => typeof value === "string",
};
const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");
const objectives = (value: unknown) => Array.isArray(value) && value.every((objective) =>
  typeof objective === "object" && objective !== null && !Array.isArray(objective) &&
  Object.entries(objective).every(([key, field]) => OBJECTIVE_FIELDS[key]?.(field) === true));
const SCENARIO_FIELDS: Record<keyof Scenario, (value: unknown) => boolean> = {
  battleRound: (value) => Number.isInteger(value) && (value as number) >= 1,
  attackerTurn: (value) => typeof value === "boolean",
  attackerStrength: (value) => STRENGTHS.includes(value as string),
  targetStrength: (value) => STRENGTHS.includes(value as string),
  attackerDesignations: strings,
  targetDesignations: strings,
  attackerStates: (value) => strings(value) && (value as string[]).every((state) => STATES.includes(state)),
  targetStates: (value) => strings(value) && (value as string[]).every((state) => STATES.includes(state)),
  targetClosest: (value) => typeof value === "boolean",
  attackerObjectives: objectives,
  targetObjectives: objectives,
  attackerGuided: (value) => typeof value === "boolean",
};

/** Parse a scenario declaration, rejecting unknown fields and malformed values. */
export function parseScenario(value: unknown, name = "HC_SCENARIO"): Scenario {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${name} must be a JSON object`);
  for (const [key, field] of Object.entries(value)) {
    const check = SCENARIO_FIELDS[key as keyof Scenario];
    if (!check) throw new Error(`${name} has unknown field ${key}`);
    if (!check(field)) throw new Error(`${name}.${key} is malformed`);
  }
  return value as Scenario;
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
    scenario: env.HC_SCENARIO ? parseScenario(JSON.parse(readFileSync(resolve(cwd, env.HC_SCENARIO), "utf8"))) : {},
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
    scenario: config.scenario,
  };
}
