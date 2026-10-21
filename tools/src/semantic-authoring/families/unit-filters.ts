import { DESIGNATION_IDS } from "../../translate/designations.js";
import { ANTECEDENT } from "../antecedent-families.js";
import { type FamilyExtension, KEYWORD_ITEMS, keywordList, optional, properties, standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";
import { boundedInteger, enumValue, exactKeys } from "../family-validation.js";
import { normalizeUnitKeywords } from "../unit-filter-family.js";
import { NAMED_RANGE_NAMES } from "../named-ranges.js";
import { ALTERNATIVE_SCHEMA, normalizeAlternatives } from "../unit-filter-alternatives.js";
import { EMBARKED_IN, ENHANCEMENT_KIND, FOLLOWING_FILTER, HELD_IN, MATCHED_UNITS } from "./shared.js";

/**
 * Versions of unit-filter, and of the target-is-selected and visible conditions on the units a
 * filter names. Each version checks only its own additions and hands the rest of a leaf to the
 * previous version, so every earlier leaf still fits it unchanged.
 */

/** Who selected the target, and which unit was selected, in a target-is-selected leaf that names them. */
const SELECTION_BY = ["event-subject", "this-unit", "selected-unit", ANTECEDENT] as const;

const SELECTION_TARGETS = ["this-unit", "this-model", "selected-unit", FOLLOWING_FILTER, ANTECEDENT] as const;

const TARGET_IS_SELECTED_PARTIES: FamilyExtension = {
  // "if one or more units with this ability are selected as a target of that charge".
  family: "target-is-selected",
  version: 2,
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

const UNIT_FILTER_ALTERNATIVES: FamilyExtension = {
  // "LEGIO CYBERNETICA or ADEPTUS MECHANICUS VEHICLE unit", "PSYKER or Battle-shocked unit": any
  // one of two or more alternatives, each with its own keywords, exclusions and states.
  family: "unit-filter",
  version: 5,
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

/** A unit-filter that picks among the Stratagem's own targets rather than among all units. */
export const AMONG_TARGETS = "stratagem-targets";

/** How many of the matching targets an among-filter names. */
export const TARGET_PICKS = ["one", "every", "any"] as const;

const AMONG_FILTER: FamilyExtension = {
  // "your **VEHICLE** unit", "one of those units", "both of those units" after two targets.
  family: "unit-filter",
  version: 6,
  description: "As the previous version, plus among and targets, always together. among stratagem-targets: the filter picks among this Stratagem's targets (\"your **VEHICLE** unit\", \"that **TRANSPORT**\", \"those units\"), not among all units. targets: one = the single target it matches; every = all matching targets (all of them, in a condition: \"both of those units\"); any = any one matching target (in a condition: \"one of those units\"; an effect or moment applies to each). Side any when no side is printed.",
  schema: (previous) => withProperties(previous, {
    among: optional({ const: AMONG_TARGETS }),
    targets: optional({ enum: [...TARGET_PICKS], "x-only-when": { among: [AMONG_TARGETS] } }),
  }),
  normalize: (input, previous) => {
    if (!("among" in input) && !("targets" in input)) return previous(input);
    const { among, targets, ...rest } = input;
    if (among !== AMONG_TARGETS) throw new TypeError(`unit-filter.among must be ${AMONG_TARGETS}, with targets.`);
    const picked = enumValue(targets, TARGET_PICKS, "unit-filter.targets");
    return { ...previous(rest), among: AMONG_TARGETS, targets: picked };
  },
};

const VISIBLE_TO_FILTER: FamilyExtension = {
  // "visible to your **PSYKER** model": the observer is the unit-filter right after the leaf.
  family: "visible",
  version: 3,
  description: "As the previous version, plus to following-filter: visible to any unit or model the unit-filter right after this leaf, in the same clause, matches (\"visible to\" + \"your **PSYKER** model\").",
  schema: (previous) => withProperties(previous, { to: widenedEnum(previous, "to", [FOLLOWING_FILTER]) }),
  normalize: (input, previous) => input.to === FOLLOWING_FILTER ? standIn(input, "to", "this-unit", previous) : previous(input),
};

const DATASHEET_ID = ENHANCEMENT_KIND;

/** Who applied a designation a unit-filter names: a unit, not a model. */
const FILTER_APPLIER = ["this-unit", "selected-unit", "event-subject"] as const;

/** Kebab-case, as every registered designation id is; the registry check follows in normalize. */
const DESIGNATION_PATTERN = "^[a-z0-9][a-z0-9-]*[a-z0-9]$";

/** The unit-filter role flag: the filter names models whose attacks an attack frame before it excludes. */
export const EXCLUDED_FROM_ATTACKS = "attacks";

/** The unit states a unit-filter gains in this version. */
export const FILTER_STATES_16 = ["engaged", "hidden"] as const;

/** The only subject a unit-filter takes in this version. */
export const FILTER_SUBJECT_TARGET = "target";

const MATCHED_FILTER: FamilyExtension = {
  // "select one of those **VEHICLE** units", "each time one of those **VEHICLE** units makes a ranged attack".
  family: "unit-filter",
  version: 12,
  description: "As the previous version, plus among matched-units: the filter names the units an earlier unit-position of matching-unit introduced (\"one of those VEHICLE units\"). Side friendly or enemy, and no targets.",
  schema: (previous) => withProperties(previous, {
    among: optional({ enum: [AMONG_TARGETS, MATCHED_UNITS] }),
  }),
  normalize: (input, previous) => {
    if (input.among !== MATCHED_UNITS) return previous(input);
    if (input.side === "any") throw new TypeError("unit-filter.among matched-units names friendly or enemy units.");
    if ("targets" in input) throw new TypeError("unit-filter.targets applies to stratagem-targets, not matched-units.");
    const { among: _among, ...rest } = input;
    return { ...previous(rest), among: MATCHED_UNITS };
  },
};

/** The unit-filter value naming the Leader units attached to this unit. */
export const ATTACHED_TO_THIS_UNIT = "this-unit";

/** unit-filter parameters that name units another way, so attached Leaders cannot combine with them. */
const EXCLUSIVE_WITH_ATTACHED = ["level", "among", "targets", "designated", "designated_by", "held_in", "other", "datasheets", "excluded_from", "subject", "alternatives"] as const;

const ATTACHED_LEADERS: FamilyExtension = {
  family: "unit-filter",
  version: 13,
  description: "As the previous version, plus attached_to: this-unit, on a friendly unit-level filter. It names the Leader units attached to this unit (\"that Leader unit\", \"models in those units\"); it cannot combine with a model level, a designation, a held state, other, a matched set or alternatives.",
  schema: (previous) => withProperties(previous, { attached_to: optional({ enum: [ATTACHED_TO_THIS_UNIT] }) }),
  normalize: (input, previous) => {
    if (!("attached_to" in input)) return previous(input);
    const { attached_to: attached, ...rest } = input;
    if (attached !== ATTACHED_TO_THIS_UNIT) throw new TypeError(`unit-filter.attached_to must be ${ATTACHED_TO_THIS_UNIT}.`);
    if (rest.side !== "friendly") throw new TypeError("unit-filter.attached_to names the Leaders attached to this unit, so the filter's side must be friendly.");
    for (const key of EXCLUSIVE_WITH_ATTACHED) {
      if (key in rest) throw new TypeError(`unit-filter.attached_to names units by their attachment; ${key} is not allowed with it.`);
    }
    return { ...previous(rest), attached_to: attached };
  },
};

/** unit-filter keys that name a different set of units; none combines with embarked_in. */
const EMBARKED_IN_EXCLUDES = ["held_in", "alternatives", "among", "subject", "datasheets", "designated", "designated_by"] as const;

/** An aura measured from any model with the given keywords, rather than from this unit or model. */
export const MATCHING_MODELS = "matching-models";

export const UNIT_FILTER_EXTENSIONS: readonly FamilyExtension[] = [
  {
    // "Units in Cult Ambush": a unit held off the battlefield in Strategic Reserves or Cult Ambush.
    family: "unit-filter",
    version: 2,
    description: "As the previous version, and held_in names where a unit off the battlefield is held: strategic-reserves, or cult-ambush (\"Units in Cult Ambush\").",
    schema: (previous) => withProperties(previous, { held_in: optional({ enum: HELD_IN }) }),
    normalize: (input, previous) => {
      if (!("held_in" in input)) return previous(input);
      const { held_in: heldIn, ...rest } = input;
      return { ...previous(rest), held_in: enumValue(heldIn, HELD_IN, "unit-filter.held_in") };
    },
  },
  {
    // "(excluding units with the Lone Operative ability)": the DSL unit-filter's lacks_ability.
    family: "unit-filter",
    version: 3,
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
  {
    // "(excluding MONSTER CHARACTER units)" excludes only units with both keywords; "not Battle-shocked".
    family: "unit-filter",
    version: 4,
    description: "As the previous version, plus excluded_all_keywords (units with every one of these keywords are left out) and the state not-battle-shocked.",
    schema: (previous) => {
      const states = properties(previous).states!;
      const items = states.items as Record<string, unknown>;
      return withProperties(previous, {
        states: { ...states, items: { ...items, enum: [...(items.enum as string[]), "not-battle-shocked"] } },
        excluded_all_keywords: optional({ type: "array", items: KEYWORD_ITEMS, minItems: 2, uniqueItems: true }),
      });
    },
    normalize: (input, previous) => {
      const states = Array.isArray(input.states) ? input.states as unknown[] : undefined;
      const negated = states?.includes("not-battle-shocked") === true;
      if (!negated && input.excluded_all_keywords === undefined) return previous(input);
      if (negated && states!.includes("battle-shocked")) throw new TypeError("unit-filter cannot be both battle-shocked and not-battle-shocked.");
      const { excluded_all_keywords: allOf, states: _states, ...rest } = input;
      const older = states?.filter((state) => state !== "not-battle-shocked") ?? [];
      const normalized = previous({ ...rest, ...(older.length ? { states: older } : {}) });
      const result: Record<string, unknown> = { ...normalized };
      if (negated) result.states = [...((normalized.states as string[] | undefined) ?? []), "not-battle-shocked"].sort();
      if (allOf !== undefined) result.excluded_all_keywords = keywordList(allOf, "unit-filter excluded_all_keywords", 2);
      return result;
    },
  },
  UNIT_FILTER_ALTERNATIVES,
  AMONG_FILTER,
  {
    // "cannot include the following datasheets: Alpha Squad, Beta Squad": units no keyword names.
    family: "unit-filter",
    version: 7,
    description: "As the previous version, plus datasheets: units of any of these datasheets (kebab-case unit ids), for a list-building group whose units no keyword names. Only a list-building rule's group can hold it.",
    schema: (previous) => withProperties(previous, {
      datasheets: optional({ type: "array", items: { type: "string", pattern: DATASHEET_ID.source }, minItems: 1, uniqueItems: true }),
    }),
    normalize: (input, previous) => {
      if (!("datasheets" in input)) return previous(input);
      const { datasheets, ...rest } = input;
      if (!Array.isArray(datasheets) || datasheets.length === 0) throw new TypeError("unit-filter.datasheets lists at least one datasheet id.");
      for (const id of datasheets) if (typeof id !== "string" || !DATASHEET_ID.test(id)) throw new TypeError("unit-filter.datasheets lists kebab-case unit ids.");
      if (new Set(datasheets).size !== datasheets.length) throw new TypeError("unit-filter.datasheets lists a datasheet twice.");
      return { ...previous(rest), datasheets: [...(datasheets as string[])].sort() };
    },
  },
  /**
   * The units carrying a designation another unit applied (a Bondsman's affected unit).
   */
  {
    // "While a model is affected by this ability": the units a Bondsman applied a designation to.
    family: "unit-filter",
    version: 8,
    description: "As the previous version, plus designated: a registered designation the unit carries, and designated_by: the unit that applied it (this-unit, selected-unit or event-subject). designated_by needs designated.",
    schema: (previous) => withProperties(previous, {
      designated: optional({ type: "string", pattern: DESIGNATION_PATTERN }),
      designated_by: optional({ enum: [...FILTER_APPLIER] }),
    }),
    normalize: (input, previous) => {
      if (input.designated === undefined && input.designated_by === undefined) return previous(input);
      const { designated, designated_by: by, ...rest } = input;
      if (designated === undefined) throw new TypeError("unit-filter.designated_by needs designated.");
      if (typeof designated !== "string" || !DESIGNATION_IDS.has(designated)) throw new TypeError(`unit-filter.designated ${JSON.stringify(designated)} is not a registered designation.`);
      const normalized = previous(rest);
      return { ...normalized, designated, ...(by === undefined ? {} : { designated_by: enumValue(by, [...FILTER_APPLIER], "unit-filter.designated_by") }) };
    },
  },
  /**
   * Model groups: a model-level unit-filter with a membership ("Character models in this unit",
   * "that unit's BATTLELINE models") takes the membership's unit as `member_of`. The unit-filter
   * gains one role flag, an attack exclusion ("this unit's ranged attacks (excluding Character
   * models' attacks)"), which compile-unit-filters.ts folds into the attack frame before it.
   */
  {
    // "This unit's ranged attacks (excluding Character models' attacks)": the models an attack frame excludes.
    family: "unit-filter",
    version: 9,
    description: "As the previous version, plus excluded_from: attacks, on a model-level filter with excluded_keywords only. It names the models whose attacks the attack frame before it does not cover (\"excluding Character models' attacks\"); without it the filter keeps its meaning.",
    schema: (previous) => withProperties(previous, {
      excluded_from: optional({ const: EXCLUDED_FROM_ATTACKS, "x-only-when": { level: ["model"] } }),
    }),
    normalize: (input, previous) => {
      if (!("excluded_from" in input)) return previous(input);
      const { excluded_from: excludedFrom, ...rest } = input;
      if (excludedFrom !== EXCLUDED_FROM_ATTACKS) throw new TypeError(`unit-filter.excluded_from must be ${EXCLUDED_FROM_ATTACKS}.`);
      if (rest.level !== "model") throw new TypeError("unit-filter.excluded_from names models, so the filter must be level model.");
      if (!Array.isArray(rest.excluded_keywords) || rest.excluded_keywords.length === 0) throw new TypeError("unit-filter.excluded_from needs excluded_keywords: the models it leaves out.");
      for (const key of ["keywords", "any_keywords", "states", "alternatives"] as const) {
        if (key in rest) throw new TypeError(`unit-filter.excluded_from takes excluded_keywords alone; ${key} is not allowed with it.`);
      }
      return { ...previous(rest), excluded_from: EXCLUDED_FROM_ATTACKS };
    },
  },
  /**
   * Engaged and hidden in a unit-filter: "One friendly **engaged** Plague Marines unit", "friendly
   * **hidden** Phobos unit". The state is the adjective of the unit's own noun phrase, as unengaged
   * already is, so it stays in the filter. A distance, a visibility or an engagement with another
   * unit stays a separate leaf. Compilation holds one positive state per filter
   * (compile-unit-filters.ts assertOneFilterState).
   */
  {
    family: "unit-filter",
    version: 10,
    description: "As the previous version, plus the states engaged and hidden (\"friendly engaged X unit\", \"friendly hidden X unit\"); engaged cannot be unengaged in the same filter.",
    schema: (previous) => {
      const states = properties(previous).states!;
      const items = states.items as Record<string, unknown>;
      return withProperties(previous, { states: { ...states, items: { ...items, enum: [...(items.enum as string[]), ...FILTER_STATES_16] } } });
    },
    normalize: (input, previous) => {
      const states = Array.isArray(input.states) ? input.states as unknown[] : undefined;
      const added = states?.filter((state) => (FILTER_STATES_16 as readonly unknown[]).includes(state)) ?? [];
      if (added.length === 0) return previous(input);
      if (new Set(states).size !== states!.length) throw new TypeError("unit-filter.states lists a state twice.");
      if (added.includes("engaged") && states!.includes("unengaged")) throw new TypeError("unit-filter cannot be both engaged and unengaged.");
      // The older states go to the previous version; a filter of only engaged or hidden has none to pass.
      const older = states!.filter((state) => !added.includes(state));
      const { states: _states, ...rest } = input;
      const normalized = previous(older.length ? { ...rest, states: older } : rest);
      const kept = (normalized.states as string[] | undefined) ?? [];
      return { ...normalized, states: [...kept, ...(added as string[])].sort() };
    },
  },
  /**
   * A unit-filter that names the attack's target: "while targeting an enemy unit" after an effect.
   * The filter's span takes the trailing "while targeting" words, as unit-mark does for a
   * designated target. Its units are the defender of the attack the effect is gated on
   * (compile-unit-filters.ts folds it to unit-filter-target). Earlier versions have no subject and
   * compile as before.
   */
  {
    family: "unit-filter",
    version: 11,
    description: "As the previous version, and subject target: the units the filter matches are the attack's target (\"while targeting an enemy unit\"). Only in an effect fragment, and the side must be friendly or enemy.",
    schema: (previous) => withProperties(previous, { subject: optional({ const: FILTER_SUBJECT_TARGET }) }),
    normalize: (input, previous) => {
      if (!("subject" in input)) return previous(input);
      const { subject, ...rest } = input;
      if (subject !== FILTER_SUBJECT_TARGET) throw new TypeError(`unit-filter.subject must be ${FILTER_SUBJECT_TARGET}.`);
      return { ...previous(rest), subject: FILTER_SUBJECT_TARGET };
    },
  },
  /**
   * "Those X units": a unit an earlier unit-position of matching-unit introduced (the set a
   * previous leaf matched, not a unit a selection picked). The pool itself is built by
   * compile-matched-set.ts; these versions only let the consumer leaves name it.
   */
  MATCHED_FILTER,
  /**
   * attached_to: actual Leader models attached to this unit ("that Leader unit gains the Scouts
   * ability", "models in those units have"). Lowers to model-level membership of this unit with
   * attachment_role leader; this is attachment composition, not possession of the Leader ability.
   */
  ATTACHED_LEADERS,
  {
    // "units embarked within this unit": the units a Transport (this unit or this model) carries.
    family: "unit-filter",
    version: 14,
    description: "As the previous version, plus embarked_in: the units (or models) embarked within this unit or this model (\"units embarked within this unit\"). Always friendly; it takes no held_in, alternatives, among, subject, datasheets or designation.",
    schema: (previous) => withProperties(previous, { embarked_in: optional({ enum: [...EMBARKED_IN] }) }),
    normalize: (input, previous) => {
      if (!("embarked_in" in input) || input.embarked_in === undefined) return previous(input);
      const { embarked_in: embarked, ...rest } = input;
      if (!(EMBARKED_IN as readonly unknown[]).includes(embarked)) throw new TypeError(`unit-filter.embarked_in is this-unit or this-model, not ${JSON.stringify(embarked)}.`);
      if (rest.side !== "friendly") throw new TypeError("unit-filter.embarked_in names friendly units: embarked units are always the Transport's own army's.");
      for (const key of EMBARKED_IN_EXCLUDES) {
        if (rest[key] !== undefined) throw new TypeError(`unit-filter.embarked_in cannot be combined with ${key}.`);
      }
      return { ...previous(rest), embarked_in: embarked };
    },
  },
  {
    family: "unit-filter",
    version: 15,
    description: "As the previous version, plus other_than event-subject: \"other\" means other than the unit the trigger names, not the unit with the ability (\"no other friendly units\" when a unit is selected to shoot).",
    schema: (previous) => withProperties(previous, { other_than: optional({ enum: ["event-subject"], "x-only-when": { other: [true] } }) }),
    normalize: (input, previous) => {
      if (input.other_than === undefined) return previous(input);
      const { other_than: otherThan, ...rest } = input;
      if (otherThan !== "event-subject") throw new TypeError("unit-filter.other_than names event-subject.");
      if (rest.other !== true) throw new TypeError("unit-filter.other_than needs other: true.");
      return { ...previous(rest), other_than: "event-subject" };
    },
  },
  {
    family: "unit-filter",
    version: 16,
    description: "As the previous version, plus actual attachment_role bodyguard or leader on model-level filters and member_of naming this-unit, selected-unit or an antecedent unit. Membership identifies attached composition, not keywords or the ability to lead. A separate reviewed membership leaf may supply member_of during compilation.",
    schema: (previous) => withProperties(previous, {
      attachment_role: optional({ enum: ["bodyguard", "leader"], "x-only-when": { level: ["model"] } }),
      member_of: optional({ enum: ["this-unit", "selected-unit", ANTECEDENT], "x-only-when": { level: ["model"] } }),
    }),
    normalize: (input, previous) => {
      if (input.attachment_role === undefined && input.member_of === undefined) return previous(input);
      const { attachment_role: role, member_of: member, ...rest } = input;
      if (rest.level !== "model") throw new TypeError("Attachment membership filters must name models.");
      if (rest.attached_to !== undefined) throw new TypeError("An attachment-role filter cannot also name attached_to.");
      return {
        ...previous(rest),
        ...(role === undefined ? {} : { attachment_role: enumValue(role, ["bodyguard", "leader"], "unit-filter.attachment_role") }),
        ...(member === undefined ? {} : { member_of: enumValue(member, ["this-unit", "selected-unit", ANTECEDENT], "unit-filter.member_of") }),
      };
    },
  },
  TARGET_IS_SELECTED_PARTIES,
  VISIBLE_TO_FILTER,
  {
    family: "aura-range",
    version: 4,
    description: "As the previous version, plus conditional_range: an alternate radius and emitter keyword that the aura fold lowers into disjoint aura effects.",
    schema: (previous) => withProperties(previous, {
      conditional_range: optional({
        type: "object",
        required: ["inches", "keywords"],
        additionalProperties: false,
        properties: {
          inches: { type: "integer", minimum: 1, maximum: 24 },
          keywords: { type: "array", minItems: 1, uniqueItems: true, items: KEYWORD_ITEMS },
        },
      }),
    }),
    normalize: (input, previous) => {
      if (input.conditional_range === undefined) return previous(input);
      const { conditional_range: conditional, ...rest } = input;
      if (!conditional || typeof conditional !== "object" || Array.isArray(conditional)) throw new TypeError("aura-range.conditional_range is an object.");
      const value = conditional as Record<string, unknown>;
      exactKeys(value, ["inches", "keywords"], "aura-range.conditional_range");
      return {
        ...previous(rest),
        conditional_range: {
          inches: boundedInteger(value.inches, 1, 24, "aura-range.conditional_range.inches"),
          keywords: normalizeUnitKeywords(value.keywords, "aura-range.conditional_range.keywords"),
        },
      };
    },
  },
  {
    // "within Contagion Range of one or more DEATH GUARD models from your army".
    family: "aura-range",
    version: 5,
    description: "As the previous version, plus range_ref in place of inches: the aura reaches as far as a named range (contagion, synapse). In the record that defines the range (its named-range-value and named-range-cap leaves) that is the defined per-battle-round distance and cap; anywhere else it is the named range's own aura. Plus of matching-models with of_keywords: the aura is measured from any model with all these keywords (\"of one or more DEATH GUARD models\"), friendly by of_side friendly or by a \"from your army\" right after this leaf.",
    schema: (previous) => ({
      ...withProperties(previous, {
        inches: optional(properties(previous).inches!),
        range_ref: optional({ enum: NAMED_RANGE_NAMES }),
        of: widenedEnum(previous, "of", [MATCHING_MODELS]),
        of_keywords: optional({ type: "array", items: KEYWORD_ITEMS, minItems: 1, uniqueItems: true, "x-only-when": { of: [MATCHING_MODELS] } }),
        of_side: optional({ enum: ["friendly"], "x-only-when": { of: [MATCHING_MODELS] } }),
      }),
      required: [],
    }),
    normalize: (input, previous) => {
      if (input.range_ref === undefined && input.of !== MATCHING_MODELS && input.of_keywords === undefined && input.of_side === undefined) return previous(input);
      const { range_ref: rangeRef, of, of_keywords: ofKeywords, of_side: ofSide, ...rest } = input;
      if (rangeRef !== undefined && "inches" in rest) throw new TypeError("aura-range takes range_ref or inches, not both.");
      if (rangeRef === undefined && !("inches" in rest)) throw new TypeError("aura-range needs inches or range_ref.");
      if (rangeRef !== undefined && rest.conditional_range !== undefined) throw new TypeError("aura-range.conditional_range gives an alternate radius in inches; a named range has none.");
      if (of !== MATCHING_MODELS && (ofKeywords !== undefined || ofSide !== undefined)) throw new TypeError("aura-range.of_keywords and of_side go with of matching-models.");
      const staged = { ...rest, ...(rangeRef !== undefined ? { inches: 1 } : {}), ...(of !== undefined && of !== MATCHING_MODELS ? { of } : {}) };
      // A named range stands in as 1 inch for the previous version's checks, then replaces it.
      const { inches, ...normalized } = previous(staged);
      return {
        ...(rangeRef === undefined ? { ...normalized, inches } : { ...normalized, range_ref: enumValue(rangeRef, NAMED_RANGE_NAMES, "aura-range.range_ref") }),
        ...(of === MATCHING_MODELS ? {
          of: MATCHING_MODELS,
          of_keywords: keywordList(ofKeywords, "aura-range.of_keywords", 1),
          ...(ofSide === undefined ? {} : { of_side: enumValue(ofSide, ["friendly"], "aura-range.of_side") }),
        } : {}),
      };
    },
  },
];
