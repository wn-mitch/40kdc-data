import { ANTECEDENT } from "../antecedent-families.js";
import { foldName } from "./vocabulary.js";
import { boundedInteger, enumValue, exactKeys } from "../family-validation.js";
import type { FlatFamily } from "./types.js";
import {
  type Params, ENTITY_ID, WINDOW_PHASES, PHASE_SET_SCHEMA, PRINTED_KEYWORD_PATTERN, PrintedKeywords, keywordList,
} from "./restrictions-and-predicates-shared.js";

/** Restriction families: who may use an ability, when and how often, and what a Stratagem targets. */

function kebabIds(value: unknown, label: string, what: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((id) => typeof id !== "string" || !ENTITY_ID.test(id))) {
    throw new TypeError(`${label} lists ${what} in kebab case.`);
  }
  if (new Set(value).size !== value.length) throw new TypeError(`${label} names an id twice.`);
  return [...value as string[]].sort();
}

const KEYWORD_MATCH = ["all", "any"] as const;
const TARGET_SELECTS = ["unit", "model"] as const;

function normalizeTargetBinding(input: Params): Params {
  exactKeys(input, ["bound_to"], "target-binding");
  return { bound_to: enumValue(input.bound_to, ["triggering-unit", "attacked-unit"], "target-binding.bound_to") };
}

function normalizeOptionalUse(input: Params): Params {
  exactKeys(input, ["who"], "optional-use");
  return { who: enumValue(input.who, ["you", "this-unit", "this-model"], "optional-use.who") };
}

const USAGE_PER = ["any", "army", "unit", "model"] as const;

function normalizeUsageScope(input: Params): Params {
  exactKeys(input, ["per"], "usage-scope");
  return { per: enumValue(input.per, USAGE_PER, "usage-scope.per") };
}

const USAGE_FREQUENCIES = [
  "once-per-battle", "once-per-battle-round", "once-per-turn", "once-per-phase", "once-per-opponent-turn", "once-per-command-phase",
  "first-this-battle", "first-time-this-phase", "twice-per-battle", "first-time-this-turn",
] as const;

function normalizeUsageLimit(input: Params): Params {
  const scoped = "per" in input;
  exactKeys(input, scoped ? ["frequency", "per"] : ["frequency"], "usage-limit");
  return {
    frequency: enumValue(input.frequency, USAGE_FREQUENCIES, "usage-limit.frequency"),
    ...(scoped ? { per: enumValue(input.per, [...USAGE_PER, "selected-unit"], "usage-limit.per") } : {}),
  };
}

function phases(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must list phases.`);
  for (const item of value) enumValue(item, WINDOW_PHASES, label);
  if (new Set(value).size !== value.length) throw new TypeError(`${label} lists a phase twice.`);
  return WINDOW_PHASES.filter((phase) => value.includes(phase));
}

/** use-window and activation-window: each phase under exactly one owner. */
function phaseWindow(family: string, input: Params): Params {
  exactKeys(input, ["your_phases", "opponent_phases", "either_phases"], family);
  const window = {
    your_phases: phases(input.your_phases, `${family}.your_phases`),
    opponent_phases: phases(input.opponent_phases, `${family}.opponent_phases`),
    either_phases: phases(input.either_phases, `${family}.either_phases`),
  };
  const all = [...window.your_phases, ...window.opponent_phases, ...window.either_phases];
  if (all.length === 0) throw new TypeError(`${family} must name at least one phase.`);
  if (new Set(all).size !== all.length) throw new TypeError(`${family} names a phase under two owners; a phase in either player's turn belongs only under either.`);
  return window;
}

const normalizeUseWindow = (input: Params) => phaseWindow("use-window", input);
const normalizeActivationWindow = (input: Params) => phaseWindow("activation-window", input);

function normalizeChosenOptionGrant(input: Params): Params {
  exactKeys(input, ["holder"], "chosen-option-grant");
  return { holder: enumValue(input.holder, ["this-model", "this-unit", ANTECEDENT], "chosen-option-grant.holder") };
}

