import { booleanValue, boundedInteger, enumValue, exactKeys } from "../family-validation.js";
import { normalizeUnitKeywords } from "../unit-filter-alternatives.js";
import { APOSTROPHE_KEYWORD_ITEMS, KEBAB_ID, KEBAB_ID_PATTERN, keywordList, SELECTION_NAME_SCHEMA, selectionName, STRING_LIST_SCHEMA, withLeadingApostrophes, type Params } from "./unit-filters-and-targeting-shared.js";
import type { FlatFamily } from "./types.js";

/** Auras (aura-emitter, aura-range), select-unit and the selection counts, and the small combinators that ride on them. */

// ---------------------------------------------------------------------------------------------
// aura-emitter, aura-range

function normalizeAuraEmitter(input: Params): Params {
  exactKeys(input, ["side", "keywords", "any_keywords"], "aura-emitter");
  const keywords = normalizeUnitKeywords(input.keywords, "aura-emitter.keywords");
  const anyKeywords = normalizeUnitKeywords(input.any_keywords, "aura-emitter.any_keywords");
  if (anyKeywords.length < 2) throw new TypeError("aura-emitter.any_keywords names two or more keywords.");
  return { side: enumValue(input.side, ["friendly"], "aura-emitter.side"), keywords, any_keywords: anyKeywords };
}

const AURA_SIDES = ["friendly", "enemy"] as const;
const AURA_OF = ["this-unit", "this-model"] as const;
const MATCHING_MODELS = "matching-models";
const NAMED_RANGES = ["contagion", "synapse"] as const;

