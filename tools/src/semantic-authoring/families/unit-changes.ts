import {
  booleanValue, boundedInteger, enumValue, exactKeys,
} from "../family-validation.js";
import {
  type Params, ENTITY_ID, DICE, withApostrophes, withAccents, keywordList, modelKeyword,
} from "./movement-and-units-shared.js";
import type { FlatFamily } from "./types.js";

/** Unit changes: units that split, are added, or are left by an attached model. */

function leavesAttachedUnit(input: Params): Params {
  exactKeys(input, [], "leaves-attached-unit");
  return {};
}

function splitUnitChecked(input: Params): Params {
  const mode = enumValue(input.mode, ["model", "counts", "keywords"], "split-unit.mode");
  if (mode === "model") {
    exactKeys(input, ["mode"], "split-unit");
    return { mode };
  }
  if (mode === "counts") {
    exactKeys(input, ["mode", "model_counts"], "split-unit");
    const counts = input.model_counts;
    if (!Array.isArray(counts) || counts.length < 2) throw new TypeError("split-unit.model_counts must list at least two counts.");
    return { mode, model_counts: counts.map((value, index) => boundedInteger(value, 1, 30, `split-unit.model_counts[${index}]`)) };
  }
  exactKeys(input, ["mode", "model_keywords"], "split-unit");
  const keywords = input.model_keywords;
  if (!Array.isArray(keywords) || keywords.length < 2) throw new TypeError("split-unit.model_keywords must list at least two keywords.");
  const normalized = keywords.map((value) => modelKeyword(value, "split-unit.model_keywords"));
  if (new Set(normalized).size !== normalized.length) throw new TypeError("split-unit.model_keywords lists a keyword twice.");
  return { mode, model_keywords: normalized };
}

function splitUnit(input: Params): Params {
  if (input.mode === "equal") {
    exactKeys(input, ["mode", "units"], "split-unit");
    return { mode: "equal", units: boundedInteger(input.units, 2, 10, "split-unit.units") };
  }
  if ("units" in input) throw new TypeError("split-unit.units belongs to mode equal.");
  return withApostrophes("split-unit", input, (stripped) => withAccents("split-unit", stripped, splitUnitChecked));
}

const ADD_UNIT_COUNTS = ["1", "2", "3", "D3", "D6"] as const;
const HELD_IN = ["strategic-reserves", "cult-ambush"] as const;

/** add-unit without source model's model name: every key but `model`, keywords in their plain spelling. */
function addUnitChecked(input: Params): Params {
  const family = "add-unit";
  const { copy_excluded_keywords: excluded, at_starting_strength: full, reset_one_shot: reset, held_in: heldIn, models, ...rest } = input;
  const source = enumValue(rest.source, ["copy-of-destroyed", "datasheet", "model"], "add-unit.source");
  if ("models" in input) {
    if (source !== "datasheet") throw new TypeError("add-unit.models sizes a new unit of a named datasheet.");
    if (rest.count !== "1") throw new TypeError("add-unit.models sizes one new unit, so its count is 1.");
    if (rest.join === true) throw new TypeError("add-unit.models sizes a new unit; models joining a unit are not a new unit.");
  }
  exactKeys(rest, ["source", "count", ...(source === "datasheet" ? ["datasheet"] : []), ...("join" in rest ? ["join"] : [])], family);
  if (source === "datasheet" && !ENTITY_ID.test(String(rest.datasheet ?? ""))) throw new TypeError("add-unit.datasheet must be a kebab-case id.");
  const result: Params = { source, count: enumValue(rest.count, ADD_UNIT_COUNTS, "add-unit.count") };
  if (source === "datasheet") result.datasheet = rest.datasheet;
  if ("join" in rest) result.join = booleanValue(rest.join, "add-unit.join");
  if ("copy_excluded_keywords" in input) {
    if (source !== "copy-of-destroyed") throw new TypeError("add-unit.copy_excluded_keywords leaves models out of a copy of the destroyed unit.");
    result.copy_excluded_keywords = keywordList(excluded, "add-unit.copy_excluded_keywords", 1);
  }
  for (const [key, value] of [["at_starting_strength", full], ["reset_one_shot", reset]] as const) {
    if (!(key in input)) continue;
    if (value !== true) throw new TypeError(`add-unit.${key} is true or absent.`);
    if (key === "reset_one_shot" && source !== "copy-of-destroyed") throw new TypeError("add-unit.reset_one_shot resets a copy's [One Shot] weapons.");
    result[key] = true;
  }
  if ("held_in" in input) result.held_in = enumValue(heldIn, HELD_IN, "add-unit.held_in");
  if ("models" in input) {
    const dice = typeof models === "string" ? models.trim().toUpperCase() : "";
    if (!DICE.test(dice)) throw new TypeError("add-unit.models is a dice amount (D3, D6, D3+1, 2D6).");
    result.models = dice;
  }
  return result;
}

