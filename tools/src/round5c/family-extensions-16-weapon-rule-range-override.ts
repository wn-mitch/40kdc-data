import { enumValue } from "./family-validation.js";
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
