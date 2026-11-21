import { DESIGNATION_IDS } from "../../translate/designations.js";
import { ANTECEDENT } from "../antecedent-families.js";
import { foldName } from "./vocabulary.js";
import { booleanValue, boundedInteger, enumSet, enumValue, exactKeys } from "../family-validation.js";
import { normalizeAlternatives } from "../unit-filter-alternatives.js";
import { normalizeUnitKeywords } from "../unit-filter-alternatives.js";
import { APOSTROPHE_KEYWORD_ITEMS, KEBAB_ID, KEBAB_ID_PATTERN, keywordList, MATCHED_UNITS, STRING_LIST_SCHEMA, withLeadingApostrophes, type Params } from "./unit-filters-and-targeting-shared.js";
import type { FlatFamily } from "./types.js";

/** The unit-filter family: the side, keywords, states and other words that pick out units. */

// ---------------------------------------------------------------------------------------------
// unit-filter

const FILTER_SIDES = ["friendly", "enemy", "any"] as const;
const BASE_FILTER_STATES = ["unengaged", "battle-shocked"] as const;
const NOT_BATTLE_SHOCKED = "not-battle-shocked";
const ENGAGED_OR_HIDDEN = ["engaged", "hidden"] as const;
const HELD_IN = ["strategic-reserves", "cult-ambush"] as const;
const AMONG_TARGETS = "stratagem-targets";
const TARGET_PICKS = ["one", "every", "any"] as const;
const FILTER_APPLIER = ["this-unit", "selected-unit", "event-subject"] as const;
const EXCLUDED_FROM_ATTACKS = "attacks";
const EMBARKED_IN = ["this-unit", "this-model"] as const;
const MEMBER_OF = ["this-unit", "selected-unit", ANTECEDENT] as const;
const ATTACHMENT_ROLES = ["bodyguard", "leader"] as const;
const BASE_FILTER_KEYS = ["side", "keywords", "any_keywords", "excluded_keywords", "states", "other", "visible", "level"] as const;
/** Keys that name units another way, so attached Leaders cannot combine with them. */
const EXCLUSIVE_WITH_ATTACHED = ["level", "among", "targets", "designated", "designated_by", "held_in", "other", "datasheets", "excluded_from", "subject", "alternatives"] as const;
/** Keys that name a different set of units; none combines with embarked_in. */
const EMBARKED_IN_EXCLUDES = ["held_in", "alternatives", "among", "subject", "datasheets", "designated", "designated_by"] as const;

/** side, keywords, exclusions, states, other, visible and level: the filter's own words. */
function filterBase(input: Params): Params {
  exactKeys(input, ["side", ...BASE_FILTER_KEYS.slice(1).filter((key) => key in input)], "unit-filter");
  const result: Params = { side: enumValue(input.side, FILTER_SIDES, "unit-filter.side") };
  if ("keywords" in input) result.keywords = normalizeUnitKeywords(input.keywords, "unit-filter.keywords");
  if ("any_keywords" in input) {
    result.any_keywords = normalizeUnitKeywords(input.any_keywords, "unit-filter.any_keywords");
    if ((result.any_keywords as string[]).length < 2) throw new TypeError("unit-filter.any_keywords names two or more keywords; one is a plain keyword.");
  }
  if ("excluded_keywords" in input) result.excluded_keywords = normalizeUnitKeywords(input.excluded_keywords, "unit-filter.excluded_keywords");
  if ("states" in input) result.states = enumSet(input.states, BASE_FILTER_STATES, "unit-filter.states");
  for (const flag of ["other", "visible"] as const) {
    if (!(flag in input)) continue;
    if (!booleanValue(input[flag], `unit-filter.${flag}`)) throw new TypeError(`unit-filter.${flag} is true or absent.`);
    result[flag] = true;
  }
  if ("level" in input) result.level = enumValue(input.level, ["model"], "unit-filter.level");
  return result;
}

