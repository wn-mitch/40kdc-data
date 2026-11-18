import { DESIGNATION_IDS, refuseListBuildingTag } from "../../translate/designations.js";
import { normalizeAlternatives } from "../unit-filter-alternatives.js";
import type { FlatFamily } from "./types.js";
import {
  ANTECEDENT, BEARER_TRANSPORT, EACH_TARGET, EVENT_OBJECT, FILTERED_UNITS, FOLLOWING_FILTER, KEBAB, KEBAB_STRING, KEYWORD_ITEMS,
  MAX_INCHES, Spellings, UNIT_KEYWORD, WIDE, WIDE_OR_ANTECEDENT, accents, apostrophes, booleanValue, boundedInteger, designationId,
  enumSet, enumValue, exactKeys, hasDuplicate, keysWithin, keywordList, type Params, without,
} from "./unit-subjects-shared.js";

/** The predicates on what a unit has done (unit-activity) and where it is (unit-position). */

// ---- unit-activity ----

/** Activities a subject did this phase, turn or battle that the condition's own check reads. */
const BASE_ACTIVITIES = ["charged-this-turn", "advanced-this-turn", "remained-stationary", "fought-this-phase", "selected-to-shoot-this-phase", "selected-to-move-this-phase"] as const;
const MADE_ATTACKS_TARGETING = "made-attacks-targeting-this-phase";
/** Further subject activities, listed beside the base ones in any mix. */
const LISTED_ACTIVITIES = [
  "declared-charge-this-phase", "fell-back-this-turn",
  "disembarked-this-turn", "made-ingress-move-this-turn", "set-up-this-turn",
  "destroyed-enemy-unit-this-phase", "destroyed-enemy-unit-this-turn", "set-up-by-deep-strike-this-phase", "set-up-by-deep-strike-this-turn", "lost-models-to-triggering-attacks",
  "disembarked-from-this-transport-this-turn",
  "set-up-from-reserves-this-phase", "set-up-from-reserves-this-turn",
  "resolved-attacks-this-phase",
  "fell-back-this-phase", "charged-this-phase", "made-normal-move-this-phase", "made-normal-move-this-turn", "disembarked-this-phase", "set-up-this-phase",
  "made-dark-pact-this-phase", "lost-models-this-phase", "destroyed-enemy-model-this-phase", "destroyed-enemy-model-this-turn",
  "targeted-by-attacks-this-phase", MADE_ATTACKS_TARGETING,
] as const;
/** Subject activities that can also stand beside a destruction, a Stratagem-targeting or a windowed history activity. */
const STRATAGEM_TARGET_ACTIVITIES = ["destroyed-stratagem-target"] as const;
const HISTORY_VALUE_ACTIVITIES = ["lost-wounds-to-triggering-attacks", "was-charged-this-turn", "suffered-mortal-wounds-from-this-ability", "lost-models-to-own-mortal-wounds"] as const;
const TRANSPORT_MOVES = ["embarked-this-phase", "advanced-this-phase"] as const;
const UNITS_DESTROYED = "destroyed-units-by-triggering-attacks";
const MODELS_DESTROYED = "destroyed-models-by-triggering-attacks";
const DESTRUCTION_ACTIVITIES = [UNITS_DESTROYED, MODELS_DESTROYED] as const;
const TARGETED_WITH_STRATAGEM = "targeted-with-stratagem-this-phase";
const WINDOWED_DESTRUCTION = "destroyed-units-in-window";
const DESTROYERS = ["this-unit", "event-subject", "stratagem-target", "this-model"] as const;
const WINDOWED_DESTROYERS = ["this-unit", "this-model", "event-subject", "stratagem-target", "defender"] as const;
const DESTROY_ACTIVITIES = ["destroyed-enemy-unit-this-phase", "destroyed-enemy-unit-this-turn"];
const ATTACK_TYPES = ["melee", "ranged", "psychic"] as const;
const ACTIVITY_SUBJECTS = [...WIDE_OR_ANTECEDENT, EACH_TARGET, BEARER_TRANSPORT] as const;
const STAND_IN = "remained-stationary";

const isIn = (list: readonly string[]) => (value: unknown) => (list as readonly unknown[]).includes(value);

/**
 * Activities `listed` from `added` beside the rest: the rest a leaf still checks (or remained
 * stationary when nothing else is listed) and how to join the added ones back, in sorted order.
 */
function peel(listed: readonly unknown[], added: readonly string[]): { rest: unknown[]; join: (rest: string[]) => string[] } {
  const found = listed.filter(isIn(added)) as string[];
  if (found.length === 0) return { rest: [...listed], join: (rest) => rest };
  if (hasDuplicate(listed)) throw new TypeError("unit-activity lists an activity twice.");
  const older = listed.filter((activity) => !found.includes(activity as string));
  return { rest: older.length ? older : [STAND_IN], join: (rest) => [...(older.length ? rest : []), ...found].sort() };
}