function auraRangeCore(input: Params): Params {
  const { range_ref: rangeRef, of, of_keywords: ofKeywords, of_side: ofSide, conditional_range: conditional, ...rest } = input;
  if (rangeRef !== undefined || of === MATCHING_MODELS || ofKeywords !== undefined || ofSide !== undefined) {
    if (rangeRef !== undefined && "inches" in rest) throw new TypeError("aura-range takes range_ref or inches, not both.");
    if (rangeRef === undefined && !("inches" in rest)) throw new TypeError("aura-range needs inches or range_ref.");
    if (rangeRef !== undefined && conditional !== undefined) throw new TypeError("aura-range.conditional_range gives an alternate radius in inches; a named range has none.");
    if (of !== MATCHING_MODELS && (ofKeywords !== undefined || ofSide !== undefined)) throw new TypeError("aura-range.of_keywords and of_side go with of matching-models.");
  }
  // A named range has no inches to check; the leaf's other keys are checked as with inches.
  const base: Params = { ...rest, ...(rangeRef !== undefined ? { inches: 1 } : {}), ...("of" in input && of !== MATCHING_MODELS ? { of } : {}) };
  exactKeys(base, ["inches", ...["side", "keywords", "range_cap_inches", "of", "wholly"].filter((key) => key in base)], "aura-range");
  if ("keywords" in base && !("side" in base)) throw new TypeError("aura-range.keywords belong to the unit-filter when side is left out.");
  const result: Params = { inches: boundedInteger(base.inches, 1, 24, "aura-range.inches") };
  if ("side" in base) result.side = enumValue(base.side, AURA_SIDES, "aura-range.side");
  if ("keywords" in base) result.keywords = normalizeUnitKeywords(base.keywords, "aura-range.keywords");
  if ("range_cap_inches" in base) result.range_cap_inches = boundedInteger(base.range_cap_inches, 1, 24, "aura-range.range_cap_inches");
  if ("of" in base) result.of = enumValue(base.of, AURA_OF, "aura-range.of");
  if ("wholly" in base) {
    if (base.wholly !== true) throw new TypeError("aura-range.wholly is true or absent.");
    result.wholly = true;
  }
  if (conditional !== undefined) {
    if (!conditional || typeof conditional !== "object" || Array.isArray(conditional)) throw new TypeError("aura-range.conditional_range is an object.");
    const value = conditional as Params;
    exactKeys(value, ["inches", "keywords"], "aura-range.conditional_range");
    result.conditional_range = {
      inches: boundedInteger(value.inches, 1, 24, "aura-range.conditional_range.inches"),
      keywords: normalizeUnitKeywords(value.keywords, "aura-range.conditional_range.keywords"),
    };
  }
  if (rangeRef !== undefined) {
    delete result.inches;
    result.range_ref = enumValue(rangeRef, NAMED_RANGES, "aura-range.range_ref");
  }
  if (of === MATCHING_MODELS) {
    result.of = MATCHING_MODELS;
    result.of_keywords = keywordList(ofKeywords, "aura-range.of_keywords", 1);
    if (ofSide !== undefined) result.of_side = enumValue(ofSide, ["friendly"], "aura-range.of_side");
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// select-unit

const SELECT_SCOPES = ["enemy", "friendly"] as const;
const SELECT_DISTANCES = ["any", "within"] as const;
const BEARER_TRANSPORT = "bearer-transport";

function normalizeSelectUnit(input: Params): Params {
  const { at_least: atLeast, within_origin: origin, bind_as: bindAs, within_of: withinOf, visible_to: visibleTo, up_to: upTo, ...base } = input;
  let count = input.count;
  delete base.count;
  if (atLeast !== undefined) {
    if (atLeast !== true) throw new TypeError("select-unit.at_least is true or absent.");
    if (upTo !== undefined) throw new TypeError("select-unit.at_least is a lower bound; up_to is an upper one, so they cannot be combined.");
    // "one or more": count 1 is the default, which is never written out otherwise.
    if (count === 1) count = undefined;
  }
  if ("within_origin" in input) {
    if (origin !== BEARER_TRANSPORT) throw new TypeError(`select-unit.within_origin is bearer-transport, not ${String(origin)}.`);
    if (input.distance !== "within") throw new TypeError("select-unit.within_origin measures a distance, so it needs distance within.");
    if (input.inches === undefined) throw new TypeError("select-unit.within_origin needs inches.");
    if (withinOf !== undefined) throw new TypeError("select-unit.within_origin and within_of name two origins; give one.");
  }
  const distance = enumValue(base.distance, SELECT_DISTANCES, "select-unit.distance");
  exactKeys(base, [...("scope" in base ? ["scope"] : []), "distance", ...(distance === "within" ? ["inches"] : []), "visible"], "select-unit");
  const result: Params = {
    ...("scope" in base ? { scope: enumValue(base.scope, SELECT_SCOPES, "select-unit.scope") } : {}),
    distance,
    ...(distance === "within" ? { inches: boundedInteger(base.inches, 1, 48, "select-unit.inches") } : {}),
    visible: booleanValue(base.visible, "select-unit.visible"),
  };
  if (count === undefined) {
    if (upTo !== undefined) throw new TypeError("select-unit.up_to needs a count.");
  } else {
    if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 10) throw new TypeError("select-unit.count is a whole number of units from 1 to 10 (a dice count has no DSL selector).");
    if (upTo !== undefined && upTo !== true) throw new TypeError("select-unit.up_to is true or absent.");
    if (count === 1 && upTo === undefined) throw new TypeError("select-unit selects one unit by default; leave count out.");
    result.count = count;
    if (upTo === true) result.up_to = true;
  }
  if (bindAs !== undefined) result.bind_as = selectionName(bindAs, "select-unit.bind_as");
  if (withinOf !== undefined) result.within_of = selectionName(withinOf, "select-unit.within_of");
  if (visibleTo !== undefined) result.visible_to = selectionName(visibleTo, "select-unit.visible_to");
  if ("within_origin" in input) result.within_origin = BEARER_TRANSPORT;
  if (atLeast !== undefined) result.at_least = true;
  return result;
}

const EMPTY_SCHEMA = { type: "object", properties: {}, additionalProperties: false };

export const AURAS_AND_SELECTIONS_FAMILIES: readonly FlatFamily[] = [
  {
    id: "aura-emitter",
    version: 2,
    role: "CONDITION",
    label: "Aura emitter",
    description: "Preamble naming friendly emitter models for the following aura: shared keywords plus one of two or more additional keywords. A keyword can start with an apostrophe as the rules print it ('ARDMOB).",
    starter: { side: "", keywords: [], any_keywords: [] },
    parameterSchema: {
      type: "object",
      required: ["side", "keywords", "any_keywords"],
      properties: {
        side: { enum: ["friendly"] },
        keywords: STRING_LIST_SCHEMA,
        any_keywords: { type: "array", minItems: 2, uniqueItems: true, items: { type: "string", minLength: 1 } },
      },
      additionalProperties: false,
    },
    normalize: (input) => withLeadingApostrophes("aura-emitter", input, normalizeAuraEmitter),
  },
  {
    id: "aura-range",
    version: 6,
    role: "CONDITION",
    label: "Within an aura",
    description: "Wraps the ability's effects in a persistent aura: units within a range (\"within 6\\\" of this unit\", measured from this unit or this model, wholly or not; \"Contagions of Nurgle affect enemy units within 6\\\" of this model\"). side (friendly or enemy) and keywords can name the units the aura reaches; with side left out, the unit-filter before it says which units it reaches. Right after a selection (\"select one visible enemy unit within 6\\\" of this unit\") the same range is that selection's distance. "
      + "range_cap_inches caps the aura's range, extensions from other abilities included. conditional_range: an alternate radius and emitter keyword that the aura fold lowers into disjoint aura effects. "
      + "range_ref in place of inches: the aura reaches as far as a named range (contagion, synapse); in the record that defines the range (its named-range-value and named-range-cap leaves) that is the defined per-battle-round distance and cap, anywhere else it is the named range's own aura. "
      + "of matching-models with of_keywords: the aura is measured from any model with all these keywords (\"of one or more DEATH GUARD models\"), friendly by of_side friendly or by a \"from your army\" right after this leaf. A keyword can start with an apostrophe as the rules print it ('ARDMOB).",
    starter: { inches: null },
    parameterSchema: {
      type: "object",
      required: [],
      properties: {
        side: { enum: ["friendly", "enemy"] },
        inches: { type: "integer", minimum: 1, maximum: 24, "x-optional": true },
        keywords: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true },
        range_cap_inches: { type: "integer", minimum: 1, maximum: 24 },
        of: { enum: ["this-unit", "this-model", "matching-models"] },
        wholly: { const: true },
        conditional_range: {
          type: "object",
          required: ["inches", "keywords"],
          additionalProperties: false,
          properties: {
            inches: { type: "integer", minimum: 1, maximum: 24 },
            keywords: { type: "array", minItems: 1, uniqueItems: true, items: APOSTROPHE_KEYWORD_ITEMS },
          },
          "x-optional": true,
        },
        range_ref: { enum: ["contagion", "synapse"], "x-optional": true },
        of_keywords: { type: "array", items: APOSTROPHE_KEYWORD_ITEMS, minItems: 1, uniqueItems: true, "x-only-when": { of: ["matching-models"] }, "x-optional": true },
        of_side: { enum: ["friendly"], "x-only-when": { of: ["matching-models"] }, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: (input) => withLeadingApostrophes("aura-range", input, auraRangeCore),
  },
  {
    id: "select-unit",
    version: 7,
    role: "EVENT",
    label: "Select a unit",
    description: "The ability selects an enemy or friendly unit, optionally within a distance or visible, and later wording refers to it as \"that unit\". scope can be left out (\"select one\"): then the unit-filter right after it (\"friendly WRAITH CONSTRUCT unit\") says which units can be selected. "
      + "count: how many units are selected, exactly or (up_to) at most that many; at_least: at least count (1 without a count) and no upper bound (\"select one or more X models\"), not with up_to. Without count, one unit. "
      + "bind_as names this selection for a later selection to refer to; within_of measures the distance (distance within) from the named selection, or, on a select whose distance is any, names the selection a candidate leaf after the select (unit-position or eligible) relates to; visible_to: visible to the named selection. "
      + "within_origin bearer-transport: a distance (distance within, with inches) is measured from the Transport the bearer is embarked within, not from the bearer; not with within_of.",
    starter: { distance: "", visible: false },
    parameterSchema: {
      type: "object",
      required: ["distance", "visible"],
      properties: {
        scope: { enum: ["enemy", "friendly"] },
        distance: { enum: ["any", "within"] },
        inches: { type: "integer", minimum: 1, maximum: 48, "x-only-when": { distance: ["within"] } },
        visible: { type: "boolean" },
        count: { type: "integer", minimum: 1, maximum: 10, "x-optional": true },
        up_to: { const: true, "x-optional": true },
        bind_as: { ...SELECTION_NAME_SCHEMA, "x-optional": true },
        within_of: { ...SELECTION_NAME_SCHEMA, "x-optional": true },
        visible_to: { ...SELECTION_NAME_SCHEMA, "x-optional": true },
        within_origin: { enum: ["bearer-transport"], "x-only-when": { distance: ["within"] }, "x-optional": true },
        at_least: { const: true, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeSelectUnit,
  },
  {
    id: "count-by-battle-size",
    version: 1,
    role: "RESTRICTION",
    label: "How many, by battle size",
    description: "\"The maximum number of units you can select depends on the battle size: Incursion up to 2, Strike Force up to 3, Onslaught up to 4\": the most units the selection before it can take, per battle size.",
    starter: { incursion: null, "strike-force": null, onslaught: null },
    parameterSchema: {
      type: "object",
      required: ["incursion", "strike-force", "onslaught"],
      properties: { incursion: { type: "integer", minimum: 1 }, "strike-force": { type: "integer", minimum: 1 }, onslaught: { type: "integer", minimum: 1 } },
      additionalProperties: false,
    },
    normalize: (input) => {
      exactKeys(input, ["incursion", "strike-force", "onslaught"], "count-by-battle-size");
      return {
        incursion: boundedInteger(input.incursion, 1, 20, "count-by-battle-size.incursion"),
        "strike-force": boundedInteger(input["strike-force"], 1, 20, "count-by-battle-size.strike-force"),
        onslaught: boundedInteger(input.onslaught, 1, 20, "count-by-battle-size.onslaught"),
      };
    },
  },
  {
    id: "count-by-battle-round",
    version: 1,
    role: "RESTRICTION",
    label: "How many, by battle round",
    description: "\"Select a number of units equal to or less than the current battle round number\": the most units the selection before it can take is the current battle round number.",
    starter: {},
    parameterSchema: EMPTY_SCHEMA,
    normalize: (input) => { exactKeys(input, [], "count-by-battle-round"); return {}; },
  },
  {
    id: "with-embarked-units",
    version: 1,
    role: "COMBINATOR",
    label: "And the units embarked within it",
    description: "\"That unit (and any units embarked within that unit): …\": every effect after this leaf in its fragment also applies to the units embarked within the unit it names.",
    starter: {},
    parameterSchema: EMPTY_SCHEMA,
    normalize: (input) => { exactKeys(input, [], "with-embarked-units"); return {}; },
  },
  {
    id: "stance-initial",
    version: 1,
    role: "COMBINATOR",
    label: "The stance in force from the start",
    description: "\"At the start of the battle, … that unit enters Aegis Protocols (see below)\": the named option (option_id, as its named-option leaf gives it) of the stance-select-open after this leaf is in force from the start of the battle, before any selection.",
    starter: { option_id: "" },
    parameterSchema: { type: "object", required: ["option_id"], properties: { option_id: { type: "string", pattern: KEBAB_ID_PATTERN } }, additionalProperties: false },
    normalize: (input) => {
      exactKeys(input, ["option_id"], "stance-initial");
      if (typeof input.option_id !== "string" || !KEBAB_ID.test(input.option_id)) throw new TypeError("stance-initial.option_id is the option's kebab-case id.");
      return { option_id: input.option_id };
    },
  },
  {
    id: "pick-exclusion",
    version: 1,
    role: "COMBINATOR",
    label: "An option the pick cannot take",
    description: "\"You cannot select the same Hyper-adaptation you selected at the start of the first battle round\": the player's pick an ability-activate names (chosen) cannot take the option active for your army (excluding army-active), a selection made once and fixed for the battle.",
    starter: { excluding: "army-active" },
    parameterSchema: { type: "object", required: ["excluding"], properties: { excluding: { const: "army-active" } }, additionalProperties: false },
    normalize: (input) => {
      exactKeys(input, ["excluding"], "pick-exclusion");
      if (input.excluding !== "army-active") throw new TypeError("pick-exclusion.excluding is army-active.");
      return { excluding: "army-active" };
    },
  },
  {
    id: "instead",
    version: 2,
    role: "COMBINATOR",
    label: "Instead",
    description: "The effect in this clause replaces an earlier effect of the same kind when this clause's condition holds; it does not add to it. With choice: true, on \"Or:\" between two effects of the same kind, the player picks one of them (each under its own conditions) instead.",
    starter: {},
    parameterSchema: { type: "object", properties: { choice: { const: true, "x-optional": true } }, additionalProperties: false },
    normalize: (input) => {
      const { choice, ...rest } = input;
      exactKeys(rest, [], "instead");
      if (choice === undefined) return {};
      if (choice !== true) throw new TypeError("instead.choice must be true, or omitted.");
      return { choice: true };
    },
  },
];