/** The filter without its leading-apostrophe keywords (handled around it) and its two outermost keys. */
function unitFilterCore(input: Params): Params {
  const rest: Params = { ...input };
  const added: Params = {};
  const take = (key: string) => { const value = rest[key]; delete rest[key]; return value; };

  if (rest.unit_names !== undefined) {
    const names = take("unit_names");
    if (rest.level === "model" || (rest.selects !== undefined && rest.selects !== "unit")) throw new TypeError("unit-filter.unit_names identifies units, not models.");
    if (!Array.isArray(names) || names.length === 0 || names.some((name) => typeof name !== "string" || !name.trim())) {
      throw new TypeError("unit-filter.unit_names must list exact nonblank datasheet names.");
    }
    const normalized = (names as string[]).map((name) => name.replaceAll("*", "").replace(/\s+/gu, " ").trim());
    if (new Set(normalized.map(foldName)).size !== normalized.length) throw new TypeError("unit-filter.unit_names repeats a datasheet name.");
    added.unit_names = normalized.sort();
  }

  let role: unknown;
  let member: unknown;
  const membership = rest.attachment_role !== undefined || rest.member_of !== undefined;
  if (membership) {
    role = take("attachment_role");
    member = take("member_of");
    if (rest.level !== "model") throw new TypeError("Attachment membership filters must name models.");
    if (rest.attached_to !== undefined) throw new TypeError("An attachment-role filter cannot also name attached_to.");
  }

  if (rest.other_than !== undefined) {
    const otherThan = take("other_than");
    if (otherThan !== "event-subject") throw new TypeError("unit-filter.other_than names event-subject, target or event-object.");
    if (rest.other !== true) throw new TypeError("unit-filter.other_than needs other: true.");
    added.other_than = "event-subject";
  }

  if ("embarked_in" in rest && rest.embarked_in !== undefined) {
    const embarked = take("embarked_in");
    if (!(EMBARKED_IN as readonly unknown[]).includes(embarked)) throw new TypeError(`unit-filter.embarked_in is this-unit or this-model, not ${JSON.stringify(embarked)}.`);
    if (rest.side !== "friendly") throw new TypeError("unit-filter.embarked_in names friendly units: embarked units are always the Transport's own army's.");
    for (const key of EMBARKED_IN_EXCLUDES) if (rest[key] !== undefined) throw new TypeError(`unit-filter.embarked_in cannot be combined with ${key}.`);
    added.embarked_in = embarked;
  }

  if ("attached_to" in rest) {
    const attached = take("attached_to");
    if (attached !== "this-unit") throw new TypeError("unit-filter.attached_to must be this-unit.");
    if (rest.side !== "friendly") throw new TypeError("unit-filter.attached_to names the Leaders attached to this unit, so the filter's side must be friendly.");
    for (const key of EXCLUSIVE_WITH_ATTACHED) if (key in rest) throw new TypeError(`unit-filter.attached_to names units by their attachment; ${key} is not allowed with it.`);
    added.attached_to = attached;
  }

  if (rest.among === MATCHED_UNITS) {
    if (rest.side === "any") throw new TypeError("unit-filter.among matched-units names friendly or enemy units.");
    if ("targets" in rest) throw new TypeError("unit-filter.targets applies to stratagem-targets, not matched-units.");
    take("among");
    added.among = MATCHED_UNITS;
  }

  if ("subject" in rest) {
    if (take("subject") !== "target") throw new TypeError("unit-filter.subject must be target.");
    if (rest.side === "any") throw new TypeError("unit-filter.subject target names an attack's target, so the filter's side must be friendly or enemy.");
    added.subject = "target";
  }

  // engaged and hidden join the states after the rest are checked; a filter of only those passes no states down.
  let engagedOrHidden: string[] = [];
  if (Array.isArray(rest.states) && rest.states.some((state) => (ENGAGED_OR_HIDDEN as readonly unknown[]).includes(state))) {
    const states = rest.states as unknown[];
    engagedOrHidden = states.filter((state) => (ENGAGED_OR_HIDDEN as readonly unknown[]).includes(state)) as string[];
    if (new Set(states).size !== states.length) throw new TypeError("unit-filter.states lists a state twice.");
    if (engagedOrHidden.includes("engaged") && states.includes("unengaged")) throw new TypeError("unit-filter cannot be both engaged and unengaged.");
    const older = states.filter((state) => !engagedOrHidden.includes(state as string));
    if (older.length) rest.states = older;
    else delete rest.states;
  }

  if ("excluded_from" in rest) {
    if (take("excluded_from") !== EXCLUDED_FROM_ATTACKS) throw new TypeError(`unit-filter.excluded_from must be ${EXCLUDED_FROM_ATTACKS}.`);
    if (rest.level !== "model") throw new TypeError("unit-filter.excluded_from names models, so the filter must be level model.");
    if (!Array.isArray(rest.excluded_keywords) || rest.excluded_keywords.length === 0) throw new TypeError("unit-filter.excluded_from needs excluded_keywords: the models it leaves out.");
    for (const key of ["keywords", "any_keywords", "states", "alternatives"] as const) {
      if (key in rest || (key === "states" && engagedOrHidden.length)) throw new TypeError(`unit-filter.excluded_from takes excluded_keywords alone; ${key} is not allowed with it.`);
    }
    added.excluded_from = EXCLUDED_FROM_ATTACKS;
  }

  let designatedBy: unknown;
  if (rest.designated !== undefined || rest.designated_by !== undefined) {
    const designated = take("designated");
    designatedBy = take("designated_by");
    if (designated === undefined) throw new TypeError("unit-filter.designated_by needs designated.");
    if (typeof designated !== "string" || !DESIGNATION_IDS.has(designated)) throw new TypeError(`unit-filter.designated ${JSON.stringify(designated)} is not a registered designation.`);
    added.designated = designated;
  }

  if ("datasheets" in rest) {
    const datasheets = take("datasheets");
    if (!Array.isArray(datasheets) || datasheets.length === 0) throw new TypeError("unit-filter.datasheets lists at least one datasheet id.");
    for (const id of datasheets) if (typeof id !== "string" || !KEBAB_ID.test(id)) throw new TypeError("unit-filter.datasheets lists kebab-case unit ids.");
    if (new Set(datasheets).size !== datasheets.length) throw new TypeError("unit-filter.datasheets lists a datasheet twice.");
    added.datasheets = [...(datasheets as string[])].sort();
  }

  if ("among" in rest || "targets" in rest) {
    const among = take("among");
    const targets = take("targets");
    if (among !== AMONG_TARGETS) throw new TypeError(`unit-filter.among must be ${AMONG_TARGETS} or ${MATCHED_UNITS}; ${AMONG_TARGETS} goes with targets.`);
    added.among = AMONG_TARGETS;
    added.targets = enumValue(targets, TARGET_PICKS, "unit-filter.targets");
  }

  let alternatives: unknown;
  if (rest.alternatives !== undefined) {
    alternatives = take("alternatives");
    if (rest.any_keywords !== undefined) throw new TypeError("unit-filter.alternatives replaces any_keywords; a one-keyword alternative is one item of alternatives.");
  }

  // not-battle-shocked joins the states after the rest are checked; a filter of only it passes no states down.
  const states = Array.isArray(rest.states) ? rest.states as unknown[] : undefined;
  const notBattleShocked = states?.includes(NOT_BATTLE_SHOCKED) === true;
  if (notBattleShocked) {
    if (new Set(states).size !== states!.length) throw new TypeError("unit-filter.states lists a state twice.");
    if (states!.includes("battle-shocked")) throw new TypeError("unit-filter cannot be both battle-shocked and not-battle-shocked.");
    const older = states!.filter((state) => state !== NOT_BATTLE_SHOCKED);
    if (older.length) rest.states = older;
    else delete rest.states;
  }
  const excludedAll = take("excluded_all_keywords");

  if (rest.excluded_abilities !== undefined) {
    const list = take("excluded_abilities") as string[];
    if (!Array.isArray(list) || list.length === 0 || list.some((id) => typeof id !== "string" || !KEBAB_ID.test(id))) {
      throw new TypeError("unit-filter excluded_abilities lists ability ids.");
    }
    if (new Set(list).size !== list.length) throw new TypeError("unit-filter excluded_abilities lists an ability twice.");
    added.excluded_abilities = [...list].sort();
  }

  if ("held_in" in rest) added.held_in = enumValue(take("held_in"), HELD_IN, "unit-filter.held_in");

  const result = filterBase(rest);
  if (notBattleShocked) result.states = [...((result.states as string[] | undefined) ?? []), NOT_BATTLE_SHOCKED].sort();
  if (excludedAll !== undefined) result.excluded_all_keywords = keywordList(excludedAll, "unit-filter excluded_all_keywords", 2);
  if (alternatives !== undefined) {
    const shared = { keywords: result.keywords as string[] | undefined, excluded_keywords: result.excluded_keywords as string[] | undefined, states: result.states as string[] | undefined };
    result.alternatives = normalizeAlternatives(alternatives, "unit-filter.alternatives", shared);
  }
  if (added.designated !== undefined && designatedBy !== undefined) added.designated_by = enumValue(designatedBy, [...FILTER_APPLIER], "unit-filter.designated_by");
  if (engagedOrHidden.length) result.states = [...((result.states as string[] | undefined) ?? []), ...engagedOrHidden].sort();
  if (membership) {
    if (role !== undefined) added.attachment_role = enumValue(role, ATTACHMENT_ROLES, "unit-filter.attachment_role");
    if (member !== undefined) added.member_of = enumValue(member, MEMBER_OF, "unit-filter.member_of");
  }
  return { ...result, ...added };
}

