import { DESIGNATION_IDS, refuseListBuildingTag } from "../../translate/designations.js";
import { type FamilyExtension, KEYWORD_ITEMS, keywordList, optional, properties, standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";
import { enumValue } from "../family-validation.js";
import { NAMED_RANGES } from "../named-ranges.js";
import { ALTERNATIVE_SCHEMA, normalizeAlternatives } from "../unit-filter-alternatives.js";
import { BEARER_TRANSPORT, EACH_TARGET, FILTERED_UNITS, FOLLOWING_FILTER, designationId, printedKeywordsExtension, refuseWith, standInEachTarget } from "./shared.js";

/**
 * Versions of unit-position: distances, ranges and placements a unit's position is measured by.
 * Each version checks only its own additions and hands the rest of a leaf to the previous version,
 * so every earlier leaf still fits it unchanged.
 */

/** A named marker's id, as battlefield-marker labels it ("cult-ambush-marker"). */
const MARKER_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;

const UNIT_POSITION_OF_ALTERNATIVES: FamilyExtension = {
  // "within 3\" of one or more friendly LEAGUES OF VOTANN VEHICLE or IRONKIN STEELJACKS units".
  family: "unit-position",
  version: 14,
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

const RANGE_NAMES = Object.keys(NAMED_RANGES);

const EXCLUDED_KEYWORDS_SCHEMA = { type: "array", items: KEYWORD_ITEMS, minItems: 1, uniqueItems: true, "x-only-when": { of: ["matching-unit"] } };

const NAMED_OF = ["this-unit", "this-model", "matching-unit"];

const WEAPON_RANGE = ["half", "full"] as const;

const UNIT_POSITION_BEARER: FamilyExtension = {
  // A Transport the unit is embarked within is within range of an objective marker: an objective range only.
  family: "unit-position",
  version: 17,
  description: "As the previous version, plus subject bearer-transport, for kind objective-range only: the Transport the unit is embarked within is within range of an objective marker.",
  schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [BEARER_TRANSPORT]) }),
  normalize: (input, previous) => {
    if (input.subject !== BEARER_TRANSPORT) return previous(input);
    if (input.kind !== "objective-range") throw new TypeError("unit-position subject bearer-transport is only for kind objective-range.");
    return standIn(input, "subject", "this-unit", previous);
  },
};

const DESIGNATION_PATTERN = "^[a-z0-9][a-z0-9-]*[a-z0-9]$";

const OBJECTIVE_CONTROLLERS = ["any", "you", "opponent"] as const;

/**
 * A distance measured to an objective marker (of objective, by its designation and controller),
 * to the enemy deployment zone (beyond only), or to matching units that carry or lack a
 * designation (of_designated, of_not_designated, with of_side).
 */
const UNIT_POSITION_WIDENED: FamilyExtension = {
  family: "unit-position",
  version: 19,
  description: "As the previous version, plus of objective (within or beyond an objective marker that carries objective_tag, a registered designation, and is controlled_by any, you or opponent), of enemy-deployment-zone (beyond only), and of_designated / of_not_designated on of matching-unit: units that carry, or do not carry, a registered designation (with of_side).",
  schema: (previous) => withProperties(previous, {
    of: widenedEnum(previous, "of", ["objective", "enemy-deployment-zone"]),
    // Redefined without x-only-when: the kinds it may qualify differ by `of`, so normalize checks them.
    objective_tag: optional({ type: "string", pattern: DESIGNATION_PATTERN }),
    controlled_by: optional({ enum: [...OBJECTIVE_CONTROLLERS] }),
    of_designated: optional({ type: "string", pattern: DESIGNATION_PATTERN, "x-only-when": { of: ["matching-unit"] } }),
    of_not_designated: optional({ type: "string", pattern: DESIGNATION_PATTERN, "x-only-when": { of: ["matching-unit"] } }),
  }),
  normalize: (input, previous) => {
    if (input.of === "objective") return objectiveDistance(input, previous);
    if (input.of === "enemy-deployment-zone") {
      if (input.kind !== "beyond") throw new TypeError("unit-position of enemy-deployment-zone measures a beyond distance (more than N away from it).");
      if (input.objective_tag !== undefined || input.controlled_by !== undefined) throw new TypeError("unit-position.objective_tag and controlled_by describe an objective marker only.");
      return standIn(input, "of", "this-unit", previous);
    }
    if (input.of_designated !== undefined || input.of_not_designated !== undefined) return designatedUnits(input, previous);
    if (input.objective_tag !== undefined && input.objective === undefined) throw new TypeError("unit-position.objective_tag qualifies of objective or objective-range.");
    return previous(input);
  },
};

