import {
  booleanValue, enumOrSource, enumSet, enumValue, exactKeys, keySet,
} from "../family-validation.js";
import {
  type Params, ANTECEDENT, EVENT_SUBJECT, MOVE_ACTOR_SUBJECTS, withApostrophes, keywordList, subjectOrSource,
} from "./movement-and-units-shared.js";
import type { FlatFamily } from "./types.js";

/** Move limits: where a move must or cannot end, and what a move may pass through. */

const MOVE_SUBSET = ["normal", "advance", "fall-back", "charge"] as const;
const PASSTHROUGH_ITEMS = ["models", "all-terrain", "tall-terrain", "terrain-le-4", "non-titanic-models"] as const;

function moveEndWaiver(input: Params): Params {
  if (Object.keys(input).join() !== "rule") throw new TypeError("move-end-waiver parameters must be exactly: rule.");
  return { rule: enumValue(input.rule, ["closest-enemy-model"], "move-end-waiver.rule") };
}

function moveMustEnd(input: Params): Params {
  const { polarity, move_types: moveTypes, replaces, ...rest } = input;
  if (replaces !== undefined) {
    if (replaces !== true) throw new TypeError("move-must-end.replaces must be true, or omitted.");
    if (polarity !== "cannot") throw new TypeError("move-must-end.replaces applies only to polarity cannot.");
  }
  const keys = Object.keys(rest);
  if (keys.length !== 1 || keys[0] !== "match") throw new TypeError("move-must-end parameters must be match, with optional polarity, move_types and replaces.");
  const result: Params = { match: enumValue(rest.match, ["any", "all"], "move-must-end.match") };
  if (polarity !== undefined && enumValue(polarity, ["must", "cannot"], "move-must-end.polarity") === "cannot") result.polarity = "cannot";
  if (moveTypes !== undefined) result.move_types = enumSet(moveTypes, MOVE_SUBSET, "move-must-end.move_types");
  if (replaces === true) result.replaces = true;
  return result;
}

const OBJECTIVE_TO = ["closest-objective-marker", "selected-objective"] as const;

function moveEndNearest(input: Params): Params {
  if (input.to === EVENT_SUBJECT) {
    if (input.per !== undefined) throw new TypeError("move-end-nearest.per applies to an objective destination; a move-end nearest the enemy unit names no per-model form.");
    if (input.instead_of !== undefined) throw new TypeError("move-end-nearest.instead_of has no form with a move-end to the enemy unit the trigger names.");
    for (const key of Object.keys(input)) {
      if (key !== "to") throw new TypeError(`move-end-nearest.${key} is not a parameter with to: event-subject.`);
    }
    return { to: EVENT_SUBJECT };
  }
  for (const key of Object.keys(input)) {
    if (!["to", "per", "instead_of"].includes(key)) throw new TypeError(`move-end-nearest.${key} is not a parameter of move-end-nearest.`);
  }
  const to = enumValue(input.to, ["following-filter", ...OBJECTIVE_TO], "move-end-nearest.to");
  const result: Params = { to };
  if (input.per !== undefined) {
    if (to === "following-filter") throw new TypeError("move-end-nearest.per applies only to an objective destination.");
    result.per = enumValue(input.per, ["unit", "model"], "move-end-nearest.per");
  }
  if (input.instead_of !== undefined) {
    if (input.instead_of !== "closest-enemy-unit") throw new TypeError("move-end-nearest.instead_of must be closest-enemy-unit.");
    result.instead_of = "closest-enemy-unit";
  }
  return result;
}

const PASSTHROUGH_OWNERS = ["friendly", "enemy", "any"] as const;
const TYPED_MODELS_KEYS = ["kind", "owner", "all_of", "excluding"] as const;

/** A typed models item: models of an owner with every all_of keyword, excluding any excluding keyword. */
function typedModels(item: Params): Params {
  if (item.kind !== "models") throw new TypeError("move-through.passthrough typed item must have kind models.");
  for (const key of Object.keys(item)) {
    if (!(TYPED_MODELS_KEYS as readonly string[]).includes(key)) throw new TypeError(`move-through.passthrough item has an unknown key: ${key}.`);
  }
  const result: Params = { kind: "models" };
  if (item.owner !== undefined) result.owner = enumValue(item.owner, PASSTHROUGH_OWNERS, "move-through.passthrough.owner");
  if (item.all_of !== undefined) result.all_of = keywordList(item.all_of, "move-through.passthrough.all_of", 1);
  if (item.excluding !== undefined) result.excluding = keywordList(item.excluding, "move-through.passthrough.excluding", 1);
  return result;
}