/** Validate and canonicalise a unit-filter leaf's parameters. */
function normalizeUnitFilter(input: Params): Params {
  const rest: Params = { ...input };
  const added: Params = {};
  if (rest.other_than === "target" || rest.other_than === "event-object") {
    if (rest.other !== true) throw new TypeError("unit-filter.other_than needs other: true.");
    added.other_than = rest.other_than;
    delete rest.other_than;
  }
  let protection: Params | undefined;
  if (rest.lone_operative_protection !== undefined) {
    const value = rest.lone_operative_protection as Params;
    delete rest.lone_operative_protection;
    if (rest.level === "model") throw new TypeError("unit-filter.lone_operative_protection excludes units, not models.");
    if (value === null || typeof value !== "object" || Object.keys(value).some((key) => key !== "inches" && key !== "of")) {
      throw new TypeError("unit-filter.lone_operative_protection is { inches, of }.");
    }
    protection = value;
  }
  const result = withLeadingApostrophes("unit-filter", rest, unitFilterCore);
  if (protection) {
    added.lone_operative_protection = {
      inches: boundedInteger(protection.inches, 1, 36, "unit-filter.lone_operative_protection.inches"),
      of: enumValue(protection.of, ["this-model", "this-unit"], "unit-filter.lone_operative_protection.of"),
    };
  }
  return { ...result, ...added };
}