function addUnit(input: Params): Params {
  if (input.source !== "model") {
    if ("model" in input) throw new TypeError("add-unit.model names the model type of source model.");
    return withApostrophes("add-unit", input, addUnitChecked);
  }
  // Source model names its models by model, never by datasheet: a datasheet key is dropped.
  const { model, datasheet: _datasheet, ...rest } = input;
  const name = typeof model === "string" ? model.replaceAll("*", "").replace(/\s+/gu, " ").trim() : "";
  if (!name) throw new TypeError("add-unit.model names the model type the models are, as printed (Blue Horror).");
  if (rest.join !== true) throw new TypeError("add-unit source model adds models to this unit, so join is true.");
  if ("models" in rest) throw new TypeError("add-unit.models sizes a new unit; models joining a unit are not a new unit.");
  return { ...withApostrophes("add-unit", rest, addUnitChecked), model: name };
}

export const UNIT_CHANGES_FAMILIES: readonly FlatFamily[] = [
  {
    id: "leaves-attached-unit",
    version: 1,
    role: "CONDITION",
    label: "Set up apart from its attached unit",
    description: "The model a set-up effect before it places is not part of an attached unit: it is set up as a unit of its own (\"That model is not part of an attached unit\"). It gates nothing.",
    starter: {},
    parameterSchema: {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    },
    normalize: leavesAttachedUnit,
  },
  {
    id: "split-unit",
    version: 4,
    role: "EFFECT",
    label: "Split this unit",
    description: "Split this unit: into units of one model each, into named sizes (Combat Squads), into one unit per listed model keyword, or (mode equal) into `units` units, each containing as equal a number of models as possible. A keyword can carry accented capitals or start with an apostrophe as the rules print it (KÂHL, 'ARDMOB).",
    starter: {"mode":""},
    parameterSchema: {
      "type": "object",
      "required": [
        "mode"
      ],
      "properties": {
        "mode": {
          "enum": [
            "model",
            "counts",
            "keywords",
            "equal"
          ]
        },
        "model_counts": {
          "type": "array",
          "items": {
            "type": "integer",
            "minimum": 1
          },
          "minItems": 2,
          "x-only-when": {
            "mode": [
              "counts"
            ]
          }
        },
        "model_keywords": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^'?[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$"
          },
          "minItems": 2,
          "uniqueItems": true,
          "x-only-when": {
            "mode": [
              "keywords"
            ]
          }
        },
        "units": {
          "type": "integer",
          "minimum": 2,
          "maximum": 10,
          "x-only-when": {
            "mode": [
              "equal"
            ]
          },
          "x-optional": true
        }
      },
      "additionalProperties": false
    },
    normalize: splitUnit,
  },
  {
    id: "add-unit",
    version: 5,
    role: "EFFECT",
    label: "Add a unit to your army",
    description: "Add a new unit to your army: an exact copy of the unit that was just destroyed, or a fixed or rolled count of a named datasheet's units; join adds the new models to this unit instead of forming a new one. A copy can leave out models with copy_excluded_keywords and reset_one_shot its [One Shot] weapons; any new unit can be at_starting_strength (every model, with all of its wounds) and be held_in strategic-reserves or cult-ambush instead of being set up. models: the one new unit of a named datasheet holds a dice amount of models (\"a new SPORE MINES unit containing D3 models\"), and its count stays 1. source model adds models of a model type the unit's rules add (its composition's added_models, as Split adds Blue Horrors to Pink Horrors), named by model in its printed form (Blue Horror); they join this unit, so join is true. A keyword can start with an apostrophe as the rules print it ('ARDMOB).",
    starter: {"source":"","count":""},
    parameterSchema: {
      "type": "object",
      "required": [
        "source",
        "count"
      ],
      "properties": {
        "source": {
          "enum": [
            "copy-of-destroyed",
            "datasheet",
            "model"
          ]
        },
        "datasheet": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9-]*[a-z0-9]$",
          "x-only-when": {
            "source": [
              "datasheet"
            ]
          }
        },
        "count": {
          "enum": [
            "1",
            "2",
            "3",
            "D3",
            "D6"
          ]
        },
        "join": {
          "type": "boolean"
        },
        "copy_excluded_keywords": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          },
          "minItems": 1,
          "uniqueItems": true,
          "x-only-when": {
            "source": [
              "copy-of-destroyed"
            ]
          },
          "x-optional": true
        },
        "at_starting_strength": {
          "const": true,
          "x-optional": true
        },
        "reset_one_shot": {
          "const": true,
          "x-only-when": {
            "source": [
              "copy-of-destroyed"
            ]
          },
          "x-optional": true
        },
        "held_in": {
          "enum": [
            "strategic-reserves",
            "cult-ambush"
          ],
          "x-optional": true
        },
        "models": {
          "type": "string",
          "pattern": "^\\d*D(3|6)(\\+\\d+)?$",
          "x-only-when": {
            "source": [
              "datasheet"
            ]
          },
          "x-optional": true
        },
        "model": {
          "type": "string",
          "minLength": 1,
          "x-only-when": {
            "source": [
              "model"
            ]
          },
          "x-optional": true
        }
      },
      "additionalProperties": false
    },
    normalize: addUnit,
  },
];
