import { activitiesExtension, type FamilyExtension, KEYWORD_ITEMS, keywordList, optional, properties, type Schema, standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";
import { enumValue } from "../family-validation.js";
import { EACH_TARGET } from "./shared.js";

/**
 * Versions of unit-activity: what a unit has (or has not) done, including its history this phase,
 * turn or battle and the destructions it caused. Each version checks only its own additions and
 * hands the rest of a leaf to the previous version, so every earlier leaf still fits it unchanged.
 */

const NEW_ACTIVITIES = ["declared-charge-this-phase", "fell-back-this-turn"] as const;

/** Activities a unit's history records, lowered to `happened` in compile-conditions.ts. */
export const HISTORY_ACTIVITIES = [
  "destroyed-enemy-unit-this-phase", "destroyed-enemy-unit-this-turn",
  "set-up-by-deep-strike-this-phase", "set-up-by-deep-strike-this-turn",
  "lost-models-to-triggering-attacks",
] as const;

/** History that names the Transport, lowered to `happened` disembarked in compile-conditions.ts. */
export const TRANSPORT_ACTIVITIES = ["disembarked-from-this-transport-this-turn"] as const;

/**
 * "That arrived from Reserves this turn": set up on the battlefield from Strategic Reserves, which
 * the rules call Reserves. Lowered to `happened` set-up from strategic-reserves in compile-conditions.ts.
 */
export const RESERVES_ARRIVAL_ACTIVITIES = ["set-up-from-reserves-this-phase", "set-up-from-reserves-this-turn"] as const;

const TARGETING_ACTIVITY_LIST = activitiesExtension(
  13,
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

const EACH_TARGET_ACTIVITY: FamilyExtension = {
  // "One **X** unit and one **Y** unit … that have not been selected to shoot this phase".
  family: "unit-activity",
  version: 14,
  description: "As the previous version, plus subject each-target: every Stratagem target named before it in TARGET, for a relative clause with plural agreement after coordinated targets (\"One **X** unit and one **Y** unit that have not been selected …\").",
  schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [EACH_TARGET]) }),
  normalize: (input, previous) => input.subject === EACH_TARGET ? standIn(input, "subject", "this-unit", previous) : previous(input),
};

/**
 * Destruction by the triggering attacks (unit-activity@15): "if those attacks destroyed an enemy unit", "if
 * one or more enemy models were destroyed by those attacks". The two activities name what was
 * destroyed; `named` places the unit-filter that names it (before or after the verb, or none),
 * `container` says a model's unit is named after it, and `destroyer` says who made the attacks.
 * A destruction leaf takes no subject. Lowering: compile-triggering-destruction.ts.
 */
export const DESTRUCTION_ACTIVITIES = ["destroyed-units-by-triggering-attacks", "destroyed-models-by-triggering-attacks"] as const;

export const DESTROYERS = ["this-unit", "event-subject", "stratagem-target"] as const;

const NAMED = ["before", "after", "none"] as const;

const CONTAINER = ["after", "none"] as const;

const DESTRUCTION_PARAMETERS = ["named", "container", "destroyer"] as const;