function normalizeTriggeringTarget(input: Params): Params {
  const family = "triggering-target";
  // unit_names are datasheet names, not keywords: they take no accented-keyword spelling.
  const spelling = new PrintedKeywords(family, input, ["unit_names"]);
  const { any_keywords: anyKeywords, unit_names: names, ...rest } = input;
  let unitNames: string[] | undefined;
  if (names !== undefined) {
    if (rest.level === "model" || (rest.selects !== undefined && rest.selects !== "unit")) throw new TypeError(`${family}.unit_names identifies units, not models.`);
    const bare = spelling.bare(names, false);
    if (!Array.isArray(bare) || bare.length === 0 || bare.some((name) => typeof name !== "string" || !name.trim())) {
      throw new TypeError(`${family}.unit_names must list exact nonblank datasheet names.`);
    }
    const normalized = (bare as string[]).map((name) => name.replaceAll("*", "").replace(/\s+/gu, " ").trim());
    if (new Set(normalized.map(foldName)).size !== normalized.length) throw new TypeError(`${family}.unit_names repeats a datasheet name.`);
    unitNames = normalized.sort().map((name) => spelling.printed(name, false));
  }
  exactKeys(rest, ["selects", "keywords", "match"], family);
  const match = enumValue(rest.match, KEYWORD_MATCH, `${family}.match`);
  const result: Params = {
    selects: enumValue(rest.selects, TARGET_SELECTS, `${family}.selects`),
    keywords: keywordList(spelling.bare(rest.keywords), `${family}.keywords`, 0).map((keyword) => spelling.printed(keyword)),
    match,
  };
  if (anyKeywords !== undefined) {
    if (match === "any") throw new TypeError("triggering-target any_keywords adds to all-of keywords; match must be all.");
    result.any_keywords = keywordList(spelling.bare(anyKeywords), "triggering-target any_keywords", 2).map((keyword) => spelling.printed(keyword));
  }
  if (unitNames !== undefined) result.unit_names = unitNames;
  return spelling.finish(result);
}

function normalizeBearerEligibility(input: Params): Params {
  const family = "bearer-eligibility";
  const spelling = new PrintedKeywords(family, input);
  const { any_keywords: anyKeywords, datasheets, abilities, or_datasheets: orDatasheets, ...rest } = input;
  if (orDatasheets !== undefined && datasheets !== undefined) {
    throw new TypeError("bearer-eligibility names datasheets that narrow its keywords or or_datasheets that add to them, not both.");
  }
  exactKeys(rest, ["keywords", "match", "excluded_keywords"], family);
  const keywords = keywordList(spelling.bare(rest.keywords), "bearer-eligibility.keywords", 1);
  const match = enumValue(rest.match, KEYWORD_MATCH, "bearer-eligibility.match");
  const excluded = keywordList(spelling.bare(rest.excluded_keywords), "bearer-eligibility.excluded_keywords", 0);
  const result: Params = {};
  if (anyKeywords !== undefined) {
    if (match !== "all") throw new TypeError("bearer-eligibility.any_keywords adds one-of keywords to keywords all must have; match must be all.");
    const any = keywordList(spelling.bare(anyKeywords), "bearer-eligibility.any_keywords", 2);
    if (any.some((keyword) => keywords.includes(keyword))) throw new TypeError("bearer-eligibility names a keyword both as required and as one of several.");
    result.any_keywords = any.map((keyword) => spelling.printed(keyword));
  }
  if (datasheets !== undefined) result.datasheets = kebabIds(datasheets, "bearer-eligibility.datasheets", "core unit ids");
  if (abilities !== undefined) result.abilities = kebabIds(abilities, "bearer-eligibility.abilities", "core ability ids");
  if (orDatasheets !== undefined) {
    const list = kebabIds(orDatasheets, "bearer-eligibility.or_datasheets", "core unit ids");
    if (match !== "all" || anyKeywords !== undefined) {
      throw new TypeError("bearer-eligibility.or_datasheets adds datasheets to keywords all must have; match must be all, with no any_keywords.");
    }
    result.or_datasheets = list;
  }
  return spelling.finish({
    keywords: keywords.map((keyword) => spelling.printed(keyword)),
    match,
    excluded_keywords: excluded.map((keyword) => spelling.printed(keyword)),
    ...result,
  });
}

const TARGET_COUNTS = ["one", "one-or-more", "up-to", "exactly"] as const;

