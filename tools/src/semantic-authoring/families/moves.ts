import {
  boundedInteger, enumOrSource, enumSet, enumValue, exactKeys, keySet,
} from "../family-validation.js";
import {
  type Params, ANTECEDENT, EVENT_SUBJECT, DICE, MOVE_SUBJECTS, subjectOrSource,
} from "./movement-and-units-shared.js";
import type { FlatFamily } from "./types.js";

/** Moves: the moves a rule makes, their distances and modes, and reserves arrival. */

const FILTERED_UNITS = "filtered-units";
/** The dice-or-whole-number form make-move's distance takes. */
const DISTANCE_DICE = /^(\d*D(3|6)(\+\d+)?|\d+)$/u;

const MOVE_TYPES = [
  "normal", "advance", "fall-back", "charge", "pile-in", "consolidation", "surge", "scout", "ingress", "disembark", "embark", "pulse-jet",
] as const;

const MOVE_MODES = ["ordered-retreat", "desperate-escape", "ongoing", "engaging", "objective", "rapid", "tactical", "combat", "emergency", "assault"] as const;
const MODE_CHOICE_SUBJECTS = ["this-unit", "this-model", "antecedent"] as const;

function moveModeChoice(input: Params): Params {
  keySet(input, ["subject", "move_types", "modes"], ["ignore_before_moving"], "move-mode-choice");
  if (input.ignore_before_moving !== undefined && input.ignore_before_moving !== true) throw new TypeError("move-mode-choice.ignore_before_moving is true or absent.");
  return {
    subject: enumValue(input.subject, MODE_CHOICE_SUBJECTS, "move-mode-choice.subject"),
    move_types: enumSet(input.move_types, MOVE_TYPES, "move-mode-choice.move_types"),
    modes: input.modes === "any" ? "any" : enumSet(input.modes, MOVE_MODES, "move-mode-choice.modes"),
    ...(input.ignore_before_moving === true ? { ignore_before_moving: true } : {}),
  };
}

const DISEMBARK_MODES = ["rapid", "tactical", "combat", "emergency", "assault", "shock"] as const;
const COUNTS_AS_MOVES = [...MOVE_TYPES, "remain-stationary"] as const;

/** A make-move distance: inches, a dice amount (D3+3, case and padding ignored), or a source snippet. */
function makeMoveDistance(value: unknown): unknown {
  if (typeof value === "string" && !["D3", "D6", "2D6"].includes(value)) {
    const dice = value.trim().toUpperCase();
    if (!DICE.test(dice)) throw new TypeError("make-move.distance is inches, D3, D6, 2D6 or a dice amount plus a number (D3+3).");
    return dice;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && DISTANCE_DICE.test(value)) return value;
  // A snippet object's other keys are dropped.
  if (value !== null && typeof value === "object" && "source" in value && typeof (value as { source: unknown }).source === "string") {
    const source = (value as { source: string }).source;
    if (source && source === source.trim()) return { source };
  }
  throw new TypeError("make-move.distance must be a non-negative integer, a dice expression, or an exact source snippet.");
}

function makeMove(input: Params): Params {
  keySet(input, ["subject", "move_type"], ["distance", "ends_within_inches", "counts_as_move", "mode"], "make-move");
  const result: Params = {
    subject: subjectOrSource(input.subject, MOVE_SUBJECTS, [ANTECEDENT, EVENT_SUBJECT, FILTERED_UNITS], "make-move.subject"),
    move_type: enumOrSource(input.move_type, MOVE_TYPES, "make-move.move_type"),
  };
  if (input.distance !== undefined) result.distance = makeMoveDistance(input.distance);
  if (input.ends_within_inches !== undefined) result.ends_within_inches = boundedInteger(input.ends_within_inches, 1, 48, "make-move.ends_within_inches");
  if (input.counts_as_move !== undefined) result.counts_as_move = enumValue(input.counts_as_move, COUNTS_AS_MOVES, "make-move.counts_as_move");
  if (input.mode !== undefined) {
    if (input.move_type !== "disembark") throw new TypeError("make-move.mode names a disembark mode, so it needs move_type disembark.");
    if (!(DISEMBARK_MODES as readonly unknown[]).includes(input.mode)) throw new TypeError(`make-move.mode is one of ${DISEMBARK_MODES.join(", ")}, not ${JSON.stringify(input.mode)}.`);
    result.mode = input.mode;
  }
  return result;
}

