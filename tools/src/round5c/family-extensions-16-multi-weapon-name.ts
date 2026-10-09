import { type FamilyExtension, optional, widenedEnum, withProperties } from "./family-extension-helpers.js";

/**
 * Wave-10 named weapons: a scope or a stat change that names each weapon it covers ("your unit's A,
 * B and C weapons", "add 3 to the A characteristic of X and Y", "those weapons"). A list is fanned
 * out to one step per name when the leaf compiles (compile-fragments.ts); each name is checked
 * against the faction's weapon records by compile-weapon-names.ts. Each version checks only its own
 * additions and hands the rest of a leaf to the previous version.
 */

/** Two to eight printed weapon names: one name is one weapon_name, so a single name needs no list. */
export const WEAPON_NAMES_MIN = 2;
export const WEAPON_NAMES_MAX = 8;

const WEAPON_NAMES_SCHEMA = { type: "array", items: { type: "string", minLength: 1 }, minItems: WEAPON_NAMES_MIN, maxItems: WEAPON_NAMES_MAX, uniqueItems: true };

/** The weapon-name list a leaf carries: printed names, no padding, no repeats. */
export function weaponNameList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length < WEAPON_NAMES_MIN || value.length > WEAPON_NAMES_MAX) {
    throw new TypeError(`${label} names ${WEAPON_NAMES_MIN} to ${WEAPON_NAMES_MAX} weapons.`);
  }
  const names = value.map((item) => {
    if (typeof item !== "string" || item.trim() === "" || item !== item.trim()) throw new TypeError(`${label} takes printed weapon names, with no padding.`);
    return item;
  });
  if (new Set(names).size !== names.length) throw new TypeError(`${label} lists a weapon name twice.`);
  return names;
}

/** Keys that name weapons some other way; a list of names takes none of them. */
function refuseWith(input: Record<string, unknown>, keys: readonly string[], label: string): void {
  for (const key of keys) if (key in input) throw new TypeError(`${label} cannot combine with ${key}.`);
}

export const FAMILY_EXTENSIONS_16_MULTI_WEAPON_NAME: readonly FamilyExtension[] = [
  {
    // "Your unit's Hot-shot Lasguns and Sentry Hot-shot Volley Guns weapons have …": a scope over named weapons.
    family: "weapon-property-scope",
    description: "As the previous version, plus weapon_names: the scope selects the listed weapons by name (two to eight printed names, \"your unit's A, B and C weapons\"). weapon_type is required with names (all is allowed). It takes no weapon_name, weapon_keyword or weapon.",
    schema: (previous) => withProperties(previous, { weapon_names: optional(WEAPON_NAMES_SCHEMA) }),
    normalize: (input, previous) => {
      if (!("weapon_names" in input)) return previous(input);
      refuseWith(input, ["weapon_name", "weapon_keyword", "weapon"], "weapon-property-scope.weapon_names");
      if (input.weapon_type === undefined) throw new TypeError("weapon-property-scope.weapon_names needs weapon_type (all is allowed).");
      const { weapon_names: names, ...rest } = input;
      return { ...previous(rest), weapon_names: weaponNameList(names, "weapon-property-scope.weapon_names") };
    },
  },
  {
    // "add 3 to the Attacks characteristic of X and Y" and "improve the AP characteristic of those weapons by 1".
    family: "characteristic-modifier",
    description: "As the previous version, plus weapon_names (two to eight printed weapon names, \"of X and Y\") and weapon: earlier-named (\"those weapons\": the weapons the earlier named weapon leaves of this ability name, bound before compilation). Both need weapon_type (all is allowed). Names take no weapon_name, weapon_keyword or weapon; earlier-named takes no names of its own.",
    schema: (previous) => withProperties(previous, { weapon_names: optional(WEAPON_NAMES_SCHEMA), weapon: widenedEnum(previous, "weapon", ["earlier-named"]) }),
    normalize: (input, previous) => {
      if (input.weapon === "earlier-named") {
        refuseWith(input, ["weapon_name", "weapon_names", "weapon_keyword"], "characteristic-modifier.weapon earlier-named");
        if (input.weapon_type === undefined) throw new TypeError("characteristic-modifier.weapon earlier-named needs weapon_type (all is allowed).");
        const { weapon: _weapon, ...rest } = input;
        return { ...previous(rest), weapon: "earlier-named" };
      }
      if (!("weapon_names" in input)) return previous(input);
      refuseWith(input, ["weapon_name", "weapon_keyword", "weapon"], "characteristic-modifier.weapon_names");
      if (input.weapon_type === undefined) throw new TypeError("characteristic-modifier.weapon_names needs weapon_type (all is allowed).");
      const { weapon_names: names, ...rest } = input;
      return { ...previous(rest), weapon_names: weaponNameList(names, "characteristic-modifier.weapon_names") };
    },
  },
  {
    // "while targeting a unit within half range": the distance is half the attacking weapon's range.
    family: "unit-position",
    description: "As the previous version, plus distance half-weapon: within half the range of the weapon the attack uses, measured from the attacker (\"while targeting a unit within half range\"). It takes kind within and of attacker, and no inches, range_ref or wholly.",
    schema: (previous) => withProperties(previous, { distance: optional({ enum: ["half-weapon"], "x-only-when": { kind: ["within"] } }) }),
    normalize: (input, previous) => {
      if (!("distance" in input)) return previous(input);
      const { distance, ...rest } = input;
      if (distance !== "half-weapon") throw new TypeError(`unit-position.distance ${JSON.stringify(distance)} is not a listed distance.`);
      if (rest.kind !== "within") throw new TypeError("unit-position.distance measures a within distance.");
      if (rest.of !== "attacker") throw new TypeError("unit-position.distance is measured from the attacker: of attacker.");
      refuseWith(rest, ["inches", "range_ref", "wholly"], "unit-position.distance");
      // The previous version checks subject, of and negated with a stand-in distance; the stand-in is not kept.
      const { inches: _standIn, ...checked } = previous({ ...rest, inches: 1 });
      return { ...checked, distance: "half-weapon" };
    },
  },
];