/** A subject activity list: the base activities and the listed ones, each once. */
function subjectActivities(listed: readonly unknown[], subject: unknown, family: Params): Params {
  exactKeys(family, ["activities", "subject", "negated"], "unit-activity");
  // A Stratagem's targets and a bearer's Transport are read as units.
  const unit = subject === EACH_TARGET || subject === BEARER_TRANSPORT ? "this-unit" : subject;
  const { rest, join } = peel(listed, LISTED_ACTIVITIES);
  const activities = join(enumSet(rest, BASE_ACTIVITIES, "unit-activity.activities"));
  enumValue(unit, WIDE_OR_ANTECEDENT, "unit-activity.subject");
  if (listed.includes(MADE_ATTACKS_TARGETING) && (unit === "this-unit" || unit === "this-model")) {
    throw new TypeError("unit-activity made-attacks-targeting-this-phase: the attacks targeted this unit, so their maker is another unit, not this unit or its model.");
  }
  return { activities, subject, negated: booleanValue(family.negated, "unit-activity.negated") };
}

/** Destruction parameters: who destroyed (destroyer) and where the leaf's unit-filters stand (named, container). */
function destruction(input: Params, rest: Params, destroyers: readonly string[], named: readonly string[], containers: readonly string[], what: string): Params {
  if (input.subject !== undefined) throw new TypeError(`unit-activity ${what} takes no subject; destroyer names who destroyed.`);
  if (!(destroyers as readonly unknown[]).includes(input.destroyer)) throw new TypeError(`unit-activity ${what} needs destroyer: ${destroyers.join(", ")}.`);
  if (!(named as readonly unknown[]).includes(input.named)) throw new TypeError(`unit-activity ${what} needs named: ${named.join(", ")}.`);
  if (!(containers as readonly unknown[]).includes(input.container)) throw new TypeError(`unit-activity ${what} needs container: ${containers.join(", ")}.`);
  exactKeys(rest, ["activities", "negated"], "unit-activity");
  return { negated: booleanValue(rest.negated, "unit-activity.negated"), named: input.named, container: input.container, destroyer: input.destroyer };
}

function normalizeUnitActivity(input: Params): Params {
  if (!Array.isArray(input.activities)) throw new TypeError(`unit-activity.activities must list at least one activity.`);
  if (input.subject !== undefined) enumValue(input.subject, ACTIVITY_SUBJECTS, "unit-activity.subject");
  // Transport moves, history values and destroyed-stratagem-target stand beside any other activity.
  const transport = peel(input.activities as unknown[], TRANSPORT_MOVES);
  const scope = { ...input, activities: transport.rest };
  const apostrophe = apostrophes("unit-activity", scope);
  const stripped = apostrophe.plain(scope) as Params;
  let core: Params;
  if (transport.rest.includes(WINDOWED_DESTRUCTION)) {
    if (transport.rest.length !== 1) throw new TypeError("unit-activity destroyed-units-in-window: one activity per leaf.");
    const stray = Object.keys(input).find((key) => !["activities", "negated", "named", "container", "destroyer", "subject"].includes(key));
    if (stray !== undefined) throw new TypeError(`unit-activity destroyed-units-in-window has no parameter ${stray}.`);
    core = { ...destruction(stripped, without(stripped, ["named", "container", "destroyer"]), WINDOWED_DESTROYERS, ["before", "after"], ["none"], "destroyed-units-in-window"), activities: [WINDOWED_DESTRUCTION] };
  } else {
    if (input.destroyer === "defender") throw new TypeError("unit-activity destroyer defender belongs to destroyed-units-in-window only.");
    const values = peel(transport.rest, HISTORY_VALUE_ACTIVITIES);
    const target = peel(values.rest, STRATAGEM_TARGET_ACTIVITIES);
    core = triggeredActivities(target.rest, stripped, apostrophe);
    core = { ...core, activities: values.join(target.join(core.activities as string[])) };
  }
  apostrophe.requireAllRestored();
  return { ...core, activities: transport.join(core.activities as string[]) };
}

