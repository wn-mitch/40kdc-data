import { EVENT_SUBJECT, type FamilyExtension, properties, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { PASSTHROUGH_ITEMS } from "./movement-families.js";
import { enumValue } from "./family-validation.js";

/**
 * Stratagem target alternatives, follow-up: a moving or permitted unit named by the moment that
 * introduces it ("that unit can move within Engagement Range" after a move-ended event), and a
 * move-through that passes two listed kinds of model or terrain in one clause ("models and terrain
 * features"). Each version checks only its own additions and hands the rest to the previous version.
 */

/**
 * Two listed passthrough tokens, sorted into canonical order. A typed models item is refused here: a
 * typed item names one owner and keyword set, and a clause with two kinds of thing needs two leaves.
 */
function passthroughPair(value: unknown[]): string[] {
  if (value.length !== 2) throw new TypeError("move-through.passthrough lists exactly two tokens, or names one.");
  const list = value.map((item) => {
    if (typeof item !== "string") throw new TypeError("move-through.passthrough lists tokens only; a typed models item stands alone.");
    return enumValue(item, PASSTHROUGH_ITEMS, "move-through.passthrough");
  });
  if (list[0] === list[1]) throw new TypeError("move-through.passthrough lists a token twice.");
  return [...list].sort();
}

export const FAMILY_EXTENSIONS_16_STRATAGEM_TARGET_ALTERNATIVES_FOLLOWUP: readonly FamilyExtension[] = [
  {
    family: "move-through",
    description: `As the previous version, plus subject event-subject (the unit a move-ended event names) and passthrough as a list of two listed tokens (${PASSTHROUGH_ITEMS.join(", ")}).`,
    schema: (previous) => withProperties(previous, {
      subject: widenedEnum(previous, "subject", [EVENT_SUBJECT]),
      passthrough: {
        anyOf: [
          properties(previous).passthrough!,
          { type: "array", items: { enum: [...PASSTHROUGH_ITEMS] }, minItems: 2, maxItems: 2, uniqueItems: true },
        ],
      },
    }),
    normalize: (input, previous) => {
      const event = input.subject === EVENT_SUBJECT;
      // The previous version checks the leaf with this unit standing in for the triggering unit.
      const staged = event ? { ...input, subject: "this-unit" } : input;
      const restore = (result: Record<string, unknown>) => event ? { ...result, subject: EVENT_SUBJECT } : result;
      if (!Array.isArray(input.passthrough)) return restore(previous(staged));
      const pair = passthroughPair(input.passthrough);
      // A token stands in for the list while the previous version checks the other keys; the list replaces it.
      return restore({ ...previous({ ...staged, passthrough: "models" }), passthrough: pair });
    },
  },
  {
    // "Then that unit can move within Engagement Range" after a move-ended trigger: the moving unit.
    family: "eligibility-permission",
    description: `As the previous version, and the subject can be the triggering unit (${EVENT_SUBJECT}), the unit a move-ended event names.`,
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [EVENT_SUBJECT]) }),
    normalize: (input, previous) => input.subject === EVENT_SUBJECT ? standIn(input, "subject", "this-unit", previous) : previous(input),
  },
];
