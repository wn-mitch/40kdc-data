import type { FlatFamily } from "./types.js";
import {
  ANTECEDENT, BEARER_TRANSPORT, EACH_TARGET, FILTERED_UNITS, FOLLOWING_FILTER, KEBAB, KEBAB_STRING, KEYWORD_ITEMS, UNIT_KEYWORD,
  WIDE_OR_ANTECEDENT, accents, apostrophes, booleanValue, enumSet, enumValue, exactKeys, hasDuplicate, keysWithin, type Params,
} from "./unit-subjects-shared.js";

/** The predicates on a unit's marks, states and keywords, and target-is-selected. */

// ---- unit-mark ----

/** Designations an ability applies. Hidden is a core-rules state: unit-state reads it. */
const UNIT_MARKS = ["oath-of-moment", "afflicted", "spotted", "marked", "riled-up"] as const;
const MARK_SUBJECTS = ["this-unit", "target"] as const;

function normalizeUnitMark(input: Params): Params {
  exactKeys(input, ["mark", "subject", "negated"], "unit-mark");
  return {
    mark: enumValue(input.mark, UNIT_MARKS, "unit-mark.mark"),
    subject: enumValue(input.subject, MARK_SUBJECTS, "unit-mark.subject"),
    negated: booleanValue(input.negated, "unit-mark.negated"),
  };
}

// ---- unit-state ----

/** States the strength, shock, engagement and battlefield checks name. */
const CORE_STATES = ["below-starting-strength", "below-half-strength", "battle-shocked", "engaged", "on-battlefield"] as const;
const RESERVE_STATES = ["in-reserves", "in-strategic-reserves", "in-cult-ambush"] as const;
const UNIT_STATES = [...CORE_STATES, "carrying-units", ...RESERVE_STATES, "hidden", "embarked", "at-or-below-half-strength"] as const;
/** States the DSL's unit-state can read at the start of the phase or turn. */
const STATES_AT = ["engaged", "battle-shocked", "on-battlefield", "in-reserves", "in-strategic-reserves", "in-cult-ambush"] as const;
const STATE_SUBJECTS = [...WIDE_OR_ANTECEDENT, BEARER_TRANSPORT, EACH_TARGET, FILTERED_UNITS] as const;
const STATE_WITH = [...WIDE_OR_ANTECEDENT, FOLLOWING_FILTER] as const;
/** The Transports a unit-filter's embarked units can be embarked within. */
const EMBARKED_IN = ["this-unit", "this-model"] as const;
const AT_OR_BELOW_HALF = "at-or-below-half-strength";

/**
 * The states a leaf lists, split into what the core check reads and what the leaf returns. Hidden,
 * the Reserves states and carrying-units each stand alone or beside the core states as their
 * rules allow; `core` is the core state list the subject, with and this-model rules apply to.
 */
function splitStates(states: readonly unknown[], hasWith: boolean): { core: readonly unknown[]; out: (core: string[]) => string[] } {
  const reserves = states.filter((state) => (RESERVE_STATES as readonly unknown[]).includes(state));
  const carrying = (list: readonly unknown[]) => {
    if (!list.includes("carrying-units")) return { core: list, out: (core: string[]) => core };
    if (list.length !== 1) throw new TypeError("unit-state carrying-units cannot be listed with other states.");
    if (hasWith) throw new TypeError("unit-state carrying-units takes no with.");
    return { core: ["engaged"], out: () => ["carrying-units"] };
  };
  if (reserves.length === 0) return carrying(states);
  if (hasWith) throw new TypeError("unit-state Reserves states take no with.");
  if (hasDuplicate(states)) throw new TypeError("unit-state lists a state twice.");
  const older = states.filter((state) => !reserves.includes(state));
  if (older.length === 0) return { core: ["on-battlefield"], out: () => reserves as string[] };
  const inner = carrying(older);
  return { core: inner.core, out: (core) => [...inner.out(core), ...(reserves as string[])] };
}