/** Destruction by the triggering attacks, Stratagem targeting, and the subject activities, after the activities that stand beside any of them. */
function triggeredActivities(listed: unknown[], input: Params, apostrophe: Spellings): Params {
  const { keywords, attack_type: attackType, ...rest } = input;
  const destroyed = listed.filter(isIn(DESTRUCTION_ACTIVITIES));
  if (keywords !== undefined && (!listed.includes(MODELS_DESTROYED) || destroyed.length !== listed.length)) throw new TypeError("unit-activity keywords belong to destroyed-models-by-triggering-attacks.");
  const checkedKeywords = keywords === undefined ? {} : { keywords: apostrophe.restore(keywordList(keywords, "unit-activity keywords", 1)) };
  const both = destroyed.length === 2;
  if (both && (listed.length !== 2 || hasDuplicate(listed))) throw new TypeError("unit-activity names both destruction activities once each, and nothing else.");
  const one = both ? [MODELS_DESTROYED] : listed;
  if (attackType !== undefined && (one.length !== 1 || !DESTROY_ACTIVITIES.includes(String(one[0])))) throw new TypeError("unit-activity.attack_type qualifies only a destroyed-enemy-unit activity on its own.");
  const typed = attackType === undefined ? {} : { attack_type: enumValue(attackType, ATTACK_TYPES, "unit-activity.attack_type") };
  let result: Params;
  if (one.includes(TARGETED_WITH_STRATAGEM)) {
    if (one.length !== 1) throw new TypeError(`unit-activity ${TARGETED_WITH_STRATAGEM} is not mixed with another activity in one leaf.`);
    const ids = rest.stratagem_ids;
    if (!Array.isArray(ids) || ids.length === 0) throw new TypeError(`unit-activity ${TARGETED_WITH_STRATAGEM} names its Stratagems in stratagem_ids.`);
    for (const id of ids) if (typeof id !== "string" || !KEBAB.test(id)) throw new TypeError("unit-activity.stratagem_ids lists Stratagem ids (kebab-case).");
    if (hasDuplicate(ids)) throw new TypeError("unit-activity.stratagem_ids lists a Stratagem twice.");
    const checked = triggeringOrSubject([STAND_IN], without(rest, ["stratagem_ids"]));
    result = { ...checked, activities: [TARGETED_WITH_STRATAGEM], stratagem_ids: [...ids].sort() };
  } else {
    if ("stratagem_ids" in rest) throw new TypeError(`unit-activity.stratagem_ids applies only to ${TARGETED_WITH_STRATAGEM}.`);
    result = triggeringOrSubject(one, rest);
  }
  return { ...result, ...(both ? { activities: [...DESTRUCTION_ACTIVITIES] } : {}), ...typed, ...checkedKeywords };
}

/** One destruction by the triggering attacks (no subject), or the subject activities. */
function triggeringOrSubject(listed: readonly unknown[], input: Params): Params {
  const destroyed = listed.filter(isIn(DESTRUCTION_ACTIVITIES));
  if (destroyed.length === 0) {
    if (["named", "container", "destroyer"].some((key) => key in input)) throw new TypeError("unit-activity named, container and destroyer belong to a triggering destruction activity.");
    if (input.subject === undefined) throw new TypeError("unit-activity needs a subject unless it is a triggering destruction activity.");
    return subjectActivities(listed, input.subject, input);
  }
  if (listed.length !== 1) throw new TypeError("destroyed-by-triggering-attacks: one destruction activity per leaf.");
  return { ...destruction(input, without(input, ["named", "container", "destroyer"]), DESTROYERS, ["before", "after", "none"], ["after", "none"], "destruction activity"), activities: [destroyed[0]] };
}

// ---- unit-position ----

const POSITION_KINDS = ["closest-eligible", "within", "beyond", "objective-range"] as const;
const POSITION_SUBJECTS = [...WIDE_OR_ANTECEDENT, BEARER_TRANSPORT, EACH_TARGET, EVENT_OBJECT, FILTERED_UNITS, "disembarked-from"] as const;
/** Units a distance can be measured to directly. */
const UNIT_OF = [...WIDE, EVENT_OBJECT, ANTECEDENT] as const;
const POSITION_OF = [...UNIT_OF, "matching-unit", "marker", "battlefield-edge", FOLLOWING_FILTER, "objective", "enemy-deployment-zone", "battlefield-centre"] as const;
const OBJECTIVE_CONTROLLERS = ["any", "you", "opponent"] as const;
/** The measures a within or beyond distance takes exactly one of. */
const MEASURES = ["inches", "rolled_inches", "range_ref", "weapon_range", "distance"] as const;
const NAMED_RANGES = ["contagion", "synapse"] as const;
const DICE = /^\d*D(3|6)(\+\d+)?$/u;
const MATCHING_KEYS = ["of_keywords", "of_side", "of_other", "of_alternatives", "of_excluded_keywords", "of_shares_keywords", "of_designated", "of_not_designated"] as const;