function moveDistance(input: Params): Params {
  const { maximum, bonus } = input;
  const keys = Object.keys(input).sort().join();
  const subject = enumValue(input.subject, ["this-unit", "this-model", ANTECEDENT], "move-distance.subject");
  if (maximum === undefined) {
    if (keys !== "bonus,move_types,subject") throw new TypeError("move-distance parameters must be exactly: subject, move_types, and bonus or maximum.");
    const size = typeof bonus === "number" && bonus < 0 ? -bonus : bonus;
    const checked = boundedInteger(size, 1, 24, "move-distance.bonus");
    return { subject, move_types: enumSet(input.move_types, MOVE_TYPES, "move-distance.move_types"), bonus: bonus === size ? checked : -checked };
  }
  if (bonus !== undefined) throw new TypeError("move-distance.maximum and bonus are mutually exclusive.");
  if (keys !== "maximum,move_types,subject") throw new TypeError("move-distance parameters must be exactly: subject, move_types, and bonus or maximum.");
  let limit: string | number;
  if (typeof maximum === "number") limit = boundedInteger(maximum, 1, 24, "move-distance.maximum");
  else if (maximum === "unlimited") {
    const moves = input.move_types;
    if (!Array.isArray(moves) || moves.length !== 1 || moves[0] !== "advance") throw new TypeError("move-distance.maximum unlimited applies only to exactly one advance move.");
    limit = "unlimited";
  } else if (typeof maximum === "string" && DICE.test(maximum)) limit = maximum;
  else throw new TypeError("move-distance.maximum must be unlimited, a number of inches or a dice expression such as D3+3.");
  return { subject, move_types: enumSet(input.move_types, MOVE_TYPES, "move-distance.move_types"), maximum: limit };
}

function reservesArrival(input: Params): Params {
  const { this_rule: own, ...rest } = input;
  if (Object.keys(rest).join() !== "allow_first_round" || typeof rest.allow_first_round !== "boolean") {
    throw new TypeError("reserves-arrival parameters must be allow_first_round (true or false), with optional this_rule.");
  }
  if (own === undefined) return { allow_first_round: rest.allow_first_round };
  if (own !== true) throw new TypeError("reserves-arrival.this_rule is true or absent.");
  if (rest.allow_first_round !== true) throw new TypeError("reserves-arrival.this_rule says only that the rule's own set-up can be made in the first battle round, so allow_first_round is true.");
  return { allow_first_round: true, this_rule: true };
}

function countsAsMoved(input: Params): Params {
  const { units, ...rest } = input;
  if (!("move_type" in rest)) throw new TypeError("counts-as-moved.move_type is required.");
  exactKeys(rest, ["move_type", ...("window" in rest ? ["window"] : [])], "counts-as-moved");
  const result: Params = { move_type: enumValue(rest.move_type, ["normal"], "counts-as-moved.move_type") };
  if ("window" in rest) result.window = enumValue(rest.window, ["phase"], "counts-as-moved.window");
  if (units !== undefined) result.units = enumValue(units, ["permission-subject"], "counts-as-moved.units");
  return result;
}