/** Two listed passthrough tokens, sorted. */
function passthroughPair(value: unknown[]): string[] {
  if (value.length !== 2) throw new TypeError("move-through.passthrough lists exactly two tokens, or names one.");
  const list = value.map((item) => {
    if (typeof item !== "string") throw new TypeError("move-through.passthrough lists tokens only; a typed models item stands alone.");
    return enumValue(item, PASSTHROUGH_ITEMS, "move-through.passthrough");
  });
  if (list[0] === list[1]) throw new TypeError("move-through.passthrough lists a token twice.");
  return [...list].sort();
}

function passthroughValue(value: unknown): unknown {
  if (Array.isArray(value)) return passthroughPair(value);
  if (value !== null && typeof value === "object" && !("source" in value)) return typedModels(value as Params);
  return enumOrSource(value, PASSTHROUGH_ITEMS, "move-through.passthrough");
}

function moveThroughChecked(input: Params): Params {
  keySet(input, ["subject", "passthrough"], ["applies_to_moves", "ignore_vertical"], "move-through");
  const result: Params = {
    subject: subjectOrSource(input.subject, MOVE_ACTOR_SUBJECTS, [ANTECEDENT, EVENT_SUBJECT], "move-through.subject"),
    passthrough: passthroughValue(input.passthrough),
  };
  if (input.applies_to_moves !== undefined) result.applies_to_moves = enumSet(input.applies_to_moves, MOVE_SUBSET, "move-through.applies_to_moves");
  if (input.ignore_vertical !== undefined) {
    if (booleanValue(input.ignore_vertical, "move-through.ignore_vertical") !== true) throw new TypeError("move-through.ignore_vertical must be true, or omitted.");
    result.ignore_vertical = true;
  }
  return result;
}

const moveThrough = (input: Params) => withApostrophes("move-through", input, moveThroughChecked);

const PASSTHROUGH_USED_VALUES = ["tall-terrain"] as const;

function movePassthroughUsed(input: Params): Params {
  exactKeys(input, ["passthrough"], "move-passthrough-used");
  return { passthrough: enumValue(input.passthrough, PASSTHROUGH_USED_VALUES, "move-passthrough-used.passthrough") };
}

