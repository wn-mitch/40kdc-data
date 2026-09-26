import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, enumValue, exactKeys } from "./family-validation.js";

/**
 * Restrictions: who may use an ability, in which phases, and how often. How often compiles to
 * the entry's `usage`. Which phases (a stratagem's WHEN) and which bearer (an enhancement's
 * "<KEYWORD> model only") are already recorded on the core stratagem and enhancement records
 * from the Munitorum dump, so those leaves compile to nothing and are checked against core
 * instead; a disagreement blocks approval rather than writing a second source of truth.
 */

export const USAGE_FREQUENCIES = ["once-per-battle", "once-per-battle-round", "once-per-turn", "once-per-phase", "once-per-opponent-turn"] as const;
export const USAGE_PER = ["any", "army", "unit", "model"] as const;
export const WINDOW_PHASES = ["command", "movement", "shooting", "charge", "fight"] as const;
export const KEYWORD_MATCH = ["all", "any"] as const;

/** A unit keyword as the DSL writes it: uppercase words, without markdown emphasis. */
const UNIT_KEYWORD = /^[A-Z][A-Z0-9' -]*[A-Z0-9]$/u;

const phaseSet = { type: "array", items: { enum: WINDOW_PHASES }, minItems: 0, uniqueItems: true } as const;

export const OPTIONAL_USERS = ["you", "bearer", "this-unit", "this-model"] as const;
export const TARGET_COUNTS = ["one", "one-or-more", "up-to"] as const;
export const TARGET_SIDES = ["your-army", "enemy"] as const;
export const TARGET_SELECTS = ["unit", "model"] as const;
export const TARGET_BINDINGS = ["triggering-unit", "attacked-unit"] as const;

const keywordList = { type: "array", items: { type: "string", pattern: UNIT_KEYWORD.source }, minItems: 0, uniqueItems: true } as const;

export const RESTRICTION_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "stratagem-target",
    version: 1,
    role: "RESTRICTION",
    label: "Stratagem target",
    description: "A stratagem's TARGET: how many, whose, unit or model, and the keywords it must have (all of them, or any one) and must not have. Qualifiers such as \"that has not been selected to shoot this phase\" are their own condition leaves in the TARGET.",
    starter: { count: "", side: "", selects: "", keywords: [], match: "", excluded_keywords: [] },
    parameterSchema: {
      type: "object",
      required: ["count", "side", "selects", "keywords", "match", "excluded_keywords"],
      properties: {
        count: { enum: TARGET_COUNTS },
        count_max: { type: "integer", minimum: 2, maximum: 10, "x-only-when": { count: ["up-to"] } },
        side: { enum: TARGET_SIDES },
        selects: { enum: TARGET_SELECTS },
        keywords: keywordList,
        match: { enum: KEYWORD_MATCH },
        excluded_keywords: keywordList,
      },
      additionalProperties: false,
    },
  },
  {
    id: "target-binding",
    version: 1,
    role: "RESTRICTION",
    label: "Target is the unit that acted or was attacked",
    description: "\"That was selected as the target of one or more of the attacking unit's attacks\": the target is the unit the triggering enemy attacked, not a free choice.",
    starter: { bound_to: "" },
    parameterSchema: { type: "object", required: ["bound_to"], properties: { bound_to: { enum: TARGET_BINDINGS } }, additionalProperties: false },
  },
  {
    id: "triggering-target",
    version: 1,
    role: "RESTRICTION",
    label: "Target is that unit",
    description: "\"That X unit\": the target is the unit the WHEN moment names. Its keywords narrow the trigger too.",
    starter: { selects: "", keywords: [], match: "" },
    parameterSchema: {
      type: "object",
      required: ["selects", "keywords", "match"],
      properties: { selects: { enum: TARGET_SELECTS }, keywords: keywordList, match: { enum: KEYWORD_MATCH } },
      additionalProperties: false,
    },
  },
  {
    id: "optional-use",
    version: 1,
    role: "RESTRICTION",
    label: "Used by choice",
    description: "\"You can use this ability\" or \"the bearer can use this Enhancement\": the player chooses whether it happens. With an event it becomes an optional trigger; without one, the ability is activated.",
    starter: { who: "" },
    parameterSchema: {
      type: "object",
      required: ["who"],
      properties: { who: { enum: OPTIONAL_USERS } },
      additionalProperties: false,
    },
  },
  {
    id: "usage-limit",
    version: 1,
    role: "RESTRICTION",
    label: "How often it can be used",
    description: "Once per battle, battle round, turn or phase, optionally counted per army, unit or model.",
    starter: { frequency: "", per: "" },
    parameterSchema: {
      type: "object",
      required: ["frequency", "per"],
      properties: { frequency: { enum: USAGE_FREQUENCIES }, per: { enum: USAGE_PER } },
      additionalProperties: false,
    },
  },
  {
    id: "use-window",
    version: 1,
    role: "RESTRICTION",
    label: "Phases it can be used in",
    description: "A stratagem's WHEN: the phases it can be used in, and whose turn each belongs to. \"Your opponent's Shooting phase or the Fight phase\" is opponent Shooting plus either player's Fight. Checked against the core stratagem record, not written again.",
    starter: { your_phases: [], opponent_phases: [], either_phases: [] },
    parameterSchema: {
      type: "object",
      required: ["your_phases", "opponent_phases", "either_phases"],
      properties: { your_phases: phaseSet, opponent_phases: phaseSet, either_phases: phaseSet },
      additionalProperties: false,
    },
  },
  {
    id: "bearer-eligibility",
    version: 1,
    role: "RESTRICTION",
    label: "Which models can take it",
    description: "An enhancement's \"<KEYWORD> model only\": every keyword, or any one of them (\"CANONESS, PALATINE or MINISTORUM PRIEST\"). Checked against the core enhancement record, not written again.",
    starter: { keywords: [], match: "" },
    parameterSchema: {
      type: "object",
      required: ["keywords", "match"],
      properties: {
        keywords: { type: "array", items: { type: "string", pattern: UNIT_KEYWORD.source }, minItems: 1, uniqueItems: true },
        match: { enum: KEYWORD_MATCH },
      },
      additionalProperties: false,
    },
  },
];

