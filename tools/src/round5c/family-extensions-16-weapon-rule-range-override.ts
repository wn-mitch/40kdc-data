import type { SemanticFamilyDefinition } from "./contracts.js";
import { enumValue, exactKeys } from "./family-validation.js";
import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";

/**
 * Wave-10 weapon rule range override. A weapon's range can stand in for a distance: a unit-position
 * within the attacking weapon's full range or half of it ("within half range" of the attack's
 * target). The distance is the weapon's own, so the leaf takes no inches.
 */

const WEAPON_RANGE = ["half", "full"] as const;

export const FAMILY_EXTENSIONS_16_WEAPON_RANGE_OVERRIDE: readonly FamilyExtension[] = [
  {
    family: "unit-position",
    description: "As the previous version, plus weapon_range: a within distance equal to the attacking weapon's range (full) or half of it (half), measured from the attacker to the target. Such a leaf takes no inches.",
    schema: (previous) => withProperties(previous, {
      weapon_range: optional({ enum: [...WEAPON_RANGE], "x-only-when": { kind: ["within"] } }),
    }),
    normalize: (input, previous) => {
      if (!("weapon_range" in input)) return previous(input);
      const { weapon_range: range, ...rest } = input;
      if (rest.kind !== "within") throw new TypeError("unit-position.weapon_range measures a within distance.");
      if ("inches" in rest) throw new TypeError("unit-position.weapon_range takes no inches: the distance is the attacking weapon's range.");
      if (rest.of !== "attacker") throw new TypeError("unit-position.weapon_range is measured from the attacker.");
      if (rest.subject !== "target") throw new TypeError("unit-position.weapon_range describes the attack's target.");
      // The previous version checks the rest with a distance standing in; the distance is not kept.
      const { inches: _inches, ...checked } = previous({ ...rest, inches: 1 });
      return { ...checked, weapon_range: enumValue(range, WEAPON_RANGE, "unit-position.weapon_range") };
    },
  },
];

const WEAPON_RANGE_KEYWORDS = ["Rapid Fire"] as const;
const WEAPON_RANGE_WITHIN = ["weapon"] as const;

/**
 * `weapon-ability-range`: a weapon ability's test (Rapid Fire's bonus) applies out to the attacking
 * weapon's full range rather than half of it, for the units the subject names. One effect leaf
 * carries the whole clause; the test is the keyword and the range, with no condition leaf.
 */
export const WEAPON_RANGE_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "weapon-ability-range",
    version: 1,
    role: "EFFECT",
    label: "Weapon ability tested at full range",
    description: "A named weapon ability (Rapid Fire) benefits its attacks when the target is within the attacking weapon's full range, not only half of it, for the units the subject names.",
    starter: { subject: "this-unit", keyword: "Rapid Fire", within: "weapon" },
    parameterSchema: {
      type: "object",
      required: ["subject", "keyword", "within"],
      properties: {
        subject: { enum: ["this-unit", "this-model"] },
        keyword: { enum: [...WEAPON_RANGE_KEYWORDS] },
        within: { enum: [...WEAPON_RANGE_WITHIN] },
      },
      additionalProperties: false,
    },
  },
];

/** The weapon-ability-range parameters, or null for another family. */
export function normalizeWeaponRangeParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "weapon-ability-range") return null;
  exactKeys(input, ["subject", "keyword", "within"], family);
  return {
    subject: enumValue(input.subject, ["this-unit", "this-model"], "weapon-ability-range.subject"),
    keyword: enumValue(input.keyword, WEAPON_RANGE_KEYWORDS, "weapon-ability-range.keyword"),
    within: enumValue(input.within, WEAPON_RANGE_WITHIN, "weapon-ability-range.within"),
  };
}