function closestEligible(input: Params, subject: string, negated: boolean): Params {
  if (subject === EVENT_OBJECT) throw new TypeError("unit-position subject event-object takes within, beyond or objective-range, not closest-eligible.");
  if (subject === BEARER_TRANSPORT) throw new TypeError("unit-position subject bearer-transport is only for kind objective-range.");
  if (subject === "disembarked-from") throw new TypeError("unit-position subject disembarked-from measures a within or beyond distance.");
  keysWithin(input, ["kind", "subject", "negated"], ["to", "range"], "unit-position closest-eligible");
  return {
    kind: "closest-eligible", subject, negated,
    ...("to" in input ? { to: enumValue(input.to, WIDE, "unit-position.to") } : {}),
    ...("range" in input ? { range: boundedInteger(input.range, 1, MAX_INCHES, "unit-position.range") } : {}),
  };
}

/** Every model of the subject passes the test (models: every). */
function everyModel(input: Params, subject: string, negated: boolean): Params {
  if (!("models" in input)) return {};
  if (input.models !== "every") throw new TypeError(`unit-position.models is "every" or absent; got ${JSON.stringify(input.models)}.`);
  if (negated) throw new TypeError("unit-position.models every describes a position that holds, so negated is false.");
  if (!["this-unit", ANTECEDENT, FILTERED_UNITS, "disembarked-from"].includes(subject)) throw new TypeError("unit-position.models every takes subject this-unit or antecedent (or a filter's units).");
  if (input.kind === "within" && !["this-unit", FOLLOWING_FILTER].includes(String(input.of))) throw new TypeError("unit-position.models every measures within a distance to this-unit or following-filter.");
  const refused = ["wholly", "distance", "range_ref", "weapon_range"].find((key) => key in input);
  if (refused) throw new TypeError(`unit-position.models every cannot combine with ${refused}.`);
  return { models: "every" };
}

function objectiveRange(input: Params, subject: string, negated: boolean): Params {
  if (subject === "disembarked-from") throw new TypeError("unit-position subject disembarked-from measures a within or beyond distance.");
  keysWithin(input, ["kind", "subject", "negated", "controlled_by"], ["objective", "objective_tag", "models"], "unit-position objective-range");
  const models = everyModel(input, subject, negated);
  const result: Params = { kind: "objective-range", subject, negated, controlled_by: enumValue(input.controlled_by, OBJECTIVE_CONTROLLERS, "unit-position.controlled_by"), ...models };
  const { objective, objective_tag: tag } = input;
  if (objective === undefined && tag === undefined) return result;
  const value = enumValue(objective ?? "any", ["any", "selected", "designated"], "unit-position.objective");
  if ((value === "designated") !== (tag !== undefined)) throw new TypeError("unit-position.objective_tag names the designation of a designated objective, and only then.");
  if (tag !== undefined && !DESIGNATION_IDS.has(String(tag))) throw new TypeError(`unit-position.objective_tag ${JSON.stringify(tag)} is not a registered designation.`);
  if (tag !== undefined) refuseListBuildingTag(String(tag), "unit-position.objective_tag");
  return value === "any" ? result : { ...result, objective: value, ...(tag !== undefined ? { objective_tag: tag } : {}) };
}

/** The one measure of a within or beyond distance. */
function measure(input: Params, kind: string, subject: string): Params {
  const given = MEASURES.filter((key) => key in input);
  if (given.length === 0) throw new TypeError("unit-position within or beyond takes inches, rolled_inches, range_ref, weapon_range or distance.");
  if (given.length > 1) throw new TypeError(`unit-position takes one of inches, rolled_inches, range_ref, weapon_range and distance, not ${given.join(" and ")}.`);
  const of = input.of;
  switch (given[0]) {
    case "inches":
      return { inches: boundedInteger(input.inches, 1, MAX_INCHES, "unit-position.inches") };
    case "rolled_inches":
      if (typeof input.rolled_inches !== "string" || !DICE.test(input.rolled_inches)) throw new TypeError("unit-position.rolled_inches is a dice roll (D3, D6, 2D6, D6+1).");
      return { rolled_inches: input.rolled_inches };
    case "range_ref": {
      const range = input.range_ref;
      if (kind !== "within") throw new TypeError("unit-position.range_ref measures a within distance; beyond a named range is not authored.");
      if ("wholly" in input) throw new TypeError("unit-position.range_ref cannot be wholly within a named range.");
      if (range === "engagement") {
        if (!["this-unit", "this-model", FOLLOWING_FILTER, EVENT_OBJECT].includes(String(of))) throw new TypeError("unit-position.range_ref engagement takes of this-unit, this-model, following-filter or event-object.");
        return { range_ref: range };
      }
      if (typeof range !== "string" || !(NAMED_RANGES as readonly string[]).includes(range)) throw new TypeError(`unit-position.range_ref names one of ${NAMED_RANGES.join(", ")}.`);
      if (!["this-unit", "this-model", "matching-unit", "objective"].includes(String(of))) throw new TypeError("unit-position.range_ref needs of: this-unit, this-model, matching-unit or objective.");
      if (of === "matching-unit" && input.of_other !== undefined) throw new TypeError("unit-position.range_ref does not take of_other.");
      return { range_ref: range };
    }
    case "weapon_range":
      if (kind !== "within") throw new TypeError("unit-position.weapon_range measures a within distance.");
      if (of !== "attacker") throw new TypeError("unit-position.weapon_range is measured from the attacker.");
      if (subject !== "target") throw new TypeError("unit-position.weapon_range describes the attack's target.");
      return { weapon_range: enumValue(input.weapon_range, ["half", "full"], "unit-position.weapon_range") };
    default:
      if (input.distance !== "half-weapon") throw new TypeError(`unit-position.distance ${JSON.stringify(input.distance)} is not a listed distance.`);
      if (kind !== "within") throw new TypeError("unit-position.distance measures a within distance.");
      if (of !== "attacker") throw new TypeError("unit-position.distance is measured from the attacker: of attacker.");
      if ("wholly" in input) throw new TypeError("unit-position.distance cannot combine with wholly.");
      return { distance: "half-weapon" };
  }
}

