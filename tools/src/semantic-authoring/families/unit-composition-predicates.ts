import { ANTECEDENT } from "../antecedent-families.js";
import { boundedInteger, enumValue, exactKeys } from "../family-validation.js";
import type { FlatFamily } from "./types.js";
import {
  type Params, SUBJECT_REF, SUBJECTS_OR_ANTECEDENT, FOLLOWING_FILTER, ENTITY_ID, UNIT_KEYWORD,
  PRINTED_KEYWORD_PATTERN, trueFlag, negation, subjectOf, present, PrintedKeywords, keywordList, OWNERS,
} from "./restrictions-and-predicates-shared.js";

/** Unit composition and mission-card predicates. */

const AT_TIMES = ["now", "opponents-previous-turn-end"] as const;
const ELIGIBLE_TO = ["shoot", "declare-charge", "fight", "start-action", "be-selected"] as const;
const EMBARK_WITHIN = "embark-within";

function normalizeModelProfile(input: Params): Params {
  const negated = negation(input, "model-profile");
  const subject = subjectOf(input);
  exactKeys(input, [...present(input, ["subject"]), "profile", ...present(input, ["negated"])], "model-profile");
  const profile = String(input.profile ?? "");
  if (!ENTITY_ID.test(profile)) throw new TypeError("model-profile.profile must be a kebab-case entity id.");
  return { ...subject, profile, ...negated };
}

function normalizeLoadout(input: Params): Params {
  const spelling = new PrintedKeywords("loadout", input);
  const negated = negation(input, "loadout");
  const subject = subjectOf(input);
  exactKeys(input, [...present(input, ["subject", "model_keyword"]), "uniform", ...present(input, ["negated"])], "loadout");
  const result: Params = { ...subject, uniform: enumValue(input.uniform, ["ranged", "melee"], "loadout.uniform") };
  if ("model_keyword" in input) {
    const keyword = String(spelling.bare(input.model_keyword) ?? "").toUpperCase();
    if (!UNIT_KEYWORD.test(keyword)) throw new TypeError("loadout.model_keyword must be a unit keyword.");
    result.model_keyword = spelling.printed(keyword);
  }
  return spelling.finish({ ...result, ...negated });
}

function normalizeEligible(input: Params): Params {
  const family = "eligible";
  const negated = negation(input, family);
  const subject = subjectOf(input, SUBJECTS_OR_ANTECEDENT);
  if (input.to === EMBARK_WITHIN) {
    // Embark eligibility: the Transport is named by transport, and the subject is a unit.
    if (!("transport" in input)) throw new TypeError("eligible to embark-within names the Transport in transport.");
    if (input.subject === "this-model" || input.subject === "model-in-this-unit") throw new TypeError("eligible embark-within names units, not models.");
    if ("at" in input || "source_ability_id" in input || "source_ability_owner" in input) {
      throw new TypeError("eligible embark-within takes no at, source_ability_id or source_ability_owner.");
    }
    exactKeys(input, [...present(input, ["subject"]), "to", "transport", ...present(input, ["negated"])], family);
    return { ...subject, to: EMBARK_WITHIN, transport: enumValue(input.transport, ["this-unit", "ability-unit"], "eligible.transport"), ...negated };
  }
  if ("transport" in input) throw new TypeError("eligible.transport applies only to to: embark-within.");
  const to = enumValue(input.to, ELIGIBLE_TO, "eligible.to");
  const selection = to === "be-selected" ? present(input, ["source_ability_id", "source_ability_owner"]) : [];
  exactKeys(input, [...present(input, ["subject"]), "to", ...selection, ...present(input, ["at", "negated"])], family);
  const result: Params = { ...subject, to };
  if (selection.includes("source_ability_id")) {
    const abilityId = String(input.source_ability_id ?? "");
    if (!ENTITY_ID.test(abilityId)) throw new TypeError("eligible.source_ability_id must be a kebab-case entity id.");
    result.source_ability_id = abilityId;
  }
  if (selection.includes("source_ability_owner")) result.source_ability_owner = enumValue(input.source_ability_owner, OWNERS, "eligible.source_ability_owner");
  if ("at" in input) result.at = enumValue(input.at, AT_TIMES, "eligible.at");
  return { ...result, ...negated };
}

