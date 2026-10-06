import { ANTECEDENT } from "./antecedent-families.js";
import { activitiesExtension, type FamilyExtension, keywordList, optional, properties, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { enumValue, sourceQualifiedSchema } from "./family-validation.js";
import { DESIGNATION_IDS } from "../translate/designations.js";
import { ALTERNATIVE_SCHEMA, normalizeAlternatives } from "./unit-filter-alternatives.js";
import { ABILITY_ACTIVATE_OPTIONS, CHOSEN_OPTION_HOLDER_ANTECEDENT, STANCE_CAPACITY_SHARED_OPTIONS, STANCE_SELECT_ADDITIVE } from "./activation-families.js";

/**
 * The eleventh round of family extensions. As in the earlier rounds, a version checks only its own
 * additions and hands the rest to the previous one.
 */

/** A distance or engagement whose other unit is the unit-filter right after the leaf. */
export const FOLLOWING_FILTER = "following-filter";

/** Keys whose value following-filter names the unit-filter right after the leaf. */
const FOLLOWING_FILTER_KEYS = ["of", "with", "object", "target", "by"] as const;

/** Whether a leaf names the unit-filter right after it (a distance's, engagement's or targeting's other unit). */
export function awaitsFollowingFilter(parameters: Record<string, unknown>): boolean {
  return FOLLOWING_FILTER_KEYS.some((key) => parameters[key] === FOLLOWING_FILTER);
}

/** States the DSL's unit-state can read at the start of the phase or turn (strength and carrying are other predicates). */
const STATES_AT = ["engaged", "battle-shocked", "on-battlefield", "in-reserves", "in-strategic-reserves", "in-cult-ambush"] as const;

/** Kinds whose moment can name this unit or model as what it was done to. */
const OBJECT_KINDS = ["targets-selected", "damage-allocated"];

const EVENT_OBJECT: FamilyExtension = {
  // "Each time you target the bearer with a Stratagem", "each time an attack is allocated to the bearer".
  family: "event",
  description: "As the previous version, plus object: this-unit or this-model is what the moment was done to (\"each time you target the bearer with a Stratagem\" = targets-selected, action_kind stratagem, owner friendly, object this-model; \"each time an attack is allocated to this model\" = damage-allocated, object this-model); and action_kind stratagem: a Stratagem's targets were selected.",
  schema: (previous) => withProperties(previous, {
    action_kind: widenedEnum(previous, "action_kind", ["stratagem"]),
    object: optional({ enum: ["this-unit", "this-model"], "x-only-when": { kind: OBJECT_KINDS } }),
  }),
  normalize: (input, previous) => {
    const { object, ...rest } = input;
    const normalized = rest.action_kind === "stratagem" ? standIn(rest, "action_kind", "attack", previous) : previous(rest);
    if (object === undefined) return normalized;
    if (!OBJECT_KINDS.includes(String(normalized.kind))) throw new TypeError(`event.object applies only to ${OBJECT_KINDS.join(", ")}.`);
    return { ...normalized, object: enumValue(object, ["this-unit", "this-model"], "event.object") };
  },
};

const EVENT_MODEL_DESTROYER: FamilyExtension = {
  // "Each time this model's unit destroys an enemy CHARACTER model", "destroyed as the result of an enemy unit's attacks".
  family: "event",
  description: "As the previous version, plus by and object_owner on model-destroyed (who destroyed the model, and whose model it was), and by enemy: an enemy unit destroyed it.",
  schema: (previous) => {
    const props = properties(previous);
    const only = { kind: ["unit-destroyed", "model-destroyed"] };
    return withProperties(previous, {
      by: { ...widenedEnum(previous, "by", ["enemy"]), "x-only-when": only },
      object_owner: { ...props.object_owner!, "x-only-when": only },
    });
  },
  normalize: (input, previous) => {
    const model = input.kind === "model-destroyed" && ("by" in input || "object_owner" in input);
    const enemy = input.by === "enemy";
    const normalized = previous({ ...input, ...(model ? { kind: "unit-destroyed" } : {}), ...(enemy ? { by: "this-unit" } : {}) });
    return { ...normalized, ...(model ? { kind: "model-destroyed" } : {}), ...(enemy ? { by: "enemy" } : {}) };
  },
};

/** Wounds a returned model can come back with beyond return-models@1's: 3, and half of its starting wounds. */
const RETURN_WOUNDS_ADDED = ["3", "half-starting"] as const;

const RETURN_MODELS_WOUNDS: FamilyExtension = {
  // "with 3 wounds remaining", "with half of its starting number of wounds remaining".
  family: "return-models",
  description: "As the previous version, plus wounds_remaining 3 and half-starting (half of the model's starting number of wounds).",
  schema: (previous) => withProperties(previous, { wounds_remaining: widenedEnum(previous, "wounds_remaining", RETURN_WOUNDS_ADDED) }),
  normalize: (input, previous) => (RETURN_WOUNDS_ADDED as readonly unknown[]).includes(input.wounds_remaining)
    ? standIn(input, "wounds_remaining", "1", previous)
    : previous(input),
};

/** The unit-state families a hidden unit and a bearer's Transport extend (see FAMILY_EXTENSIONS_11). */
const UNIT_STATE_HIDDEN: FamilyExtension = {
  // "if that friendly unit is hidden": the core state, not a designation.
  family: "unit-state",
  description: "As the previous version, plus the state hidden: the core rules' hidden state (\"if that friendly unit is hidden\"), not a designation an ability applies.",
  schema: (previous) => {
    const states = properties(previous).states!;
    const items = states.items as Record<string, unknown>;
    return withProperties(previous, { states: { ...states, items: { ...items, enum: [...(items.enum as string[]), "hidden"] } } });
  },
  normalize: (input, previous) => {
    if (!Array.isArray(input.states) || !input.states.includes("hidden")) return previous(input);
    if (input.at !== undefined) throw new TypeError("unit-state hidden has no earlier point (at).");
    const rest = input.states.filter((state) => state !== "hidden");
    // Battle-shocked stands in for a hidden-only leaf: it takes no with, as hidden takes none.
    const normalized = previous({ ...input, states: rest.length ? rest : ["battle-shocked"] });
    return { ...normalized, states: [...(rest.length ? normalized.states as string[] : []), "hidden"] };
  },
};

const UNIT_STATE_BEARER_TRANSPORT: FamilyExtension = {
  // "(or any TRANSPORT it is embarked within is on the battlefield)".
  family: "unit-state",
  description: "As the previous version, plus subject bearer-transport: the Transport this model is embarked within (\"any TRANSPORT it is embarked within is on the battlefield\").",
  schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", ["bearer-transport"]) }),
  normalize: (input, previous) => input.subject === "bearer-transport" ? standIn(input, "subject", "this-unit", previous) : previous(input),
};

const CHARACTERISTIC_FLOOR: FamilyExtension = {
  // "subtract 1 from the Objective Control characteristic … (to a minimum of 1)".
  family: "characteristic-modifier",
  description: "As the previous version, plus minimum: a lowered characteristic never goes below this value (\"(to a minimum of 1)\"). Only for subtract or worsen.",
  schema: (previous) => withProperties(previous, { minimum: optional({ type: "integer", minimum: 0, maximum: 20 }) }),
  normalize: (input, previous) => {
    if (input.minimum === undefined) return previous(input);
    const { minimum, ...rest } = input;
    if (!Number.isInteger(minimum) || (minimum as number) < 0 || (minimum as number) > 20) throw new TypeError("characteristic-modifier.minimum must be an integer from 0 to 20.");
    const normalized = previous(rest);
    if (normalized.operation !== "subtract" && normalized.operation !== "worsen") throw new TypeError("characteristic-modifier.minimum floors only a subtract or worsen.");
    return { ...normalized, minimum };
  },
};

/** Who selected the target, and which unit was selected, in a target-is-selected leaf that names them. */
const SELECTION_BY = ["event-subject", "this-unit", "selected-unit", ANTECEDENT] as const;
const SELECTION_TARGETS = ["this-unit", "this-model", "selected-unit", FOLLOWING_FILTER, ANTECEDENT] as const;

const TARGET_IS_SELECTED_PARTIES: FamilyExtension = {
  // "if one or more units with this ability are selected as a target of that charge".
  family: "target-is-selected",
  description: "As the previous version, plus by and target, always together: target was selected as a target by by in the moment the ability names (\"if one or more units with this ability are selected as a target of that charge\" = by antecedent, target this-unit). target following-filter is any unit the unit-filter right after this leaf matches. Without them, the attack targets the selected unit, as before.",
  schema: (previous) => withProperties(previous, { by: optional({ enum: SELECTION_BY }), target: optional({ enum: SELECTION_TARGETS }) }),
  normalize: (input, previous) => {
    if (input.by === undefined && input.target === undefined) return previous(input);
    const { by, target, ...rest } = input;
    if (by === undefined || target === undefined) throw new TypeError("target-is-selected names by and target together, or neither.");
    const normalized = previous(rest);
    const who = enumValue(by, SELECTION_BY, "target-is-selected.by");
    const what = enumValue(target, SELECTION_TARGETS, "target-is-selected.target");
    if (who === what && who !== ANTECEDENT) throw new TypeError("target-is-selected: a unit does not select itself as a target.");
    return { ...normalized, by: who, target: what };
  },
};

const HIT_THIS_PHASE: FamilyExtension = {
  // "that was hit by one or more Psychic Attacks made by a" + "THOUSAND SONS PSYKER model" + "this phase".
  family: "hit-by-attacks",
  description: "As the previous version, plus window phase: hit at any time this phase, not only by the attacks of the ability's moment; and by following-filter (only with window phase): the attacks were made by any unit or model the unit-filter right after this leaf matches. Without by, the attacker is the unit of the ability's moment, as before.",
  schema: (previous) => withProperties(previous, {
    window: optional({ enum: ["phase"] }),
    by: optional({ enum: [FOLLOWING_FILTER], "x-only-when": { window: ["phase"] } }),
  }),
  normalize: (input, previous) => {
    if (input.window === undefined && input.by === undefined) return previous(input);
    const { window, by, ...rest } = input;
    if (window === undefined) throw new TypeError("hit-by-attacks.by names who made the attacks of a window phase hit.");
    const normalized = { ...previous(rest), window: enumValue(window, ["phase"], "hit-by-attacks.window") };
    return by === undefined ? normalized : { ...normalized, by: enumValue(by, [FOLLOWING_FILTER], "hit-by-attacks.by") };
  },
};

const TARGETING_ACTIVITY_LIST = activitiesExtension(
  ["targeted-by-attacks-this-phase", "made-attacks-targeting-this-phase"],
  "targeted-by-attacks-this-phase (the subject was selected as the target of one or more attacks this phase, by any unit) and made-attacks-targeting-this-phase (the subject made one or more attacks this phase that targeted this unit; the subject is never this unit or its model)",
);

const TARGETING_ACTIVITIES: FamilyExtension = {
  // "that was selected as the target of one or more attacks this phase"; "that made one or more attacks that targeted your unit this phase".
  ...TARGETING_ACTIVITY_LIST,
  normalize: (input, previous) => {
    const normalized = TARGETING_ACTIVITY_LIST.normalize(input, previous);
    if ((normalized.activities as string[]).includes("made-attacks-targeting-this-phase") && (normalized.subject === "this-unit" || normalized.subject === "this-model")) {
      throw new TypeError("unit-activity made-attacks-targeting-this-phase: the attacks targeted this unit, so their maker is another unit, not this unit or its model.");
    }
    return normalized;
  },
};

const UNIT_FILTER_ALTERNATIVES: FamilyExtension = {
  // "LEGIO CYBERNETICA or ADEPTUS MECHANICUS VEHICLE unit", "PSYKER or Battle-shocked unit": any
  // one of two or more alternatives, each with its own keywords, exclusions and states.
  family: "unit-filter",
  description: "As the previous version, plus alternatives: two or more {keywords, excluded_keywords, states}, any one of which a unit matches (\"LEGIO CYBERNETICA or ADEPTUS MECHANICUS VEHICLE unit\" is [LEGIO CYBERNETICA] and [ADEPTUS MECHANICUS, VEHICLE]; \"PSYKER or Battle-shocked unit\" is [PSYKER] and states [battle-shocked]). Each alternative keeps its own exclusions and states; side, level and the filter's own keywords, exclusions and states hold for every alternative. Not with any_keywords.",
  schema: (previous) => withProperties(previous, { alternatives: optional({ type: "array", minItems: 2, items: ALTERNATIVE_SCHEMA }) }),
  normalize: (input, previous) => {
    if (input.alternatives === undefined) return previous(input);
    const { alternatives, ...rest } = input;
    if (rest.any_keywords !== undefined) throw new TypeError("unit-filter.alternatives replaces any_keywords; a one-keyword alternative is one item of alternatives.");
    const normalized = previous(rest);
    const shared = { keywords: normalized.keywords as string[] | undefined, excluded_keywords: normalized.excluded_keywords as string[] | undefined, states: normalized.states as string[] | undefined };
    return { ...normalized, alternatives: normalizeAlternatives(alternatives, "unit-filter.alternatives", shared) };
  },
};

const UNIT_POSITION_OF_ALTERNATIVES: FamilyExtension = {
  // "within 3\" of one or more friendly LEAGUES OF VOTANN VEHICLE or IRONKIN STEELJACKS units".
  family: "unit-position",
  description: "As the previous version, plus of_alternatives on of matching-unit: two or more {keywords, excluded_keywords, states}, any one of which the unit measured to matches (\"of one or more friendly X VEHICLE or Y units\" is [X, VEHICLE] and [Y]); of_keywords, if given, hold for every alternative.",
  schema: (previous) => withProperties(previous, { of_alternatives: optional({ type: "array", minItems: 2, items: ALTERNATIVE_SCHEMA, "x-only-when": { of: ["matching-unit"] } }) }),
  normalize: (input, previous) => {
    if (input.of_alternatives === undefined) return previous(input);
    const { of_alternatives: alternatives, ...rest } = input;
    if (rest.of !== "matching-unit") throw new TypeError("unit-position.of_alternatives goes with of: matching-unit.");
    const normalized = previous(rest);
    return { ...normalized, of_alternatives: normalizeAlternatives(alternatives, "unit-position.of_alternatives", { keywords: normalized.of_keywords as string[] | undefined }) };
  },
};

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
  rollSubject("roll-modifier", "\"add 1 to Charge rolls made for that unit\", \"that enemy unit has -2 to Charge rolls\""),
  rollSubject("reroll", "\"you can re-roll Charge rolls made for that unit\""),
  {
    // "At the start or end of this unit's move": one leaf, either moment.
    family: "event",
    description: "As the previous version, plus also: the other end of the same move (move-started with also move-ended, or the reverse), so \"at the start or end of this unit's move\" is one leaf that fires at either moment.",
    schema: (previous) => withProperties(previous, { also: optional({ enum: ["move-started", "move-ended"], "x-only-when": { kind: ["move-started", "move-ended"] } }) }),
    normalize: (input, previous) => {
      if (input.also === undefined) return previous(input);
      const { also, ...rest } = input;
      const other = enumValue(also, ["move-started", "move-ended"], "event.also");
      if (!["move-started", "move-ended"].includes(String(rest.kind)) || rest.kind === other) throw new TypeError("event.also names the other end of a move-started or move-ended moment.");
      return { ...previous(rest), also: other };
    },
  },
  {
    // "The bearer has a Move characteristic of 7\" and a Save characteristic of 3+": one leaf over
    // the list, each item a characteristic and its value, sharing the subject and scope.
    family: "characteristic-set",
    description: "As the previous version, plus values: two or more {characteristic, value} pairs set together (\"has a Move characteristic of 7\\\" and a Save characteristic of 3+\") in place of characteristic and value.",
    schema: (previous) => {
      const item = { type: "object", required: ["characteristic", "value"], properties: { characteristic: properties(previous).characteristic!, value: properties(previous).value! }, additionalProperties: false };
      const widened = withProperties(previous, { values: optional({ type: "array", minItems: 2, items: item }) });
      return { ...widened, required: ((previous.required as string[] | undefined) ?? []).filter((key) => key !== "characteristic" && key !== "value") };
    },
    normalize: (input, previous) => {
      if (input.values === undefined) return previous(input);
      const { values, ...rest } = input;
      if (!Array.isArray(values) || values.length < 2) throw new TypeError("characteristic-set.values lists two or more characteristics.");
      if (rest.characteristic !== undefined || rest.value !== undefined) throw new TypeError("characteristic-set.values replaces characteristic and value.");
      const items = values.map((item) => {
        const { characteristic, value } = previous({ ...rest, ...(item as Record<string, unknown>) }) as Record<string, unknown>;
        return { characteristic, value };
      });
      const { characteristic: _c, value: _v, ...shared } = previous({ ...rest, ...(values[0] as Record<string, unknown>) }) as Record<string, unknown>;
      return { ...shared, values: items };
    },
  },
  {
    // "Your unit can make a Normal move of: Up to D6\". Or: If …, up to 6\"": the player picks one.
    family: "instead",
    description: "As the previous version, plus choice: true on \"Or:\" between two effects of the same kind: the player picks one of them (each under its own conditions), rather than this clause replacing the earlier one when its condition holds.",
    schema: (previous) => withProperties(previous, { choice: optional({ const: true }) }),
    normalize: (input, previous) => {
      if (input.choice === undefined) return previous(input);
      const { choice, ...rest } = input;
      if (choice !== true) throw new TypeError("instead.choice must be true, or omitted.");
      return { ...previous(rest), choice: true };
    },
  },
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
  UNIT_STATE_HIDDEN,
  UNIT_STATE_BEARER_TRANSPORT,
  CHARACTERISTIC_FLOOR,
  EVENT_OBJECT,
  activitiesExtension(
    ["fell-back-this-phase", "charged-this-phase", "made-normal-move-this-phase", "made-normal-move-this-turn", "disembarked-this-phase", "set-up-this-phase", "made-dark-pact-this-phase", "lost-models-this-phase", "destroyed-enemy-model-this-phase", "destroyed-enemy-model-this-turn"],
    "a unit's moves and moments this phase (fell back, charged, made a Normal move, disembarked, was set up, made a Dark Pact), made a Normal move this turn, lost models this phase, and destroyed an enemy model this phase or turn",
  ),
  EVENT_MODEL_DESTROYER,
  TARGET_IS_SELECTED_PARTIES,
  HIT_THIS_PHASE,
  TARGETING_ACTIVITIES,
  UNIT_FILTER_ALTERNATIVES,
  UNIT_POSITION_OF_ALTERNATIVES,
  ABILITY_ACTIVATE_OPTIONS,
  STANCE_SELECT_ADDITIVE,
  CHOSEN_OPTION_HOLDER_ANTECEDENT,
  STANCE_CAPACITY_SHARED_OPTIONS,
  RETURN_MODELS_WOUNDS,
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

/** Whose rolls a roll change or re-roll is about, when the text names a unit other than this one. */
const ROLL_SUBJECTS = ["this-unit", "this-model", "event-subject", "selected-unit", "recipient", ANTECEDENT] as const;

/** A version whose rolls belong to a named unit: subject, which an earlier leaf's unit may bind. */
function rollSubject(family: string, example: string): FamilyExtension {
  return {
    family,
    description: `As the previous version, plus subject: the unit whose rolls these are (${example}); antecedent points back to an earlier leaf's unit. Without it, the rolls are this unit's (or the attacker's, against an attack on this unit).`,
    schema: (previous) => withProperties(previous, { subject: optional({ enum: ROLL_SUBJECTS }) }),
    normalize: (input, previous) => {
      if (input.subject === undefined) return previous(input);
      const { subject, ...rest } = input;
      return { ...previous(rest), subject: enumValue(subject, ROLL_SUBJECTS, `${family}.subject`) };
    },
  };
}
