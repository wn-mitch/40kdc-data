import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, enumValue, exactKeys } from "./family-validation.js";

/**
 * Per-model weapon count: "equipped with two melee weapons in addition to its close combat weapon".
 * Holds when the subject carries a weapon named `other_than` and exactly `count` weapons of
 * `weapon_type` whose name is not `other_than`. Unlike `loadout` (identical weapons across a
 * unit's models), this counts one model's own weapons.
 */

export const EQUIPPED_WEAPON_TYPES = ["melee", "ranged"] as const;

export const EQUIPPED_WEAPON_COUNT_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "equipped-weapon-count",
    version: 1,
    role: "CONDITION",
    label: "Model is equipped with a number of weapons besides a named one",
    description: "Requires this model to carry a weapon with the given printed name, and exactly count weapons of a melee or ranged weapon type whose names differ from it (\"equipped with two melee weapons in addition to its close combat weapon\").",
    starter: { subject: "this-model", weapon_type: "melee", count: 1, other_than: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "weapon_type", "count", "other_than"],
      properties: {
        subject: { enum: ["this-model"] },
        weapon_type: { enum: [...EQUIPPED_WEAPON_TYPES] },
        count: { type: "integer", minimum: 1, maximum: 12 },
        other_than: { type: "string", minLength: 1 },
        negated: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
];

/** Validate and canonicalise one equipped-weapon-count leaf, or return null for other families. */
export function normalizeEquippedWeaponParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "equipped-weapon-count") return null;
  exactKeys(input, ["subject", "weapon_type", "count", "other_than", ...("negated" in input ? ["negated"] : [])], family);
  const subject = enumValue(input.subject, ["this-model"], "equipped-weapon-count.subject");
  const name = typeof input.other_than === "string" ? input.other_than.trim() : "";
  if (name.length === 0) throw new TypeError("equipped-weapon-count.other_than is the printed name of the weapon it excludes.");
  return {
    subject,
    weapon_type: enumValue(input.weapon_type, [...EQUIPPED_WEAPON_TYPES], "equipped-weapon-count.weapon_type"),
    count: boundedInteger(input.count, 1, 12, "equipped-weapon-count.count"),
    other_than: name,
    ...("negated" in input ? { negated: input.negated === true } : {}),
  };
}