function normalizeResource(input: Params): Params {
  const negated = negation(input, "resource");
  exactKeys(input, ["pool", ...present(input, ["at_least", "at_most", "below_max", "source_ability_id", "source_ability_owner", "at", "gained_this_turn", "negated"])], "resource");
  if (!("at_least" in input) && !("at_most" in input) && !("below_max" in input)) throw new TypeError("resource needs at_least, at_most, or below_max.");
  const result: Params = { pool: String(input.pool ?? "") };
  if (!result.pool) throw new TypeError("resource.pool must be a nonempty string.");
  if ("at_least" in input) result.at_least = boundedInteger(input.at_least, 0, 999, "resource.at_least");
  if ("at_most" in input) result.at_most = boundedInteger(input.at_most, 0, 999, "resource.at_most");
  if ("below_max" in input) result.below_max = trueFlag(input.below_max, "resource.below_max");
  if ("source_ability_id" in input) {
    const abilityId = String(input.source_ability_id ?? "");
    if (!ENTITY_ID.test(abilityId)) throw new TypeError("resource.source_ability_id must be a kebab-case entity id.");
    result.source_ability_id = abilityId;
  }
  if ("source_ability_owner" in input) result.source_ability_owner = enumValue(input.source_ability_owner, OWNERS, "resource.source_ability_owner");
  if ("at" in input) result.at = enumValue(input.at, AT_TIMES, "resource.at");
  // "you gained fewer than 3YP this turn": the bounds read this turn's gains, not what the pool holds.
  if ("gained_this_turn" in input) {
    result.gained_this_turn = trueFlag(input.gained_this_turn, "resource.gained_this_turn");
    if ("below_max" in input || "at" in input) throw new TypeError("resource.gained_this_turn bounds this turn's gains with at_least or at_most; it takes no below_max or at.");
  }
  return { ...result, ...negated };
}

function normalizeOperationMarkers(input: Params): Params {
  const family = "operation-markers";
  const negated = negation(input, family);
  exactKeys(input, present(input, ["side", "count_min", "count_max", "friendly_unit_in_same_terrain_area", "no_enemy_in_terrain_area", "within_range_of", "negated"]), family);
  const result: Params = {};
  if ("side" in input) result.side = enumValue(input.side, ["friendly", "opponent"], "operation-markers.side");
  if ("count_min" in input) result.count_min = boundedInteger(input.count_min, 0, 20, "operation-markers.count_min");
  if ("count_max" in input) result.count_max = boundedInteger(input.count_max, 0, 20, "operation-markers.count_max");
  for (const flag of ["friendly_unit_in_same_terrain_area", "no_enemy_in_terrain_area"]) {
    if (flag in input) result[flag] = trueFlag(input[flag], `operation-markers.${flag}`);
  }
  if ("within_range_of" in input) result.within_range_of = enumValue(input.within_range_of, ["opponent-home-objective"], "operation-markers.within_range_of");
  return { ...result, ...negated };
}

function normalizeEngagementFronts(input: Params): Params {
  const negated = negation(input, "engagement-fronts");
  exactKeys(input, ["count_min", ...present(input, ["negated"])], "engagement-fronts");
  return { count_min: boundedInteger(input.count_min, 0, 6, "engagement-fronts.count_min"), ...negated };
}

function normalizeDestroyedWhileOnObjective(input: Params): Params {
  const family = "destroyed-while-on-objective";
  const negated = negation(input, family);
  const flags = ["destroyer_on_objective", "victim_on_objective", "victim_started_turn_on_objective"];
  exactKeys(input, present(input, ["count_min", "objective_role", ...flags, "negated"]), family);
  const result: Params = {};
  if ("count_min" in input) result.count_min = boundedInteger(input.count_min, 0, 20, `${family}.count_min`);
  if ("objective_role" in input) result.objective_role = enumValue(input.objective_role, ["central", "expansion"], `${family}.objective_role`);
  for (const flag of flags) if (flag in input) result[flag] = trueFlag(input[flag], `${family}.${flag}`);
  return { ...result, ...negated };
}

function normalizeDestroyedInTaggedTerrain(input: Params): Params {
  const family = "destroyed-in-tagged-terrain";
  const negated = negation(input, family);
  exactKeys(input, present(input, ["count_min", "tag", "at_start_of_turn", "negated"]), family);
  const result: Params = {};
  if ("count_min" in input) result.count_min = boundedInteger(input.count_min, 0, 20, `${family}.count_min`);
  if ("tag" in input) {
    const tag = String(input.tag ?? "");
    if (!tag) throw new TypeError(`${family}.tag must be a nonempty string.`);
    result.tag = tag;
  }
  if ("at_start_of_turn" in input) result.at_start_of_turn = trueFlag(input.at_start_of_turn, `${family}.at_start_of_turn`);
  return { ...result, ...negated };
}

