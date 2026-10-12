import type { SemanticFamilyDefinition } from "./contracts.js";
import { type FamilyExtension, properties, type Schema, withProperties } from "./family-extension-helpers.js";
import { enumValue, exactKeys } from "./family-validation.js";
import { NAMED_ID, namedId } from "./family-extensions-w8-named.js";

/**
 * Tier-7 gaps (t7-new-gaps): a permission-exercised condition, and a roll that an ability prohibits
 * in favour of its own result.
 *
 * - move-passthrough-used@1 is a CONDITION: "but if it does, after it has moved, …" names the move
 *   that used a move-through permission. It folds into the move-ended moment after it
 *   (compile-passthrough-used.ts), which takes the `through` filter (event@23).
 * - roll-prohibition@2 lets the prohibited roll be a named ability's own roll ({ability: id}): "do
 *   not roll to gain a Blood Tithe point" forbids that ability's roll. The DSL form is a roll-result
 *   pass on that roll (compile-roll-prohibition.ts).
 */

/** The terrain kinds a move-through permission can pass through that a "but if it does" can name. */
export const PASSTHROUGH_USED_VALUES = ["tall-terrain"] as const;

export const MOVE_PASSTHROUGH_USED_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "move-passthrough-used",
    version: 1,
    role: "CONDITION",
    label: "Moved through permitted terrain",
    description: "\"But if it does, after it has moved, …\": the move-ended moment that follows it happened only when the move passed through the named terrain under the move-through before it. It qualifies that moment and gates nothing by itself.",
    starter: { passthrough: "" },
    parameterSchema: {
      type: "object",
      required: ["passthrough"],
      properties: { passthrough: { enum: PASSTHROUGH_USED_VALUES } },
      additionalProperties: false,
    },
  },
];

/** move-passthrough-used@1 parameters: the terrain kind the move passed through. */
export function normalizeMovePassthroughUsedParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "move-passthrough-used") return null;
  exactKeys(input, ["passthrough"], family);
  return { passthrough: enumValue(input.passthrough, PASSTHROUGH_USED_VALUES, "move-passthrough-used.passthrough") };
}

const ABILITY_ROLL_SCHEMA: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["ability"],
  properties: { ability: { type: "string", pattern: NAMED_ID.source } },
};

export const FAMILY_EXTENSIONS_16_T7: readonly FamilyExtension[] = [
  {
    // "…, but if it does, after it has moved, …": the moment's move passed through the named terrain.
    family: "event",
    description: "As the previous version, plus through on a move-ended moment: the move passed through the named terrain. Written by the move-passthrough-used fold, not authored directly.",
    schema: (previous) => withProperties(previous, {
      through: { enum: PASSTHROUGH_USED_VALUES, "x-optional": true, "x-only-when": { kind: ["move-ended"] } },
    }),
    normalize: (input, previous) => {
      if (!("through" in input)) return previous(input);
      if (input.kind !== "move-ended") throw new TypeError("event.through describes a move-ended moment only.");
      // The previous version rejects keys it does not know, so the new one is checked and removed first.
      const { through, ...rest } = input;
      return { ...previous(rest), through: enumValue(through, PASSTHROUGH_USED_VALUES, "event.through") };
    },
  },
  {
    // "do not roll to gain a Blood Tithe point": the roll a named ability makes is the one forbidden.
    family: "roll-prohibition",
    description: "As the previous version, and roll can be a named ability's own roll, {ability: id}: the roll that ability makes.",
    schema: (previous) => withProperties(previous, {
      roll: { anyOf: [properties(previous).roll!, ABILITY_ROLL_SCHEMA] },
    }),
    normalize: (input, previous) => {
      if (input.roll === null || typeof input.roll !== "object") return previous(input);
      exactKeys(input, ["roll"], "roll-prohibition");
      exactKeys(input.roll as Record<string, unknown>, ["ability"], "roll-prohibition.roll");
      return { roll: { ability: namedId((input.roll as { ability: unknown }).ability, "roll-prohibition.roll.ability") } };
    },
  },
];
