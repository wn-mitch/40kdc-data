import { DESIGNATION_IDS } from "../../translate/designations.js";
import { ANTECEDENT } from "../antecedent-families.js";
import { boundedInteger, enumValue, exactKeys, keySet } from "../family-validation.js";
import type { FlatFamily } from "./types.js";
import {
  type Params, SUBJECT_REF, SUBJECTS_OR_ANTECEDENT, ENTITY_ID, UNIT_KEYWORD, PRINTED_KEYWORD_PATTERN, trueFlag,
  nonEmptyString, negation, subjectOf, present, PrintedKeywords, OWNERS,
} from "./restrictions-and-predicates-shared.js";

/** Identity, history, position and objective predicates. */

function entityId(value: unknown, label: string): string {
  if (typeof value === "string" && ENTITY_ID.test(value)) return value;
  throw new TypeError(`${label} must be a kebab-case entity id.`);
}

function normalizeRuleActive(input: Params): Params {
  const negated = negation(input, "rule-active");
  exactKeys(input, ["rule", ...present(input, ["negated"])], "rule-active");
  const rule = input.rule;
  if (rule === null || typeof rule !== "object") return { rule: entityId(rule, "rule-active.rule"), ...negated };
  // One option of an option-bearing rule: the rule's ability record and the option's stable id.
  if (Array.isArray(rule)) throw new TypeError("rule-active.rule is an ability id or {ability_id, option_id}.");
  const { ability_id: abilityId, option_id: optionId, ...extra } = rule as Params;
  if (Object.keys(extra).length) throw new TypeError("rule-active.rule option reference holds only ability_id and option_id.");
  if (typeof optionId !== "string" || !ENTITY_ID.test(optionId)) throw new TypeError("rule-active.rule.option_id must be a kebab-case option id.");
  return { rule: { ability_id: entityId(abilityId, "rule-active.rule"), option_id: optionId }, ...negated };
}

function normalizeUnitOwner(input: Params): Params {
  const negated = negation(input, "unit-owner");
  const subject = subjectOf(input);
  exactKeys(input, [...present(input, ["subject"]), "owner", ...present(input, ["negated"])], "unit-owner");
  return { ...subject, owner: enumValue(input.owner, OWNERS, "unit-owner.owner"), ...negated };
}

function normalizeUnitHasAbility(input: Params): Params {
  const family = "unit-has-ability";
  const { excluding_keywords: excluded, own, ...rest } = input;
  if (excluded !== undefined) {
    if (!Array.isArray(excluded) || excluded.length === 0 || excluded.some((keyword) => typeof keyword !== "string" || keyword.trim().length === 0)) {
      throw new TypeError("unit-has-ability.excluding_keywords is a nonempty list of keywords.");
    }
    if (new Set(excluded).size !== excluded.length) throw new TypeError("unit-has-ability.excluding_keywords lists each keyword once.");
  }
  // own: true names "this ability", the record's own ability, in place of an ability id.
  if ("own" in input) {
    if ("ability" in input) throw new TypeError("unit-has-ability names an ability or own: true, not both.");
    if (own !== true) throw new TypeError("unit-has-ability.own is true or absent.");
  } else if (!("ability" in input)) {
    throw new TypeError("unit-has-ability names an ability, or own: true for this ability.");
  }
  keySet(input, [], ["subject", "ability", "own", "negated", "excluding_keywords"], family);
  const negated = negation(rest, family);
  const subject = subjectOf(rest, SUBJECTS_OR_ANTECEDENT);
  return {
    ...subject,
    ...("own" in input ? { own: true } : { ability: entityId(rest.ability, "unit-has-ability.ability") }),
    ...negated,
    ...(excluded !== undefined ? { excluding_keywords: [...excluded as string[]] } : {}),
  };
}

function normalizeSameUnit(input: Params): Params {
  const negated = negation(input, "same-unit");
  const subject = subjectOf(input);
  exactKeys(input, [...present(input, ["subject"]), "as", ...present(input, ["negated"])], "same-unit");
  return { ...subject, as: enumValue(input.as, SUBJECT_REF, "same-unit.as"), ...negated };
}