function normalizeArmyIncludes(input: Params): Params {
  const allowed = ["quantifier", "with", "keywords", "any_keywords", "level", "min"];
  const stray = Object.keys(input).filter((key) => !allowed.includes(key));
  if (stray.length) throw new TypeError(`army-includes has no parameter ${stray[0]}.`);
  const quantifier = enumValue(input.quantifier, ["some", "every"], "army-includes.quantifier");
  if (quantifier === "some") {
    for (const key of ["keywords", "any_keywords", "level"]) if (key in input) throw new TypeError(`army-includes some names its units by the unit-filter after it, not ${key}.`);
    if (input.with !== FOLLOWING_FILTER) throw new TypeError("army-includes some names its units by with: following-filter.");
    return { quantifier, with: FOLLOWING_FILTER, ...(input.min !== undefined ? { min: boundedInteger(input.min, 2, 10, "army-includes.min") } : {}) };
  }
  if ("with" in input) throw new TypeError("army-includes every names its keyword inline, not by a following filter.");
  if ("min" in input) throw new TypeError("army-includes every counts every model; it takes no min.");
  if (input.level !== "model") throw new TypeError("army-includes every is about every model: level model.");
  const keywords = input.keywords === undefined ? undefined : keywordList(input.keywords, "army-includes.keywords", 1);
  const any = input.any_keywords === undefined ? undefined : keywordList(input.any_keywords, "army-includes.any_keywords", 2);
  if (keywords === undefined && any === undefined) throw new TypeError("army-includes every names keywords or any_keywords.");
  if (keywords !== undefined && any !== undefined) throw new TypeError("army-includes every names keywords or any_keywords, not both.");
  return { quantifier, level: "model", ...(keywords ? { keywords } : {}), ...(any ? { any_keywords: any } : {}) };
}