/** The Stratagem id shape every entity id uses (kebab-case, as the core records name them). */
const STRATAGEM_ID = { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$" };

/** The unit-activity that says a unit was targeted with the Stratagems named in stratagem_ids this phase. */
export const TARGETED_WITH_STRATAGEM = "targeted-with-stratagem-this-phase";

/** Destroyed-enemy-unit activities that an attack type can qualify. */
const DESTROY_ACTIVITIES = ["destroyed-enemy-unit-this-phase", "destroyed-enemy-unit-this-turn"];

const ATTACK_TYPES = ["melee", "ranged", "psychic"];

const DESTROYER_THIS_MODEL: FamilyExtension = {
  family: "unit-activity",
  version: 18,
  description: "As the previous version, plus destroyer this-model: the destruction was made by the attacks of this model (a destruction activity only).",
  schema: (previous) => {
    const destroyer = properties(previous).destroyer!;
    return withProperties(previous, { destroyer: optional({ ...destroyer, enum: [...(destroyer.enum as string[]), "this-model"] }) as Schema });
  },
  normalize: (input, previous) => input.destroyer === "this-model" ? standIn(input, "destroyer", "this-unit", previous) : previous(input),
};

const UNITS = "destroyed-units-by-triggering-attacks";

const MODELS = "destroyed-models-by-triggering-attacks";

const UNIT_ACTIVITY_KEYWORDS: FamilyExtension = {
  family: "unit-activity",
  version: 19,
  description: "As the previous version, plus keywords on destroyed-models-by-triggering-attacks (the destroyed models' unit keywords), and both destruction activities on one leaf (a destroyed unit or a destroyed model, one verb and one unit-filter after it).",
  schema: (previous) => withProperties(previous, {
    keywords: optional({ type: "array", items: KEYWORD_ITEMS, minItems: 1, uniqueItems: true }),
  }),
  normalize: (input, previous) => {
    const { keywords, ...rest } = input;
    const listed = Array.isArray(rest.activities) ? rest.activities as unknown[] : [];
    const destruction = listed.filter((activity) => (DESTRUCTION_ACTIVITIES as readonly unknown[]).includes(activity));
    if (keywords !== undefined && (!listed.includes(MODELS) || destruction.length !== listed.length)) {
      throw new TypeError("unit-activity keywords belong to destroyed-models-by-triggering-attacks.");
    }
    const checkedKeywords = keywords === undefined ? {} : { keywords: keywordList(keywords, "unit-activity keywords", 1) };
    if (destruction.length !== 2) return { ...previous(rest), ...checkedKeywords };
    if (listed.length !== 2 || new Set(listed).size !== 2) throw new TypeError("unit-activity names both destruction activities once each, and nothing else.");
    // The previous version checks one destruction activity; the pair is restored after it.
    const { activities: _activities, ...shared } = rest;
    const checked = previous({ ...shared, activities: [MODELS] });
    return { ...checked, activities: [...DESTRUCTION_ACTIVITIES], ...checkedKeywords };
  },
};

/** The activity: the subject destroyed the Stratagem's target. */
export const DESTROYED_STRATAGEM_TARGET = "destroyed-stratagem-target";

/**
 * unit-activity history values, in two versions (21 and 22):
 *
 * 1. Four subject-bearing activities: `lost-wounds-to-triggering-attacks` ("lost a wound as a result
 *    of those attacks"), `was-charged-this-turn` ("was charged this turn"),
 *    `suffered-mortal-wounds-from-this-ability` and `lost-models-to-own-mortal-wounds` ("as a result
 *    of this ability"). Lowered from the HISTORY table in compile-conditions.ts.
 * 2. `destroyed-units-in-window` ("an enemy unit that has destroyed one or more X units during the
 *    battle"): a windowed destruction history. It takes no subject; `named` places the unit-filter
 *    of the victims, `destroyer` says who destroyed them (`defender`, the attack's target, joins
 *    the older roles and is valid only here) and a `history-window` leaf after it names the
 *    window. Lowered in compile-triggering-destruction.ts.
 */
export const HISTORY_VALUE_ACTIVITIES = [
  "lost-wounds-to-triggering-attacks", "was-charged-this-turn", "suffered-mortal-wounds-from-this-ability", "lost-models-to-own-mortal-wounds",
] as const;

export const WINDOWED_DESTRUCTION = "destroyed-units-in-window";

export const WINDOWED_DESTROYERS = ["this-unit", "this-model", "event-subject", "stratagem-target", "defender"] as const;

const WINDOWED_NAMED = ["before", "after"] as const;

const VALUES: FamilyExtension = activitiesExtension(
  21,
  HISTORY_VALUE_ACTIVITIES,
  "four activities that name the unit by subject: lost wounds to the triggering attacks, was charged this turn, suffered mortal wounds from this ability, lost models to this ability's mortal wounds",
);

const WINDOWED: FamilyExtension = {
  family: "unit-activity",
  version: 22,
  description: "As the previous version, plus the activity destroyed-units-in-window (a windowed destruction history): named before or after, container none, destroyer this-unit, this-model, event-subject, stratagem-target or defender (the attack's target; this activity only), no subject. A history-window leaf after it names the window.",
  schema: (previous) => {
    const property = properties(previous).activities!;
    const items = property.items as Schema;
    const destroyer = properties(previous).destroyer!;
    return withProperties(previous, {
      activities: { ...property, items: { ...items, enum: [...(items.enum as string[]), WINDOWED_DESTRUCTION] } },
      destroyer: optional({ ...destroyer, enum: [...(destroyer.enum as string[]), "defender"] }),
    });
  },
  normalize: (input, previous) => {
    const listed = Array.isArray(input.activities) ? input.activities as unknown[] : [];
    if (!listed.includes(WINDOWED_DESTRUCTION)) {
      if (input.destroyer === "defender") throw new TypeError("unit-activity destroyer defender belongs to destroyed-units-in-window only.");
      return previous(input);
    }
    if (listed.length !== 1) throw new TypeError("unit-activity destroyed-units-in-window: one activity per leaf.");
    if (input.subject !== undefined) throw new TypeError("unit-activity destroyed-units-in-window takes no subject; destroyer names who destroyed.");
    if (!(WINDOWED_DESTROYERS as readonly unknown[]).includes(input.destroyer)) throw new TypeError(`unit-activity destroyed-units-in-window needs destroyer: ${WINDOWED_DESTROYERS.join(", ")}.`);
    if (!(WINDOWED_NAMED as readonly unknown[]).includes(input.named)) throw new TypeError("unit-activity destroyed-units-in-window needs named: before or after.");
    if (input.container !== "none") throw new TypeError("unit-activity destroyed-units-in-window names a unit, not a model's container: container none.");
    const { named, container, destroyer, ...rest } = input;
    const stray = Object.keys(rest).filter((key) => key !== "activities" && key !== "negated");
    if (stray.length) throw new TypeError(`unit-activity destroyed-units-in-window has no parameter ${stray[0]}.`);
    // The previous version checks the shared parameters (negated) with a known activity standing in.
    const { subject: _subject, ...normalized } = previous({ ...rest, activities: ["remained-stationary"], subject: "this-unit" });
    return { ...normalized, activities: [WINDOWED_DESTRUCTION], named, container, destroyer };
  },
};

export const UNIT_ACTIVITY_EXTENSIONS: readonly FamilyExtension[] = [
  // "if that unit has declared a charge this phase", "if this unit Fell Back this turn".
  activitiesExtension(6, NEW_ACTIVITIES, "two activities: declared a charge this phase, and made a Fall Back move this turn"),
  // "if this unit disembarked from a TRANSPORT this turn", "made an Ingress move this turn", "was set up this turn".
  activitiesExtension(7, ["disembarked-this-turn", "made-ingress-move-this-turn", "set-up-this-turn"], "three activities: disembarked this turn, made an Ingress move this turn, and was set up on the battlefield this turn"),
  activitiesExtension(8, HISTORY_ACTIVITIES, "history: destroyed one or more enemy units this phase or turn, set up using Deep Strike this phase or turn, and had models destroyed by the attacks of the unit that fired the trigger"),
  activitiesExtension(9, TRANSPORT_ACTIVITIES, "disembarked-from-this-transport-this-turn: the subject disembarked from this unit (the Transport) this turn"),
  activitiesExtension(10, RESERVES_ARRIVAL_ACTIVITIES, "set-up-from-reserves-this-phase/-this-turn: the subject arrived from (Strategic) Reserves this phase or turn"),
  // "whose attacks have been resolved this phase": the unit has finished its attacks, which is
  // more than being selected to shoot or fight.
  activitiesExtension(11, ["resolved-attacks-this-phase"], "resolved-attacks-this-phase: the subject has resolved its attacks this phase"),
  activitiesExtension(
    12,
    ["fell-back-this-phase", "charged-this-phase", "made-normal-move-this-phase", "made-normal-move-this-turn", "disembarked-this-phase", "set-up-this-phase", "made-dark-pact-this-phase", "lost-models-this-phase", "destroyed-enemy-model-this-phase", "destroyed-enemy-model-this-turn"],
    "a unit's moves and moments this phase (fell back, charged, made a Normal move, disembarked, was set up, made a Dark Pact), made a Normal move this turn, lost models this phase, and destroyed an enemy model this phase or turn",
  ),
  TARGETING_ACTIVITIES,
  EACH_TARGET_ACTIVITY,
  {
    family: "unit-activity",
    version: 15,
    description: "As the previous version, plus two destruction activities (destroyed-units-by-triggering-attacks, destroyed-models-by-triggering-attacks) with named (before, after or none), container (after or none), and destroyer (this-unit, event-subject or stratagem-target); a destruction leaf takes no subject.",
    schema: (previous) => {
      const property = properties(previous).activities!;
      const items = property.items as Schema;
      const extended = withProperties(previous, {
        activities: { ...property, items: { ...items, enum: [...(items.enum as string[]), ...DESTRUCTION_ACTIVITIES] } },
        named: optional({ enum: [...NAMED] }),
        container: optional({ enum: [...CONTAINER] }),
        destroyer: optional({ enum: [...DESTROYERS] }),
      });
      return { ...extended, required: (previous.required as string[]).filter((key) => key !== "subject") };
    },
    normalize: (input, previous) => {
      const listed = Array.isArray(input.activities) ? input.activities as unknown[] : [];
      const destruction = listed.filter((activity) => (DESTRUCTION_ACTIVITIES as readonly unknown[]).includes(activity));
      if (destruction.length === 0) {
        if (DESTRUCTION_PARAMETERS.some((key) => key in input)) throw new TypeError("unit-activity named, container and destroyer belong to a triggering destruction activity.");
        if (input.subject === undefined) throw new TypeError("unit-activity needs a subject unless it is a triggering destruction activity.");
        return previous(input);
      }
      if (listed.length !== 1) throw new TypeError("destroyed-by-triggering-attacks: one destruction activity per leaf.");
      if (input.subject !== undefined) throw new TypeError("unit-activity destruction activities take no subject; destroyer names who made the attacks.");
      if (!(DESTROYERS as readonly unknown[]).includes(input.destroyer)) throw new TypeError("unit-activity destruction activity needs destroyer: this-unit, event-subject or stratagem-target.");
      if (!(NAMED as readonly unknown[]).includes(input.named)) throw new TypeError("unit-activity destruction activity needs named: before, after or none.");
      if (!(CONTAINER as readonly unknown[]).includes(input.container)) throw new TypeError("unit-activity destruction activity needs container: after or none.");
      const { named, container, destroyer, ...rest } = input;
      // The previous version checks the shared parameters (negated) with a known activity standing in.
      const { subject: _subject, ...normalized } = previous({ ...rest, activities: ["remained-stationary"], subject: "this-unit" });
      return { ...normalized, activities: [destruction[0]], named, container, destroyer };
    },
  },
  /**
   * "Not chosen by these Gadgets this phase", for restrictions that name other Gadgets.
   */
  {
    // "not chosen by the Alpha Gadget or Beta Gadget this phase": one leaf naming the Gadgets.
    family: "unit-activity",
    version: 16,
    description: "As the previous version, plus activity targeted-with-stratagem-this-phase with stratagem_ids (one or more Stratagems that targeted the unit this phase, any player's): the leaf names that activity alone, and its stratagem_ids name the Stratagems.",
    schema: (previous) => {
      const activities = properties(previous).activities!;
      const items = activities.items as Schema;
      return withProperties(previous, {
        activities: { ...activities, items: { ...items, enum: [...(items.enum as string[]), TARGETED_WITH_STRATAGEM] } },
        stratagem_ids: optional({ type: "array", items: STRATAGEM_ID, minItems: 1, uniqueItems: true }),
      });
    },
    normalize: (input, previous) => {
      const listed = Array.isArray(input.activities) ? input.activities as unknown[] : [];
      const named = listed.includes(TARGETED_WITH_STRATAGEM);
      if (!named) {
        if ("stratagem_ids" in input) throw new TypeError(`unit-activity.stratagem_ids applies only to ${TARGETED_WITH_STRATAGEM}.`);
        return previous(input);
      }
      if (listed.length !== 1) throw new TypeError(`unit-activity ${TARGETED_WITH_STRATAGEM} is not mixed with another activity in one leaf.`);
      if (!Array.isArray(input.stratagem_ids) || input.stratagem_ids.length === 0) throw new TypeError(`unit-activity ${TARGETED_WITH_STRATAGEM} names its Stratagems in stratagem_ids.`);
      const ids = input.stratagem_ids.map((id) => {
        if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/u.test(id)) throw new TypeError("unit-activity.stratagem_ids lists Stratagem ids (kebab-case).");
        return id;
      });
      if (new Set(ids).size !== ids.length) throw new TypeError("unit-activity.stratagem_ids lists a Stratagem twice.");
      const { stratagem_ids: _ids, ...rest } = input;
      // The previous version checks the rest of the leaf with one activity it knows standing in.
      const normalized = previous({ ...rest, activities: ["remained-stationary"] });
      return { ...normalized, activities: [TARGETED_WITH_STRATAGEM], stratagem_ids: [...ids].sort() };
    },
  },
  /**
   * Which attacks destroyed ("If this unit's melee attacks destroyed an enemy unit this phase").
   * Every earlier leaf keeps its meaning.
   */
  {
    // "If this unit's melee attacks destroyed an enemy unit this phase".
    family: "unit-activity",
    version: 17,
    description: "As the previous version, plus attack_type (melee, ranged or psychic) on one destroyed-enemy-unit activity this phase or turn: the destroying attacks are of that type. It qualifies no other activity, nor a list of several.",
    schema: (previous) => withProperties(previous, { attack_type: optional({ enum: ATTACK_TYPES }) }),
    normalize: (input, previous) => {
      if (input.attack_type === undefined) return previous(input);
      const { attack_type: attackType, ...rest } = input;
      const listed = Array.isArray(rest.activities) ? rest.activities as unknown[] : [];
      if (listed.length !== 1 || !DESTROY_ACTIVITIES.includes(String(listed[0]))) {
        throw new TypeError("unit-activity.attack_type qualifies only a destroyed-enemy-unit activity on its own.");
      }
      const normalized = previous(rest);
      return { ...normalized, attack_type: enumValue(attackType, ATTACK_TYPES, "unit-activity.attack_type") };
    },
  },
 DESTROYER_THIS_MODEL,
  /**
   * Keywords on destroyed-models-by-triggering-attacks ("destroyed an enemy Character model"), and
   * both destruction activities on one leaf ("destroyed an enemy unit or an enemy Character
   * model"): one verb, one unit-filter after it, each activity keeps its own object. The keywords
   * belong to the models activity only. Lowering: compile-triggering-destruction.ts.
   */
 UNIT_ACTIVITY_KEYWORDS,
  /**
   * destroyed-stratagem-target: the subject destroyed the unit the Stratagem targets ("targets the
   * enemy unit that just destroyed your unit"). Lowers to a history condition
   * (compile-conditions.ts) and is refused outside a Stratagem whose target was just destroyed
   * (compile-triggering-destruction.ts).
   */
  activitiesExtension(20, [DESTROYED_STRATAGEM_TARGET], `activity ${DESTROYED_STRATAGEM_TARGET}: the subject destroyed the unit the Stratagem targets ("targets the enemy unit that just destroyed your unit")`),
  VALUES,
 WINDOWED,
];