function normalizeModelCount(input: Params): Params {
  const spelling = new PrintedKeywords("model-count", input);
  const negated = negation(input, "model-count");
  const subject = subjectOf(input);
  exactKeys(input, present(input, ["subject", "keyword", "min", "max", "negated"]), "model-count");
  if (input.min === undefined && input.max === undefined) throw new TypeError("model-count needs min, max, or both.");
  const result: Params = { ...subject };
  if ("keyword" in input) {
    const keyword = spelling.bare(input.keyword);
    if (typeof keyword !== "string" || !UNIT_KEYWORD.test(keyword)) throw new TypeError("model-count.keyword must be a unit keyword.");
    result.keyword = spelling.printed(keyword);
  }
  if (input.min !== undefined) result.min = boundedInteger(input.min, 0, 30, "model-count.min");
  if (input.max !== undefined) result.max = boundedInteger(input.max, 0, 30, "model-count.max");
  return spelling.finish({ ...result, ...negated });
}

const WOUND_KINDS = ["lost", "damaged", "remaining-at-most"] as const;

function normalizeWoundsState(input: Params): Params {
  const negated = negation(input, "wounds-state");
  const subject = subjectOf(input);
  const kind = enumValue(input.kind, WOUND_KINDS, "wounds-state.kind");
  const valued = kind === "remaining-at-most";
  exactKeys(input, [...present(input, ["subject"]), "kind", ...(valued ? ["value"] : []), ...present(input, ["negated"])], "wounds-state");
  return { ...subject, kind, ...(valued ? { value: boundedInteger(input.value, 0, 30, "wounds-state.value") } : {}), ...negated };
}

const TALLY_KINDS = ["character", "any"] as const;

function normalizeHistoryCompare(input: Params): Params {
  const family = "history-compare";
  const negated = negation(input, family);
  const comparison = enumValue(input.comparison, ["greater-than", "greater-or-equal"], "history-compare.comparison");
  const rightKind = enumValue(input.right_kind, ["tally", "value", "pool"], "history-compare.right_kind");
  const right = rightKind === "tally" ? "right_tally_kind" : rightKind === "value" ? "right_value" : "right_pool";
  exactKeys(input, [...present(input, ["left_kind"]), "comparison", "right_kind", right, ...present(input, ["negated", "window"])], family);
  const result: Params = { comparison, right_kind: rightKind };
  if (input.left_kind !== undefined) result.left_kind = enumValue(input.left_kind, TALLY_KINDS, "history-compare.left_kind");
  if (rightKind === "tally") result.right_tally_kind = enumValue(input.right_tally_kind, TALLY_KINDS, "history-compare.right_tally_kind");
  else if (rightKind === "value") result.right_value = boundedInteger(input.right_value, 0, 30, "history-compare.right_value");
  else result.right_pool = nonEmptyString(input.right_pool, "history-compare.right_pool");
  if (input.window !== undefined) result.window = enumValue(input.window, ["battle-round"], "history-compare.window");
  return { ...result, ...negated };
}

const TERRITORIES = ["your-territory", "enemy-territory", "no-mans-land", "your-deployment-zone", "enemy-deployment-zone", "attacker-territory"] as const;

