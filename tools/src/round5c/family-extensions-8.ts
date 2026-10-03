import { activitiesExtension, type FamilyExtension, KEYWORD_ITEMS, keywordList, optional, properties, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";

/**
 * The eighth round of family extensions: the small gaps decision passes kept hitting. As in the
 * earlier rounds, a version checks only its own additions and hands the rest to the previous one.
 */

/** Activities a unit's history records, lowered to `happened` in compile-conditions.ts. */
export const HISTORY_ACTIVITIES = [
  "destroyed-enemy-unit-this-phase", "destroyed-enemy-unit-this-turn",
  "set-up-by-deep-strike-this-phase", "set-up-by-deep-strike-this-turn",
  "lost-models-to-triggering-attacks",
] as const;

/** Characteristic operations that scale a value instead of adding to it. */
const SCALING = ["halve", "multiply"] as const;

export const FAMILY_EXTENSIONS_8: readonly FamilyExtension[] = [
  {
    // "Halve the Damage characteristic of that attack", "triple its Attacks characteristic": the
    // DSL stat-modifier's halve and multiply. Halve takes no value; multiply names the factor.
    family: "characteristic-modifier",
    description: "As the previous version, and the operation can halve the characteristic (no value) or multiply it (value: the factor, 2 to 4).",
    schema: (previous) => withProperties(previous, { operation: widenedEnum(previous, "operation", SCALING) }),
    normalize: (input, previous) => {
      if (!(SCALING as readonly string[]).includes(input.operation as string)) return previous(input);
      const { value, ...rest } = input;
      if (input.operation === "halve") {
        if (value !== undefined) throw new TypeError("characteristic-modifier halve takes no value.");
        const { value: _value, ...normalized } = previous({ ...rest, operation: "add", value: 1 });
        return { ...normalized, operation: "halve" };
      }
      if (!Number.isInteger(value) || (value as number) < 2 || (value as number) > 4) throw new TypeError("characteristic-modifier multiply needs a whole factor from 2 to 4.");
      return { ...previous({ ...rest, operation: "add", value: 1 }), operation: "multiply", value };
    },
  },
  {
    // "Wholly within 6\" of a battlefield edge": the DSL's battlefield-edge place.
    family: "unit-position",
    description: "As the previous version, and a distance can be measured from a battlefield edge (of: battlefield-edge).",
    schema: (previous) => withProperties(previous, { of: widenedEnum(previous, "of", ["battlefield-edge"]) }),
    normalize: (input, previous) => input.of === "battlefield-edge" ? standIn(input, "of", "this-unit", previous) : previous(input),
  },
  activitiesExtension(HISTORY_ACTIVITIES, "history: destroyed one or more enemy units this phase or turn, set up using Deep Strike this phase or turn, and had models destroyed by the attacks of the unit that fired the trigger"),
  {
    // "There are no models embarked within this TRANSPORT": a unit is embarked within the subject.
    family: "unit-state",
    description: "As the previous version, plus carrying-units: one or more units are embarked within the subject (negated: none are).",
    schema: (previous) => {
      const property = properties(previous).states!;
      const items = property.items as Record<string, unknown>;
      return withProperties(previous, { states: { ...property, items: { ...items, enum: [...(items.enum as string[]), "carrying-units"] } } });
    },
    normalize: (input, previous) => {
      const states = Array.isArray(input.states) ? input.states as unknown[] : [];
      if (!states.includes("carrying-units")) return previous(input);
      if (states.length !== 1) throw new TypeError("unit-state carrying-units cannot be listed with other states.");
      if (input.with !== undefined) throw new TypeError("unit-state carrying-units takes no with.");
      return { ...previous({ ...input, states: ["engaged"] }), states: ["carrying-units"] };
    },
  },
  {
    // "That ADEPTUS ASTARTES INFANTRY/MOUNTED unit": every keyword in `keywords`, plus any one of `any_keywords`.
    family: "triggering-target",
    description: "As the previous version, plus any_keywords: the unit also has at least one of these (a shared prefix before a slash list).",
    schema: (previous) => withProperties(previous, { any_keywords: optional({ type: "array", items: KEYWORD_ITEMS, minItems: 2, uniqueItems: true }) }),
    normalize: (input, previous) => {
      if (input.any_keywords === undefined) return previous(input);
      const { any_keywords: anyKeywords, ...rest } = input;
      const normalized = previous(rest);
      if (normalized.match === "any") throw new TypeError("triggering-target any_keywords adds to all-of keywords; match must be all.");
      return { ...normalized, any_keywords: keywordList(anyKeywords, "triggering-target any_keywords", 2) };
    },
  },
  {
    // "That attack has the [LETHAL HITS] ability": the weapon making the attack, whoever makes it.
    family: "weapon-ability-grant",
    description: "As the previous version, and the subject can be attack: the weapon making the attack the ability is resolving.",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", ["attack"]) }),
    normalize: (input, previous) => input.subject === "attack" ? standIn(input, "subject", "this-unit", previous) : previous(input),
  },
  {
    // "(excluding units with the Lone Operative ability)": the DSL unit-filter's lacks_ability.
    family: "unit-filter",
    description: "As the previous version, plus excluded_abilities: matching units have none of these abilities (by record id, e.g. lone-operative).",
    schema: (previous) => withProperties(previous, { excluded_abilities: optional({ type: "array", items: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$" }, minItems: 1, uniqueItems: true }) }),
    normalize: (input, previous) => {
      if (input.excluded_abilities === undefined) return previous(input);
      const { excluded_abilities: abilities, ...rest } = input;
      const list = abilities as string[];
      if (!Array.isArray(list) || list.length === 0 || list.some((id) => typeof id !== "string" || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/u.test(id))) {
        throw new TypeError("unit-filter excluded_abilities lists ability ids.");
      }
      return { ...previous(rest), excluded_abilities: [...new Set(list)].sort() };
    },
  },
];
