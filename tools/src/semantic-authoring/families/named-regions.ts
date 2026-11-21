import type { ValidateFunction } from "ajv";
import { createValidator } from "../../schema-loader.js";
import {
  boundedInteger, enumValue, exactKeys,
} from "../family-validation.js";
import {
  type Params, ENTITY_ID,
} from "./movement-and-units-shared.js";
import type { FlatFamily } from "./types.js";

/** Named regions: the regions a rule produces and the state they grant. */

function namedRegionProducer(input: Params): Params {
  exactKeys(input, ["region_id", "owner_faction"], "named-region-producer");
  for (const key of ["region_id", "owner_faction"]) {
    if (typeof input[key] !== "string" || !ENTITY_ID.test(input[key] as string)) throw new TypeError(`named-region-producer.${key} must be a kebab-case entity id.`);
  }
  return { region_id: input.region_id, owner_faction: input.owner_faction };
}

const REGION_BRANCH_KINDS = ["reroll", "roll-modifier"] as const;
/** "any" is a re-roll with no subset restriction. */
const REGION_REROLL_SUBSETS = ["ones", "all-failures", "any"] as const;
const REGION_MODIFIER_OPERATIONS = ["add", "subtract"] as const;

function regionBranch(value: unknown, label: string): Params {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  const input = value as Params;
  const kind = enumValue(input.kind, REGION_BRANCH_KINDS, `${label}.kind`);
  const allowed = new Set(["kind", "roll", "weapon_keyword", "optional", ...(kind === "reroll" ? ["subset"] : ["operation", "value"])]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError(`${label} parameters must be kind, roll, weapon_keyword, optional, and ${kind === "reroll" ? "subset" : "operation, value"} only.`);
  }
  if (typeof input.roll !== "string" || !input.roll) throw new TypeError(`${label}.roll must be a nonblank string.`);
  // An absent optional is a mandatory branch.
  if (input.optional !== undefined && typeof input.optional !== "boolean") throw new TypeError(`${label}.optional must be true or false, or omitted.`);
  const result: Params = { kind, roll: input.roll, optional: input.optional === true };
  if (kind === "reroll") result.subset = enumValue(input.subset, REGION_REROLL_SUBSETS, `${label}.subset`);
  else {
    result.operation = enumValue(input.operation, REGION_MODIFIER_OPERATIONS, `${label}.operation`);
    result.value = boundedInteger(input.value, -20, 20, `${label}.value`);
  }
  if (input.weapon_keyword !== undefined) {
    if (typeof input.weapon_keyword !== "string" || !input.weapon_keyword) throw new TypeError(`${label}.weapon_keyword must be a nonblank string.`);
    result.weapon_keyword = input.weapon_keyword;
  }
  return result;
}

/** A non-empty list of distinct strings, kept in its own order. */
function distinctStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must list at least one string.`);
  for (const item of value) if (typeof item !== "string") throw new TypeError(`${label} must list strings only.`);
  if (new Set(value).size !== value.length) throw new TypeError(`${label} lists a value twice.`);
  return [...value] as string[];
}

const COMMON_SCHEMA = "https://40kdc.dev/schemas/defs/common.schema.json";
const EFFECT_SCHEMA = "https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json";
let recipeValidators: { region: ValidateFunction<unknown>; phaseExtension: ValidateFunction<unknown> } | undefined;

/** Recipe fragments are checked against the same closed contracts that accept compiled DSL output. */
function recipeFragment(value: unknown, label: string, which: "region" | "phaseExtension"): Params {
  if (!recipeValidators) {
    const ajv = createValidator();
    recipeValidators = {
      region: ajv.compile({ $ref: `${COMMON_SCHEMA}#/$defs/region-ref` }),
      phaseExtension: ajv.compile({ $ref: `${EFFECT_SCHEMA}#/$defs/named-region-phase-extension` }),
    };
  }
  const validate = recipeValidators[which];
  if (!validate(value)) throw new TypeError(`${label} must satisfy the canonical named-region contract: ${JSON.stringify(validate.errors ?? [])}`);
  return structuredClone(value) as Params;
}

const NAMED_REGION_REQUIRED = ["region_id", "owner_faction", "behavior", "membership_scope", "beneficiary_operator", "beneficiary_keywords", "default_branch", "qualified_branch"];
const NAMED_REGION_OPTIONAL = ["beneficiary_faction", "qualifies_by_keyword", "melee_or_visible_ranged", "proximity_extension", "baseline_region", "phase_extensions"];