/** Units matching a filter (of matching-unit): side, keywords, alternatives, exclusions, shared keywords and designations. */
function matchingUnit(input: Params, original: Params, apostrophe: Spellings): Params {
  const side = enumValue(input.of_side, ["friendly", "enemy"], "unit-position.of_side");
  const designated = input.of_designated !== undefined || input.of_not_designated !== undefined;
  if (designated && input.of_other !== undefined) throw new TypeError("unit-position.of_other is not combined with of_designated.");
  if (input.of_other !== undefined && input.of_other !== true) throw new TypeError("unit-position.of_other is true or absent.");
  // Without keywords a designated filter reads only its designations; it takes no alternatives or exclusions.
  if (designated && input.of_keywords === undefined) {
    const extra = ["of_alternatives", "of_excluded_keywords"].find((key) => input[key] !== undefined);
    if (extra) throw new TypeError(`unit-position.${extra} needs of_keywords beside of_designated.`);
  }
  let keywords: string[] | undefined;
  if (input.of_keywords !== undefined) {
    const accent = accents("unit-position", without(input, ["of_alternatives", "of_excluded_keywords", "of_shares_keywords"]));
    keywords = accent.restore(keywordList(accent.plain(input.of_keywords), "unit-position.of_keywords", 1));
  }
  return {
    of_side: side,
    ...(keywords !== undefined ? { of_keywords: apostrophe.restore(keywords) } : {}),
    ...(input.of_other === true ? { of_other: true } : {}),
    ...(input.of_alternatives !== undefined
      ? { of_alternatives: apostrophe.restore(normalizeAlternatives(input.of_alternatives, "unit-position.of_alternatives", { keywords })) }
      : {}),
    ...(input.of_excluded_keywords !== undefined
      ? { of_excluded_keywords: apostrophe.restore(keywordList(input.of_excluded_keywords, "unit-position.of_excluded_keywords", 1)) }
      : {}),
    ...(original.of_shares_keywords !== undefined ? { of_shares_keywords: keywordList(original.of_shares_keywords, "unit-position.of_shares_keywords", 2) } : {}),
    ...(input.of_designated !== undefined ? { of_designated: designationId(input.of_designated, "unit-position.of_designated") } : {}),
    ...(input.of_not_designated !== undefined ? { of_not_designated: designationId(input.of_not_designated, "unit-position.of_not_designated") } : {}),
  };
}