const UNIT_FILTER_SCHEMA = {
  type: "object",
  required: ["side"],
  properties: {
    side: { enum: ["friendly", "enemy", "any"] },
    keywords: STRING_LIST_SCHEMA,
    any_keywords: { type: "array", minItems: 2, uniqueItems: true, items: { type: "string", minLength: 1 } },
    excluded_keywords: STRING_LIST_SCHEMA,
    states: { type: "array", minItems: 1, uniqueItems: true, items: { enum: ["unengaged", "battle-shocked", "not-battle-shocked", "engaged", "hidden"] } },
    other: { const: true },
    visible: { const: true },
    level: { const: "model" },
    held_in: { enum: ["strategic-reserves", "cult-ambush"], "x-optional": true },
    excluded_abilities: { type: "array", items: { type: "string", pattern: KEBAB_ID_PATTERN }, minItems: 1, uniqueItems: true, "x-optional": true },
    excluded_all_keywords: { type: "array", items: APOSTROPHE_KEYWORD_ITEMS, minItems: 2, uniqueItems: true, "x-optional": true },
    alternatives: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        minProperties: 1,
        properties: {
          keywords: STRING_LIST_SCHEMA,
          excluded_keywords: STRING_LIST_SCHEMA,
          states: { type: "array", minItems: 1, uniqueItems: true, items: { enum: ["unengaged", "battle-shocked", "not-battle-shocked"] } },
        },
        additionalProperties: false,
      },
      "x-optional": true,
    },
    among: { enum: ["stratagem-targets", "matched-units"], "x-optional": true },
    targets: { enum: ["one", "every", "any"], "x-only-when": { among: ["stratagem-targets"] }, "x-optional": true },
    datasheets: { type: "array", items: { type: "string", pattern: KEBAB_ID_PATTERN }, minItems: 1, uniqueItems: true, "x-optional": true },
    designated: { type: "string", pattern: KEBAB_ID_PATTERN, "x-optional": true },
    designated_by: { enum: ["this-unit", "selected-unit", "event-subject"], "x-optional": true },
    excluded_from: { const: "attacks", "x-only-when": { level: ["model"] }, "x-optional": true },
    subject: { const: "target", "x-optional": true },
    attached_to: { enum: ["this-unit"], "x-optional": true },
    embarked_in: { enum: ["this-unit", "this-model"], "x-optional": true },
    other_than: { enum: ["event-subject", "target", "event-object"], "x-only-when": { other: [true] }, "x-optional": true },
    attachment_role: { enum: ["bodyguard", "leader"], "x-only-when": { level: ["model"] }, "x-optional": true },
    member_of: { enum: ["this-unit", "selected-unit", "antecedent"], "x-only-when": { level: ["model"] }, "x-optional": true },
    unit_names: { ...STRING_LIST_SCHEMA, "x-optional": true },
    lone_operative_protection: {
      type: "object",
      required: ["inches", "of"],
      additionalProperties: false,
      properties: { inches: { type: "integer", minimum: 1, maximum: 36 }, of: { enum: ["this-model", "this-unit"] } },
      "x-optional": true,
    },
  },
  additionalProperties: false,
};


