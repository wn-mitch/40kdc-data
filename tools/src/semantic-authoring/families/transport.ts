import {
  boundedInteger, enumValue, keySet,
} from "../family-validation.js";
import {
  type Params,
} from "./movement-and-units-shared.js";
import type { FlatFamily } from "./types.js";

/** Transport capacity and what embarked units may do. */

function nonblankString(value: unknown, label: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value;
  throw new TypeError(`${label} must be a nonblank string.`);
}

const TRANSPORT_SHAPES = ["grouped-models", "fixed-model-spaces", "equivalent-model", "capacity"] as const;
const TRANSPORT_SUBJECT_KINDS = ["unit-models", "single-model"] as const;
const TRANSPORT_ELIGIBILITY_KINDS = ["requires-capacity-keyword", "embark-as-keyword"] as const;

function transportCapacity(input: Params): Params {
  const family = "transport-capacity";
  const shape = enumValue(input.shape, TRANSPORT_SHAPES, "transport-capacity.shape");
  if (shape === "capacity") {
    keySet(input, ["shape", "capacity"], ["capacity_keywords"], family);
    const result: Params = { shape, capacity: boundedInteger(input.capacity, 1, 26, "transport-capacity.capacity") };
    if (input.capacity_keywords !== undefined) {
      const keywords = input.capacity_keywords;
      if (!Array.isArray(keywords) || keywords.length === 0) throw new TypeError("transport-capacity.capacity_keywords must be a nonempty list of strings.");
      result.capacity_keywords = keywords.map((item) => nonblankString(item, "transport-capacity.capacity_keywords"));
    }
    return result;
  }
  // The three occupancy shapes share subject_kind, an optional model_keyword, and an optional
  // eligibility kind+keyword pair, given together or not at all.
  const eligibilityOptional = ["model_keyword", "transport_eligibility_kind", "transport_eligibility_keyword"];
  const shared = () => {
    const result: Params = { shape, subject_kind: enumValue(input.subject_kind, TRANSPORT_SUBJECT_KINDS, "transport-capacity.subject_kind") };
    if (input.model_keyword !== undefined) result.model_keyword = nonblankString(input.model_keyword, "transport-capacity.model_keyword");
    const hasKind = input.transport_eligibility_kind !== undefined;
    if (hasKind !== (input.transport_eligibility_keyword !== undefined)) throw new TypeError("transport-capacity: transport_eligibility_kind and transport_eligibility_keyword must be given together.");
    if (hasKind) {
      result.transport_eligibility_kind = enumValue(input.transport_eligibility_kind, TRANSPORT_ELIGIBILITY_KINDS, "transport-capacity.transport_eligibility_kind");
      result.transport_eligibility_keyword = nonblankString(input.transport_eligibility_keyword, "transport-capacity.transport_eligibility_keyword");
    }
    return result;
  };
  if (shape === "grouped-models") {
    keySet(input, ["shape", "subject_kind", "models_per_group", "spaces_per_group", "rounding"], eligibilityOptional, family);
    const result = shared();
    result.models_per_group = boundedInteger(input.models_per_group, 1, 50, "transport-capacity.models_per_group");
    result.spaces_per_group = boundedInteger(input.spaces_per_group, 1, 50, "transport-capacity.spaces_per_group");
    result.rounding = enumValue(input.rounding, ["up", "down"], "transport-capacity.rounding");
    if (result.subject_kind === "single-model" && result.models_per_group !== 1) {
      throw new TypeError("transport-capacity.models_per_group must be 1 when subject_kind is single-model.");
    }
    return result;
  }
  if (shape === "fixed-model-spaces") {
    keySet(input, ["shape", "subject_kind", "spaces_per_model"], eligibilityOptional, family);
    const result = shared();
    // 0: those models take up no Transport capacity.
    result.spaces_per_model = boundedInteger(input.spaces_per_model, 0, 50, "transport-capacity.spaces_per_model");
    return result;
  }
  keySet(input, ["shape", "subject_kind", "equivalent_by"], [...eligibilityOptional, "equivalent_model_keyword", "equivalent_model_count"], family);
  const result = shared();
  const by = enumValue(input.equivalent_by, ["keyword", "count"], "transport-capacity.equivalent_by");
  result.equivalent_by = by;
  if (by === "keyword") {
    if (input.equivalent_model_keyword === undefined || input.equivalent_model_count !== undefined) {
      throw new TypeError("transport-capacity: equivalent_by keyword needs equivalent_model_keyword only.");
    }
    result.equivalent_model_keyword = nonblankString(input.equivalent_model_keyword, "transport-capacity.equivalent_model_keyword");
  } else {
    if (input.equivalent_model_count === undefined || input.equivalent_model_keyword !== undefined) {
      throw new TypeError("transport-capacity: equivalent_by count needs equivalent_model_count only.");
    }
    result.equivalent_model_count = boundedInteger(input.equivalent_model_count, 1, 20, "transport-capacity.equivalent_model_count");
  }
  return result;
}

