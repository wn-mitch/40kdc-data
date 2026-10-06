import type { SemanticFamilyDefinition } from "./contracts.js";
import { ANTECEDENT } from "./antecedent-families.js";
import { optional } from "./family-extension-helpers.js";
import { FOLLOWING_FILTER } from "./family-extensions-11.js";
import { enumValue, exactKeys } from "./family-validation.js";

/**
 * Past targeting as a condition: "an enemy unit that targeted a friendly unengaged X unit has
 * shot", "if that unit targeted this unit", "that made one or more attacks that targeted your unit
 * this phase". The subject selected the object as a target of its attacks within the window. It
 * lowers to the DSL's `happened` condition on targets-selected (`compile-conditions.ts`).
 */

/** Who did the targeting; antecedent points back to an earlier leaf's unit ("that unit"). */
export const TARGETED_SUBJECTS = ["this-unit", "this-model", "event-subject", "selected-unit", ANTECEDENT] as const;
/** What was targeted: this unit, or any unit the unit-filter right after the leaf matches. */
export const TARGETED_OBJECTS = ["this-unit", FOLLOWING_FILTER] as const;
/** event: in the moment the ability names (the shooting that just ended); phase: any time this phase. */
export const TARGETED_WINDOWS = ["phase", "event"] as const;
const ATTACK_TYPES = ["ranged", "melee", "psychic"] as const;

export const TARGETED_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "targeted",
    version: 1,
    role: "CONDITION",
    label: "Unit targeted another unit",
    description: "The subject selected the object as a target of its attacks: within the moment the ability names (window event: \"an enemy unit that targeted a\" + \"friendly unengaged X unit\" + \"has shot\") or at any time this phase (window phase: \"that made one or more attacks that targeted your unit this phase\"). object following-filter is any unit the unit-filter right after this leaf, in the same clause, matches; this-unit is the ability's own unit (a Stratagem's target). attack_type: only its ranged (or melee, psychic) attacks count.",
    starter: { subject: "", object: "", window: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "object", "window"],
      properties: {
        subject: { enum: TARGETED_SUBJECTS },
        object: { enum: TARGETED_OBJECTS },
        window: { enum: TARGETED_WINDOWS },
        attack_type: optional({ enum: ATTACK_TYPES }),
      },
      additionalProperties: false,
    },
  },
];

/** Validate and canonicalise a targeted leaf's parameters, or return null for other families. */
export function normalizeTargetedParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "targeted") return null;
  exactKeys(input, ["subject", "object", "window", ...(input.attack_type !== undefined ? ["attack_type"] : [])], family);
  const subject = enumValue(input.subject, TARGETED_SUBJECTS, "targeted.subject");
  const object = enumValue(input.object, TARGETED_OBJECTS, "targeted.object");
  if ((subject === "this-unit" || subject === "this-model") && object === "this-unit") throw new TypeError("targeted: a unit does not target itself; the subject is this unit (or its model) and so is the object.");
  const window = enumValue(input.window, TARGETED_WINDOWS, "targeted.window");
  return { subject, object, window, ...(input.attack_type !== undefined ? { attack_type: enumValue(input.attack_type, ATTACK_TYPES, "targeted.attack_type") } : {}) };
}