export const UNIT_FILTER_FAMILIES: readonly FlatFamily[] = [
  {
    id: "unit-filter",
    version: 20,
    role: "CONDITION",
    label: "Which units",
    description: "The units an aura reaches or a selection may pick: friendly, enemy or any (a phrase naming no side means friendly), optionally with unit keywords they all have, keywords one of which they have (\"NECRONS VEHICLE or NECRONS MOUNTED\": NECRONS, and VEHICLE or MOUNTED), keywords they must not have (excluded_keywords), keywords they must not have all of (excluded_all_keywords), states they are in (unengaged, battle-shocked, not-battle-shocked, engaged, hidden; engaged cannot be unengaged in the same filter), other than this unit, and visible; level model when it names models (\"One ADEPTUS CUSTODES model\"). A keyword can start with an apostrophe as the rules print it ('ARDMOB). It names no range or count: the aura-range after it or the select-unit before it does. "
      + "held_in names where a unit off the battlefield is held: strategic-reserves, or cult-ambush (\"Units in Cult Ambush\"). excluded_abilities: matching units have none of these abilities (by record id, e.g. lone-operative). "
      + "alternatives: two or more {keywords, excluded_keywords, states}, any one of which a unit matches (\"LEGIO CYBERNETICA or ADEPTUS MECHANICUS VEHICLE unit\" is [LEGIO CYBERNETICA] and [ADEPTUS MECHANICUS, VEHICLE]; \"PSYKER or Battle-shocked unit\" is [PSYKER] and states [battle-shocked]); each alternative keeps its own exclusions and states, side, level and the filter's own keywords, exclusions and states hold for every alternative, and it does not go with any_keywords. "
      + "among stratagem-targets, always with targets: the filter picks among this Stratagem's targets (\"your **VEHICLE** unit\", \"that **TRANSPORT**\", \"those units\"), not among all units; targets one = the single target it matches, every = all matching targets (in a condition: \"both of those units\"), any = any one matching target (in a condition: \"one of those units\"; an effect or moment applies to each); side any when no side is printed. among matched-units: the units an earlier unit-position of matching-unit introduced (\"one of those VEHICLE units\"), friendly or enemy, with no targets. "
      + "datasheets: units of any of these datasheets (kebab-case unit ids), for a list-building group whose units no keyword names; only a list-building rule's group can hold it. unit_names: exact named unit datasheets, resolved within the owning faction to stable unit IDs; these are unit-level identities, not keywords or model names. "
      + "designated: a registered designation the unit carries, and designated_by: the unit that applied it (this-unit, selected-unit or event-subject); designated_by needs designated. "
      + "excluded_from attacks, on a model-level filter with excluded_keywords only: the models whose attacks the attack frame before it does not cover (\"excluding Character models' attacks\"). "
      + "subject target: the units the filter matches are the attack's target (\"while targeting an enemy unit\"), only in an effect fragment. "
      + "attached_to this-unit, on a friendly unit-level filter: the Leader units attached to this unit (\"that Leader unit\", \"models in those units\"); it cannot combine with a model level, a designation, a held state, other, a matched set or alternatives. "
      + "embarked_in: the units (or models) embarked within this unit or this model (\"units embarked within this unit\"); always friendly, with no held_in, alternatives, among, subject, datasheets or designation. "
      + "other_than, with other: \"other\" means other than the unit the trigger names (event-subject: \"no other friendly units\" when a unit is selected to shoot), the unit the attack or shooting targets (target), or the unit the trigger's moment was aimed at or a unit-destroyed moment destroyed (event-object). "
      + "attachment_role bodyguard or leader and member_of (this-unit, selected-unit or an antecedent unit), on model-level filters: actual attached composition, not keywords or the ability to lead; a separate reviewed membership leaf may supply member_of during compilation. "
      + "lone_operative_protection, unit level only: the units excluded are those with the Lone Operative ability that are neither part of an Attached unit nor within `inches` of `of` (this model or this unit).",
    starter: { side: "" },
    parameterSchema: UNIT_FILTER_SCHEMA,
    normalize: normalizeUnitFilter,
  },
];