function namedRegionState(input: Params): Params {
  const label = "named-region-state";
  exactKeys(input, [...NAMED_REGION_REQUIRED, ...NAMED_REGION_OPTIONAL.filter((key) => key in input)], label);
  const result: Params = {
    region_id: input.region_id,
    owner_faction: input.owner_faction,
    behavior: enumValue(input.behavior, ["aura", "passive"], `${label}.behavior`),
    membership_scope: enumValue(input.membership_scope, ["model", "whole-unit"], `${label}.membership_scope`),
    beneficiary_operator: enumValue(input.beneficiary_operator, ["and", "or"], `${label}.beneficiary_operator`),
    beneficiary_keywords: distinctStrings(input.beneficiary_keywords, `${label}.beneficiary_keywords`),
    default_branch: regionBranch(input.default_branch, `${label}.default_branch`),
    qualified_branch: regionBranch(input.qualified_branch, `${label}.qualified_branch`),
  };
  for (const key of ["region_id", "owner_faction"]) {
    if (typeof result[key] !== "string" || !ENTITY_ID.test(result[key] as string)) throw new TypeError(`${label}.${key} must be a kebab-case entity id.`);
  }
  if ("beneficiary_faction" in input) {
    const faction = input.beneficiary_faction;
    if (typeof faction !== "string" || !ENTITY_ID.test(faction)) throw new TypeError(`${label}.beneficiary_faction must be a kebab-case entity id.`);
    result.beneficiary_faction = faction;
  }
  if ("qualifies_by_keyword" in input) {
    const keyword = input.qualifies_by_keyword;
    if (typeof keyword !== "string" || keyword.trim() === "") throw new TypeError(`${label}.qualifies_by_keyword must be a nonblank keyword.`);
    result.qualifies_by_keyword = keyword;
  }
  if ("melee_or_visible_ranged" in input) {
    if (input.melee_or_visible_ranged !== true) throw new TypeError(`${label}.melee_or_visible_ranged must be true, or omitted.`);
    result.melee_or_visible_ranged = true;
  }
  if ("proximity_extension" in input) {
    const ext = input.proximity_extension as Params;
    if (ext === null || typeof ext !== "object" || Array.isArray(ext)) throw new TypeError(`${label}.proximity_extension must be an object.`);
    exactKeys(ext, ["gate_ref", "keywords", "radius_inches"], `${label}.proximity_extension`);
    if (typeof ext.gate_ref !== "string" || !ext.gate_ref) throw new TypeError(`${label}.proximity_extension.gate_ref must be a nonblank string.`);
    if (typeof ext.radius_inches !== "number" || !(ext.radius_inches > 0)) throw new TypeError(`${label}.proximity_extension.radius_inches must be a positive number.`);
    result.proximity_extension = {
      gate_ref: ext.gate_ref,
      keywords: distinctStrings(ext.keywords, `${label}.proximity_extension.keywords`),
      radius_inches: ext.radius_inches,
    };
  }
  if ("baseline_region" in input) {
    const baseline = input.baseline_region;
    if (baseline === null || typeof baseline !== "object" || Array.isArray(baseline)) throw new TypeError(`${label}.baseline_region must be an object.`);
    result.baseline_region = recipeFragment(baseline, `${label}.baseline_region`, "region");
  }
  if ("phase_extensions" in input) {
    const phases = input.phase_extensions;
    if (!Array.isArray(phases) || phases.length === 0) throw new TypeError(`${label}.phase_extensions must be a non-empty array.`);
    for (const item of phases) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) throw new TypeError(`${label}.phase_extensions items must be objects.`);
      const comparison = ((((item as Params).condition as Params | undefined)?.parameters as Params | undefined)?.proportion as Params | undefined)?.comparison;
      if (comparison !== undefined && !["gt", "gte", "lt", "lte", "eq"].includes(String(comparison))) {
        throw new TypeError(`${label}.phase_extensions condition proportion comparison must be gt, gte, lt, lte, or eq.`);
      }
    }
    result.phase_extensions = phases.map((item, index) => recipeFragment(item, `${label}.phase_extensions[${index}]`, "phaseExtension"));
  }
  return result;
}