function phases(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must list phases.`);
  for (const item of value) enumValue(item, WINDOW_PHASES, label);
  if (new Set(value).size !== value.length) throw new TypeError(`${label} lists a phase twice.`);
  return WINDOW_PHASES.filter((phase) => value.includes(phase));
}

function keywords(value: unknown, label = "bearer-eligibility.keywords", allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new TypeError(`${label} must list at least one keyword.`);
  const list = value.map((item) => {
    const keyword = String(item).replaceAll("*", "").replace(/\s+/gu, " ").trim().toUpperCase();
    if (!UNIT_KEYWORD.test(keyword)) throw new TypeError(`${label} keyword ${JSON.stringify(item)} is not a unit keyword.`);
    return keyword;
  });
  if (new Set(list).size !== list.length) throw new TypeError(`${label} lists a keyword twice.`);
  return list.sort();
}

export function normalizeRestrictionParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  switch (family) {
    case "stratagem-target": {
      const count = enumValue(input.count, TARGET_COUNTS, "stratagem-target.count");
      exactKeys(input, count === "up-to" ? ["count", "count_max", "side", "selects", "keywords", "match", "excluded_keywords"] : ["count", "side", "selects", "keywords", "match", "excluded_keywords"], family);
      return {
        count,
        ...(count === "up-to" ? { count_max: boundedInteger(input.count_max, 2, 10, "stratagem-target.count_max") } : {}),
        side: enumValue(input.side, TARGET_SIDES, "stratagem-target.side"),
        selects: enumValue(input.selects, TARGET_SELECTS, "stratagem-target.selects"),
        keywords: keywords(input.keywords, "stratagem-target.keywords", true),
        match: enumValue(input.match, KEYWORD_MATCH, "stratagem-target.match"),
        excluded_keywords: keywords(input.excluded_keywords, "stratagem-target.excluded_keywords", true),
      };
    }
    case "target-binding":
      exactKeys(input, ["bound_to"], family);
      return { bound_to: enumValue(input.bound_to, TARGET_BINDINGS, "target-binding.bound_to") };
    case "triggering-target":
      exactKeys(input, ["selects", "keywords", "match"], family);
      return {
        selects: enumValue(input.selects, TARGET_SELECTS, "triggering-target.selects"),
        keywords: keywords(input.keywords, "triggering-target.keywords", true),
        match: enumValue(input.match, KEYWORD_MATCH, "triggering-target.match"),
      };
    case "optional-use":
      exactKeys(input, ["who"], family);
      return { who: enumValue(input.who, OPTIONAL_USERS, "optional-use.who") };
    case "usage-limit":
      exactKeys(input, ["frequency", "per"], family);
      return { frequency: enumValue(input.frequency, USAGE_FREQUENCIES, "usage-limit.frequency"), per: enumValue(input.per, USAGE_PER, "usage-limit.per") };
    case "use-window": {
      exactKeys(input, ["your_phases", "opponent_phases", "either_phases"], family);
      const window = {
        your_phases: phases(input.your_phases, "use-window.your_phases"),
        opponent_phases: phases(input.opponent_phases, "use-window.opponent_phases"),
        either_phases: phases(input.either_phases, "use-window.either_phases"),
      };
      const all = [...window.your_phases, ...window.opponent_phases, ...window.either_phases];
      if (all.length === 0) throw new TypeError("use-window must name at least one phase.");
      if (new Set(all).size !== all.length) throw new TypeError("use-window names a phase under two owners; a phase in either player's turn belongs only under either.");
      return window;
    }
    case "bearer-eligibility":
      exactKeys(input, ["keywords", "match"], family);
      return { keywords: keywords(input.keywords), match: enumValue(input.match, KEYWORD_MATCH, "bearer-eligibility.match") };
    default:
      return null;
  }
}

/** The entry's usage for a usage-limit leaf, in the DSL's spelling. */
export function usageFor(parameters: Record<string, unknown>): Record<string, unknown> {
  const frequency = parameters.frequency === "once-per-battle" ? { frequency: "n-per-battle", count: 1 } : { frequency: parameters.frequency };
  return { ...frequency, ...(parameters.per !== "any" ? { per: parameters.per } : {}) };
}

/** What core must say for a use-window: the same phases, and one turn when every phase has one owner. */
export function expectedWindow(parameters: Record<string, unknown>): { phases: string[]; player_turn: string } {
  const your = parameters.your_phases as string[];
  const opponent = parameters.opponent_phases as string[];
  const either = parameters.either_phases as string[];
  const phases = WINDOW_PHASES.filter((phase) => [...your, ...opponent, ...either].includes(phase));
  const player_turn = either.length === 0 && opponent.length === 0 ? "your-turn" : either.length === 0 && your.length === 0 ? "opponent-turn" : "either";
  return { phases, player_turn };
}
