import type { SemanticFamilyDefinition } from "./contracts.js";
import { booleanValue, boundedInteger, enumValue, exactKeys } from "./family-validation.js";

/**
 * Effects that change which models and units exist: returning destroyed models, destroying
 * models outright, splitting a unit into several, adding a new unit to the army, and setting or
 * clearing a unit's Battle-shocked state. Placement detail (near/away_from/in_region, detach,
 * starting_strength) is carried forward for a later version; these leaves cover count, wounds
 * remaining and the common recipients first.
 */

/** A unit keyword as the DSL writes it: uppercase words, without markdown emphasis. */
const UNIT_KEYWORD = /^[A-Z][A-Z0-9' -]*[A-Z0-9]$/u;
const ENTITY_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;

export const RETURN_SUBJECTS = ["this-unit", "this-model"] as const;
export const RETURN_COUNTS = ["1", "2", "3", "D3", "D3+1", "D3+3", "D6", "all"] as const;
/** wounds_remaining is either "full" or a quantity (a plain number or dice expression); "half" is not a valid quantity. */
export const WOUNDS_REMAINING = ["full", "1", "D3", "D6"] as const;

export const DESTROY_RECIPIENTS = ["this-unit", "this-model", "defender", "selected-unit"] as const;
export const DESTROY_COUNTS = ["1", "2", "3", "D3", "D6", "all"] as const;

export const SPLIT_MODES = ["model", "counts", "keywords"] as const;

export const ADD_UNIT_SOURCES = ["copy-of-destroyed", "datasheet"] as const;
export const ADD_UNIT_COUNTS = ["1", "2", "3", "D3", "D6"] as const;

export const BATTLE_SHOCK_RECIPIENTS = ["this-unit", "defender", "selected-unit"] as const;

export const UNIT_STATE_EFFECT_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "return-models",
    version: 1,
    role: "EFFECT",
    label: "Return destroyed models",
    description: "Return a number of destroyed models (all of them, a fixed or rolled count, optionally only of a named model keyword) to this unit, each with its full wounds, 1 wound, or half its wounds remaining.",
    starter: { subject: "", count: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "count"],
      properties: {
        subject: { enum: RETURN_SUBJECTS },
        count: { enum: RETURN_COUNTS },
        wounds_remaining: { enum: WOUNDS_REMAINING },
        model_keyword: { type: "string", pattern: UNIT_KEYWORD.source },
        bodyguard_only: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    id: "destroy-models",
    version: 1,
    role: "EFFECT",
    label: "Destroy models",
    description: "Destroy a number of models (all of them, a fixed or rolled count, optionally only of a named model keyword) in this unit, the attack's target, or the unit selected earlier, optionally removing them from play or ignoring rules their destruction would trigger.",
    starter: { recipient: "", count: "" },
    parameterSchema: {
      type: "object",
      required: ["recipient", "count"],
      properties: {
        recipient: { enum: DESTROY_RECIPIENTS },
        count: { enum: DESTROY_COUNTS },
        model_keyword: { type: "string", pattern: UNIT_KEYWORD.source },
        remove_from_play: { type: "boolean" },
        ignore_death_triggers: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    id: "split-unit",
    version: 1,
    role: "EFFECT",
    label: "Split this unit",
    description: "Split this unit: into units of one model each, into named sizes (Combat Squads), or into one unit per listed model keyword.",
    starter: { mode: "" },
    parameterSchema: {
      type: "object",
      required: ["mode"],
      properties: {
        mode: { enum: SPLIT_MODES },
        model_counts: { type: "array", items: { type: "integer", minimum: 1 }, minItems: 2, "x-only-when": { mode: ["counts"] } },
        model_keywords: { type: "array", items: { type: "string", pattern: UNIT_KEYWORD.source }, minItems: 2, uniqueItems: true, "x-only-when": { mode: ["keywords"] } },
      },
      additionalProperties: false,
    },
  },
  {
    id: "add-unit",
    version: 1,
    role: "EFFECT",
    label: "Add a unit to your army",
    description: "Add a new unit to your army: an exact copy of the unit that was just destroyed, or a fixed or rolled count of a named datasheet's units; join adds the new models to this unit instead of forming a new one.",
    starter: { source: "", count: "" },
    parameterSchema: {
      type: "object",
      required: ["source", "count"],
      properties: {
        source: { enum: ADD_UNIT_SOURCES },
        datasheet: { type: "string", pattern: ENTITY_ID.source, "x-only-when": { source: ["datasheet"] } },
        count: { enum: ADD_UNIT_COUNTS },
        join: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    id: "battle-shock-state",
    version: 1,
    role: "EFFECT",
    label: "Set or clear Battle-shocked",
    description: "This unit, the attack's target, or the unit selected earlier becomes Battle-shocked, or is no longer Battle-shocked.",
    starter: { recipient: "", set: true },
    parameterSchema: {
      type: "object",
      required: ["recipient", "set"],
      properties: { recipient: { enum: BATTLE_SHOCK_RECIPIENTS }, set: { type: "boolean" } },
      additionalProperties: false,
    },
  },
];

function modelKeyword(value: unknown, label: string): string {
  const keyword = String(value).replaceAll("*", "").replace(/\s+/gu, " ").trim().toUpperCase();
  if (!UNIT_KEYWORD.test(keyword)) throw new TypeError(`${label} must be a unit keyword.`);
  return keyword;
}

export function normalizeUnitStateParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  switch (family) {
    case "return-models": {
      const keys = ["subject", "count", ...(["wounds_remaining", "model_keyword", "bodyguard_only"] as const).filter((key) => key in input)];
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = {
        subject: enumValue(input.subject, RETURN_SUBJECTS, "return-models.subject"),
        count: enumValue(input.count, RETURN_COUNTS, "return-models.count"),
      };
      if ("wounds_remaining" in input) result.wounds_remaining = enumValue(input.wounds_remaining, WOUNDS_REMAINING, "return-models.wounds_remaining");
      if ("model_keyword" in input) result.model_keyword = modelKeyword(input.model_keyword, "return-models.model_keyword");
      if ("bodyguard_only" in input) result.bodyguard_only = booleanValue(input.bodyguard_only, "return-models.bodyguard_only");
      return result;
    }
    case "destroy-models": {
      const keys = ["recipient", "count", ...(["model_keyword", "remove_from_play", "ignore_death_triggers"] as const).filter((key) => key in input)];
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = {
        recipient: enumValue(input.recipient, DESTROY_RECIPIENTS, "destroy-models.recipient"),
        count: enumValue(input.count, DESTROY_COUNTS, "destroy-models.count"),
      };
      if ("model_keyword" in input) result.model_keyword = modelKeyword(input.model_keyword, "destroy-models.model_keyword");
      if ("remove_from_play" in input) result.remove_from_play = booleanValue(input.remove_from_play, "destroy-models.remove_from_play");
      if ("ignore_death_triggers" in input) result.ignore_death_triggers = booleanValue(input.ignore_death_triggers, "destroy-models.ignore_death_triggers");
      return result;
    }
    case "split-unit": {
      const mode = enumValue(input.mode, SPLIT_MODES, "split-unit.mode");
      if (mode === "model") {
        exactKeys(input, ["mode"], family);
        return { mode };
      }
      if (mode === "counts") {
        exactKeys(input, ["mode", "model_counts"], family);
        const counts = input.model_counts;
        if (!Array.isArray(counts) || counts.length < 2) throw new TypeError("split-unit.model_counts must list at least two counts.");
        return { mode, model_counts: counts.map((value, index) => boundedInteger(value, 1, 30, `split-unit.model_counts[${index}]`)) };
      }
      exactKeys(input, ["mode", "model_keywords"], family);
      const keywords = input.model_keywords;
      if (!Array.isArray(keywords) || keywords.length < 2) throw new TypeError("split-unit.model_keywords must list at least two keywords.");
      const normalized = keywords.map((value) => modelKeyword(value, "split-unit.model_keywords"));
      if (new Set(normalized).size !== normalized.length) throw new TypeError("split-unit.model_keywords lists a keyword twice.");
      return { mode, model_keywords: normalized };
    }
    case "add-unit": {
      const source = enumValue(input.source, ADD_UNIT_SOURCES, "add-unit.source");
      const keys = ["source", "count", ...(source === "datasheet" ? ["datasheet"] : []), ...("join" in input ? ["join"] : [])];
      exactKeys(input, keys, family);
      if (source === "datasheet" && !ENTITY_ID.test(String(input.datasheet ?? ""))) throw new TypeError("add-unit.datasheet must be a kebab-case id.");
      const result: Record<string, unknown> = { source, count: enumValue(input.count, ADD_UNIT_COUNTS, "add-unit.count") };
      if (source === "datasheet") result.datasheet = input.datasheet;
      if ("join" in input) result.join = booleanValue(input.join, "add-unit.join");
      return result;
    }
    case "battle-shock-state":
      exactKeys(input, ["recipient", "set"], family);
      return { recipient: enumValue(input.recipient, BATTLE_SHOCK_RECIPIENTS, "battle-shock-state.recipient"), set: booleanValue(input.set, "battle-shock-state.set") };
    default:
      return null;
  }
}