/** What a within or beyond distance is measured to, and that place's own parameters. */
function distancePlace(input: Params, original: Params, kind: string, apostrophe: Spellings): Params {
  const of = enumValue(input.of, POSITION_OF, "unit-position.of");
  const stray = MATCHING_KEYS.find((key) => original[key] !== undefined);
  if (of !== "matching-unit" && stray) throw new TypeError(`unit-position.${stray} only describes of: matching-unit.`);
  if (of !== "marker" && "of_marker" in input) throw new TypeError("unit-position.of_marker goes with of: marker.");
  if (of !== "objective" && (input.objective_tag !== undefined || input.controlled_by !== undefined)) {
    throw new TypeError("unit-position.objective_tag and controlled_by describe an objective marker only.");
  }
  if ("objective" in input) throw new TypeError("unit-position.objective qualifies an objective-range.");
  const place = (keys: readonly string[]) => {
    const refused = keys.find((key) => input[key] !== undefined);
    if (refused) throw new TypeError(`unit-position of ${of} takes whole inches; ${refused} does not apply.`);
  };
  switch (of) {
    case "matching-unit":
      return { of, ...matchingUnit(input, original, apostrophe) };
    case "marker":
      if (typeof input.of_marker !== "string" || !KEBAB.test(input.of_marker)) throw new TypeError("unit-position.of_marker is the marker's kebab-case id (cult-ambush-marker).");
      return { of, of_marker: input.of_marker };
    case "objective": {
      const tag = designationId(input.objective_tag, "unit-position.objective_tag");
      if (input.controlled_by !== undefined) enumValue(input.controlled_by, OBJECTIVE_CONTROLLERS, "unit-position.controlled_by");
      return { of, objective_tag: tag, ...(input.controlled_by !== undefined ? { controlled_by: input.controlled_by } : {}) };
    }
    case "enemy-deployment-zone":
      if (kind === "within") place(["range_ref", "distance", "weapon_range", "models"]);
      return { of };
    case "battlefield-centre":
      place(["range_ref", "distance", "weapon_range", "models"]);
      return { of };
    default:
      return { of };
  }
}

function withinOrBeyond(input: Params, original: Params, kind: string, subject: string, negated: boolean, apostrophe: Spellings): Params {
  keysWithin(input, ["kind", "subject", "negated", "of"], [...MEASURES, ...MATCHING_KEYS, "wholly", "of_marker", "objective_tag", "controlled_by", "models", "at", "objective"], "unit-position within/beyond");
  if (subject === BEARER_TRANSPORT) throw new TypeError("unit-position subject bearer-transport is only for kind objective-range.");
  if (subject === "disembarked-from") {
    if (input.of !== "this-unit" && input.of !== "this-model") throw new TypeError("unit-position subject disembarked-from is measured to this unit or model.");
    if (negated) throw new TypeError("unit-position subject disembarked-from names the Transport's position; negate it with beyond.");
  }
  if ("wholly" in input) {
    if (input.wholly !== true) throw new TypeError("unit-position.wholly is true or absent.");
    if (kind !== "within") throw new TypeError("unit-position.wholly describes a within distance.");
  }
  if (kind === "beyond" && "models" in input) throw new TypeError("unit-position.models every describes a within distance or an objective-range.");
  const place = distancePlace(input, original, kind, apostrophe);
  const models = everyModel(input, subject, negated);
  const at = input.at === undefined ? {} : { at: enumValue(input.at, ["move-start"], "unit-position.at") };
  return { kind, subject, negated, ...measure(input, kind, subject), ...place, ...(input.wholly === true ? { wholly: true } : {}), ...models, ...at };
}

function normalizeUnitPosition(original: Params): Params {
  const kind = enumValue(original.kind, POSITION_KINDS, "unit-position.kind");
  const subject = enumValue(original.subject, POSITION_SUBJECTS, "unit-position.subject");
  const negated = booleanValue(original.negated, "unit-position.negated");
  if (kind === "closest-eligible") return closestEligible(original, subject, negated);
  if (kind === "objective-range") return objectiveRange(original, subject, negated);
  // Keywords printed after an apostrophe: every keyword list but the shared one reads them plain.
  const apostrophe = apostrophes("unit-position", without(original, ["of_shares_keywords"]));
  const input = apostrophe.plain(original) as Params;
  const result = withinOrBeyond(input, original, kind, subject, negated, apostrophe);
  apostrophe.requireAllRestored();
  return result;
}

const WITHIN_OR_BEYOND = { kind: ["within", "beyond"] } as const;
const MATCHING_ONLY = { of: ["matching-unit"] } as const;
const ALTERNATIVE_KEYWORDS = { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } } as const;

