import { ENTITY_ID } from "./buff-families.js";
import { type FamilyExtension, optional, properties, standIn, widenedEnum, withProperties, type Schema } from "./family-extension-helpers.js";

/**
 * Named-ability roll scope: a roll that belongs to one named ability (its own dice), the dice of a
 * manoeuvre on a re-roll, and a count of the models in a unit that carry a wargear item. Each version checks only its own additions and hands the rest
 * to the previous version, with a stand-in value the previous version accepts where it cannot take
 * the new one. The compiler checks what each form binds (compile-ability-roll.ts,
 * compile-manoeuvre-own-roll.ts, compile-count-scale.ts).
 */

const ROLL = "roll";

/** A roll a named ability makes: its own dice, named by its entity id. */
const ABILITY_ROLL: Schema = {
  type: "object",
  required: ["ability"],
  properties: { ability: { type: "string", pattern: ENTITY_ID.source } },
  additionalProperties: false,
};

/** Whether a roll names one ability's dice. */
const isAbilityRoll = (roll: unknown): roll is { ability: string } => roll !== null && typeof roll === "object" && "ability" in roll;

/** Check an ability roll's id; the previous version never sees it, so its shape is checked here. */
function abilityId(roll: { ability: string }, label: string): string {
  if (Object.keys(roll).length !== 1) throw new TypeError(`${label} roll names one ability, and nothing else.`);
  if (typeof roll.ability !== "string" || !ENTITY_ID.test(roll.ability)) throw new TypeError(`${label} roll.ability is a kebab-case ability id.`);
  return roll.ability;
}

/** A roll property with an ability alternative beside its enum, as the widened roll takes. */
function withAbilityAlternative(schema: Schema, key: string): Schema {
  const property = properties(schema)[key]!;
  const alternatives = Array.isArray(property.anyOf) ? property.anyOf as Schema[] : [property];
  return withProperties(schema, { [key]: { ...property, anyOf: [...alternatives, ABILITY_ROLL] } });
}

/** Stand-in roll for the previous version, which takes only its own kinds; the new roll is restored after. */
const ROLL_STAND_IN = "hit";

/** The counts a count-scale takes beside the previous two. */
const MODELS_EQUIPPED_WITH = "models-equipped-with";

export const FAMILY_EXTENSIONS_16_NAMED_ABILITY_ROLL_SCOPE: readonly FamilyExtension[] = [
  {
    // A re-roll of a manoeuvre's own dice (roll manoeuvre), or of the dice one named ability rolls (roll {ability}).
    family: "reroll",
    description: "As the previous version, and roll can be manoeuvre (the performing unit's own Agile Manoeuvre roll, bound by a manoeuvre moment in the same clause) or an object {ability: id} (the dice a named ability rolls).",
    schema: (previous) => {
      const { enum: values, ...rest } = properties(previous)[ROLL]!;
      return withProperties(previous, { [ROLL]: { ...rest, anyOf: [{ enum: [...(values as string[]), "manoeuvre"] }, ABILITY_ROLL] } });
    },
    normalize: (input, previous) => {
      if (input[ROLL] === "manoeuvre") return standIn(input, ROLL, ROLL_STAND_IN, previous);
      if (isAbilityRoll(input[ROLL])) {
        abilityId(input[ROLL], "reroll");
        return standIn(input, ROLL, ROLL_STAND_IN, previous);
      }
      return previous(input);
    },
  },
  {
    // A modifier to the dice one named ability rolls.
    family: "roll-modifier",
    description: "As the previous version, and roll can be an object {ability: id}: the dice that named ability rolls.",
    schema: (previous) => withAbilityAlternative(previous, ROLL),
    normalize: (input, previous) => {
      if (!isAbilityRoll(input[ROLL])) return previous(input);
      abilityId(input[ROLL], "roll-modifier");
      return standIn(input, ROLL, ROLL_STAND_IN, previous);
    },
  },
  {
    // A count of the models in the unit that carry the wargear item.
    family: "count-scale",
    description: "As the previous version, and counts can be models-equipped-with with a wargear id: the models in the bearer's unit equipped with that wargear. It takes no following filter or item, and is live.",
    schema: (previous) => withProperties(widenedEnum(previous, "counts", [MODELS_EQUIPPED_WITH]), {
      wargear: optional({ type: "string", pattern: ENTITY_ID.source, "x-only-when": { counts: [MODELS_EQUIPPED_WITH] } }),
    }),
    normalize: (input, previous) => {
      if (input.counts !== MODELS_EQUIPPED_WITH) {
        if ("wargear" in input) throw new TypeError("count-scale.wargear names the wargear of counts models-equipped-with.");
        return previous(input);
      }
      const { counts: _counts, wargear, ...rest } = input;
      if (typeof wargear !== "string" || !ENTITY_ID.test(wargear)) throw new TypeError("count-scale counts models-equipped-with needs wargear, a kebab-case wargear id.");
      if (rest.timing === "on-apply") throw new TypeError("count-scale counts models-equipped-with is live; an on-apply count is not defined for it.");
      // The previous version checks per and timing; the stand-in is a value it accepts, and counts is put back after.
      return { ...previous({ ...rest, counts: "following-filter" }), counts: MODELS_EQUIPPED_WITH, wargear };
    },
  },
];