export const MOVES_FAMILIES: readonly FlatFamily[] = [
  {
    id: "move-mode-choice",
    version: 1,
    role: "EFFECT",
    label: "Select a move's mode regardless of its restrictions",
    description: "\"You can select any consolidation mode for that consolidation move, regardless of that consolidation move's Before Moving restrictions\": the unit may pick a mode of the named move it otherwise could not. modes is \"any\" (every mode of that move) or the modes named (\"the objective consolidation mode\" is [objective]); ignore_before_moving is the \"regardless of … Before Moving restrictions\" clause.",
    starter: {"subject":"this-unit","move_types":[],"modes":"any","ignore_before_moving":true},
    parameterSchema: {
      "type": "object",
      "required": [
        "subject",
        "move_types",
        "modes"
      ],
      "properties": {
        "subject": {
          "enum": [
            "this-unit",
            "this-model",
            "antecedent"
          ]
        },
        "move_types": {
          "type": "array",
          "items": {
            "enum": [
              "normal",
              "advance",
              "fall-back",
              "charge",
              "pile-in",
              "consolidation",
              "surge",
              "scout",
              "ingress",
              "disembark",
              "embark",
              "pulse-jet"
            ]
          },
          "minItems": 1,
          "uniqueItems": true
        },
        "modes": {
          "anyOf": [
            {
              "const": "any"
            },
            {
              "type": "array",
              "items": {
                "enum": [
                  "ordered-retreat",
                  "desperate-escape",
                  "ongoing",
                  "engaging",
                  "objective",
                  "rapid",
                  "tactical",
                  "combat",
                  "emergency",
                  "assault"
                ]
              },
              "minItems": 1,
              "uniqueItems": true
            }
          ]
        },
        "ignore_before_moving": {
          "const": true,
          "x-optional": true
        }
      },
      "additionalProperties": false
    },
    normalize: moveModeChoice,
  },
  {
    id: "make-move",
    version: 7,
    role: "EFFECT",
    label: "Make a move",
    description: "The target makes a named kind of move: normal, Advance, Fall Back, charge, Pile In, Consolidation, Surge, Scout, ingress, disembark, embark, or Pulse Jet. The target can be this unit, this model, the selected unit, the unit an earlier leaf introduced (antecedent), the triggering unit (event-subject), or the units a unit-filter names right before the move (filtered-units). distance (inches, D3, D6, 2D6, or a dice amount plus a number such as D3+3) and ends_within_inches are optional. counts_as_move is optional: for rules that check what the unit did this turn, the move counts as a different named kind of move (or as Remaining Stationary). mode is the disembark mode the move uses (rapid, tactical, combat, emergency, assault, shock) and needs move_type disembark.",
    starter: {"subject":"this-unit","move_type":""},
    parameterSchema: {
      "type": "object",
      "required": [
        "subject",
        "move_type"
      ],
      "properties": {
        "subject": {
          "anyOf": [
            {
              "enum": [
                "this-unit",
                "this-model",
                "selected-unit",
                "antecedent",
                "event-subject",
                "filtered-units"
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
        "move_type": {
          "anyOf": [
            {
              "enum": [
                "normal",
                "advance",
                "fall-back",
                "charge",
                "pile-in",
                "consolidation",
                "surge",
                "scout",
                "ingress",
                "disembark",
                "embark",
                "pulse-jet"
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
        "distance": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0
            },
            {
              "enum": [
                "D3",
                "D6",
                "2D6"
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
            },
            {
              "type": "string",
              "pattern": "^\\d*D(3|6)(\\+\\d+)?$"
            }
          ]
        },
        "ends_within_inches": {
          "type": "integer",
          "minimum": 1,
          "maximum": 48
        },
        "counts_as_move": {
          "enum": [
            "normal",
            "advance",
            "fall-back",
            "charge",
            "pile-in",
            "consolidation",
            "surge",
            "scout",
            "ingress",
            "disembark",
            "embark",
            "pulse-jet",
            "remain-stationary"
          ]
        },
        "mode": {
          "enum": [
            "rapid",
            "tactical",
            "combat",
            "emergency",
            "assault",
            "shock"
          ],
          "x-only-when": {
            "move_type": [
              "disembark"
            ]
          },
          "x-optional": true
        }
      },
      "additionalProperties": false
    },
    normalize: makeMove,
  },
  {
    id: "reserves-arrival",
    version: 2,
    role: "RESTRICTION",
    label: "Arrives from reserves next Movement phase",
    description: "\"This unit can make an ingress move in your next Movement phase (including in your first turn)\": the unit set up into Strategic Reserves just before it returns in your next Movement phase; allow_first_round when that can be the first battle round. With this_rule, the set-up this rule describes keeps the timing the rule gives it (no next-Movement-phase arrival), and allow_first_round (true) lets it be made even in the first battle round (\"can make an ingress move in the first battle round using this rule\").",
    starter: {"allow_first_round":false},
    parameterSchema: {
      "type": "object",
      "required": [
        "allow_first_round"
      ],
      "properties": {
        "allow_first_round": {
          "type": "boolean"
        },
        "this_rule": {
          "const": true,
          "x-optional": true
        }
      },
      "additionalProperties": false
    },
    normalize: reservesArrival,
  },
  {
    id: "move-distance",
    version: 5,
    role: "EFFECT",
    label: "Moves go further",
    description: "\"Each time a model in your unit makes a Pile-in or Consolidation move, it can move up to 6\\\" instead of up to 3\\\"\": the named kinds of move go `bonus` inches further than normal (3 here), or, with a negative bonus, that many inches less far (\"-2\\\" from that pile-in move\"). maximum, in place of bonus, is the distance ceiling as printed: a number of inches (\"can move up to 4\\\"\") or a dice expression (\"can move up to D3+3\\\"\") for any move type, or unlimited for exactly one named Advance move (\"that Advance has no maximum distance\"), which changes that move's ceiling without creating another move. The subject can be the unit an earlier leaf introduced (antecedent, such as \"an enemy unit engaged with your unit\").",
    starter: {"subject":"this-unit","move_types":[],"bonus":null},
    parameterSchema: {
      "type": "object",
      "required": [
        "subject",
        "move_types"
      ],
      "properties": {
        "subject": {
          "enum": [
            "this-unit",
            "this-model",
            "antecedent"
          ]
        },
        "move_types": {
          "type": "array",
          "items": {
            "enum": [
              "normal",
              "advance",
              "fall-back",
              "charge",
              "pile-in",
              "consolidation",
              "surge",
              "scout",
              "ingress",
              "disembark",
              "embark",
              "pulse-jet"
            ]
          },
          "minItems": 1,
          "uniqueItems": true
        },
        "bonus": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 24
            },
            {
              "type": "integer",
              "minimum": -24,
              "maximum": -1
            }
          ],
          "x-optional": true
        },
        "maximum": {
          "anyOf": [
            {
              "const": "unlimited"
            },
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 24
            },
            {
              "type": "string",
              "pattern": "^\\d*D(3|6)(\\+\\d+)?$"
            }
          ]
        }
      },
      "additionalProperties": false,
      "anyOf": [
        {
          "required": [
            "bonus"
          ]
        },
        {
          "required": [
            "maximum"
          ]
        }
      ],
      "not": {
        "required": [
          "bonus",
          "maximum"
        ]
      }
    },
    normalize: moveDistance,
  },
  {
    id: "counts-as-moved",
    version: 2,
    role: "CONDITION",
    label: "Counts as having made a move",
    description: "The units a disembark permission before it allows count as having made a move of that kind this turn (or this phase, when window is phase). It qualifies that permission and gates nothing. Without units, those are the units a Transport carries; units permission-subject says the permission's own subject is the unit that disembarks (\"the bearer's unit can disembark … if it does, it counts as having made a Normal move\").",
    starter: {"move_type":""},
    parameterSchema: {
      "type": "object",
      "required": [
        "move_type"
      ],
      "properties": {
        "move_type": {
          "enum": [
            "normal"
          ]
        },
        "window": {
          "enum": [
            "phase"
          ]
        },
        "units": {
          "enum": [
            "permission-subject"
          ],
          "x-optional": true
        }
      },
      "additionalProperties": false
    },
    normalize: countsAsMoved,
  },
];