function normalizeUnitState(input: Params): Params {
  keysWithin(input, ["states", "subject", "negated"], ["with", "at"], "unit-state");
  const { subject, with: withUnit, at } = input;
  const negated = booleanValue(input.negated, "unit-state.negated");
  enumValue(subject, STATE_SUBJECTS, "unit-state.subject");
  if (withUnit !== undefined) enumValue(withUnit, STATE_WITH, "unit-state.with");
  if (!Array.isArray(input.states)) throw new TypeError(`unit-state.states must list at least one of ${UNIT_STATES.join(", ")}.`);
  const listed = input.states as unknown[];
  if (hasDuplicate(listed)) throw new TypeError("unit-state lists a state twice.");
  if (listed.includes(AT_OR_BELOW_HALF) && listed.includes("below-half-strength")) throw new TypeError("unit-state: at-or-below-half-strength already covers below-half-strength.");
  // At or below half strength takes what below half strength takes.
  const states = listed.map((state) => (state === AT_OR_BELOW_HALF ? "below-half-strength" : state));
  const alone = (state: string) => states.length === 1 && states[0] === state;

  // The unit the core check reads the subject as: a filter's units, a Stratagem's targets and a
  // bearer's Transport are units; this model engaged is checked as its unit is.
  let unit = subject;
  if (subject === FILTERED_UNITS) unit = "this-unit";
  else if (subject === "this-model" && alone("engaged")) {
    if (withUnit === "this-model") throw new TypeError("unit-state: a model cannot be engaged with itself.");
    unit = "this-unit";
  }

  if (alone("embarked") && withUnit !== undefined) {
    // Embarked with a Transport: an earlier leaf's units are embarked within this unit or model.
    if (!(EMBARKED_IN as readonly unknown[]).includes(withUnit)) throw new TypeError(`unit-state embarked names the Transport with this-unit or this-model, not ${JSON.stringify(withUnit)}.`);
    if (unit !== ANTECEDENT) throw new TypeError("unit-state embarked takes a with only for subject antecedent.");
    if (at !== undefined) throw new TypeError("unit-state embarked has no earlier point (at).");
    return { states: ["embarked"], subject, negated, with: withUnit };
  }
  if (unit === EACH_TARGET) unit = "this-unit";

  let core: readonly unknown[];
  let out: (canonical: string[]) => string[];
  if (states.includes("embarked")) {
    if (states.length !== 1) throw new TypeError("unit-state embarked cannot be listed with other states.");
    if (withUnit !== undefined) throw new TypeError("unit-state embarked takes no with.");
    if (at !== undefined) throw new TypeError("unit-state embarked has no earlier point (at).");
    if (!["this-unit", "this-model", "target"].includes(String(unit))) throw new TypeError(`unit-state embarked is about this-unit, this-model or target, not ${String(unit)}.`);
    core = ["on-battlefield"];
    out = () => ["embarked"];
  } else {
    if (unit === BEARER_TRANSPORT) unit = "this-unit";
    const hidden = states.includes("hidden");
    if (hidden && at !== undefined) throw new TypeError("unit-state hidden has no earlier point (at).");
    const rest = hidden ? states.filter((state) => state !== "hidden") : states;
    const split = splitStates(rest.length || !hidden ? rest : ["battle-shocked"], withUnit !== undefined);
    core = split.core;
    out = hidden ? (canonical) => [...(rest.length ? split.out(canonical) : []), "hidden"] : split.out;
    if (at !== undefined) {
      const read = split.out(enumSet(core, CORE_STATES, "unit-state.states"));
      if (!read.every((state) => (STATES_AT as readonly string[]).includes(state))) throw new TypeError(`unit-state.at reads only ${STATES_AT.join(", ")} at an earlier point.`);
      enumValue(at, ["phase-start", "turn-start"], "unit-state.at");
    }
  }

  const canonical = enumSet(core, CORE_STATES, "unit-state.states");
  const checkedUnit = enumValue(unit, WIDE_OR_ANTECEDENT, "unit-state.subject");
  if (checkedUnit === "this-model" && canonical.some((state) => state !== "on-battlefield")) {
    throw new TypeError("unit-state: only being on the battlefield or engaged can be said of this model alone; use this unit for the other states.");
  }
  if (withUnit !== undefined) {
    if (canonical.length !== 1 || canonical[0] !== "engaged") throw new TypeError("unit-state.with only narrows being engaged.");
    enumValue(withUnit === FOLLOWING_FILTER ? "this-unit" : withUnit, WIDE_OR_ANTECEDENT, "unit-state.with");
  }
  return {
    // At or below half strength takes below half strength's place in the canonical order.
    states: out(canonical).map((state) => (state === "below-half-strength" && listed.includes(AT_OR_BELOW_HALF) ? AT_OR_BELOW_HALF : state)),
    subject, negated,
    ...(withUnit !== undefined ? { with: withUnit } : {}),
    ...(at !== undefined ? { at } : {}),
  };
}