function normalizeStratagemTarget(input: Params): Params {
  const family = "stratagem-target";
  const spelling = new PrintedKeywords(family, input);
  const count = enumValue(input.count, TARGET_COUNTS, "stratagem-target.count");
  if (count !== "exactly" && "count_exact" in input) throw new TypeError("stratagem-target.count_exact needs count exactly.");
  const ranged = count === "up-to" ? ["count_max"] : count === "exactly" ? ["count_exact"] : [];
  const counted: Params = {
    count,
    ...(count === "up-to" ? { count_max: boundedInteger(input.count_max, 1, 10, "stratagem-target.count_max") } : {}),
    ...(count === "exactly" ? { count_exact: boundedInteger(input.count_exact, 2, 10, "stratagem-target.count_exact") } : {}),
  };
  // Without side, the leaf is only the count; the unit-filter after it names whose units and which keywords.
  if (!("side" in input)) {
    exactKeys(input, ["count", ...ranged], family);
    return spelling.finish(counted);
  }
  exactKeys(input, ["count", ...ranged, "side", "selects", "keywords", "match", "excluded_keywords"], family);
  return spelling.finish({
    ...counted,
    side: enumValue(input.side, ["your-army", "enemy"], "stratagem-target.side"),
    selects: enumValue(input.selects, TARGET_SELECTS, "stratagem-target.selects"),
    keywords: keywordList(spelling.bare(input.keywords), "stratagem-target.keywords", 0).map((keyword) => spelling.printed(keyword)),
    match: enumValue(input.match, KEYWORD_MATCH, "stratagem-target.match"),
    excluded_keywords: keywordList(spelling.bare(input.excluded_keywords), "stratagem-target.excluded_keywords", 0).map((keyword) => spelling.printed(keyword)),
  });
}


