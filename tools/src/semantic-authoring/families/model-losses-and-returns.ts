import {
  booleanValue, boundedInteger, enumValue, exactKeys, isSpentReference, spentReference, spentReferenceSchema,
} from "../family-validation.js";
import {
  type Params, ANTECEDENT, EVENT_SUBJECT, withApostrophes, withAccents, modelKeyword,
} from "./movement-and-units-shared.js";
import type { FlatFamily } from "./types.js";

/** Models lost and returned: wounds remaining, Starting Strength, destroyed and returned models, and Battle-shock state. */

/** A unit keyword with any capitals (the unit-filter's keyword form). */
const ANY_CAPITALS_KEYWORD = /^\p{Lu}[\p{Lu}\p{N}' -]*[\p{Lu}\p{N}]$/u;

/** A list of unit keywords with any capitals, sorted. */
function unitKeywords(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must list at least one keyword.`);
  const list = value.map((item) => {
    if (typeof item !== "string") throw new TypeError(`${label} must be strings.`);
    const keyword = item.replaceAll("*", "").replace(/\s+/gu, " ").trim().toUpperCase();
    if (!ANY_CAPITALS_KEYWORD.test(keyword)) throw new TypeError(`${label} ${JSON.stringify(item)} is not a unit keyword.`);
    return keyword;
  });
  if (new Set(list).size !== list.length) throw new TypeError(`${label} lists a keyword twice.`);
  return list.sort();
}

const WOUNDS_REMAINING_WORDS = ["full", "half-starting", "D3", "D6"] as const;

function woundsRemaining(input: Params): Params {
  exactKeys(input, ["value"], "wounds-remaining");
  const value = typeof input.value === "string" && /^\d+$/u.test(input.value) ? Number(input.value) : input.value;
  if (typeof value === "number") return { value: boundedInteger(value, 1, 30, "wounds-remaining.value") };
  return { value: enumValue(value, WOUNDS_REMAINING_WORDS, "wounds-remaining.value") };
}

function startingStrength(input: Params): Params {
  exactKeys(input, ["value"], "starting-strength");
  return { value: boundedInteger(input.value, 1, 30, "starting-strength.value") };
}

const returnedModelExclusion = (input: Params) => withApostrophes("returned-model-exclusion", input, (checked) => {
  exactKeys(checked, ["keywords"], "returned-model-exclusion");
  return { keywords: unitKeywords(checked.keywords, "returned-model-exclusion.keywords") };
});

const DESTROY_RECIPIENTS = ["this-unit", "this-model", "defender", "selected-unit", ANTECEDENT, "event-subject"] as const;
const DESTROY_COUNTS = ["1", "2", "3", "D3", "D6", "all"] as const;

function destroyModelsChecked(input: Params): Params {
  exactKeys(input, ["recipient", "count", ...(["model_keyword", "remove_from_play", "ignore_death_triggers", "chosen_by"] as const).filter((key) => key in input)], "destroy-models");
  const result: Params = {
    recipient: enumValue(input.recipient, DESTROY_RECIPIENTS, "destroy-models.recipient"),
    count: enumValue(input.count, DESTROY_COUNTS, "destroy-models.count"),
  };
  if ("model_keyword" in input) result.model_keyword = modelKeyword(input.model_keyword, "destroy-models.model_keyword");
  if ("remove_from_play" in input) result.remove_from_play = booleanValue(input.remove_from_play, "destroy-models.remove_from_play");
  if ("ignore_death_triggers" in input) result.ignore_death_triggers = booleanValue(input.ignore_death_triggers, "destroy-models.ignore_death_triggers");
  // "one model in that unit is destroyed (chosen by its controlling player)": the unit's owner picks which models.
  if ("chosen_by" in input) {
    result.chosen_by = enumValue(input.chosen_by, ["controlling-player"], "destroy-models.chosen_by");
    if (result.count === "all") throw new TypeError("destroy-models.chosen_by names who picks some of the models; all of them leaves nothing to choose.");
  }
  return result;
}

const destroyModels = (input: Params) =>
  withApostrophes("destroy-models", input, (stripped) => withAccents("destroy-models", stripped, destroyModelsChecked));

const RETURN_SUBJECTS = ["this-unit", "this-model", ANTECEDENT] as const;
const RETURN_COUNTS = ["1", "2", "3", "D3", "D3+1", "D3+2", "D3+3", "D6", "all"] as const;
const RETURN_WOUNDS = ["full", "1", "3", "half-starting", "D3", "D6"] as const;

function returnModelsChecked(input: Params): Params {
  exactKeys(input, ["subject", "count", ...(["wounds_remaining", "model_keyword", "exclude_model_keyword", "bodyguard_only"] as const).filter((key) => key in input)], "return-models");
  const result: Params = {
    subject: enumValue(input.subject, RETURN_SUBJECTS, "return-models.subject"),
    // "for every 2YP you just spent, return up to one additional destroyed model": the amount a resource-spend bound.
    count: isSpentReference(input.count) ? spentReference(input.count, "return-models.count") : enumValue(input.count, RETURN_COUNTS, "return-models.count"),
  };
  if ("wounds_remaining" in input) result.wounds_remaining = enumValue(input.wounds_remaining, RETURN_WOUNDS, "return-models.wounds_remaining");
  if ("model_keyword" in input) result.model_keyword = modelKeyword(input.model_keyword, "return-models.model_keyword");
  if ("exclude_model_keyword" in input) result.exclude_model_keyword = modelKeyword(input.exclude_model_keyword, "return-models.exclude_model_keyword");
  if ("bodyguard_only" in input) result.bodyguard_only = booleanValue(input.bodyguard_only, "return-models.bodyguard_only");
  return result;
}

function returnModels(input: Params): Params {
  const { model_name: modelName, ...rest } = input;
  const normalized = withApostrophes("return-models", rest, (stripped) => withAccents("return-models", stripped, returnModelsChecked));
  if (modelName === undefined) return normalized;
  // A model returns to a unit; a single model has no other models to name.
  if (normalized.subject === "this-model") throw new TypeError("return-models.model_name names models of a unit; its subject cannot be this-model.");
  if (typeof modelName !== "string" || modelName.trim().length === 0) throw new TypeError("return-models.model_name is the model's profile name as its datasheet prints it.");
  return { ...normalized, model_name: modelName.trim() };
}

function battleShockState(input: Params): Params {
  exactKeys(input, ["recipient", "set"], "battle-shock-state");
  return {
    recipient: enumValue(input.recipient, ["this-unit", "defender", "selected-unit", EVENT_SUBJECT, ANTECEDENT], "battle-shock-state.recipient"),
    set: booleanValue(input.set, "battle-shock-state.set"),
  };
}

export const MODEL_LOSSES_AND_RETURNS_FAMILIES: readonly FlatFamily[] = [
  {
    id: "wounds-remaining",
    version: 1,
    role: "CONDITION",
    label: "Wounds remaining on a returned model",
    description: "How many wounds a model set back up or returned has: its full wounds, half of its starting number of wounds, a whole number, or D3/D6 (\"with 3 wounds remaining\"). It qualifies the set-up or return-models effect before it and gates nothing.",
    starter: {"value":""},
    parameterSchema: {
      "type": "object",
      "required": [
        "value"
      ],
      "properties": {
        "value": {
          "anyOf": [
            {
              "enum": [
                "full",
                "half-starting",
                "D3",
                "D6"
              ]
            },
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 30
            }
          ]
        }
      },
      "additionalProperties": false
    },
    normalize: woundsRemaining,
  },
  {
    id: "starting-strength",
    version: 1,
    role: "CONDITION",
    label: "Starting Strength of a new unit",
    description: "The Starting Strength of the unit a set-up or split-unit effect before it produces (\"These new units each have a Starting Strength of 1\"). It gates nothing.",
    starter: {"value":1},
    parameterSchema: {
      "type": "object",
      "required": [
        "value"
      ],
      "properties": {
        "value": {
          "type": "integer",
          "minimum": 1,
          "maximum": 30
        }
      },
      "additionalProperties": false
    },
    normalize: startingStrength,
  },
  {
    id: "destroy-models",
    version: 5,
    role: "EFFECT",
    label: "Destroy models",
    description: "Destroy a number of models (all of them, a fixed or rolled count, optionally only of a named model keyword) in this unit, the attack's target, the unit selected earlier, the unit whose moment triggered the ability (event-subject: \"each time an enemy unit fails a Battle-shock test, … one model in that unit is destroyed\"), or the unit an earlier leaf of the record introduced (antecedent, bound when the record compiles), optionally removing them from play or ignoring rules their destruction would trigger. chosen_by controlling-player: the destroyed unit's controlling player picks which models (\"(chosen by its controlling player)\"); it takes a count other than all. A keyword can carry accented capitals or start with an apostrophe as the rules print it (KÂHL, 'ARDMOB).",
    starter: {"recipient":"","count":""},
    parameterSchema: {
      "type": "object",
      "required": [
        "recipient",
        "count"
      ],
      "properties": {
        "recipient": {
          "enum": [
            "this-unit",
            "this-model",
            "defender",
            "selected-unit",
            "antecedent",
            "event-subject"
          ]
        },
        "count": {
          "enum": [
            "1",
            "2",
            "3",
            "D3",
            "D6",
            "all"
          ]
        },
        "model_keyword": {
          "type": "string",
          "pattern": "^'?[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$"
        },
        "remove_from_play": {
          "type": "boolean"
        },
        "ignore_death_triggers": {
          "type": "boolean"
        },
        "chosen_by": {
          "const": "controlling-player",
          "x-optional": true
        }
      },
      "additionalProperties": false
    },
    normalize: destroyModels,
  },
  {
    id: "returned-model-exclusion",
    version: 2,
    role: "CONDITION",
    label: "Models that cannot return",
    description: "Exclude individual returned models with any listed keyword. This qualifies a return-models effect, never the whole unit or its attached group; count, wounds and placement remain separate. A keyword can start with an apostrophe as the rules print it ('ARDMOB).",
    starter: {"keywords":[]},
    parameterSchema: {
      "type": "object",
      "required": [
        "keywords"
      ],
      "properties": {
        "keywords": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "minLength": 1
          }
        }
      },
      "additionalProperties": false
    },
    normalize: returnedModelExclusion,
  },
  {
    id: "battle-shock-state",
    version: 3,
    role: "EFFECT",
    label: "Set or clear Battle-shocked",
    description: "This unit, the attack's target, the unit selected earlier, the unit the record's moment names (event-subject), or the unit an earlier leaf of the record introduced (antecedent: \"That unit is battle-shocked\" for each unit a loop names, bound when the record compiles) becomes Battle-shocked, or stops being Battle-shocked.",
    starter: {"recipient":"","set":true},
    parameterSchema: {
      "type": "object",
      "required": [
        "recipient",
        "set"
      ],
      "properties": {
        "recipient": {
          "enum": [
            "this-unit",
            "defender",
            "selected-unit",
            "event-subject",
            "antecedent"
          ]
        },
        "set": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    },
    normalize: battleShockState,
  },
  {
    id: "return-models",
    version: 9,
    role: "EFFECT",
    label: "Return destroyed models",
    description: "Return a number of destroyed models (all of them, a fixed or rolled count up to D3+3, or a spent amount {spent: the bind_as of an earlier resource-spend, per?: one for every N} (\"for every 2YP you just spent, return one additional model\"), optionally only of a named model keyword (and not of exclude_model_keyword: \"(excluding CHARACTERS)\"), or only models with the profile name model_name as the datasheet prints it: \"1 destroyed Geminae Superia model\") to this unit, this model or the unit an earlier leaf introduced (antecedent), each with its full wounds, 1, 3, D3 or D6 wounds, or half of its starting number of wounds remaining. model_name needs a unit subject. A keyword can carry accented capitals or start with an apostrophe as the rules print it (KÂHL, 'ARDMOB).",
    starter: {"subject":"","count":""},
    parameterSchema: {
      "type": "object",
      "required": [
        "subject",
        "count"
      ],
      "properties": {
        "subject": {
          "enum": [
            "this-unit",
            "this-model",
            "antecedent"
          ]
        },
        "count": {
          "anyOf": [{
            "enum": [
              "1",
              "2",
              "3",
              "D3",
              "D3+1",
              "D3+3",
              "D6",
              "all",
              "D3+2"
            ]
          }, spentReferenceSchema]
        },
        "wounds_remaining": {
          "enum": [
            "full",
            "1",
            "D3",
            "D6",
            "3",
            "half-starting"
          ]
        },
        "model_keyword": {
          "type": "string",
          "pattern": "^'?[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$"
        },
        "exclude_model_keyword": {
          "type": "string",
          "pattern": "^'?[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$",
          "x-optional": true
        },
        "bodyguard_only": {
          "type": "boolean"
        },
        "model_name": {
          "type": "string",
          "minLength": 1,
          "x-optional": true
        }
      },
      "additionalProperties": false
    },
    normalize: returnModels,
  },
];
