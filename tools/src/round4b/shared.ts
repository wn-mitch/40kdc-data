import type {
  ByteSpan,
  DecompositionAtom,
  DecompositionRelation,
  FrozenAbility,
  ModelOutputEnvelope,
} from "./contracts.js";

export const REQUIRED_MODEL_IDS = ["luna", "silver-a", "silver-b", "silver-c"] as const;
export const OPTIONAL_MODEL_IDS = ["sol-ceiling"] as const;
export const ALL_MODEL_IDS = [...REQUIRED_MODEL_IDS, ...OPTIONAL_MODEL_IDS] as const;
export type ModelId = (typeof ALL_MODEL_IDS)[number];
export type AgreementModelId = (typeof REQUIRED_MODEL_IDS)[number];

export interface ModelOutputArtifact {
  run_id: string;
  model_id: string;
  actual_agent: string;
  prompt_hash: string;
  request_hashes?: string[];
  latency_ms?: number;
  cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
  execution?: {
    requests?: number;
    latency_ms?: number | null;
    input_tokens?: number | null;
    output_tokens?: number | null;
    cost_usd?: number | null;
    accounting_status?: string;
  };
  records: ModelOutputEnvelope[];
}

export interface ArtifactLoad<T> {
  status: "complete" | "not_run" | "invalid";
  value?: T;
  errors: string[];
}

export interface CountMetric {
  correct: number;
  predicted: number;
  required: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface BinomialInterval {
  successes: number;
  trials: number;
  rate: number | null;
  lower: number | null;
  upper: number | null;
  confidence: 0.95;
}

export function identityKey(identity: { faction_id: string; ability_id: string }): string {
  return `${identity.faction_id}/${identity.ability_id}`;
}

export function normalizeMeaning(meaning: string): string {
  return meaning.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

export function spansOverlap(left: ByteSpan, right: ByteSpan): boolean {
  return left.start < right.end && right.start < left.end;
}

export function sourceOverlap(left: DecompositionAtom, right: DecompositionAtom): boolean {
  return spansOverlap(left.source_span, right.source_span);
}

export function atomSemanticMatch(left: DecompositionAtom, right: DecompositionAtom): boolean {
  return left.family === right.family && sourceOverlap(left, right);
}

export function relationTypeFamily(type: DecompositionRelation["type"]): string {
  switch (type) {
    case "antecedent-of":
    case "binds-to":
      return "antecedent";
    case "argument-filling":
    case "targets":
    case "consumes-resource":
      return "argument-filling";
    case "attaches-to":
    case "condition-of":
    case "governs":
    case "modifies":
      return "attachment";
    case "branch-kind":
      return "branch-kind";
    case "choice-vs-disjunction":
    case "choice-option-of":
      return "choice-vs-disjunction";
    case "duration-of":
      return "duration-scope";
    case "iterator-collection":
    case "iterates-over":
      return "iterator-collection";
    case "replacement-vs-coexistence":
    case "replaces":
      return "replacement-vs-coexistence";
    default:
      return "other";
  }
}

export function relationFamily(relation: DecompositionRelation): string {
  return relationTypeFamily(relation.type);
}
export function relationSemanticMatch(
  left: DecompositionRelation,
  right: DecompositionRelation,
  leftAtoms: Map<string, DecompositionAtom>,
  rightAtoms: Map<string, DecompositionAtom>,
): boolean {
  if (relationFamily(left) !== relationFamily(right) || left.type === "novel_relation" || right.type === "novel_relation") return false;
  const leftFrom = leftAtoms.get(left.from_atom_id);
  const leftTo = leftAtoms.get(left.to_atom_id);
  const rightFrom = rightAtoms.get(right.from_atom_id);
  const rightTo = rightAtoms.get(right.to_atom_id);
  return Boolean(leftFrom && leftTo && rightFrom && rightTo && atomSemanticMatch(leftFrom, rightFrom) && atomSemanticMatch(leftTo, rightTo));
}

export function countMetric(correct: number, predicted: number, required: number): CountMetric {
  const precision = predicted === 0 ? null : correct / predicted;
  const recall = required === 0 ? null : correct / required;
  return {
    correct,
    predicted,
    required,
    precision,
    recall,
    f1: precision === null || recall === null || precision + recall === 0 ? null : (2 * precision * recall) / (precision + recall),
  };
}

export function wilsonInterval(successes: number, trials: number, z = 1.959963984540054): BinomialInterval {
  if (!Number.isInteger(successes) || !Number.isInteger(trials) || successes < 0 || trials < 0 || successes > trials) {
    throw new Error("Wilson interval requires integer successes in [0, trials]");
  }
  if (trials === 0) return { successes, trials, rate: null, lower: null, upper: null, confidence: 0.95 };
  const rate = successes / trials;
  const zSquared = z ** 2;
  const denominator = 1 + zSquared / trials;
  const centre = (rate + zSquared / (2 * trials)) / denominator;
  const halfWidth = (z * Math.sqrt((rate * (1 - rate) + zSquared / (4 * trials)) / trials)) / denominator;
  return {
    successes,
    trials,
    rate,
    lower: Math.max(0, centre - halfWidth),
    upper: Math.min(1, centre + halfWidth),
    confidence: 0.95,
  };
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function hasString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function parseModelArtifact(value: unknown): ArtifactLoad<ModelOutputArtifact> {
  const artifact = asRecord(value);
  const errors: string[] = [];
  if (!artifact) return { status: "invalid", errors: ["model artifact is not an object"] };
  for (const field of ["run_id", "model_id", "actual_agent", "prompt_hash"]) {
    if (!hasString(artifact[field])) errors.push(`model artifact has invalid ${field}`);
  }
  if (!Array.isArray(artifact.records)) errors.push("model artifact has no records array");
  if (artifact.request_hashes !== undefined && (!Array.isArray(artifact.request_hashes) || !artifact.request_hashes.every(hasString))) {
    errors.push("model artifact request_hashes is invalid");
  }
  for (const field of ["latency_ms", "cost_usd"]) {
    if (artifact[field] !== undefined && (typeof artifact[field] !== "number" || !Number.isFinite(artifact[field]))) {
      errors.push(`model artifact has invalid ${field}`);
    }
  }
  const execution = artifact.execution === undefined ? null : asRecord(artifact.execution);
  if (artifact.execution !== undefined && !execution) errors.push("model artifact execution is invalid");
  if (execution) {
    for (const field of ["requests", "latency_ms", "input_tokens", "output_tokens", "cost_usd"]) {
      const value = execution[field];
      if (value !== undefined && value !== null && (typeof value !== "number" || !Number.isFinite(value))) errors.push(`model artifact execution has invalid ${field}`);
    }
  }
  if (errors.length) return { status: "invalid", errors };
  return { status: "complete", errors: [], value: artifact as unknown as ModelOutputArtifact };
}

export function recordMap<T extends { faction_id: string; ability_id: string }>(records: readonly T[]): Map<string, T> {
  return new Map(records.map((record) => [identityKey(record), record]));
}

export function sourceRegion(record: FrozenAbility, span: ByteSpan): string {
  return Buffer.from(record.source_text, "utf8").subarray(span.start, span.end).toString("utf8");
}