export const UNIT_ACTIVITY_AND_POSITION_FAMILIES: readonly FlatFamily[] = [
  {
    id: "unit-activity",
    version: 25,
    role: "CONDITION",
    label: "Unit has (or has not) acted",
    description: "What the subject has done: it holds when the subject did any of the listed activities, and negated when it did none (\"has not been selected to shoot or fight this phase\"). Activities: charged or Advanced this turn, Remained Stationary, fought (or was selected to fight) this phase, selected to shoot or to move this phase, declared a charge this phase, Fell Back this turn or this phase, charged this phase, made a Normal move this phase or turn, disembarked this phase or turn (or from this unit, the Transport, this turn), made an Ingress move this turn, was set up this phase or turn (using Deep Strike, or from Reserves), resolved its attacks this phase, made a Dark Pact this phase, lost models this phase or to the attacks of the unit that fired the trigger, destroyed an enemy unit or model this phase or turn, was targeted by attacks this phase, made attacks this phase that targeted this unit (made-attacks-targeting-this-phase; its subject is never this unit or its model), destroyed the Stratagem's target, lost wounds to the triggering attacks, was charged this turn, suffered mortal wounds from this ability, lost models to this ability's mortal wounds, embarked within a Transport this phase, and made an Advance move this phase. The subject is this unit, this model, the attack's target, the attacking unit, the unit that triggered the ability, the effect's recipient, a unit the ability selected earlier, an earlier leaf's unit (antecedent), every Stratagem target named before it (each-target), or the Transport the unit is embarked within (bearer-transport). attack_type (melee, ranged or psychic) qualifies one destroyed-enemy-unit activity on its own. targeted-with-stratagem-this-phase stands alone, with stratagem_ids naming the Stratagems (any player's) that targeted the subject this phase. A destruction by the triggering attacks (destroyed-units-by-triggering-attacks, destroyed-models-by-triggering-attacks, or both on one leaf) takes no subject: named (before, after or none) places the unit-filter that names what was destroyed, container (after or none) says a model's unit is named after it, destroyer (this-unit, this-model, event-subject or stratagem-target) says whose attacks, and keywords on destroyed-models-by-triggering-attacks are the destroyed models' unit keywords. destroyed-units-in-window is a windowed destruction history with no subject: named before or after, container none, destroyer this-unit, this-model, event-subject, stratagem-target or defender (the attack's target, this activity only); a history-window leaf after it names the window. A keyword can start with an apostrophe as the rules print it.",
    starter: { activities: [], subject: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["activities", "negated"],
      properties: {
        activities: {
          type: "array", minItems: 1, uniqueItems: true,
          items: {
            enum: [
              ...BASE_ACTIVITIES, ...LISTED_ACTIVITIES, ...DESTRUCTION_ACTIVITIES, TARGETED_WITH_STRATAGEM, ...STRATAGEM_TARGET_ACTIVITIES,
              ...HISTORY_VALUE_ACTIVITIES, WINDOWED_DESTRUCTION, ...TRANSPORT_MOVES,
            ],
          },
        },
        subject: { enum: [...ACTIVITY_SUBJECTS] },
        negated: { type: "boolean" },
        named: { enum: ["before", "after", "none"], "x-optional": true },
        container: { enum: ["after", "none"], "x-optional": true },
        destroyer: { enum: ["this-unit", "event-subject", "stratagem-target", "this-model", "defender"], "x-optional": true },
        stratagem_ids: { type: "array", items: KEBAB_STRING, minItems: 1, uniqueItems: true, "x-optional": true },
        attack_type: { enum: [...ATTACK_TYPES], "x-optional": true },
        keywords: { type: "array", items: { type: "string", pattern: "^'?[A-Z][A-Z0-9' -]*[A-Z0-9]$" }, minItems: 1, uniqueItems: true, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeUnitActivity,
  },
  {
    id: "unit-position",
    version: 30,
    role: "CONDITION",
    label: "Unit's position",
    description: "Where a unit is. closest-eligible: the subject is the closest eligible target, optionally whose closest it is (to, default the attacker) and within a maximum range. objective-range: the subject is within range of an objective marker controlled_by any player, you or your opponent; objective is any (the default), selected (the marker this record's select-objective chose) or designated (the marker carrying objective_tag, a registered designation). within/beyond: the subject is within, or more than, a distance of `of`. The distance is whole inches, a dice roll (rolled_inches: D3, D6, 2D6, D6+1, rolled once each time the ability resolves), a named range (range_ref contagion or synapse, within only, measured to this unit, this model, matching units or an objective marker; range_ref engagement, the Engagement Range itself, measured to this unit, this model, the following filter's units or the event object), the attacking weapon's range or half of it (weapon_range full or half: within, of the attacker, the subject the attack's target), or half the range of the weapon the attack uses (distance half-weapon: within, of the attacker). `of` is a unit-ref (\"one enemy unit within 24\\\" of this unit\" is subject selected-unit, of this-unit; event-subject is the unit whose move triggered the ability; event-object the unit the triggering event acted on), any unit matching a filter (matching-unit: of_side friendly or enemy; of_keywords, every keyword; of_other, a unit other than the subject; of_alternatives, two or more {keywords, excluded_keywords, states} any one of which it matches; of_excluded_keywords, none of these keywords; of_shares_keywords, two or more keywords at least one of which it shares with the subject; of_designated / of_not_designated, a registered designation it carries or does not), a named marker (marker, of_marker cult-ambush-marker), a battlefield edge, the units the unit-filter right after this leaf matches (following-filter), an objective marker (objective, with objective_tag and optionally controlled_by), the enemy deployment zone, or the centre of the battlefield. wholly: every part of each model of the subject is within the distance. models every: every model of this unit or an earlier leaf's unit is within a distance of this unit or the following filter's units, or within range of an objective marker. at move-start reads where the subject was when the move that triggered the ability began. The subject is this unit, this model, the attack's target, the attacking unit, the unit that triggered the ability, the effect's recipient, a unit the ability selected earlier, an earlier leaf's unit (antecedent), the Transport the unit is embarked within (bearer-transport, objective-range only), every Stratagem target named before it (each-target), the unit the moment's event acted on (event-object, not with closest-eligible), the units the unit-filter before this leaf names (filtered-units: the position holds when any of them meets it, or none of them when negated), or the Transport the moment's unit disembarked from (disembarked-from, within or beyond this unit or model). A keyword can carry accented capitals (KÂHL) or start with an apostrophe ('ARDMOB) as the rules print it.",
    starter: { kind: "", subject: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["kind", "subject", "negated"],
      properties: {
        kind: { enum: [...POSITION_KINDS] },
        inches: { type: "integer", minimum: 1, maximum: MAX_INCHES, "x-only-when": WITHIN_OR_BEYOND },
        of: { enum: [...POSITION_OF], "x-only-when": WITHIN_OR_BEYOND },
        controlled_by: { enum: [...OBJECTIVE_CONTROLLERS], "x-optional": true },
        to: { enum: [...WIDE], "x-only-when": { kind: ["closest-eligible"] } },
        range: { type: "integer", minimum: 1, maximum: MAX_INCHES, "x-only-when": { kind: ["closest-eligible"] } },
        subject: { enum: [...POSITION_SUBJECTS] },
        negated: { type: "boolean" },
        of_keywords: { type: "array", items: KEYWORD_ITEMS, minItems: 1, uniqueItems: true, "x-only-when": MATCHING_ONLY, "x-optional": true },
        of_side: { enum: ["friendly", "enemy"], "x-only-when": MATCHING_ONLY },
        of_other: { const: true, "x-only-when": MATCHING_ONLY, "x-optional": true },
        wholly: { const: true, "x-only-when": { kind: ["within"] }, "x-optional": true },
        of_marker: { ...KEBAB_STRING, "x-only-when": { of: ["marker"] }, "x-optional": true },
        objective: { enum: ["any", "selected", "designated"], "x-only-when": { kind: ["objective-range"] }, "x-optional": true },
        objective_tag: { ...KEBAB_STRING, "x-optional": true },
        of_alternatives: {
          type: "array", minItems: 2,
          items: {
            type: "object", minProperties: 1,
            properties: {
              keywords: ALTERNATIVE_KEYWORDS,
              excluded_keywords: ALTERNATIVE_KEYWORDS,
              states: { type: "array", minItems: 1, uniqueItems: true, items: { enum: ["unengaged", "battle-shocked", "not-battle-shocked"] } },
            },
            additionalProperties: false,
          },
          "x-only-when": MATCHING_ONLY, "x-optional": true,
        },
        range_ref: { enum: [...NAMED_RANGES, "engagement"], "x-only-when": { kind: ["within"] }, "x-optional": true },
        of_excluded_keywords: { type: "array", items: { type: "string", pattern: "^'?[A-Z][A-Z0-9' -]*[A-Z0-9]$" }, minItems: 1, uniqueItems: true, "x-only-when": MATCHING_ONLY, "x-optional": true },
        weapon_range: { enum: ["half", "full"], "x-only-when": { kind: ["within"] }, "x-optional": true },
        of_designated: { ...KEBAB_STRING, "x-only-when": MATCHING_ONLY, "x-optional": true },
        of_not_designated: { ...KEBAB_STRING, "x-only-when": MATCHING_ONLY, "x-optional": true },
        distance: { enum: ["half-weapon"], "x-only-when": { kind: ["within"] }, "x-optional": true },
        models: { enum: ["every"], "x-only-when": { kind: ["within", "objective-range"] }, "x-optional": true },
        of_shares_keywords: { type: "array", items: { type: "string", pattern: UNIT_KEYWORD.source }, minItems: 2, uniqueItems: true, "x-only-when": MATCHING_ONLY, "x-optional": true },
        at: { enum: ["move-start"], "x-only-when": WITHIN_OR_BEYOND, "x-optional": true },
        rolled_inches: { type: "string", pattern: DICE.source, "x-only-when": WITHIN_OR_BEYOND, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeUnitPosition,
  },
];