function objectiveDistance(input: Record<string, unknown>, previous: (rest: Record<string, unknown>) => Record<string, unknown>): Record<string, unknown> {
  const { objective_tag: tag, controlled_by: controlled, ...rest } = input;
  if (rest.kind !== "within" && rest.kind !== "beyond") throw new TypeError("unit-position of objective measures a within or beyond distance.");
  if (rest.objective !== undefined) throw new TypeError("unit-position.objective names an objective-range; a distance to an objective names it by objective_tag.");
  if (tag === undefined) throw new TypeError("unit-position of objective needs objective_tag: the designation the marker carries.");
  const designation = designationId(tag, "unit-position.objective_tag");
  if (controlled !== undefined) enumValue(controlled, [...OBJECTIVE_CONTROLLERS], "unit-position.controlled_by");
  const normalized = standIn(rest, "of", "this-unit", previous);
  return { ...normalized, of: "objective", objective_tag: designation, ...(controlled !== undefined ? { controlled_by: controlled } : {}) };
}

function designatedUnits(input: Record<string, unknown>, previous: (rest: Record<string, unknown>) => Record<string, unknown>): Record<string, unknown> {
  const { of_designated: designated, of_not_designated: notDesignated, of_side: side, ...rest } = input;
  if (rest.of !== "matching-unit") throw new TypeError("unit-position.of_designated describes of: matching-unit only.");
  if (rest.of_other !== undefined) throw new TypeError("unit-position.of_other is not combined with of_designated.");
  const sideValue = enumValue(side, ["friendly", "enemy"], "unit-position.of_side");
  const designations = {
    ...(designated !== undefined ? { of_designated: designationId(designated, "unit-position.of_designated") } : {}),
    ...(notDesignated !== undefined ? { of_not_designated: designationId(notDesignated, "unit-position.of_not_designated") } : {}),
  };
  if (rest.of_keywords !== undefined) return { ...previous({ ...rest, of_side: sideValue }), ...designations };
  // Without keywords the matching-unit form has no keyword list to check; the distance and its
  // place are checked as a unit-ref ("this-unit") and the units are restored.
  const normalized = standIn({ ...rest, of: "matching-unit" }, "of", "this-unit", previous);
  return { ...normalized, of_side: sideValue, ...designations };
}

/** The distance a unit-position range_ref engagement names: the Engagement Range, which no aura carries. */
const NAMED_RANGE_REFS = [...Object.keys(NAMED_RANGES), "engagement"];

const ENGAGEMENT_OF = ["this-unit", "this-model", "following-filter"];

const EVENT_OBJECT = "event-object";

const SUBJECTS = ["this-unit", "antecedent"] as const;

const WITHIN_OF = ["this-unit", "following-filter"] as const;

/** Distance forms an every-model position never combines with: wholly is footprint, not every model; the others measure a range this version does not cover. */
const REFUSED_WITH_EVERY = ["wholly", "distance", "range_ref", "weapon_range"] as const;

/** The middle of the battlefield: a place a distance can be measured from. */
export const BATTLEFIELD_CENTRE = "battlefield-centre";

const PLACE_REFUSED = ["range_ref", "distance", "weapon_range", "models"] as const;