function normalizeInRegion(input: Params): Params {
  const family = "in-region";
  const kind = input.region_kind;
  if (kind !== "designated-terrain" && "designation" in input) throw new TypeError("in-region.designation belongs to region_kind designated-terrain.");
  const region: Params = {};
  let own: string[];
  if (kind === "designated-terrain") {
    // A terrain feature a rule tagged with a designation.
    if ("terrain_tag" in input || "territory" in input || "region_id" in input) {
      throw new TypeError("in-region with region_kind designated-terrain takes designation, not terrain_tag, territory or region_id.");
    }
    if (typeof input.designation !== "string" || !DESIGNATION_IDS.has(input.designation)) {
      throw new TypeError(`in-region.designation ${JSON.stringify(input.designation)} is not a registered designation.`);
    }
    region.designation = input.designation;
    own = ["designation"];
  } else if (kind === "rule-region") {
    // A region an army rule defines, named by its id and the faction whose rule defines it.
    if ("terrain_tag" in input || "territory" in input) throw new TypeError("in-region with region_kind rule-region takes region_id and owner_faction, not terrain_tag or territory.");
    for (const key of ["region_id", "owner_faction"]) {
      const value = input[key];
      if (typeof value !== "string" || !ENTITY_ID.test(value)) throw new TypeError(`in-region.${key} must be a kebab-case entity id.`);
      region[key] = value;
    }
    own = ["region_id", "owner_faction"];
  } else {
    const plain = enumValue(kind, ["territory", "terrain-area"], "in-region.region_kind");
    if (plain === "territory") {
      region.territory = enumValue(input.territory, TERRITORIES, "in-region.territory");
      own = ["territory"];
    } else {
      region.terrain_tag = nonEmptyString(input.terrain_tag, "in-region.terrain_tag");
      own = ["terrain_tag"];
    }
  }
  const negated = negation(input, family);
  const subject = subjectOf(input, SUBJECTS_OR_ANTECEDENT);
  exactKeys(input, [...present(input, ["subject"]), "region_kind", ...own, ...present(input, ["wholly", "models", "negated"])], family);
  const result: Params = { ...subject, region_kind: kind, ...region };
  if (input.wholly !== undefined) result.wholly = trueFlag(input.wholly, "in-region.wholly");
  if (input.models !== undefined) result.models = enumValue(input.models, ["any", "every"], "in-region.models");
  return { ...result, ...negated };
}

const OBJECTIVE_ROLES = ["central", "expansion", "home", "non-home"] as const;

function normalizeControlsObjective(input: Params): Params {
  const family = "controls-objective";
  const negated = negation(input, family);
  const mode = enumValue(input.mode, ["count", "more-than-opponent"], "controls-objective.mode");
  if (mode === "more-than-opponent") {
    exactKeys(input, ["mode", ...present(input, ["negated"])], family);
    return { mode, ...negated };
  }
  exactKeys(input, ["mode", ...present(input, ["by", "objective_role", "home_of", "objective_territory", "count_min", "count_max", "negated"])], family);
  const result: Params = { mode };
  if (input.by !== undefined) result.by = enumValue(input.by, OWNERS, "controls-objective.by");
  if (input.objective_role !== undefined) result.objective_role = enumValue(input.objective_role, OBJECTIVE_ROLES, "controls-objective.objective_role");
  if (input.home_of !== undefined) result.home_of = enumValue(input.home_of, OWNERS, "controls-objective.home_of");
  if (input.objective_territory !== undefined) {
    result.objective_territory = enumValue(input.objective_territory, ["your-territory", "enemy-territory", "no-mans-land"], "controls-objective.objective_territory");
  }
  if (input.count_min !== undefined) result.count_min = boundedInteger(input.count_min, 0, 6, "controls-objective.count_min");
  if (input.count_max !== undefined) result.count_max = boundedInteger(input.count_max, 0, 6, "controls-objective.count_max");
  return { ...result, ...negated };
}