export const NAMED_REGIONS_FAMILIES: readonly FlatFamily[] = [
  {
    id: "named-region-producer",
    version: 1,
    role: "EFFECT",
    label: "Declare a named region",
    description: "\"Certain areas of the battlefield are considered to be within your army's Shadow of Chaos, as follows: …\": declares the named region an army rule produces — its own deployment zone for the battle, extended into no-man's-land and the opponent's deployment zone for a phase once the army holds half that zone's objective markers at its start — with no effect of its own. Other rules name it through in-region's rule-region.",
    starter: {"region_id":"","owner_faction":""},
    parameterSchema: {
      "type": "object",
      "required": [
        "region_id",
        "owner_faction"
      ],
      "properties": {
        "region_id": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9-]*[a-z0-9]$"
        },
        "owner_faction": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9-]*[a-z0-9]$"
        }
      },
      "additionalProperties": false
    },
    normalize: namedRegionProducer,
  },
  {
    id: "named-region-state",
    version: 3,
    role: "EFFECT",
    label: "Named region",
    description: "A named battlefield region this army produces (starting as its own deployment zone, extended into no-man's-land and the opponent's deployment zone once it holds half that zone's objective markers) and what it does for eligible units within it. Must be the ability's only leaf. region_id, owner_faction and beneficiary_faction are kebab-case entity ids and qualifies_by_keyword is a nonblank keyword. Optional baseline_region and phase_extensions are canonical recipe values for reviewed named-region variants, checked against the closed region-ref and named-region-phase-extension contracts.",
    starter: {"region_id":"","owner_faction":"","behavior":"","membership_scope":"","beneficiary_operator":"","beneficiary_keywords":[],"default_branch":{"kind":"","roll":"","optional":false},"qualified_branch":{"kind":"","roll":"","optional":false}},
    parameterSchema: {
      "type": "object",
      "$defs": {
        "name": {
          "type": "string",
          "minLength": 1
        },
        "branch": {
          "type": "object",
          "required": [
            "kind",
            "roll"
          ],
          "properties": {
            "kind": {
              "enum": [
                "reroll",
                "roll-modifier"
              ]
            },
            "roll": {
              "$ref": "#/$defs/name"
            },
            "subset": {
              "enum": [
                "ones",
                "all-failures",
                "any"
              ],
              "x-only-when": {
                "kind": [
                  "reroll"
                ]
              }
            },
            "operation": {
              "enum": [
                "add",
                "subtract"
              ],
              "x-only-when": {
                "kind": [
                  "roll-modifier"
                ]
              }
            },
            "value": {
              "type": "integer",
              "x-only-when": {
                "kind": [
                  "roll-modifier"
                ]
              }
            },
            "weapon_keyword": {
              "$ref": "#/$defs/name"
            },
            "optional": {
              "type": "boolean"
            }
          },
          "additionalProperties": false
        }
      },
      "required": [
        "region_id",
        "owner_faction",
        "behavior",
        "membership_scope",
        "beneficiary_operator",
        "beneficiary_keywords",
        "default_branch",
        "qualified_branch"
      ],
      "properties": {
        "region_id": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9-]*[a-z0-9]$"
        },
        "owner_faction": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9-]*[a-z0-9]$"
        },
        "behavior": {
          "enum": [
            "aura",
            "passive"
          ]
        },
        "membership_scope": {
          "enum": [
            "model",
            "whole-unit"
          ]
        },
        "beneficiary_operator": {
          "enum": [
            "and",
            "or"
          ]
        },
        "beneficiary_keywords": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/name"
          },
          "minItems": 1,
          "uniqueItems": true
        },
        "beneficiary_faction": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9-]*[a-z0-9]$",
          "x-optional": true
        },
        "qualifies_by_keyword": {
          "type": "string",
          "pattern": "\\S",
          "x-optional": true
        },
        "melee_or_visible_ranged": {
          "type": "boolean"
        },
        "proximity_extension": {
          "type": "object",
          "required": [
            "gate_ref",
            "keywords",
            "radius_inches"
          ],
          "properties": {
            "gate_ref": {
              "$ref": "#/$defs/name"
            },
            "keywords": {
              "type": "array",
              "items": {
                "$ref": "#/$defs/name"
              },
              "minItems": 1,
              "uniqueItems": true
            },
            "radius_inches": {
              "type": "number",
              "exclusiveMinimum": 0
            }
          },
          "additionalProperties": false
        },
        "default_branch": {
          "$ref": "#/$defs/branch"
        },
        "qualified_branch": {
          "$ref": "#/$defs/branch"
        },
        "baseline_region": {
          "$ref": "https://40kdc.dev/schemas/defs/common.schema.json#/$defs/region-ref",
          "x-optional": true
        },
        "phase_extensions": {
          "type": "array",
          "items": {
            "$ref": "https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json#/$defs/named-region-phase-extension"
          },
          "minItems": 1,
          "x-optional": true
        }
      },
      "additionalProperties": false
    },
    normalize: namedRegionState,
  },
];
