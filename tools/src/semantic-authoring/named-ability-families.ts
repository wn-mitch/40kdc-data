import type { SemanticFamilyDefinition } from "./contracts.js";
import { ANTECEDENT } from "./antecedent-families.js";
import { NAMED_ACTIVITIES } from "./families/events.js";
import { NAMED_ID, namedId } from "./families/shared.js";
import { booleanValue, enumValue, exactKeys } from "./family-validation.js";

/**
 * Conditions that name an ability by its id: the ability through which the moment before them
 * happened (`by-ability`), and a unit having used a named ability in a window (`ability-used`).
 * Lowered in `compile-named-ability.ts`.
 */

/** Rules a unit can be recorded as having used: event@17's `used` activities. */
export const USED_ACTIVITY_KINDS = ["ability", "manoeuvre", "stratagem", "action", "dark-pact", "act-of-faith", "ritual", "order"] as const;
/** Who used it. */
export const ABILITY_USED_SUBJECTS = ["this-unit", "this-model", ANTECEDENT, "event-subject", "recipient", "selected-unit"] as const;
/** now: the use is being resolved at this moment ("while it is performing"); phase and turn: earlier in the window. */
export const ABILITY_USED_WINDOWS = ["now", "phase", "turn"] as const;

/**
 * "performs an Agile Manoeuvre that involves rolling a D6": the manoeuvres whose own effect rolls
 * that die, derived from the faction's resource-action menus (compile-manoeuvre-own-roll.ts).
 */
export const MANOEUVRE_DIE_KINDS = ["D6"] as const;

export const MANOEUVRE_OWN_ROLL_FAMILY: SemanticFamilyDefinition = {
  id: "manoeuvre-own-roll",
  version: 1,
  role: "CONDITION",
  label: "Manoeuvre that rolls a die",
  description: "The used manoeuvre is one whose own effect rolls this die (\"an Agile Manoeuvre that involves rolling a D6\"). Folds into the used-manoeuvre moment before it and names the manoeuvres from the faction's menus.",
  starter: { die: "" },
  parameterSchema: {
    type: "object",
    required: ["die"],
    properties: { die: { enum: MANOEUVRE_DIE_KINDS } },
    additionalProperties: false,
  },
};

export const NAMED_ABILITY_FAMILIES: readonly SemanticFamilyDefinition[] = [
  MANOEUVRE_OWN_ROLL_FAMILY,
  {
    id: "by-ability",
    version: 1,
    role: "CONDITION",
    label: "Through a named ability",
    description: "The moment just before it happened through this ability (its enrichment ability id): \"pinned by a friendly X unit's Foo ability\", \"a move made using its Bar ability\". Folds into that moment.",
    starter: { id: "" },
    parameterSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", pattern: NAMED_ID.source } },
      additionalProperties: false,
    },
  },
  {
    id: "ability-used",
    version: 1,
    role: "CONDITION",
    label: "Unit used a named ability",
    description: "The subject used a rule of this activity (one named by id for an ability, manoeuvre, Stratagem or action) in the window: now (it is performing it: \"while it is performing a Foo\"), this phase or this turn (\"in a turn in which it used its Bar ability\"). Negated: it did not.",
    starter: { subject: "", activity: "", window: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["subject", "activity", "window", "negated"],
      properties: {
        subject: { enum: ABILITY_USED_SUBJECTS },
        activity: { enum: USED_ACTIVITY_KINDS },
        id: { type: "string", pattern: NAMED_ID.source, "x-optional": true },
        window: { enum: ABILITY_USED_WINDOWS },
        negated: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
];

/** Validate and canonicalise the named-ability conditions, or null for any other family. */
export function normalizeNamedAbilityParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family === "by-ability") {
    exactKeys(input, ["id"], family);
    return { id: namedId(input.id, "by-ability.id") };
  }
  if (family === "manoeuvre-own-roll") {
    exactKeys(input, ["die"], family);
    return { die: enumValue(input.die, MANOEUVRE_DIE_KINDS, "manoeuvre-own-roll.die") };
  }
  if (family !== "ability-used") return null;
  exactKeys(input, ["subject", "activity", "window", "negated", ...("id" in input ? ["id"] : [])], family);
  const activity = enumValue(input.activity, USED_ACTIVITY_KINDS, "ability-used.activity");
  const result: Record<string, unknown> = {
    subject: enumValue(input.subject, ABILITY_USED_SUBJECTS, "ability-used.subject"),
    activity,
    window: enumValue(input.window, ABILITY_USED_WINDOWS, "ability-used.window"),
    negated: booleanValue(input.negated, "ability-used.negated"),
  };
  if ("id" in input) {
    if (!(NAMED_ACTIVITIES as readonly string[]).includes(activity)) throw new TypeError(`ability-used.id names one ${NAMED_ACTIVITIES.join(", ")}; a ${activity} is named only as a kind.`);
    result.id = namedId(input.id, "ability-used.id");
  }
  return result;
}