export const IDENTITY_AND_POSITION_PREDICATES_FAMILIES: readonly FlatFamily[] = [
  {
    id: "unit-owner",
    version: 1,
    role: "CONDITION",
    label: "Unit's owner",
    description: "Requires a unit to be a friendly or an enemy unit.",
    starter: { owner: "" },
    parameterSchema: {
      type: "object", required: ["owner"], additionalProperties: false,
      properties: {
        subject: { enum: [...SUBJECT_REF] },
        negated: { type: "boolean" },
        owner: { enum: ["friendly", "enemy"] },
      },
    },
    normalize: normalizeUnitOwner,
  },
  {
    id: "same-unit",
    version: 1,
    role: "CONDITION",
    label: "Same unit as",
    description: "Requires a unit to be (or not be) the same unit as another named unit reference.",
    starter: { as: "" },
    parameterSchema: {
      type: "object", required: ["as"], additionalProperties: false,
      properties: {
        subject: { enum: [...SUBJECT_REF] },
        negated: { type: "boolean" },
        as: { enum: [...SUBJECT_REF] },
      },
    },
    normalize: normalizeSameUnit,
  },
  {
    id: "wounds-state",
    version: 1,
    role: "CONDITION",
    label: "Unit or model's wounds",
    description: "Requires a unit or model to have lost wounds, be Damaged, or have at most a number of wounds remaining.",
    starter: { kind: "lost" },
    parameterSchema: {
      type: "object", required: ["kind"], additionalProperties: false,
      properties: {
        subject: { enum: [...SUBJECT_REF] },
        negated: { type: "boolean" },
        kind: { enum: ["lost", "damaged", "remaining-at-most"] },
        value: { type: "integer", minimum: 0, maximum: 30, "x-only-when": { kind: ["remaining-at-most"] } },
      },
    },
    normalize: normalizeWoundsState,
  },
  {
    id: "controls-objective",
    version: 1,
    role: "CONDITION",
    label: "Controls objectives",
    description: "Requires you (or the opponent) to control at least this many objectives matching a role or ownership filter, or more objectives than the opponent holds.",
    starter: { mode: "count", by: "friendly" },
    parameterSchema: {
      type: "object", required: ["mode"], additionalProperties: false,
      properties: {
        mode: { enum: ["count", "more-than-opponent"] },
        by: { enum: ["friendly", "enemy"], "x-only-when": { mode: ["count"] } },
        objective_role: { enum: ["central", "expansion", "home", "non-home"], "x-only-when": { mode: ["count"] } },
        home_of: { enum: ["friendly", "enemy"], "x-only-when": { mode: ["count"] } },
        objective_territory: { enum: ["your-territory", "enemy-territory", "no-mans-land"], "x-only-when": { mode: ["count"] } },
        count_min: { type: "integer", minimum: 0, maximum: 6, "x-only-when": { mode: ["count"] } },
        count_max: { type: "integer", minimum: 0, maximum: 6, "x-only-when": { mode: ["count"] } },
        negated: { type: "boolean" },
      },
    },
    normalize: normalizeControlsObjective,
  },
  {
    id: "rule-active",
    version: 2,
    role: "CONDITION",
    label: "A named rule is active",
    description: "Requires a named army or detachment rule (a doctrine, Waaagh!, or pact) to be currently active. rule is an ability record id for a whole rule, or one option of an option-bearing rule as {ability_id, option_id}: the rule's ability record and the option's stable id within it (\"the Protector Imperative is active\" is an option of Doctrina Imperatives). The option id is the option's id, never its display label.",
    starter: { rule: "" },
    parameterSchema: {
      type: "object", required: ["rule"], additionalProperties: false,
      properties: {
        rule: { oneOf: [{ type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$" }, { type: "object", required: ["ability_id", "option_id"], additionalProperties: false, properties: { ability_id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$" }, option_id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$" } } }] },
        negated: { type: "boolean" },
      },
    },
    normalize: normalizeRuleActive,
  },
  {
    id: "model-count",
    version: 3,
    role: "CONDITION",
    label: "Unit's model count",
    description: "Requires a unit to contain at least, at most, or between this many models, optionally only of a keyword. The keyword can carry accented capitals (KÂHL) or start with an apostrophe ('ARDMOB) as the rules print it.",
    starter: { min: 1 },
    parameterSchema: {
      type: "object", required: [], additionalProperties: false,
      properties: {
        subject: { enum: [...SUBJECT_REF] },
        negated: { type: "boolean" },
        keyword: { type: "string", pattern: PRINTED_KEYWORD_PATTERN },
        min: { type: "integer", minimum: 0, maximum: 30 },
        max: { type: "integer", minimum: 0, maximum: 30 },
      },
    },
    normalize: normalizeModelCount,
  },
  {
    id: "unit-has-ability",
    version: 4,
    role: "CONDITION",
    label: "Unit has a named ability",
    description: "Requires a unit to have a named ability (a core ability, Discipline, or ability record id), or, with own: true, \"this ability\": the ability of the record the leaf is on, bound to its id when the record compiles (a duplicate record names the record datasheets carry). A leaf names ability or own, never both. excluding_keywords: every model in the unit except models with any of these keywords has the ability (\"every model (excluding CHARACTER models) in that unit has this ability\"); without it, the leaf reads the unit. subject can be antecedent: the unit an earlier leaf of the record introduced (\"that enemy unit\", \"it\"), bound when the record compiles.",
    starter: { ability: "" },
    parameterSchema: {
      type: "object", additionalProperties: false, required: [],
      properties: {
        subject: { enum: [...SUBJECT_REF, ANTECEDENT] },
        negated: { type: "boolean" },
        ability: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$", "x-optional": true },
        own: { const: true, "x-optional": true },
        excluding_keywords: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true, "x-optional": true },
      },
    },
    normalize: normalizeUnitHasAbility,
  },
  {
    id: "history-compare",
    version: 2,
    role: "CONDITION",
    label: "Compare units destroyed",
    description: "Compares how many enemy units (optionally of a kind) you destroyed this battle against a fixed count, a pool or another such tally (mission cards). With window battle-round, both tallies count enemy units destroyed this battle round instead.",
    starter: { comparison: "greater-or-equal", right_kind: "value", right_value: 1 },
    parameterSchema: {
      type: "object", required: ["comparison", "right_kind"], additionalProperties: false,
      properties: {
        left_kind: { enum: ["character", "any"] },
        comparison: { enum: ["greater-than", "greater-or-equal"] },
        right_kind: { enum: ["tally", "value", "pool"] },
        right_tally_kind: { enum: ["character", "any"], "x-only-when": { right_kind: ["tally"] } },
        right_value: { type: "integer", minimum: 0, "x-only-when": { right_kind: ["value"] } },
        right_pool: { type: "string", minLength: 1, "x-only-when": { right_kind: ["pool"] } },
        negated: { type: "boolean" },
        window: { enum: ["battle-round"], "x-optional": true },
      },
    },
    normalize: normalizeHistoryCompare,
  },
  {
    id: "in-region",
    version: 4,
    role: "CONDITION",
    label: "Unit is within a region",
    description: "Requires a unit to be (wholly, if set) within a territory (your/enemy deployment zone, no-man's-land), a tagged terrain area, a region an army rule defines (region_kind rule-region, named by region_id and owner_faction: \"wholly within your army's Flow of Magic\"), or a terrain feature a rule tagged with a designation (region_kind designated-terrain with designation: \"within an identified terrain feature\"). Each region kind takes only its own region fields. subject can be antecedent: the unit an earlier leaf introduced (\"if a friendly X unit is wholly within a terrain area, that unit …\").",
    starter: { region_kind: "territory", territory: "no-mans-land" },
    parameterSchema: {
      type: "object", required: ["region_kind"], additionalProperties: false,
      properties: {
        subject: { enum: [...SUBJECT_REF, ANTECEDENT] },
        negated: { type: "boolean" },
        region_kind: { enum: ["territory", "terrain-area", "rule-region", "designated-terrain"] },
        territory: { enum: ["your-territory", "enemy-territory", "no-mans-land", "your-deployment-zone", "enemy-deployment-zone", "attacker-territory"], "x-only-when": { region_kind: ["territory"] } },
        terrain_tag: { type: "string", minLength: 1, "x-only-when": { region_kind: ["terrain-area"] } },
        wholly: { const: true },
        models: { enum: ["any", "every"] },
        region_id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$", "x-only-when": { region_kind: ["rule-region"] } },
        owner_faction: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$", "x-only-when": { region_kind: ["rule-region"] } },
        designation: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$", "x-only-when": { region_kind: ["designated-terrain"] }, "x-optional": true },
      },
    },
    normalize: normalizeInRegion,
  },
];