export const RESTRICTIONS_FAMILIES: readonly FlatFamily[] = [
  {
    id: "target-binding",
    version: 1,
    role: "RESTRICTION",
    label: "Target is the unit that acted or was attacked",
    description: "\"That was selected as the target of one or more of the attacking unit's attacks\": the target is the unit the triggering enemy attacked, not a free choice.",
    starter: { bound_to: "" },
    parameterSchema: {
      type: "object", required: ["bound_to"], additionalProperties: false,
      properties: {
        bound_to: { enum: ["triggering-unit", "attacked-unit"] },
      },
    },
    normalize: normalizeTargetBinding,
  },
  {
    id: "optional-use",
    version: 2,
    role: "RESTRICTION",
    label: "Used by choice",
    description: "\"You can use this ability\" or \"the bearer can use this Enhancement\": the player chooses whether it happens. With an event it becomes an optional trigger; without one, the ability is activated. \"The bearer\" is this model.",
    starter: { who: "" },
    parameterSchema: {
      type: "object", required: ["who"], additionalProperties: false,
      properties: {
        who: { enum: ["you", "this-unit", "this-model"] },
      },
    },
    normalize: normalizeOptionalUse,
  },
  {
    id: "usage-scope",
    version: 1,
    role: "RESTRICTION",
    label: "Usage allowance ownership",
    description: "Qualifies an ability's usage allowance as counted per army, unit or model; any explicitly leaves entity granularity unspecified. It supplies no frequency. A restriction on repeatedly selecting or affecting a target is not the ability's usage ownership.",
    starter: { per: "" },
    parameterSchema: {
      type: "object", required: ["per"], additionalProperties: false,
      properties: {
        per: { enum: ["any", "army", "unit", "model"] },
      },
    },
    normalize: normalizeUsageScope,
  },
  {
    id: "activation-window",
    version: 1,
    role: "RESTRICTION",
    kinds: ["unit", "enhancement", "detachment", "faction", "core"],
    label: "Phases it can be used in (non-Stratagem)",
    description: "A non-Stratagem ability's own phase restriction: the phases it can be used in, and whose turn each belongs to (\"in the Fight phase\", \"your opponent's Shooting phase\"). Same shape as use-window, for abilities with no core stratagem record to check it against instead.",
    starter: { your_phases: [], opponent_phases: [], either_phases: [] },
    parameterSchema: {
      type: "object", required: ["your_phases", "opponent_phases", "either_phases"], additionalProperties: false,
      properties: {
        your_phases: PHASE_SET_SCHEMA,
        opponent_phases: PHASE_SET_SCHEMA,
        either_phases: PHASE_SET_SCHEMA,
      },
    },
    normalize: normalizeActivationWindow,
  },
  {
    id: "chosen-option-grant",
    version: 2,
    role: "RESTRICTION",
    label: "Holder of the chosen options",
    description: "\"This model has that ability\" / \"has those abilities\" after a menu (\"select one of the abilities in the X section\"): the options chosen from that menu apply, held by this model, this unit, or (antecedent) the unit an earlier leaf introduced (\"that unit has that ability\"). It adds no effect of its own; a record with no menu opener before it cannot compile.",
    starter: { holder: "" },
    parameterSchema: {
      type: "object", required: ["holder"], additionalProperties: false,
      properties: {
        holder: { enum: ["this-model", "this-unit", "antecedent"] },
      },
    },
    normalize: normalizeChosenOptionGrant,
  },
  {
    id: "triggering-target",
    version: 6,
    role: "RESTRICTION",
    label: "Target is that unit",
    description: "\"That X unit\": the target is the unit the WHEN moment names. Its keywords narrow the trigger too. any_keywords: the unit also has at least one of these (a shared prefix before a slash list, with match all). unit_names: exact named unit datasheets, resolved within the owning faction to stable unit IDs; these are unit-level identities, not keywords or model names, so selects is unit. A keyword in keywords or any_keywords can carry accented capitals as the rules print it (KÂHL), and any keyword can start with an apostrophe ('ARDMOB).",
    starter: { selects: "", keywords: [], match: "" },
    parameterSchema: {
      type: "object", required: ["selects", "keywords", "match"], additionalProperties: false,
      properties: {
        selects: { enum: ["unit", "model"] },
        keywords: { type: "array", items: { type: "string", pattern: PRINTED_KEYWORD_PATTERN }, minItems: 0, uniqueItems: true },
        match: { enum: ["all", "any"] },
        any_keywords: { type: "array", items: { type: "string", pattern: PRINTED_KEYWORD_PATTERN }, minItems: 2, uniqueItems: true, "x-optional": true },
        unit_names: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 }, "x-optional": true },
      },
    },
    normalize: normalizeTriggeringTarget,
  },
  {
    id: "bearer-eligibility",
    version: 8,
    role: "RESTRICTION",
    kinds: ["enhancement"],
    label: "Which models can take it",
    description: "An enhancement's \"<KEYWORD> model only\": every keyword, or any one of them (\"CANONESS, PALATINE or MINISTORUM PRIEST\"), and the models it excludes (\"(excluding CYBERNETICA DATASMITH models)\"). any_keywords: the bearer has every keyword and at least one of these (\"ADEPTUS ASTARTES INFANTRY/MOUNTED model only\" is ADEPTUS ASTARTES plus INFANTRY or MOUNTED; match all). datasheets: the bearer is a model of one of these datasheets, by core unit id (\"Tzaangor Shaman model only\" when the restriction names the Tzaangor Shaman datasheet, not every unit with its keyword); the keywords still record what the source prints. or_datasheets: the bearer has every keyword, or is a model of one of these datasheets (match all, with no datasheets and no any_keywords). abilities: core abilities the bearer's datasheet must have, by core ability id (\"HERETIC ASTARTES model with the Deep Strike ability only\" is HERETIC ASTARTES plus deep-strike), checked against the core enhancement's required_ability_ids. A keyword can carry accented capitals (KÂHL) or start with an apostrophe ('ARDMOB) as the rules print it. Checked against the core enhancement record, not written again.",
    starter: { keywords: [], match: "", excluded_keywords: [] },
    parameterSchema: {
      type: "object", required: ["keywords", "match", "excluded_keywords"], additionalProperties: false,
      properties: {
        keywords: { type: "array", items: { type: "string", pattern: PRINTED_KEYWORD_PATTERN }, minItems: 1, uniqueItems: true },
        match: { enum: ["all", "any"] },
        excluded_keywords: { type: "array", items: { type: "string", pattern: PRINTED_KEYWORD_PATTERN }, uniqueItems: true },
        any_keywords: { type: "array", items: { type: "string", pattern: PRINTED_KEYWORD_PATTERN }, minItems: 2, uniqueItems: true, "x-optional": true },
        datasheets: { type: "array", items: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$" }, minItems: 1, uniqueItems: true, "x-optional": true },
        abilities: { type: "array", items: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$" }, minItems: 1, uniqueItems: true, "x-optional": true },
        or_datasheets: { type: "array", items: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$" }, minItems: 1, uniqueItems: true, "x-optional": true },
      },
    },
    normalize: normalizeBearerEligibility,
  },
  {
    id: "usage-limit",
    version: 6,
    role: "RESTRICTION",
    label: "Usage frequency",
    description: "A frequency qualifier: once per battle, battle round, turn, phase, opponent's turn or Command phase, twice per battle, or the first time this battle, this phase or each turn. It is independent of army, unit or model ownership: the optional per field records a reviewed binding; otherwise a separate usage-scope leaf supplies it. Frequency alone does not choose an allowance owner. per selected-unit counts the frequency for each unit the ability's one unit selection chooses, across every bearer; it lowers to that selection's selection_limit, not to the ability's usage.",
    starter: { frequency: "" },
    parameterSchema: {
      type: "object", required: ["frequency"], additionalProperties: false,
      properties: {
        frequency: { enum: ["once-per-battle", "once-per-battle-round", "once-per-turn", "once-per-phase", "once-per-opponent-turn", "once-per-command-phase", "first-this-battle", "first-time-this-phase", "twice-per-battle", "first-time-this-turn"] },
        per: { enum: ["any", "army", "unit", "model", "selected-unit"] },
      },
    },
    normalize: normalizeUsageLimit,
  },
  {
    id: "stratagem-target",
    version: 6,
    role: "RESTRICTION",
    kinds: ["stratagem"],
    label: "Stratagem target",
    description: "A stratagem's TARGET: how many (one, one or more, up to count_max of 1-10 (\"Up to one\": zero or one unit), or exactly count_exact of 2-10, each meeting the same restrictions: \"Two **X** units\"), whose, unit or model, and the keywords it must have (all of them, or any one) and must not have. side, selects, keywords, match and excluded_keywords are given together or all left out; left out, the leaf is only the count (\"One\", \"Up to two\") and the unit-filter right after it says whose units and which keywords. A keyword can carry accented capitals (KÂHL) or start with an apostrophe ('ARDMOB) as the rules print it. Qualifiers such as \"that has not been selected to shoot this phase\" are their own condition leaves in the TARGET.",
    starter: { count: "" },
    parameterSchema: {
      type: "object", required: ["count"], additionalProperties: false,
      properties: {
        count: { enum: ["one", "one-or-more", "up-to", "exactly"] },
        count_max: { type: "integer", minimum: 1, maximum: 10, "x-only-when": { count: ["up-to"] } },
        side: { enum: ["your-army", "enemy"] },
        selects: { enum: ["unit", "model"] },
        keywords: { type: "array", items: { type: "string", pattern: PRINTED_KEYWORD_PATTERN }, minItems: 0, uniqueItems: true },
        match: { enum: ["all", "any"] },
        excluded_keywords: { type: "array", items: { type: "string", pattern: PRINTED_KEYWORD_PATTERN }, minItems: 0, uniqueItems: true },
        count_exact: { type: "integer", minimum: 2, maximum: 10, "x-only-when": { count: ["exactly"] } },
      },
    },
    normalize: normalizeStratagemTarget,
  },
  {
    id: "use-window",
    version: 1,
    role: "RESTRICTION",
    kinds: ["stratagem"],
    label: "Phases it can be used in",
    description: "A stratagem's WHEN: the phases it can be used in, and whose turn each belongs to. \"Your opponent's Shooting phase or the Fight phase\" is opponent Shooting plus either player's Fight. Checked against the core stratagem record, not written again.",
    starter: { your_phases: [], opponent_phases: [], either_phases: [] },
    parameterSchema: {
      type: "object", required: ["your_phases", "opponent_phases", "either_phases"], additionalProperties: false,
      properties: {
        your_phases: PHASE_SET_SCHEMA,
        opponent_phases: PHASE_SET_SCHEMA,
        either_phases: PHASE_SET_SCHEMA,
      },
    },
    normalize: normalizeUseWindow,
  },
];
