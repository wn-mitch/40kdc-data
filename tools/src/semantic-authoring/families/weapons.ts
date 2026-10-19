import { ANTECEDENT } from "../antecedent-families.js";
import type { SemanticFamilyDefinition } from "../contracts.js";
import { EVENT_SUBJECT, type FamilyExtension, optional, standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";
import { enumValue, exactKeys } from "../family-validation.js";
import { WEAPON_REMOVAL_KEYWORDS } from "../weapon-buff-families.js";
import { normalizeWave9Keyword, widenKeyword } from "./weapon-keywords.js";
import { WEAPON, WEAPON_KEYWORDS, WEAPON_NAMES_SCHEMA, antecedentSubject, refuseWith, weaponName, weaponNameList, withoutRequired } from "./shared.js";

/**
 * Versions of the weapon families (weapon-property-scope, weapon-ability-grant,
 * weapon-ability-keyword), and the weapon-ability-range base family. Each version checks only its
 * own additions and hands the rest of a leaf to the previous version, so every earlier leaf still
 * fits it unchanged.
 */

/** Placeholder for a key the previous version requires but this one takes from a bound weapon. */
const BOUND_STAND_IN = "all";

/**
 * The keywords a scope can select by: those a removal can name and that characteristic-modifier
 * already takes as weapon_keyword. Extra Attacks and Close-quarters can be removed but are not in
 * WEAPON_KEYWORDS, so a scope cannot select weapons by them.
 */
export const SCOPE_WEAPON_KEYWORDS: readonly string[] = WEAPON_KEYWORDS.filter((keyword) => WEAPON_REMOVAL_KEYWORDS.includes(keyword));

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

const FRAME = "frame";

const ANTECEDENT_FRAME = "antecedent";

/** Keys that name a recipient or weapon scope: an antecedent frame may not state them, the binder supplies them. */
const GRANT_SCOPE_KEYS = ["subject", "weapon_type", "keyword", "keywords", "weapon", "weapon_name", "weapon_keyword", "incoming"];

const SCOPE_KEYS = ["subject", "weapon_type", "weapon", "weapon_keyword", "weapon_name", "incoming"];

/** Stand-ins the previous version requires for a frame; the binder replaces them before lowering. */
const STAND_IN = { subject: "this-unit", weapon_type: "all" } as const;

const SCOPE_EVENT_SUBJECT: FamilyExtension = {
  family: "weapon-property-scope",
  version: 7,
  description: "As the previous version, plus subject event-subject: the weapons are equipped by models in the unit the record's moment names (\"weapons equipped by models in the attacking unit have\").",
  schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [EVENT_SUBJECT]) }),
  normalize: (input, previous) => input.subject === EVENT_SUBJECT ? standIn(input, "subject", "this-unit", previous) : previous(input),
};

