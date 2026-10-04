import { ANTECEDENT } from "./antecedent-families.js";
import { activitiesExtension, type FamilyExtension, keywordList, optional, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { enumValue, sourceQualifiedSchema } from "./family-validation.js";
import { DESIGNATION_IDS } from "../translate/designations.js";

/**
 * The eleventh round of family extensions. As in the earlier rounds, a version checks only its own
 * additions and hands the rest to the previous one.
 */

/** A distance or engagement whose other unit is the unit-filter right after the leaf. */
export const FOLLOWING_FILTER = "following-filter";

/** States the DSL's unit-state can read at the start of the phase or turn (strength and carrying are other predicates). */
const STATES_AT = ["engaged", "battle-shocked", "on-battlefield", "in-reserves", "in-strategic-reserves", "in-cult-ambush"] as const;

export const FAMILY_EXTENSIONS_11: readonly FamilyExtension[] = [
  {
    // "but cannot end that move within Engagement Range of them".
    family: "move-must-end",
    description: "As the previous version, plus polarity: must (the default) says where the move must end; cannot says where it must not end (\"cannot end that move within Engagement Range of them\"), so the conditions after it are negated together.",
    schema: (previous) => withProperties(previous, { polarity: optional({ enum: ["must", "cannot"] }) }),
    normalize: (input, previous) => {
      if (input.polarity === undefined) return previous(input);
      const { polarity, ...rest } = input;
      const value = enumValue(polarity, ["must", "cannot"], "move-must-end.polarity");
      return value === "must" ? previous(rest) : { ...previous(rest), polarity: "cannot" };
    },
  },
  {
    // "ends a move within 8\" of a" + "friendly unengaged unit": the distance is measured to the
    // units of the unit-filter right after it in its clause (compile-unit-filters.ts folds it).
    family: "unit-position",
    description: "As the previous version, plus of following-filter: the distance is to any unit the unit-filter right after this leaf, in the same clause, matches (\"within 8\\\" of a\" + \"friendly unengaged unit\").",
    schema: (previous) => withProperties(previous, { of: widenedEnum(previous, "of", [FOLLOWING_FILTER]) }),
    normalize: (input, previous) => input.of === FOLLOWING_FILTER ? { ...previous({ ...input, of: "this-unit" }), of: FOLLOWING_FILTER } : previous(input),
  },
  {
    // "engaged with one or more" + "friendly GREY KNIGHTS VEHICLE units".
    family: "unit-state",
    description: "As the previous version, plus with following-filter: engaged with any unit the unit-filter right after this leaf, in the same clause, matches.",
    schema: (previous) => withProperties(previous, { with: widenedEnum(previous, "with", [FOLLOWING_FILTER]) }),
    normalize: (input, previous) => input.with === FOLLOWING_FILTER ? { ...previous({ ...input, with: "this-unit" }), with: FOLLOWING_FILTER } : previous(input),
  },
  {
    // "an enemy unit that was engaged with this unit ends a Fall Back move": the state at the start
    // of the phase or turn, not now.
    family: "unit-state",
    description: "As the previous version, plus at: phase-start or turn-start reads the state as it was then (\"that was engaged with this unit\"), not now.",
    schema: (previous) => withProperties(previous, { at: optional({ enum: ["phase-start", "turn-start"], "x-only-when": { states: STATES_AT } }) }),
    normalize: (input, previous) => {
      if (input.at === undefined) return previous(input);
      const { at, ...rest } = input;
      const normalized = previous(rest);
      if (!(normalized.states as string[]).every((state) => (STATES_AT as readonly string[]).includes(state))) {
        throw new TypeError(`unit-state.at reads only ${STATES_AT.join(", ")} at an earlier point.`);
      }
      return { ...normalized, at: enumValue(at, ["phase-start", "turn-start"], "unit-state.at") };
    },
  },
  {
    // "Once per battle, in any phase, just after …": every phase, said outright.
    family: "phase-window",
    description: "As the previous version, plus phase any: \"in any phase\" (with turn either it gates nothing; with your or opponent it is that player's turn).",
    schema: (previous) => withProperties(previous, { phase: widenedEnum(previous, "phase", ["any"]) }),
    normalize: (input, previous) => input.phase === "any" ? { ...previous({ ...input, phase: "command" }), phase: "any" } : previous(input),
  },
  {
    // "Place two tokens next to the unit, removing one each time this ability is used."
    family: "usage-limit",
    description: "As the previous version, plus frequency twice-per-battle.",
    schema: (previous) => withProperties(previous, { frequency: widenedEnum(previous, "frequency", ["twice-per-battle"]) }),
    normalize: (input, previous) => input.frequency === "twice-per-battle" ? { ...previous({ ...input, frequency: "once-per-battle" }), frequency: "twice-per-battle" } : previous(input),
  },
  // "whose attacks have been resolved this phase": the unit has finished its attacks, which is
  // more than being selected to shoot or fight.
  activitiesExtension(["resolved-attacks-this-phase"], "resolved-attacks-this-phase: the subject has resolved its attacks this phase"),
  {
    // "While a FARSEER model is leading this unit"; "unless it is leading a unit"; "while that unit
    // is being led".
    family: "leading-unit",
    description: "As the previous version, plus attachment led (the subject unit is led by a Leader; leader_keywords: that Leader has every one of these keywords), negated (the attachment does not hold), and subject antecedent or selected-unit.",
    schema: (previous) => withProperties(previous, {
      attachment: widenedEnum(previous, "attachment", ["led"]),
      subject: widenedEnum(previous, "subject", [ANTECEDENT, "selected-unit"]),
      leader_keywords: optional({ type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true, "x-only-when": { attachment: ["led"] } }),
      negated: optional({ type: "boolean" }),
    }),
    normalize: (input, previous) => {
      const { leader_keywords: leaders, negated, ...rest } = input;
      if (negated !== undefined && typeof negated !== "boolean") throw new TypeError("leading-unit.negated is true or false.");
      if (leaders !== undefined && rest.attachment !== "led") throw new TypeError("leading-unit.leader_keywords names the Leader of a led unit (attachment led).");
      const subject = rest.subject;
      const standIn = { ...rest, ...(rest.attachment === "led" ? { attachment: "leading" } : {}), ...(subject === ANTECEDENT || subject === "selected-unit" ? { subject: "this-unit" } : {}) };
      const normalized = previous(standIn);
      return {
        ...normalized, attachment: rest.attachment, ...(subject === ANTECEDENT || subject === "selected-unit" ? { subject } : {}),
        ...(leaders !== undefined ? { leader_keywords: keywordList(leaders, "leading-unit.leader_keywords", 1) } : {}),
        ...(negated === true ? { negated: true } : {}),
      };
    },
  },
  {
    // "within range of your vowed objective"; "within range of that objective marker" after a
    // select-objective.
    family: "unit-position",
    description: "As the previous version, plus, for objective-range, objective: any (the default), selected (the objective marker this record's select-objective chose) or designated (the marker carrying objective_tag, a registered designation id).",
    schema: (previous) => withProperties(previous, {
      objective: optional({ enum: ["any", "selected", "designated"], "x-only-when": { kind: ["objective-range"] } }),
      objective_tag: optional({ type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$", "x-only-when": { objective: ["designated"] } }),
    }),
    normalize: (input, previous) => {
      const { objective, objective_tag: tag, ...rest } = input;
      if (objective === undefined && tag === undefined) return previous(input);
      const value = enumValue(objective ?? "any", ["any", "selected", "designated"], "unit-position.objective");
      if (rest.kind !== "objective-range") throw new TypeError("unit-position.objective qualifies an objective-range.");
      if ((value === "designated") !== (tag !== undefined)) throw new TypeError("unit-position.objective_tag names the designation of a designated objective, and only then.");
      if (tag !== undefined && !DESIGNATION_IDS.has(String(tag))) throw new TypeError(`unit-position.objective_tag ${JSON.stringify(tag)} is not a registered designation.`);
      const normalized = previous(rest);
      return value === "any" ? normalized : { ...normalized, objective: value, ...(tag !== undefined ? { objective_tag: tag } : {}) };
    },
  },
  // "Friendly WORLD EATERS units' melee attacks have +1 A": the units a bare filter before the
  // scope matches (compile-antecedent.ts binds the antecedent; compile-unit-filters.ts folds it).
  antecedentSubject("weapon-property-scope", "\"Friendly X units' melee attacks have\": the units a unit-filter right before it matches"),
  antecedentSubject("ignore-modifiers", "\"Friendly X units can ignore modifiers to …\": the units a unit-filter right before it matches, or a selected unit"),
  {
    // "roll one D6 for each" + "enemy unit" + "within 6\" of this model": a bare quantifier, whose
    // units the unit-filter (and range or engagement) right after it name (compile-unit-filters.ts).
    family: "for-each-unit-select",
    description: "As the previous version, plus the bare quantifier {} on \"each\" / \"for each\" / \"every\": the unit-filter right after it, in the same fragment, names the units, with a range or \"engaged with this unit\" after that. A later \"that unit\" is the unit of each pass.",
    schema: (previous) => ({ ...previous, required: [] }),
    normalize: (input, previous) => Object.keys(input).length === 0 ? {} : previous(input),
  },
  {
    // "That unit is wracked with agonies": any designation in the live registry, not only the ones
    // registered when apply-mark was first reviewed.
    family: "apply-mark",
    description: "As the previous version, but tag is any registered designation id (tools/src/translate/designations.ts), or still a source-qualified value.",
    schema: (previous) => withProperties(previous, { tag: { anyOf: [{ type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$", examples: ["afflicted"] }, sourceQualifiedSchema] } }),
    normalize: (input, previous) => {
      if (typeof input.tag !== "string") return previous(input);
      if (!DESIGNATION_IDS.has(input.tag)) throw new TypeError(`apply-mark.tag ${JSON.stringify(input.tag)} is not a registered designation.`);
      return { ...previous({ ...input, tag: "designated" }), tag: input.tag };
    },
  },
];

/** A version whose subject also accepts antecedent: an earlier leaf's unit, bound when the record compiles. */
function antecedentSubject(family: string, example: string): FamilyExtension {
  return {
    family,
    description: `As the previous version, plus subject antecedent: ${example}.`,
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [ANTECEDENT]) }),
    normalize: (input, previous) => input.subject === ANTECEDENT ? { ...previous({ ...input, subject: "this-unit" }), subject: ANTECEDENT } : previous(input),
  };
}
