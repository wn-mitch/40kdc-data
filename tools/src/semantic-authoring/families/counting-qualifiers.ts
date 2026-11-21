import {
  boundedInteger, enumValue, exactKeys,
} from "../family-validation.js";
import {
  type Params, ANTECEDENT, ENTITY_ID, DICE,
} from "./movement-and-units-shared.js";
import type { FlatFamily } from "./types.js";

/** Counting qualifiers: count scales and their caps, membership and unit size. */

const COUNT_SCALE_COUNTS = ["following-filter", "following-items"] as const;
const MODELS_EQUIPPED_WITH = "models-equipped-with";

function countScale(input: Params): Params {
  const { wargear, timing, ...rest } = input;
  const equipped = rest.counts === MODELS_EQUIPPED_WITH;
  if (equipped) {
    if (typeof wargear !== "string" || !ENTITY_ID.test(wargear)) throw new TypeError("count-scale counts models-equipped-with needs wargear, a kebab-case wargear id.");
    if (timing === "on-apply") throw new TypeError("count-scale counts models-equipped-with is live; an on-apply count is not defined for it.");
  } else if ("wargear" in input) throw new TypeError("count-scale.wargear names the wargear of counts models-equipped-with.");
  const checkedTiming = "timing" in input ? enumValue(timing, ["live", "on-apply"], "count-scale.timing") : undefined;
  if (checkedTiming === "on-apply" && rest.counts === "following-items") throw new TypeError("count-scale.timing on-apply counts a fixed set once; following-items counts one item at a time.");
  exactKeys(rest, ["per", ...("counts" in rest ? ["counts"] : [])], "count-scale");
  const per = boundedInteger(rest.per, 1, 20, "count-scale.per");
  const result: Params = { per };
  if (equipped) {
    result.counts = MODELS_EQUIPPED_WITH;
    result.wargear = wargear;
  } else if ("counts" in rest) {
    const counts = enumValue(rest.counts, COUNT_SCALE_COUNTS, "count-scale.counts");
    if (counts === "following-items" && per !== 1) throw new TypeError("count-scale counts following-items one item at a time; per must be 1.");
    result.counts = counts;
  }
  if (checkedTiming === "on-apply") result.timing = "on-apply";
  return result;
}

function scaleCap(input: Params): Params {
  exactKeys(input, ["max"], "scale-cap");
  return { max: boundedInteger(input.max, 1, 99, "scale-cap.max") };
}

function membership(input: Params): Params {
  exactKeys(input, ["relation", "of"], "membership");
  const relation = enumValue(input.relation, ["in", "embarked-in", "in-or-embarked-in"], "membership.relation");
  const of = enumValue(input.of, ["this-unit", "this-model", "stratagem-target", ANTECEDENT], "membership.of");
  if (of === "stratagem-target" && relation !== "in") throw new TypeError("membership of a Stratagem's target is only a model of that unit (relation in).");
  if (of === ANTECEDENT && relation !== "in") throw new TypeError("membership of the moment's unit is only a model of that unit (relation in).");
  if (relation === "in" && of === "this-model") throw new TypeError("membership: a model is not in this model; name this-unit, or embarked-in this-model.");
  if (relation === "in-or-embarked-in" && of !== "this-unit") throw new TypeError("membership in-or-embarked-in names this-unit (its models, or the models embarked within it).");
  return { relation, of };
}

function unitSize(input: Params): Params {
  exactKeys(input, ["models"], "unit-size");
  if (typeof input.models === "string") {
    const dice = input.models.trim().toUpperCase();
    if (!DICE.test(dice)) throw new TypeError("unit-size.models is a whole number from 1 to 20, or a dice amount (D3, D6, D3+1, 2D6).");
    return { models: dice };
  }
  return { models: boundedInteger(input.models, 1, 20, "unit-size.models") };
}

export const COUNTING_QUALIFIERS_FAMILIES: readonly FlatFamily[] = [
  {
    id: "scale-cap",
    version: 1,
    role: "CONDITION",
    label: "Cap on a scaled amount",
    description: "\"(to a maximum of +3 A)\", \"(to a maximum of 3)\": the amount a count-scale in the same clause scales never exceeds `max`. A cap on a total of mortal wounds stays mortal-wounds.max.",
    starter: {"max":1},
    parameterSchema: {
      "type": "object",
      "required": [
        "max"
      ],
      "properties": {
        "max": {
          "type": "integer",
          "minimum": 1,
          "maximum": 99
        }
      },
      "additionalProperties": false
    },
    normalize: scaleCap,
  },
  {
    id: "membership",
    version: 3,
    role: "CONDITION",
    label: "Counted model belongs to a unit",
    description: "Which unit the models of the model-level unit-filter beside it belong to (right before or right after it, with only unit-owners between): \"in this unit\" / \"in your unit\" {in, this-unit}; \"embarked within this model\" {embarked-in, this-model}; \"embarked within this unit\" {embarked-in, this-unit}; \"in this unit (or embarked within this model)\" {in-or-embarked-in, this-unit}. of can also be stratagem-target, the Stratagem's target unit (\"in your unit\" on a Stratagem), or antecedent, the unit the record's moment names (\"that unit's Character models\" after \"when a friendly X unit is selected\"); only relation in can name either.",
    starter: {"relation":"","of":""},
    parameterSchema: {
      "type": "object",
      "required": [
        "relation",
        "of"
      ],
      "properties": {
        "relation": {
          "enum": [
            "in",
            "embarked-in",
            "in-or-embarked-in"
          ]
        },
        "of": {
          "enum": [
            "this-unit",
            "this-model",
            "stratagem-target",
            "antecedent"
          ]
        }
      },
      "additionalProperties": false
    },
    normalize: membership,
  },
  {
    id: "unit-size",
    version: 2,
    role: "CONDITION",
    label: "Models in an added unit",
    description: "\"contains 1 model\", \"containing D3 models\": the unit the add-unit before it adds has this many models, a whole number from 1 to 20 or a dice amount (D3, D6, D3+1, 2D6); a count-scale after it (\"for each model in this unit\") scales that number.",
    starter: {"models":1},
    parameterSchema: {
      "type": "object",
      "required": [
        "models"
      ],
      "properties": {
        "models": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 20
            },
            {
              "type": "string",
              "pattern": "^\\d*D(3|6)(\\+\\d+)?$"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    normalize: unitSize,
  },
  {
    id: "count-scale",
    version: 3,
    role: "CONDITION",
    label: "Amount per counted thing",
    description: "\"for each\" (per 1) or \"for every N\" (per N): the amount of the effect in its sentence (the effect before this leaf, else the first effect after it) applies once per `per` of what it counts. counts following-filter (the default) counts the units or models the unit-filter right after this leaf names, narrowed by the aura-range or membership leaves after that filter; following-items counts the bulleted items after it whose conditions all hold (per must be 1); models-equipped-with, with a wargear id, counts the models in the bearer's unit equipped with that wargear. timing is live (the default, and the same leaf as no timing) or on-apply, a count in a lasting rule taken once when the rule applies; on-apply cannot count following-items or models-equipped-with. \"(rounding down)\" is a connective: the count is always rounded down.",
    starter: {"per":1},
    parameterSchema: {
      "enum": [
        "following-filter",
        "following-items",
        "models-equipped-with"
      ],
      "x-optional": true,
      "properties": {
        "wargear": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9-]*[a-z0-9]$",
          "x-only-when": {
            "counts": [
              "models-equipped-with"
            ]
          },
          "x-optional": true
        }
      }
    },
    normalize: countScale,
  },
];