export const MOVE_LIMITS_FAMILIES: readonly FlatFamily[] = [
  {
    id: "move-end-waiver",
    version: 1,
    role: "RESTRICTION",
    label: "Waives where a move must end",
    description: "Waives the closest-enemy-model requirement of a move-end nearest in the same sentence: the move may instead end as close as possible to that unit. rule names the waived requirement. It is never valid without a move-end-nearest.",
    starter: {"rule":""},
    parameterSchema: {
      "type": "object",
      "required": [
        "rule"
      ],
      "properties": {
        "rule": {
          "enum": [
            "closest-enemy-model"
          ]
        }
      },
      "additionalProperties": false
    },
    normalize: moveEndWaiver,
  },
  {
    id: "move-must-end",
    version: 4,
    role: "RESTRICTION",
    label: "Where a move must end",
    description: "\"Your unit must end that move either wholly within your deployment zone or within range of an objective marker\": the conditions that follow it in the same sentence say where the unit must be when the move before it ends. match is any for \"either … or\", all when every condition must hold. polarity cannot (must is the default) says where the move must not end (\"cannot end that move within Engagement Range of them\"), so the conditions after it are negated together. move_types limits the restriction to the listed move kinds (\"cannot end a Normal or Advance move within Engagement Range of them\"); absent, it covers every move the trigger names. replaces: true marks a cannot restriction that replaces the usual end threshold (\"instead of more than 8\\\"\"), with its move kinds from the trigger; absent, the restriction adds to the usual rules.",
    starter: {"match":""},
    parameterSchema: {
      "type": "object",
      "required": [
        "match"
      ],
      "properties": {
        "match": {
          "enum": [
            "any",
            "all"
          ]
        },
        "polarity": {
          "enum": [
            "must",
            "cannot"
          ],
          "x-optional": true
        },
        "move_types": {
          "type": "array",
          "items": {
            "enum": [
              "normal",
              "advance",
              "fall-back",
              "charge"
            ]
          },
          "minItems": 1,
          "uniqueItems": true,
          "x-optional": true
        },
        "replaces": {
          "const": true,
          "x-only-when": {
            "polarity": [
              "cannot"
            ]
          },
          "x-optional": true
        }
      },
      "additionalProperties": false
    },
    normalize: moveMustEnd,
  },
  {
    id: "move-end-nearest",
    version: 3,
    role: "RESTRICTION",
    label: "Move must end nearest a unit",
    description: "The move before it must end as close as possible to a destination. to: following-filter is the closest unit that the unit-filter right after it names (that filter is folded into the leaf's of before compilation); closest-objective-marker is any objective marker; selected-objective is the objective a select-objective bound; event-subject is the enemy unit the trigger names. per (unit or model) applies to an objective destination only. instead_of closest-enemy-unit names the enemy unit the move is not required to end closer to; it takes no event-subject destination.",
    starter: {"to":""},
    parameterSchema: {
      "type": "object",
      "required": [
        "to"
      ],
      "properties": {
        "to": {
          "enum": [
            "following-filter",
            "closest-objective-marker",
            "selected-objective",
            "event-subject"
          ]
        },
        "per": {
          "enum": [
            "unit",
            "model"
          ],
          "x-only-when": {
            "to": [
              "closest-objective-marker",
              "selected-objective"
            ]
          },
          "x-optional": true
        },
        "instead_of": {
          "const": "closest-enemy-unit",
          "x-optional": true
        }
      },
      "additionalProperties": false
    },
    normalize: moveEndNearest,
  },
  {
    id: "move-through",
    version: 5,
    role: "EFFECT",
    label: "Move through terrain or models",
    description: "The target's moves treat models or a kind of terrain feature as though they were not there; applies_to_moves and ignore_vertical are optional. The subject can also be the unit an earlier leaf introduced (antecedent) or the unit a move-ended event names (event-subject). passthrough is one listed token, a list of two listed tokens (models, all-terrain, tall-terrain, terrain-le-4, non-titanic-models), or a typed models item: models of an owner (friendly, enemy or any) with every all_of keyword, excluding models with any excluding keyword. A keyword can start with an apostrophe as the rules print it ('ARDMOB).",
    starter: {"subject":"this-unit","passthrough":""},
    parameterSchema: {
      "type": "object",
      "required": [
        "subject",
        "passthrough"
      ],
      "properties": {
        "subject": {
          "anyOf": [
            {
              "enum": [
                "this-unit",
                "this-model",
                "antecedent",
                "event-subject"
              ]
            },
            {
              "type": "object",
              "required": [
                "source"
              ],
              "properties": {
                "source": {
                  "type": "string",
                  "minLength": 1
                }
              },
              "additionalProperties": false
            }
          ]
        },
        "passthrough": {
          "anyOf": [
            {
              "anyOf": [
                {
                  "anyOf": [
                    {
                      "enum": [
                        "models",
                        "all-terrain",
                        "tall-terrain",
                        "terrain-le-4",
                        "non-titanic-models"
                      ]
                    },
                    {
                      "type": "object",
                      "required": [
                        "source"
                      ],
                      "properties": {
                        "source": {
                          "type": "string",
                          "minLength": 1
                        }
                      },
                      "additionalProperties": false
                    }
                  ]
                },
                {
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "kind"
                  ],
                  "properties": {
                    "kind": {
                      "const": "models"
                    },
                    "owner": {
                      "enum": [
                        "friendly",
                        "enemy",
                        "any"
                      ]
                    },
                    "all_of": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "pattern": "^'?[A-Z][A-Z0-9' -]*[A-Z0-9]$"
                      },
                      "minItems": 1,
                      "uniqueItems": true
                    },
                    "excluding": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "pattern": "^'?[A-Z][A-Z0-9' -]*[A-Z0-9]$"
                      },
                      "minItems": 1,
                      "uniqueItems": true
                    }
                  }
                }
              ]
            },
            {
              "type": "array",
              "items": {
                "enum": [
                  "models",
                  "all-terrain",
                  "tall-terrain",
                  "terrain-le-4",
                  "non-titanic-models"
                ]
              },
              "minItems": 2,
              "maxItems": 2,
              "uniqueItems": true
            }
          ]
        },
        "applies_to_moves": {
          "type": "array",
          "items": {
            "enum": [
              "normal",
              "advance",
              "fall-back",
              "charge"
            ]
          },
          "minItems": 1,
          "uniqueItems": true
        },
        "ignore_vertical": {
          "const": true
        }
      },
      "additionalProperties": false
    },
    normalize: moveThrough,
  },
  {
    id: "move-passthrough-used",
    version: 1,
    role: "CONDITION",
    label: "Moved through permitted terrain",
    description: "\"But if it does, after it has moved, …\": the move-ended moment that follows it happened only when the move passed through the named terrain under the move-through before it. It qualifies that moment and gates nothing by itself.",
    starter: {"passthrough":""},
    parameterSchema: {
      "type": "object",
      "required": [
        "passthrough"
      ],
      "properties": {
        "passthrough": {
          "enum": [
            "tall-terrain"
          ]
        }
      },
      "additionalProperties": false
    },
    normalize: movePassthroughUsed,
  },
];