export const WEAPON_EXTENSIONS: readonly FamilyExtension[] = [
  // "Friendly WORLD EATERS units' melee attacks have +1 A": the units a bare filter before the
  // scope matches (compile-antecedent.ts binds the antecedent; compile-unit-filters.ts folds it).
  antecedentSubject("weapon-property-scope", 2, "\"Friendly X units' melee attacks have\": the units a unit-filter right before it matches"),
  /**
   * The one weapon an earlier select-weapon bound; compile-weapon-antecedent.ts resolves it per
   * record.
   */
  {
    // "That weapon's attacks have:": the scope is the bound weapon, so it names no weapon_type.
    family: "weapon-property-scope",
    version: 3,
    description: "As the previous version, plus weapon: antecedent, the weapon an earlier select-weapon bound (\"That weapon's attacks have\"). It takes subject this-model and no weapon_type; a stat adjustment after it is the only property it can scope.",
    schema: (previous) => withProperties(withoutRequired(previous, "weapon_type"), {
      weapon: optional({ enum: ["antecedent"] }),
    }),
    normalize: (input, previous) => {
      if (input.weapon === undefined) return previous(input);
      if (input.weapon !== "antecedent") throw new TypeError("weapon-property-scope.weapon takes only antecedent.");
      if ("weapon_type" in input) throw new TypeError("weapon-property-scope.weapon antecedent is the bound weapon; it takes no weapon_type.");
      if (input.subject !== "this-model") throw new TypeError("weapon-property-scope.weapon antecedent belongs to this-model, the model that made the selection.");
      return { subject: "this-model", weapon: "antecedent" };
    },
  },
  /**
   * Weapons named by one weapon keyword ("Your unit's [Blast] ranged attacks"), the scope a
   * weapon-ability removal needs. The removal family itself (weapon-ability-removal) is a base
   * family in weapon-buff-families.ts.
   */
  {
    // "Your unit's [Blast] ranged attacks: Do not have [Blast]. Have +1 A.": the scope selects weapons by a keyword.
    family: "weapon-property-scope",
    version: 4,
    description: "As the previous version, plus weapon_keyword: the scope selects only weapons with that weapon ability (Blast, Torrent, Heavy …). weapon_type is still required, and a bound-weapon scope takes no weapon_keyword.",
    schema: (previous) => withProperties(previous, { weapon_keyword: optional({ enum: SCOPE_WEAPON_KEYWORDS }) }),
    normalize: (input, previous) => {
      if (!("weapon_keyword" in input)) return previous(input);
      if ("weapon" in input) throw new TypeError("weapon-property-scope.weapon_keyword cannot combine with weapon: the bound weapon is one weapon, not a keyword's weapons.");
      const { weapon_keyword: keyword, ...rest } = input;
      const normalized = previous(rest);
      return { ...normalized, weapon_keyword: enumValue(keyword, SCOPE_WEAPON_KEYWORDS, "weapon-property-scope.weapon_keyword") };
    },
  },
  /**
   * An antecedent frame: a weapon-ability-grant or a weapon-property-scope with `frame:
   * "antecedent"` names no recipient or weapon type of its own. The binder
   * (compile-weapon-antecedent.ts bindFrameAntecedents) copies them from the nearest earlier frame
   * or scope before any fold runs, so "Or: If X, [K] and +1 AP" inherits the branch's weapons from
   * the sentence before it. The previous version gets stand-in values it requires and this one does
   * not.
   */
  {
    // "Or: If the doctrine is active, … +1 AP": the stat scope takes its recipient and weapon type from the branch before it.
    family: "weapon-property-scope",
    version: 5,
    description: "As the previous version, and frame: antecedent makes a scope with no subject or weapon_type: the binder copies both from the nearest earlier frame or scope. It names no weapon, weapon_keyword, weapon_name or incoming attacks.",
    schema: (previous) => withoutRequired(withProperties(previous, { [FRAME]: optional({ enum: [ANTECEDENT_FRAME] }) }), ["subject", "weapon_type"]),
    normalize: (input, previous) => {
      if (!(FRAME in input)) return previous(input);
      if (input[FRAME] !== ANTECEDENT_FRAME) throw new TypeError(`weapon-property-scope.frame is ${ANTECEDENT_FRAME} or absent.`);
      for (const key of SCOPE_KEYS) {
        if (key in input) throw new TypeError(`weapon-property-scope antecedent frame cannot also name ${key}; the binder takes it from an earlier frame or scope.`);
      }
      const { [FRAME]: _frame, ...rest } = input;
      const { subject: _subject, weapon_type: _type, ...others } = previous({ ...rest, ...STAND_IN });
      return { ...others, [FRAME]: ANTECEDENT_FRAME };
    },
  },
  /**
   * Named weapons: a scope or a stat change that names each weapon it covers ("your unit's A, B and
   * C weapons", "add 3 to the A characteristic of X and Y", "those weapons"). A list is fanned out
   * to one step per name when the leaf compiles (compile-fragments.ts); each name is checked
   * against the faction's weapon records by compile-weapon-names.ts.
   */
  {
    // "Your unit's Hot-shot Lasguns and Sentry Hot-shot Volley Guns weapons have …": a scope over named weapons.
    family: "weapon-property-scope",
    version: 6,
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
  /**
   * Subject event-subject: the unit a Stratagem's or ability's moment names (the enemy unit that
   * selected its targets), where the family's own enum named only the bearer, a selection or an
   * earlier leaf's unit.
   */
  SCOPE_EVENT_SUBJECT,
  {
    // "Your unit's Boltgun weapons have:", "its Bloody Twins weapon has:".
    family: "weapon-property-scope",
    version: 8,
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
    // "That attack has the [LETHAL HITS] ability": the weapon making the attack, whoever makes it.
    family: "weapon-ability-grant",
    version: 7,
    description: "As the previous version, and the subject can be attack: the weapon making the attack the ability is resolving.",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", ["attack"]) }),
    normalize: (input, previous) => input.subject === "attack" ? standIn(input, "subject", "this-unit", previous) : previous(input),
  },
  /**
   * The keyword additions weapon-ability-keyword version 2 takes (Close-quarters, Cleave N, Anti
   * with a target list).
   */
  {
    family: "weapon-ability-grant",
    version: 8,
    description: "As the previous version, and the keyword can be Close-quarters, Cleave N or Anti with several slash-separated target keywords.",
    schema: widenKeyword,
    normalize: normalizeWave9Keyword,
  },
  /**
   * "That weapon" names a weapon an earlier leaf of the same record bound: `weapon: antecedent`
   * binds the weapon a select-weapon bound (compile-weapon-antecedent.ts).
   */
  {
    // "that weapon has the [DEVASTATING WOUNDS] ability": the weapon an earlier select-weapon bound.
    family: "weapon-ability-grant",
    version: 9,
    description: "As the previous version, and weapon: antecedent gives the keyword to the weapon an earlier select-weapon bound (\"that weapon has the [X] ability\"). The subject is this-model and one keyword is named; weapon_type is the bound weapon's and may be left out; weapon_name and weapon_keyword cannot narrow a bound weapon.",
    schema: (previous) => withoutRequired(withProperties(previous, { weapon: optional({ enum: [ANTECEDENT] }) }), "weapon_type"),
    normalize: (input, previous) => {
      if (!(WEAPON in input)) {
        if (input.weapon_type === undefined) throw new TypeError("weapon-ability-grant needs weapon_type unless weapon is antecedent.");
        return previous(input);
      }
      if (input.weapon !== ANTECEDENT) throw new TypeError(`weapon-ability-grant.weapon is ${ANTECEDENT} or absent.`);
      if (input.subject !== "this-model") throw new TypeError("weapon-ability-grant with weapon antecedent takes subject this-model: the bound weapon is this model's.");
      if (typeof input.keyword !== "string") throw new TypeError("weapon-ability-grant with weapon antecedent names one keyword; a frame has none.");
      if (input.weapon_type === "all") throw new TypeError("weapon-ability-grant with weapon antecedent takes the bound weapon's melee or ranged type, not all.");
      for (const key of ["weapon_name", "weapon_keyword", "incoming"]) {
        if (key in input) throw new TypeError(`weapon-ability-grant with weapon antecedent cannot also name ${key}; the bound weapon is already one weapon.`);
      }
      const { weapon: _weapon, weapon_type: stated, ...rest } = input;
      const normalized = previous({ ...rest, weapon_type: stated ?? BOUND_STAND_IN });
      const { weapon_type: _standIn, ...others } = normalized;
      return stated === undefined ? { ...others, weapon: ANTECEDENT } : { ...others, weapon_type: normalized.weapon_type, weapon: ANTECEDENT };
    },
  },
  /**
   * An antecedent frame, as weapon-property-scope version 5 takes it (compile-weapon-antecedent.ts
   * bindFrameAntecedents).
   */
  {
    // "Or: If the doctrine is active, [K]": the keyword frame takes its recipient from the branch before it.
    family: "weapon-ability-grant",
    version: 10,
    description: "As the previous version, and frame: antecedent makes a keyword-less frame with no subject or weapon_type: the binder copies both from the nearest earlier frame or scope. A frame with frame antecedent names no keyword, weapon name, weapon keyword or incoming attacks.",
    schema: (previous) => withoutRequired(withProperties(previous, { [FRAME]: optional({ enum: [ANTECEDENT_FRAME] }) }), ["subject", "weapon_type"]),
    normalize: (input, previous) => {
      if (!(FRAME in input)) return previous(input);
      if (input[FRAME] !== ANTECEDENT_FRAME) throw new TypeError(`weapon-ability-grant.frame is ${ANTECEDENT_FRAME} or absent.`);
      for (const key of GRANT_SCOPE_KEYS) {
        if (key in input) throw new TypeError(`weapon-ability-grant antecedent frame cannot also name ${key}; the binder takes it from an earlier frame.`);
      }
      const { [FRAME]: _frame, ...rest } = input;
      const { subject: _subject, weapon_type: _type, ...others } = previous({ ...rest, ...STAND_IN });
      return { ...others, [FRAME]: ANTECEDENT_FRAME };
    },
  },
  /**
   * Weapon-ability vocabulary: the keywords the printed rules name that the keyword enum and
   * pattern did not yet take. Each widening adds keywords and changes nothing a previous version
   * accepted; weapon-ability-grant takes the same additions.
   *
   * - Close-quarters: a value-less keyword, distinct from the shooting mode `close-quarters`.
   * - Cleave N: a value-carrying keyword, N from 1 to 9.
   * - Anti with a target list: "Anti-Monster/Vehicle 4+" (one of the slash-separated targets).
   */
  {
    family: "weapon-ability-keyword",
    version: 2,
    description: "As the previous version, plus Close-quarters, Cleave N (N from 1 to 9) and Anti with several slash-separated target keywords (\"Anti-Monster/Vehicle 4+\", one of them).",
    schema: widenKeyword,
    normalize: normalizeWave9Keyword,
  },
];