export const UNIT_COMPOSITION_PREDICATES_FAMILIES: readonly FlatFamily[] = [
  {
    id: "model-profile",
    version: 1,
    role: "CONDITION",
    label: "Model uses a datasheet profile",
    description: "Requires a model to use a named datasheet model profile (a named character's own profile, not a generic Triarchal Menhir).",
    starter: { profile: "" },
    parameterSchema: {
      type: "object", required: ["profile"], additionalProperties: false,
      properties: {
        subject: { enum: [...SUBJECT_REF] },
        negated: { type: "boolean" },
        profile: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$" },
      },
    },
    normalize: normalizeModelProfile,
  },
  {
    id: "resource",
    version: 2,
    role: "CONDITION",
    label: "Resource pool holds",
    description: "Requires a named resource pool to hold at least, or at most, an amount, or to have unused capacity below its maximum (optionally as of the end of the opponent's previous turn). gained_this_turn: the at_least/at_most bounds read how much of the pool you gained this turn (\"you gained fewer than 3YP this turn\" is at_most 2), not how much it holds.",
    starter: { pool: "", at_least: 1 },
    parameterSchema: {
      type: "object", required: ["pool"], additionalProperties: false,
      properties: {
        pool: { type: "string", minLength: 1 },
        at_least: { type: "integer", minimum: 0 },
        at_most: { type: "integer", minimum: 0 },
        below_max: { const: true },
        source_ability_id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$", "x-only-when": { below_max: ["true"] } },
        source_ability_owner: { enum: ["friendly", "enemy"], "x-only-when": { below_max: ["true"] } },
        at: { enum: ["now", "opponents-previous-turn-end"] },
        gained_this_turn: { const: true, "x-optional": true },
        negated: { type: "boolean" },
      },
    },
    normalize: normalizeResource,
  },
  {
    id: "operation-markers",
    version: 1,
    role: "CONDITION",
    label: "Operation markers on the battlefield",
    description: "Mission cards: a count of friendly or opponent operation markers on the battlefield, optionally with a friendly unit (and no enemy unit) in the same terrain area, or within range of the opponent's home objective.",
    starter: { side: "friendly", count_min: 1 },
    parameterSchema: {
      type: "object", required: [], additionalProperties: false,
      properties: {
        side: { enum: ["friendly", "opponent"] },
        count_min: { type: "integer", minimum: 0 },
        count_max: { type: "integer", minimum: 0 },
        friendly_unit_in_same_terrain_area: { const: true },
        no_enemy_in_terrain_area: { const: true },
        within_range_of: { const: "opponent-home-objective" },
        negated: { type: "boolean" },
      },
    },
    normalize: normalizeOperationMarkers,
  },
  {
    id: "engagement-fronts",
    version: 1,
    role: "CONDITION",
    label: "Engaged on multiple fronts",
    description: "Mission cards: you are engaged on at least this many fronts.",
    starter: { count_min: 2 },
    parameterSchema: {
      type: "object", required: ["count_min"], additionalProperties: false,
      properties: {
        count_min: { type: "integer", minimum: 0 },
        negated: { type: "boolean" },
      },
    },
    normalize: normalizeEngagementFronts,
  },
  {
    id: "destroyed-while-on-objective",
    version: 1,
    role: "CONDITION",
    label: "Enemy units destroyed on an objective",
    description: "Mission cards: a count of enemy units destroyed on (or by a unit on) an objective, optionally narrowed to central or expansion objectives or to units that started the turn there.",
    starter: { count_min: 1 },
    parameterSchema: {
      type: "object", required: [], additionalProperties: false,
      properties: {
        count_min: { type: "integer", minimum: 0 },
        objective_role: { enum: ["central", "expansion"] },
        destroyer_on_objective: { const: true },
        victim_on_objective: { const: true },
        victim_started_turn_on_objective: { const: true },
        negated: { type: "boolean" },
      },
    },
    normalize: normalizeDestroyedWhileOnObjective,
  },
  {
    id: "destroyed-in-tagged-terrain",
    version: 1,
    role: "CONDITION",
    label: "Enemy units destroyed in tagged terrain",
    description: "Mission cards: a count of enemy units destroyed in (or that started the turn in) terrain tagged with a designation.",
    starter: { count_min: 1 },
    parameterSchema: {
      type: "object", required: [], additionalProperties: false,
      properties: {
        count_min: { type: "integer", minimum: 0 },
        tag: { type: "string", minLength: 1 },
        at_start_of_turn: { const: true },
        negated: { type: "boolean" },
      },
    },
    normalize: normalizeDestroyedInTaggedTerrain,
  },
  {
    id: "eligible",
    version: 3,
    role: "CONDITION",
    label: "Unit is eligible to",
    description: "Requires a unit or model to be eligible to shoot, declare a charge, fight, start an action, or (with a named ability) be selected, optionally as of the end of the opponent's previous turn. With to embark-within, the subject (a unit, not a model) is able to embark within the Transport named by transport: this-unit (the candidate being checked) or ability-unit (the unit with the ability). subject can be antecedent: the unit an earlier leaf of the record introduced (\"that enemy unit\", \"it\"), bound when the record compiles.",
    starter: { to: "shoot" },
    parameterSchema: {
      type: "object", required: ["to"], additionalProperties: false,
      properties: {
        subject: { enum: [...SUBJECT_REF, ANTECEDENT] },
        negated: { type: "boolean" },
        to: { enum: ["shoot", "declare-charge", "fight", "start-action", "be-selected", "embark-within"] },
        source_ability_id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$", "x-only-when": { to: ["be-selected"] } },
        source_ability_owner: { enum: ["friendly", "enemy"], "x-only-when": { to: ["be-selected"] } },
        at: { enum: ["now", "opponents-previous-turn-end"] },
        transport: { enum: ["this-unit", "ability-unit"], "x-only-when": { to: ["embark-within"] }, "x-optional": true },
      },
    },
    normalize: normalizeEligible,
  },
  {
    id: "loadout",
    version: 3,
    role: "CONDITION",
    label: "Unit is uniformly equipped",
    description: "Requires every model in a unit (or every model of a keyword) to carry identical ranged or melee weapons. The keyword can carry accented capitals (KÂHL) or start with an apostrophe ('ARDMOB) as the rules print it.",
    starter: { uniform: "ranged" },
    parameterSchema: {
      type: "object", required: ["uniform"], additionalProperties: false,
      properties: {
        subject: { enum: [...SUBJECT_REF] },
        negated: { type: "boolean" },
        model_keyword: { type: "string", pattern: PRINTED_KEYWORD_PATTERN },
        uniform: { enum: ["ranged", "melee"] },
      },
    },
    normalize: normalizeLoadout,
  },
  {
    id: "army-includes",
    version: 1,
    role: "CONDITION",
    label: "Your army includes",
    description: "Your army includes units, read when mustering. quantifier some (\"If your army includes any/a\"): with following-filter names the units by the unit-filter right after the leaf; min (2 or more) for \"more than one\". quantifier every (\"If every model in your army has the X keyword\"): keywords (every one) or any_keywords (at least one of them), with level model.",
    starter: { quantifier: "some", with: "following-filter" },
    parameterSchema: {
      type: "object", required: ["quantifier"], additionalProperties: false,
      properties: {
        quantifier: { enum: ["some", "every"] },
        with: { enum: ["following-filter"], "x-only-when": { quantifier: ["some"] } },
        keywords: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true, "x-optional": true, "x-only-when": { quantifier: ["every"] } },
        any_keywords: { type: "array", items: { type: "string", minLength: 1 }, minItems: 2, uniqueItems: true, "x-optional": true, "x-only-when": { quantifier: ["every"] } },
        level: { enum: ["model"], "x-only-when": { quantifier: ["every"] } },
        min: { type: "integer", minimum: 2, maximum: 10, "x-optional": true, "x-only-when": { quantifier: ["some"] } },
      },
    },
    normalize: normalizeArmyIncludes,
  },
];