// ---- unit-keyword ----

/** event-object: the moment's object ("if the destroyed model was a MAGUS"). */
const KEYWORD_SUBJECTS = [...WIDE_OR_ANTECEDENT, BEARER_TRANSPORT, "event-object"] as const;

/** unit-keyword's own list check: strings only, markdown dropped, upper case, each once, sorted. */
function unitKeywordList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("unit-keyword.keywords must list at least one keyword.");
  const keywords = value.map((item) => {
    if (typeof item !== "string") throw new TypeError("unit-keyword.keywords must be strings.");
    const keyword = item.replaceAll("*", "").replace(/\s+/gu, " ").trim().toUpperCase();
    if (!UNIT_KEYWORD.test(keyword)) throw new TypeError(`unit-keyword keyword ${JSON.stringify(item)} is not a unit keyword.`);
    return keyword;
  });
  if (new Set(keywords).size !== keywords.length) throw new TypeError("unit-keyword.keywords lists a keyword twice.");
  return keywords.sort();
}

function normalizeUnitKeyword(input: Params): Params {
  const { match, ...rest } = input;
  if ("chosen_by" in rest && "keywords" in rest) throw new TypeError("unit-keyword uses keywords or chosen_by, not both.");
  exactKeys(rest, ["chosen_by" in rest ? "chosen_by" : "keywords", "subject", "negated"], "unit-keyword");
  const subject = enumValue(rest.subject, KEYWORD_SUBJECTS, "unit-keyword.subject");
  const negated = booleanValue(rest.negated, "unit-keyword.negated");
  let named: Params;
  if ("chosen_by" in rest) {
    if (typeof rest.chosen_by !== "string" || !KEBAB.test(rest.chosen_by)) throw new TypeError("unit-keyword.chosen_by is a kebab-case ability, Stratagem, manoeuvre or action id.");
    named = { chosen_by: rest.chosen_by };
  } else {
    const apostrophe = apostrophes("unit-keyword", rest);
    const stripped = apostrophe.plain(rest) as Params;
    const accent = accents("unit-keyword", stripped);
    named = { keywords: apostrophe.restore(accent.restore(unitKeywordList(accent.plain(stripped.keywords)))) };
    accent.requireAllRestored();
    apostrophe.requireAllRestored();
  }
  if (match !== undefined) {
    if (match !== "all") throw new TypeError("unit-keyword.match is all or omitted.");
    const keywords = named.keywords as string[] | undefined;
    if (keywords === undefined || keywords.length < 2) throw new TypeError("unit-keyword.match all names two or more keywords.");
    if (negated) throw new TypeError("unit-keyword.match all is not negated; name the keywords the subject lacks one by one.");
  }
  return { ...named, subject, negated, ...(match !== undefined ? { match } : {}) };
}

