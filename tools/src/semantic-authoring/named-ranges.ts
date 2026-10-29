import { CompileError } from "./compile-error.js";
import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, enumValue, exactKeys } from "./family-validation.js";

/**
 * Named distances an army rule defines ("within Synapse Range"). A name maps to the id of the
 * ability whose current aura range it is, so the DSL carries it as `{aura_of: <ability-id>}`
 * (common.schema.json range-ref). The ability's own `within` holds the anchor and its extensions;
 * a leaf says only whose units are measured to.
 */
export const NAMED_RANGES = {
  contagion: { label: "Contagion Range", aura_of: "nurgles-gift-death-guard" },
  synapse: { label: "Synapse Range", aura_of: "synapse-tyranids" },
} as const;

/** The named range a leaf names, or a CompileError when the name is not registered. */
export function namedRange(name: unknown): { label: string; aura_of: string } {
  if (typeof name !== "string" || !Object.hasOwn(NAMED_RANGES, name)) throw new CompileError(`Unknown named range ${String(name)}.`);
  return NAMED_RANGES[name as keyof typeof NAMED_RANGES];
}

export const NAMED_RANGE_NAMES = Object.keys(NAMED_RANGES) as ReadonlyArray<keyof typeof NAMED_RANGES>;

/** The largest named-range distance a leaf records, in inches. */
const MAX_RANGE_INCHES = 24;

/**
 * The rule that defines a named range says how far it reaches: "In the first battle round, the
 * Contagion Range is three inches" is a battle-round leaf and a named-range-value leaf, and
 * "Contagion Range cannot be greater than 12" after modifiers" is a named-range-cap leaf. Both are
 * CONDITION-role qualifiers that compile-named-range.ts folds into the defining record's own
 * aura-range (range_ref) before any role-based pass, so the role never reaches lowering.
 */
export const NAMED_RANGE_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "named-range-value",
    version: 1,
    role: "CONDITION",
    label: "How far a named range reaches",
    description: "\"the Contagion Range is three inches\": the distance a named range (contagion, synapse) has in the record that defines it. A battle-round leaf right before it limits the value to those battle rounds; the record's values then form one per-battle-round table from the first battle round, whose last entry holds for the rest of the battle. Without a battle-round leaf the range is that distance throughout.",
    starter: { range: "", inches: null },
    parameterSchema: {
      type: "object",
      required: ["range", "inches"],
      properties: {
        range: { enum: NAMED_RANGE_NAMES },
        inches: { type: "integer", minimum: 1, maximum: MAX_RANGE_INCHES },
      },
      additionalProperties: false,
    },
  },
  {
    id: "named-range-cap",
    version: 1,
    role: "CONDITION",
    label: "Cap on a named range",
    description: "\"Contagion Range cannot be greater than 12\" after modifiers\": the named range, every extension and modifier included, never exceeds this many inches. It caps the aura of the record that defines the range.",
    starter: { range: "", inches: null },
    parameterSchema: {
      type: "object",
      required: ["range", "inches"],
      properties: {
        range: { enum: NAMED_RANGE_NAMES },
        inches: { type: "integer", minimum: 1, maximum: MAX_RANGE_INCHES },
      },
      additionalProperties: false,
    },
  },
];

/** Validate and canonicalise a named-range leaf's parameters, or return null for other families. */
export function normalizeNamedRangeParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "named-range-value" && family !== "named-range-cap") return null;
  exactKeys(input, ["range", "inches"], family);
  return {
    range: enumValue(input.range, NAMED_RANGE_NAMES, `${family}.range`),
    inches: boundedInteger(input.inches, 1, MAX_RANGE_INCHES, `${family}.inches`),
  };
}