function embarkedPermission(input: Params): Params {
  const stray = Object.keys(input).filter((key) => key !== "subject");
  if (stray.length) throw new TypeError(`embarked-permission has no parameter ${stray[0]}.`);
  if (input.subject !== "this-unit") throw new TypeError("embarked-permission.subject can only be this-unit.");
  return { subject: "this-unit" };
}

export const TRANSPORT_FAMILIES: readonly FlatFamily[] = [
  {
    id: "transport-capacity",
    version: 2,
    role: "EFFECT",
    label: "Transport capacity occupancy",
    description: "How models count against this Transport's capacity, in one of four shapes: grouped-models (models_per_group occupy spaces_per_group, rounded up or down), fixed-model-spaces (each model occupies spaces_per_model, which can be 0: \"takes up 0 transport capacity\"), equivalent-model (each model counts as another kind of model, named by transport_eligibility_kind/transport_eligibility_keyword and equivalent_by/equivalent_model_keyword/equivalent_model_count), or capacity (this model's own Transport capacity, and which units are eligible to embark). model_keyword and the eligibility pair are optional on the first three shapes.",
    starter: {"shape":""},
    parameterSchema: {
      "type": "object",
      "required": [
        "shape"
      ],
      "properties": {
        "shape": {
          "enum": [
            "grouped-models",
            "fixed-model-spaces",
            "equivalent-model",
            "capacity"
          ]
        },
        "subject_kind": {
          "enum": [
            "unit-models",
            "single-model"
          ],
          "x-only-when": {
            "shape": [
              "grouped-models",
              "fixed-model-spaces",
              "equivalent-model"
            ]
          }
        },
        "model_keyword": {
          "anyOf": [
            {
              "enum": [
                "Gunner"
              ]
            },
            {
              "type": "string",
              "minLength": 1
            }
          ],
          "x-only-when": {
            "shape": [
              "grouped-models",
              "fixed-model-spaces",
              "equivalent-model"
            ]
          }
        },
        "transport_eligibility_kind": {
          "enum": [
            "requires-capacity-keyword",
            "embark-as-keyword"
          ],
          "x-only-when": {
            "shape": [
              "grouped-models",
              "fixed-model-spaces",
              "equivalent-model"
            ]
          }
        },
        "transport_eligibility_keyword": {
          "anyOf": [
            {
              "enum": [
                "Firestorm Ridgerunner"
              ]
            },
            {
              "type": "string",
              "minLength": 1
            }
          ],
          "x-only-when": {
            "shape": [
              "grouped-models",
              "fixed-model-spaces",
              "equivalent-model"
            ]
          }
        },
        "models_per_group": {
          "type": "integer",
          "minimum": 1,
          "x-only-when": {
            "shape": [
              "grouped-models"
            ]
          }
        },
        "spaces_per_group": {
          "type": "integer",
          "minimum": 1,
          "x-only-when": {
            "shape": [
              "grouped-models"
            ]
          }
        },
        "rounding": {
          "enum": [
            "up",
            "down"
          ],
          "x-only-when": {
            "shape": [
              "grouped-models"
            ]
          }
        },
        "spaces_per_model": {
          "type": "integer",
          "minimum": 0,
          "x-only-when": {
            "shape": [
              "fixed-model-spaces"
            ]
          }
        },
        "equivalent_by": {
          "enum": [
            "keyword",
            "count"
          ],
          "x-only-when": {
            "shape": [
              "equivalent-model"
            ]
          }
        },
        "equivalent_model_keyword": {
          "anyOf": [
            {
              "enum": [
                "Ork Boy"
              ]
            },
            {
              "type": "string",
              "minLength": 1
            }
          ],
          "x-only-when": {
            "shape": [
              "equivalent-model"
            ],
            "equivalent_by": [
              "keyword"
            ]
          }
        },
        "equivalent_model_count": {
          "type": "integer",
          "minimum": 1,
          "x-only-when": {
            "shape": [
              "equivalent-model"
            ],
            "equivalent_by": [
              "count"
            ]
          }
        },
        "capacity": {
          "type": "integer",
          "minimum": 1,
          "x-only-when": {
            "shape": [
              "capacity"
            ]
          }
        },
        "capacity_keywords": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "enum": [
                  "CHARACTER"
                ]
              },
              {
                "type": "string",
                "minLength": 1
              }
            ]
          },
          "minItems": 1,
          "uniqueItems": true,
          "x-only-when": {
            "shape": [
              "capacity"
            ]
          }
        }
      },
      "additionalProperties": false
    },
    normalize: transportCapacity,
  },
  {
    id: "embarked-permission",
    version: 1,
    role: "CONDITION",
    label: "Designation allowed while embarked",
    description: "This ability can be used even though its unit is embarked within a Transport. It qualifies the persistent designation before it in its fragment and gates nothing.",
    starter: {"subject":"this-unit"},
    parameterSchema: {
      "type": "object",
      "required": [
        "subject"
      ],
      "properties": {
        "subject": {
          "enum": [
            "this-unit"
          ]
        }
      },
      "additionalProperties": false
    },
    normalize: embarkedPermission,
  },
];
