import type { SemanticFamilyDefinition } from "./contracts.js";
import { booleanValue, enumValue, exactKeys } from "./family-validation.js";
import { SUBJECT_REF } from "./predicate-families.js";

/**
 * optional-cost-paid: "if you spent YP during this use of this Stratagem" (window use) and "if you
 * spent no YP in that turn" (window turn). The spend itself is an optional part of the ability
 * (compile-optional-cost.ts); window use reads the designation that part sets on the subject.
 */

/** The pools a spend can name here; each maps to the designation its optional spend sets (compile-optional-cost.ts). */
export const OPTIONAL_COST_POOLS = ["yp-pool"] as const;
export const OPTIONAL_COST_WINDOWS = ["use", "turn"] as const;

export const OPTIONAL_COST_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "optional-cost-paid",
    version: 1,
    role: "CONDITION",
    label: "A resource was spent this use or this turn",
    description: "Requires that the optional spend of a pool was paid during this use of the ability (window use, with the subject that spent it), or that the pool was not spent at all in the turn (window turn, negated for \"you spent no YP in that turn\").",
    starter: { pool: "yp-pool", window: "use", subject: "this-unit" },
    parameterSchema: {
      type: "object",
      required: ["pool", "window"],
      properties: {
        pool: { enum: [...OPTIONAL_COST_POOLS] },
        window: { enum: [...OPTIONAL_COST_WINDOWS] },
        subject: { enum: SUBJECT_REF },
        negated: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
];

/**
 * Parameter normalisation for optional-cost-paid. Window use names the subject that spent (required,
 * never defaulted); window turn names no subject and reads the pool's spends of the whole turn.
 */
export function normalizeOptionalCostParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "optional-cost-paid") return null;
  const window = enumValue(input.window, OPTIONAL_COST_WINDOWS, "optional-cost-paid.window");
  const keys = ["pool", "window", ...(window === "use" ? ["subject"] : []), ...("negated" in input ? ["negated"] : [])];
  exactKeys(input, keys, family);
  const pool = enumValue(input.pool, OPTIONAL_COST_POOLS, "optional-cost-paid.pool");
  if (window === "use" && input.subject === undefined) throw new TypeError("optional-cost-paid window use needs the subject that spent the pool.");
  const negated = "negated" in input ? booleanValue(input.negated, "optional-cost-paid.negated") : false;
  if (negated && window !== "turn") throw new TypeError("optional-cost-paid negated is only for window turn (\"spent no YP in that turn\").");
  return {
    pool,
    window,
    ...(window === "use" ? { subject: enumValue(input.subject, SUBJECT_REF, "optional-cost-paid.subject") } : {}),
    ...(negated ? { negated: true } : {}),
  };
}