export const POSITION_EXTENSIONS: readonly FamilyExtension[] = [
  {
    // "while this unit is within 6\" of one or more friendly **K** units".
    family: "unit-position",
    version: 7,
    description: "As the previous version, and a within/beyond distance can be measured to any unit matching a filter: of matching-unit with of_keywords (every keyword), of_side (friendly or enemy) and of_other (a unit other than the subject).",
    schema: (previous) => withProperties(previous, {
      of: widenedEnum(previous, "of", ["matching-unit"]),
      of_keywords: { type: "array", items: KEYWORD_ITEMS, minItems: 1, uniqueItems: true, "x-only-when": { of: ["matching-unit"] } },
      of_side: { enum: ["friendly", "enemy"], "x-only-when": { of: ["matching-unit"] } },
      of_other: optional({ const: true, "x-only-when": { of: ["matching-unit"] } }),
    }),
    normalize: (input, previous) => {
      const extras = ["of_keywords", "of_side", "of_other"].filter((key) => key in input);
      if (input.of !== "matching-unit") {
        if (extras.length) throw new TypeError(`unit-position.${extras[0]} only describes of: matching-unit.`);
        return previous(input);
      }
      if (input.kind !== "within" && input.kind !== "beyond") throw new TypeError("unit-position of matching-unit measures a within or beyond distance.");
      const { of_keywords: keywords, of_side: side, of_other: other, ...rest } = input;
      const normalized = standIn(rest, "of", "this-unit", previous);
      if (other !== undefined && other !== true) throw new TypeError("unit-position.of_other is true or absent.");
      return {
        ...normalized,
        of_keywords: keywordList(keywords, "unit-position.of_keywords", 1),
        of_side: enumValue(side, ["friendly", "enemy"], "unit-position.of_side"),
        ...(other === true ? { of_other: true } : {}),
      };
    },
  },
  {
    // "while this unit is wholly within 6\" of one or more friendly **K** units", "within 3\" of one or more enemy units".
    family: "unit-position",
    version: 8,
    description: "As the previous version, plus wholly (every part of each model of the subject is within the distance), and a matching unit can be any unit of a side, with no keywords.",
    schema: (previous) => withProperties(previous, {
      wholly: optional({ const: true, "x-only-when": { kind: ["within"] } }),
      of_keywords: optional(properties(previous).of_keywords!),
    }),
    normalize: (input, previous) => {
      const { wholly, ...rest } = input;
      if ("wholly" in input) {
        if (wholly !== true) throw new TypeError("unit-position.wholly is true or absent.");
        if (rest.kind !== "within") throw new TypeError("unit-position.wholly describes a within distance.");
      }
      // Any unit of a side: the previous version checks the rest with a keyword standing in.
      const anyUnit = rest.of === "matching-unit" && !("of_keywords" in rest);
      const normalized = anyUnit ? (({ of_keywords: _keywords, ...checked }) => checked)(previous({ ...rest, of_keywords: ["INFANTRY"] })) : previous(rest);
      return { ...normalized, ...(wholly === true ? { wholly: true } : {}) };
    },
  },
  printedKeywordsExtension("unit-position", 9),
  {
    // "within 8\" of a Cult Ambush marker you placed": the distance to a named marker.
    family: "unit-position",
    version: 10,
    description: "As the previous version, and of: marker measures a within or beyond distance to the named marker of_marker (\"within 8\\\" of a Cult Ambush marker\" is of_marker cult-ambush-marker).",
    schema: (previous) => {
      const of = (previous.properties as Record<string, Record<string, unknown>>).of!;
      const widened = Array.isArray(of.enum) ? { ...of, enum: [...(of.enum as string[]), "marker"] } : of;
      return withProperties(previous, { of: widened, of_marker: optional({ type: "string", pattern: MARKER_ID.source, "x-only-when": { of: ["marker"] } }) });
    },
    normalize: (input, previous) => {
      if (input.of !== "marker") {
        if ("of_marker" in input) throw new TypeError("unit-position.of_marker goes with of: marker.");
        return previous(input);
      }
      const { of_marker: marker, ...rest } = input;
      if (rest.kind !== "within" && rest.kind !== "beyond") throw new TypeError("unit-position of a marker measures a within or beyond distance.");
      if (typeof marker !== "string" || !MARKER_ID.test(marker)) throw new TypeError("unit-position.of_marker is the marker's kebab-case id (cult-ambush-marker).");
      return { ...standIn(rest, "of", "this-unit", previous), of_marker: marker };
    },
  },
  {
    // "Wholly within 6\" of a battlefield edge": the DSL's battlefield-edge place.
    family: "unit-position",
    version: 11,
    description: "As the previous version, and a distance can be measured from a battlefield edge (of: battlefield-edge).",
    schema: (previous) => withProperties(previous, { of: widenedEnum(previous, "of", ["battlefield-edge"]) }),
    normalize: (input, previous) => input.of === "battlefield-edge" ? standIn(input, "of", "this-unit", previous) : previous(input),
  },
  {
    // "ends a move within 8\" of a" + "friendly unengaged unit": the distance is measured to the
    // units of the unit-filter right after it in its clause (compile-unit-filters.ts folds it).
    family: "unit-position",
    version: 12,
    description: "As the previous version, plus of following-filter: the distance is to any unit the unit-filter right after this leaf, in the same clause, matches (\"within 8\\\" of a\" + \"friendly unengaged unit\").",
    schema: (previous) => withProperties(previous, { of: widenedEnum(previous, "of", [FOLLOWING_FILTER]) }),
    normalize: (input, previous) => input.of === FOLLOWING_FILTER ? { ...previous({ ...input, of: "this-unit" }), of: FOLLOWING_FILTER } : previous(input),
  },
  {
    // "within range of your vowed objective"; "within range of that objective marker" after a
    // select-objective.
    family: "unit-position",
    version: 13,
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
      if (tag !== undefined) refuseListBuildingTag(String(tag), "unit-position.objective_tag");
      const normalized = previous(rest);
      return value === "any" ? normalized : { ...normalized, objective: value, ...(tag !== undefined ? { objective_tag: tag } : {}) };
    },
  },
  UNIT_POSITION_OF_ALTERNATIVES,
  /**
   * Named-range references: "inside Synapse Range of your host" and "inside Contagion Range of this
   * unit". The distance is the named range's aura (`range_ref`), not a number of inches, and the
   * leaf says only which units are measured to. A matching unit can exclude keywords
   * (`of_excluded_keywords`) for "(excluding NEUROGAUNT units)".
   */
  {
    // "inside Synapse Range of your host": the distance is a named range, measured to units of the army.
    family: "unit-position",
    version: 15,
    description: "As the previous version, plus range_ref: within a named range (contagion or synapse) instead of inches. The named range's aura carries its anchor; of says whose units are measured to (this-unit, this-model, or matching-unit with of_side). of_excluded_keywords, on of matching-unit, excludes units that have any of the keywords.",
    schema: (previous) => withProperties(previous, {
      range_ref: optional({ enum: RANGE_NAMES, "x-only-when": { kind: ["within"] } }),
      of_excluded_keywords: optional(EXCLUDED_KEYWORDS_SCHEMA),
    }),
    normalize: (input, previous) => {
      const { range_ref: rangeRef, of_excluded_keywords: excluded, ...rest } = input;
      if (excluded !== undefined && rest.of !== "matching-unit") throw new TypeError("unit-position.of_excluded_keywords goes with of: matching-unit.");
      if (rangeRef === undefined) {
        if (excluded === undefined) return previous(input);
        return { ...previous(rest), of_excluded_keywords: keywordList(excluded, "unit-position.of_excluded_keywords", 1) };
      }
      if (typeof rangeRef !== "string" || !RANGE_NAMES.includes(rangeRef)) throw new TypeError(`unit-position.range_ref names one of ${RANGE_NAMES.join(", ")}.`);
      if (rest.kind !== "within") throw new TypeError("unit-position.range_ref measures a within distance; beyond a named range is not authored.");
      if ("inches" in rest) throw new TypeError("unit-position takes range_ref or inches, not both.");
      if ("wholly" in rest) throw new TypeError("unit-position.range_ref cannot be wholly within a named range.");
      if (typeof rest.of !== "string" || !NAMED_OF.includes(rest.of)) throw new TypeError(`unit-position.range_ref needs of: ${NAMED_OF.join(", ")}.`);
      if (rest.of === "matching-unit" && rest.of_side === undefined) throw new TypeError("unit-position.range_ref on of matching-unit needs of_side.");
      if (rest.of === "matching-unit" && rest.of_other !== undefined) throw new TypeError("unit-position.range_ref does not take of_other.");
      if (rest.of !== "matching-unit" && rest.of_side !== undefined) throw new TypeError("unit-position.of_side goes with of: matching-unit.");
      // The previous version checks subject, of, of_side, of_keywords and negated with a stand-in distance; the stand-in is not kept.
      const { inches: _standIn, ...checked } = previous({ ...rest, inches: 1 });
      return {
        ...checked,
        range_ref: rangeRef,
        ...(excluded !== undefined ? { of_excluded_keywords: keywordList(excluded, "unit-position.of_excluded_keywords", 1) } : {}),
      };
    },
  },
  /**
   * A weapon's range can stand in for a distance: a unit-position within the attacking weapon's
   * full range or half of it ("within half range" of the attack's target). The distance is the
   * weapon's own, so the leaf takes no inches.
   */
  {
    family: "unit-position",
    version: 16,
    description: "As the previous version, plus weapon_range: a within distance equal to the attacking weapon's range (full) or half of it (half), measured from the attacker to the target. Such a leaf takes no inches.",
    schema: (previous) => withProperties(previous, {
      weapon_range: optional({ enum: [...WEAPON_RANGE], "x-only-when": { kind: ["within"] } }),
    }),
    normalize: (input, previous) => {
      if (!("weapon_range" in input)) return previous(input);
      const { weapon_range: range, ...rest } = input;
      if (rest.kind !== "within") throw new TypeError("unit-position.weapon_range measures a within distance.");
      if ("inches" in rest) throw new TypeError("unit-position.weapon_range takes no inches: the distance is the attacking weapon's range.");
      if (rest.of !== "attacker") throw new TypeError("unit-position.weapon_range is measured from the attacker.");
      if (rest.subject !== "target") throw new TypeError("unit-position.weapon_range describes the attack's target.");
      // The previous version checks the rest with a distance standing in; the distance is not kept.
      const { inches: _inches, ...checked } = previous({ ...rest, inches: 1 });
      return { ...checked, weapon_range: enumValue(range, WEAPON_RANGE, "unit-position.weapon_range") };
    },
  },
  UNIT_POSITION_BEARER,
  /**
   * Subject each-target, as unit-state version 14 takes it: the condition holds of every Stratagem
   * target named before it (compile-target-groups.ts).
   */
  {
    family: "unit-position",
    version: 18,
    description: "As the previous version, plus subject each-target: the position holds of every Stratagem target named before it (\"Each unit targeted with this Stratagem must be more than 3\\\" away from all enemy units\").",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [EACH_TARGET]) }),
    normalize: (input, previous) => standInEachTarget(input, previous),
  },
 UNIT_POSITION_WIDENED,
  /**
   * Engagement Range as a distance: "is within Engagement Range of one or more" is unit-position
   * range_ref engagement, measured to this unit, this model or the following filter.
   */
  {
    family: "unit-position",
    version: 20,
    description: "As the previous version, and range_ref engagement measures a within distance of the Engagement Range itself, to this unit, this model or the following filter's units. A named Synapse or Contagion range is unchanged.",
    schema: (previous) => withProperties(previous, {
      range_ref: optional({ enum: NAMED_RANGE_REFS, "x-only-when": { kind: ["within"] } }),
    }),
    normalize: (input, previous) => {
      if (input.range_ref !== "engagement") return previous(input);
      const { range_ref: _rangeRef, ...rest } = input;
      if (rest.kind !== "within") throw new TypeError("unit-position.range_ref measures a within distance; beyond a named range is not authored.");
      if ("inches" in rest) throw new TypeError("unit-position takes range_ref or inches, not both.");
      if ("wholly" in rest) throw new TypeError("unit-position.range_ref cannot be wholly within a named range.");
      if (typeof rest.of !== "string" || !ENGAGEMENT_OF.includes(rest.of)) {
        throw new TypeError(`unit-position.range_ref engagement takes of ${ENGAGEMENT_OF.join(", ")}; of matching-unit has no DSL form.`);
      }
      // The previous version checks subject, of and negated with a stand-in distance; the stand-in is not kept.
      const { inches: _standIn, ...checked } = previous({ ...rest, inches: 1 });
      return { ...checked, range_ref: "engagement" };
    },
  },
  {
    // "while targeting a unit within half range": the distance is half the attacking weapon's range.
    family: "unit-position",
    version: 21,
    description: "As the previous version, plus distance half-weapon: within half the range of the weapon the attack uses, measured from the attacker (\"while targeting a unit within half range\"). It takes kind within and of attacker, and no inches, range_ref or wholly.",
    schema: (previous) => withProperties(previous, { distance: optional({ enum: ["half-weapon"], "x-only-when": { kind: ["within"] } }) }),
    normalize: (input, previous) => {
      if (!("distance" in input)) return previous(input);
      const { distance, ...rest } = input;
      if (distance !== "half-weapon") throw new TypeError(`unit-position.distance ${JSON.stringify(distance)} is not a listed distance.`);
      if (rest.kind !== "within") throw new TypeError("unit-position.distance measures a within distance.");
      if (rest.of !== "attacker") throw new TypeError("unit-position.distance is measured from the attacker: of attacker.");
      refuseWith(rest, ["inches", "range_ref", "wholly"], "unit-position.distance");
      // The previous version checks subject, of and negated with a stand-in distance; the stand-in is not kept.
      const { inches: _standIn, ...checked } = previous({ ...rest, inches: 1 });
      return { ...checked, distance: "half-weapon" };
    },
  },
  /**
   * Set-up relative placement: "within Engagement Range of the destroyed model's unit" is the
   * permission an add-unit grants when a sentence says "If you do, that unit can be set up within
   * Engagement Range of …". The destroyed unit is the event object, so unit-position range_ref
   * engagement takes of event-object as well as the three subjects the previous version names.
   */
  {
    family: "unit-position",
    version: 22,
    description: "As the previous version, and range_ref engagement also measures a within distance of the Engagement Range to the event object (the destroyed unit or model). The add-unit permission it lowers to is allow_engagement_with.",
    schema: (previous) => previous,
    normalize: (input, previous) => {
      if (input.range_ref !== "engagement" || input.of !== EVENT_OBJECT) return previous(input);
      // The previous version checks subject, kind, distance and negation with this unit as the stand-in measure, then the measure is restored.
      const { of: _of, ...rest } = input;
      return { ...previous({ ...rest, of: "this-unit" }), of: EVENT_OBJECT };
    },
  },
  /**
   * Every-model position: "every model in that unit is within 3\" of this transport", "every model
   * in this unit is within range of an objective marker". `models: every` says every model of the
   * subject passes the distance test. It is not `wholly` (every part of each model), which the
   * previous version keeps, and the two never combine. The compiler lowers it to the DSL's `models:
   * "every"` (compile-every-model.ts).
   */
  {
    family: "unit-position",
    version: 23,
    description: "As the previous version, plus models: every, meaning every model of the subject is within the distance (\"every model in that unit is within 3\\\" of this transport\") or within range of an objective marker (\"every model in this unit is within range of an objective\"). A within distance is measured from this unit or the following filter's unit; a subject is this unit or an earlier leaf's unit. It cannot combine with wholly.",
    schema: (previous) => withProperties(previous, {
      models: optional({ enum: ["every"], "x-only-when": { kind: ["within", "objective-range"] } }),
    }),
    normalize: (input, previous) => {
      if (!("models" in input)) return previous(input);
      const { models, ...rest } = input;
      if (models !== "every") throw new TypeError(`unit-position.models is "every" or absent; got ${JSON.stringify(models)}.`);
      if (rest.negated !== false) throw new TypeError("unit-position.models every describes a position that holds, so negated is false.");
      if (!(SUBJECTS as readonly unknown[]).includes(rest.subject)) throw new TypeError(`unit-position.models every takes subject ${SUBJECTS.join(" or ")}.`);
      if (rest.kind === "within") {
        if (!(WITHIN_OF as readonly unknown[]).includes(rest.of)) throw new TypeError(`unit-position.models every measures within a distance to ${WITHIN_OF.join(" or ")}.`);
      } else if (rest.kind === "objective-range") {
        if ("of" in rest) throw new TypeError("unit-position.models every on objective-range takes no of.");
      } else {
        throw new TypeError("unit-position.models every describes a within distance or an objective-range.");
      }
      const refused = REFUSED_WITH_EVERY.filter((key) => key in rest);
      if (refused.length) throw new TypeError(`unit-position.models every cannot combine with ${refused[0]}.`);
      return { ...previous(rest), models: "every" };
    },
  },
  /**
   * Place values: a distance measured from the centre of the battlefield (`of:
   * battlefield-centre`), a within (and wholly within) distance of the enemy deployment zone (`of:
   * enemy-deployment-zone` with `kind: within`; `kind: beyond` keeps its set-up restriction rule),
   * and the unit an event acted on as the subject (`subject: event-object`).
   *
   * The three values can share one leaf, so one function checks every refusal on the input as
   * authored, then makes one call of the previous version with a stand-in for each new value and
   * writes the authored values back.
   */
  {
    family: "unit-position",
    version: 24,
    description: "As the previous version, plus of battlefield-centre (a within or beyond distance from the centre of the battlefield, whole inches), of enemy-deployment-zone with kind within (the unit is within, or with wholly wholly within, the distance of the enemy deployment zone), and subject event-object (the unit the moment's event acted on; not with closest-eligible).",
    schema: (previous) => withProperties(previous, {
      of: widenedEnum(previous, "of", [BATTLEFIELD_CENTRE]),
      subject: widenedEnum(previous, "subject", [EVENT_OBJECT]),
    }),
    normalize: (input, previous) => {
      const centre = input.of === BATTLEFIELD_CENTRE;
      const zoneWithin = input.of === "enemy-deployment-zone" && input.kind === "within";
      const objectSubject = input.subject === EVENT_OBJECT;
      if (!centre && !zoneWithin && !objectSubject) return previous(input);
      if (objectSubject && input.kind === "closest-eligible") throw new TypeError("unit-position subject event-object takes within, beyond or objective-range, not closest-eligible.");
      if (centre || zoneWithin) {
        if (input.kind !== "within" && input.kind !== "beyond") throw new TypeError(`unit-position of ${String(input.of)} measures a within or beyond distance.`);
        const refused = PLACE_REFUSED.find((key) => input[key] !== undefined);
        if (refused) throw new TypeError(`unit-position of ${String(input.of)} takes whole inches; ${refused} does not apply.`);
        if (input.objective !== undefined || input.objective_tag !== undefined || input.controlled_by !== undefined) throw new TypeError(`unit-position of ${String(input.of)} is a place, not an objective marker; objective, objective_tag and controlled_by do not apply.`);
        if (input.wholly !== undefined && input.kind !== "within") throw new TypeError(`unit-position of ${String(input.of)} is wholly within a distance, not wholly beyond it.`);
      }
      const original = { of: input.of, subject: input.subject };
      const standIns = {
        ...(centre || zoneWithin ? { of: "this-unit" } : {}),
        ...(objectSubject ? { subject: "event-subject" } : {}),
      };
      const normalized = previous({ ...input, ...standIns });
      return { ...normalized, ...(centre || zoneWithin ? { of: original.of } : {}), ...(objectSubject ? { subject: original.subject } : {}) };
    },
  },
  {
    family: "unit-position",
    version: 25,
    description: "As the previous version, plus subject filtered-units: the units the unit-filter before this leaf names (\"one or more friendly OFFICER models\" + \"within 6\\\"\"). The position holds when any of them meets it, or none of them, when negated.",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [FILTERED_UNITS]) }),
    normalize: (input, previous) => input.subject === FILTERED_UNITS ? standIn(input, "subject", "this-unit", previous) : previous(input),
  },
];