// ---- target-is-selected ----

const SELECTION_BY = ["event-subject", "this-unit", "selected-unit", ANTECEDENT] as const;
const SELECTION_TARGETS = ["this-unit", "this-model", "selected-unit", FOLLOWING_FILTER, ANTECEDENT] as const;

function normalizeTargetIsSelected(input: Params): Params {
  keysWithin(input, [], ["by", "target", "all_attacks", "negated", "unit"], "target-is-selected");
  const { by, target, all_attacks: all, negated, unit } = input;
  if (unit !== undefined) {
    if (Object.keys(input).length > 1) throw new TypeError("target-is-selected.unit stands alone.");
    return { unit: enumValue(unit, ["event-subject"], "target-is-selected.unit") };
  }
  if (by === undefined && target === undefined) {
    if (all !== undefined || negated !== undefined) throw new TypeError("target-is-selected.all_attacks and negated need by and target.");
    return {};
  }
  if (by === undefined || target === undefined) throw new TypeError("target-is-selected names by and target together, or neither.");
  if (all !== undefined && all !== true) throw new TypeError("target-is-selected.all_attacks is true or absent.");
  if (negated !== undefined && typeof negated !== "boolean") throw new TypeError("target-is-selected.negated is a boolean.");
  const who = enumValue(by, SELECTION_BY, "target-is-selected.by");
  const what = enumValue(target, SELECTION_TARGETS, "target-is-selected.target");
  if (who === what && who !== ANTECEDENT) throw new TypeError("target-is-selected: a unit does not select itself as a target.");
  return { by: who, target: what, ...(all === true ? { all_attacks: true } : {}), ...(negated === true ? { negated: true } : {}) };
}

