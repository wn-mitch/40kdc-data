import { WEAPON_CHARACTERISTICS } from "./effect-families.js";
import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";
import { weaponNameList } from "./family-extensions-16-multi-weapon-name.js";
import { WEAPON_KEYWORDS } from "./family-extensions-2.js";
import { enumValue } from "./family-validation.js";

/**
 * Weapon scopes that name one weapon, a set that selects weapons by keyword, and a roll modifier
 * for named weapons. Each version checks only its own additions and hands the rest of a leaf to the
 * previous version.
 */

/** Rolls a weapon name can limit: the attacker's three rolls and the Hazard roll a weapon causes. */
export const NAMED_WEAPON_ROLLS = ["hit", "wound", "damage", "hazard"] as const;

/** One printed weapon name: non-empty, with no padding. */
function weaponName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) throw new TypeError(`${label} takes one printed weapon name, with no padding.`);
  return value;
}

/** Keys that select weapons some other way; one name takes none of them. */
function refuseWith(input: Record<string, unknown>, keys: readonly string[], label: string): void {
  for (const key of keys) if (key in input) throw new TypeError(`${label} cannot combine with ${key}.`);
}

export const FAMILY_EXTENSIONS_20_WEAPON_SCOPE_NAME_KEYWORD_EXCLUSION: readonly FamilyExtension[] = [
  {
    // "Your unit's Boltgun weapons have:", "its Bloody Twins weapon has:".
    family: "weapon-property-scope",
    description: "As the previous version, plus weapon_name: the scope selects the weapons with one printed name (\"your unit's X weapons\", \"its X weapon\"). weapon_type is required with it (all is allowed). It takes no weapon_names, weapon_keyword, weapon or frame.",
    schema: (previous) => withProperties(previous, { weapon_name: optional({ type: "string", minLength: 1 }) }),
    normalize: (input, previous) => {
      if (!("weapon_name" in input)) return previous(input);
      refuseWith(input, ["weapon_names", "weapon_keyword", "weapon", "frame"], "weapon-property-scope.weapon_name");
      if (input.weapon_type === undefined) throw new TypeError("weapon-property-scope.weapon_name needs weapon_type (all is allowed).");
      const { weapon_name: name, ...rest } = input;
      return { ...previous(rest), weapon_name: weaponName(name, "weapon-property-scope.weapon_name") };
    },
  },
  {
    // "change the Attacks characteristic of Torrent weapons to 6".
    family: "characteristic-set",
    description: "As the previous version, plus weapon_keyword: the set applies to the weapons that print this weapon ability (\"the Attacks characteristic of Torrent weapons\"). It needs weapon_type (all is allowed) and a weapon characteristic, and takes no weapon_name or values.",
    schema: (previous) => withProperties(previous, { weapon_keyword: optional({ enum: WEAPON_KEYWORDS }) }),
    normalize: (input, previous) => {
      if (!("weapon_keyword" in input)) return previous(input);
      refuseWith(input, ["weapon_name", "values"], "characteristic-set.weapon_keyword");
      if (input.weapon_type === undefined) throw new TypeError("characteristic-set.weapon_keyword needs weapon_type (all is allowed).");
      if (!(WEAPON_CHARACTERISTICS as readonly string[]).includes(String(input.characteristic))) {
        throw new TypeError("characteristic-set.weapon_keyword selects weapons, so it sets a weapon characteristic.");
      }
      const { weapon_keyword: keyword, ...rest } = input;
      return { ...previous(rest), weapon_keyword: enumValue(keyword, WEAPON_KEYWORDS, "characteristic-set.weapon_keyword") };
    },
  },
  {
    // "+1 to hazard rolls made for its X and Y weapons".
    family: "roll-modifier",
    description: "As the previous version, plus weapon_name (one printed weapon name) or weapon_names (two to eight): the modifier applies to the roll made for those weapons (\"+1 to hazard rolls made for its X and Y weapons\"). It needs a hit, wound, damage or hazard roll, and takes no rolls; weapon_name and weapon_names exclude each other.",
    schema: (previous) => withProperties(previous, {
      weapon_name: optional({ type: "string", minLength: 1 }),
      weapon_names: optional({ type: "array", items: { type: "string", minLength: 1 }, minItems: 2, maxItems: 8, uniqueItems: true }),
    }),
    normalize: (input, previous) => {
      if (!("weapon_name" in input) && !("weapon_names" in input)) return previous(input);
      refuseWith(input, ["rolls"], "roll-modifier weapon names");
      if ("weapon_name" in input && "weapon_names" in input) throw new TypeError("roll-modifier.weapon_name cannot combine with weapon_names.");
      if (!(NAMED_WEAPON_ROLLS as readonly unknown[]).includes(input.roll)) {
        throw new TypeError(`roll-modifier weapon names need a ${NAMED_WEAPON_ROLLS.join(", ")} roll.`);
      }
      const { weapon_name: name, weapon_names: names, ...rest } = input;
      return {
        ...previous(rest),
        ...(name !== undefined ? { weapon_name: weaponName(name, "roll-modifier.weapon_name") } : {}),
        ...(names !== undefined ? { weapon_names: weaponNameList(names, "roll-modifier.weapon_names") } : {}),
      };
    },
  },
];
