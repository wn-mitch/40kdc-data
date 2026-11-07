/**
 * Declared answers for leaf conditions the engine cannot evaluate from its context.
 *
 * A leaf condition the context does not decide ("while an enemy unit is engaged with this unit",
 * "if this unit disembarked this turn") evaluates to `"unknown"`. The translator reports each such
 * leaf as a {@link ConditionNeed}; the caller answers it in {@link EngineContext.conditionFacts} under
 * the need's `key`, and the leaf then evaluates to that answer. A compound (`and`/`or`/`not`) is never
 * a need itself: it evaluates from its leaves.
 *
 * @packageDocumentation
 */
import type { TranslationPerspective } from "./from-dsl.js";

/** One leaf condition the context cannot decide, with the key its declared answer goes under. */
export type ConditionNeed = {
  /** {@link conditionFactKey} of the leaf: the key {@link EngineContext.conditionFacts} reads. */
  key: string;
  /** The leaf condition as authored. */
  condition: Record<string, unknown>;
  /** The perspective the leaf was evaluated from; its unit references are relative to it. */
  perspective: TranslationPerspective;
};

/**
 * JSON with object keys sorted at every depth and no whitespace, so equal conditions serialize to
 * equal text in every port.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The key a leaf condition's declared answer goes under: the perspective, then the leaf's canonical
 * JSON. Unit references such as `this-unit` name a different unit from each perspective, so the
 * perspective is part of the key.
 */
export function conditionFactKey(condition: Record<string, unknown>, perspective: TranslationPerspective): string {
  return `${perspective}:${canonicalJson(condition)}`;
}

/**
 * The leaves of `condition` that leave it undecided, deduplicated by key in first-seen order.
 * `evaluate` is the engine's evaluator; a compound recurses into each operand that evaluates
 * `"unknown"`, so an `and` already decided by a false operand contributes nothing.
 */
export function conditionNeeds(
  condition: Record<string, unknown>,
  perspective: TranslationPerspective,
  evaluate: (condition: Record<string, unknown>) => boolean | "unknown",
): ConditionNeed[] {
  const out: ConditionNeed[] = [];
  const seen = new Set<string>();
  const visit = (node: Record<string, unknown>) => {
    if (evaluate(node) !== "unknown") return;
    if (typeof node.operator === "string" && Array.isArray(node.operands)) {
      for (const operand of node.operands) {
        if (operand !== null && typeof operand === "object" && !Array.isArray(operand)) visit(operand as Record<string, unknown>);
      }
      return;
    }
    const key = conditionFactKey(node, perspective);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, condition: node, perspective });
  };
  visit(condition);
  return out;
}