export const UNIT_STATES_AND_KEYWORDS_FAMILIES: readonly FlatFamily[] = [
  {
    id: "unit-mark",
    version: 3,
    role: "CONDITION",
    label: "Unit carries (or lacks) a mark",
    description: "This unit or the attack's target carries a named mark: the Oath of Moment target, Afflicted, Spotted, Marked, or riled up. Hidden is a unit state (unit-state), not a mark.",
    starter: { mark: "", subject: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["mark", "subject", "negated"],
      properties: { mark: { enum: [...UNIT_MARKS] }, subject: { enum: [...MARK_SUBJECTS] }, negated: { type: "boolean" } },
      additionalProperties: false,
    },
    normalize: normalizeUnitMark,
  },
  {
    id: "unit-state",
    version: 18,
    role: "CONDITION",
    label: "Unit is (or is not) in a state",
    description: "The subject is below its Starting Strength, Below Half-strength, at or below half its Starting Strength (at-or-below-half-strength, which takes what below-half-strength takes and is not listed with it), Battle-shocked, within Engagement Range of an enemy unit (engaged; negated: unengaged), on the battlefield, hidden (the core rules' hidden state, not a designation an ability applies), in Reserves (\"in Reserves\", which the rules define as Strategic Reserves), in Strategic Reserves, in Cult Ambush (a type of Strategic Reserves), carrying one or more embarked units (carrying-units; negated: none are), or embarked within a Transport (this unit, this model or the attack's target). Several states mean any of them; carrying-units and embarked stand alone. The subject is this unit, this model, the attack's target, the attacking unit, the unit that triggered the ability, the effect's recipient, a unit the ability selected earlier, an earlier leaf's unit (antecedent), the Transport this model is embarked within (bearer-transport: \"any TRANSPORT it is embarked within is on the battlefield\"), every Stratagem target named before it (each-target: \"Each unit targeted with this Stratagem must …\"), or the units the unit-filter before it names (filtered-units: \"one or more Neurotyrants are on the battlefield\"). This model can be on the battlefield, embarked, in Reserves, or engaged (\"if this model is not within Engagement Range of one or more enemy units\"). `with` names the one unit an engaged subject is engaged with (\"engaged with your unit\"), or following-filter: any unit the unit-filter right after this leaf, in the same clause, matches. With embarked and subject antecedent, `with` (this-unit or this-model) is the Transport the earlier leaf's units are embarked within (\"While a Big Mek model is embarked within this unit\"). `at`, phase-start or turn-start, reads engaged, Battle-shocked, on the battlefield or a Reserves state as it was then (\"that was engaged with this unit\"), not at the moment of the check.",
    starter: { states: [], subject: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["states", "subject", "negated"],
      properties: {
        states: { type: "array", items: { enum: [...UNIT_STATES] }, minItems: 1, uniqueItems: true },
        subject: { enum: [...STATE_SUBJECTS] },
        negated: { type: "boolean" },
        with: { enum: [...STATE_WITH], "x-only-when": { states: ["engaged", "embarked"] } },
        at: { enum: ["phase-start", "turn-start"], "x-only-when": { states: [...STATES_AT] }, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeUnitState,
  },
  {
    id: "unit-keyword",
    version: 9,
    role: "CONDITION",
    label: "Unit has (or lacks) a keyword",
    description: "The subject has one of the keywords, for example CHARACTER, or MONSTER or VEHICLE; with match all it has every listed keyword (two or more, not negated). A unit that can FLY has the FLY keyword. chosen_by, in place of keywords, says the subject has the keyword chosen by the named ability; a leaf names keywords or chosen_by, never both. The subject is this unit, this model, the attack's target, the attacking unit, the unit that triggered the ability, the effect's recipient, a unit the ability selected earlier, an earlier leaf's unit (antecedent), the Transport the unit is embarked within (bearer-transport), or the moment's object (event-object: \"if the destroyed model was a MAGUS, PRIMUS or ACOLYTE ICONWARD\"). A keyword can carry accented capitals (KÂHL) or start with an apostrophe ('ARDMOB) as the rules print it.",
    starter: { keywords: [], subject: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["subject", "negated"],
      properties: {
        keywords: { type: "array", items: KEYWORD_ITEMS, minItems: 1, uniqueItems: true, "x-optional": true },
        subject: { enum: [...KEYWORD_SUBJECTS] },
        negated: { type: "boolean" },
        chosen_by: { ...KEBAB_STRING, "x-optional": true },
        match: { const: "all", "x-optional": true },
      },
      additionalProperties: false,
      oneOf: [
        { required: ["keywords"], not: { required: ["chosen_by"] } },
        { required: ["chosen_by"], not: { required: ["keywords"] } },
      ],
    },
    normalize: normalizeUnitKeyword,
  },
  {
    id: "target-is-selected",
    version: 4,
    role: "CONDITION",
    label: "Target is the selected unit",
    description: "The attack targets the unit selected earlier in the ability (\"that unit\" after \"select one enemy unit\"). With by and target, always together, target was selected as a target by by in the moment the ability names (\"if one or more units with this ability are selected as a target of that charge\" = by antecedent, target this-unit); target following-filter is any unit the unit-filter right after this leaf matches. all_attacks and negated go only with by and target. all_attacks: target was selected as the target of every one of by's attacks, not just some (\"as the target of all of its attacks\"). negated: the selection did not happen (\"does not select your unit as the target of all of its attacks\" = all_attacks and negated). unit event-subject, alone: the attack targets the unit of the ability's moment, which the ability designates with no selection (\"just after an enemy unit has shot\" … \"makes an attack that targets that enemy unit\").",
    starter: {},
    parameterSchema: {
      type: "object",
      properties: {
        by: { enum: [...SELECTION_BY], "x-optional": true },
        target: { enum: [...SELECTION_TARGETS], "x-optional": true },
        all_attacks: { const: true, "x-optional": true },
        negated: { type: "boolean", "x-optional": true },
        unit: { enum: ["event-subject"], "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeTargetIsSelected,
  },
];
