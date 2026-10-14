import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, enumSet, enumValue, exactKeys } from "./family-validation.js";

/**
 * `named-region-state` (batch 5): one leaf compiles a whole ability. Its DSL shape
 * (`schemas/enrichment/ability-dsl/effect.schema.json#/$defs/named-region-state-effect`, via
 * `named-region-producer`/`named-region-consumer`) is mostly a fixed template — every authored
 * record (`flow-of-magic-thousand-sons`, `power-matrix-necrons`, `hallowed-ground-grey-knights`)
 * shares the same `producer.mode: "complete"`, the same one-item `baseline` and the same
 * two-item `phase_extensions` (no-mans-land / opponent-deployment-zone, each snapshotting
 * majority control at phase start) — this file hardcodes that template in `compile-containers.ts`.
 * What genuinely varies per record is parameterized here: which region, who benefits, how a
 * model/unit qualifies for the default vs. the qualified branch, the two branches' effects, and
 * an optional unit-proximity extra zone (Hallowed Ground's Purifier Squad aura).
 */

const MEMBERSHIP_SCOPES = ["model", "whole-unit"] as const;
const BENEFICIARY_OPERATORS = ["and", "or"] as const;
const BEHAVIORS = ["aura", "passive"] as const;
/** The only two branch-effect shapes the three authored records need; both are closed rolls. */
const BRANCH_KINDS = ["reroll", "roll-modifier"] as const;
/** "any" is this family's placeholder for a re-roll with no subset restriction: the DSL spells it `result_scope: "any-result"` instead of a `subset` value. */
const REROLL_SUBSETS = ["ones", "all-failures", "any"] as const;
const MODIFIER_OPERATIONS = ["add", "subtract"] as const;

/**
 * The wire form of this schema counts against the Luna request budget (`activeRegistry` in
 * proposal.ts sends every active family's `parameterSchema` on every request), so the two
 * branches and the repeated `{type:"string",minLength:1}` shape are factored through `$defs`
 * rather than inlined twice — nothing here runs AJV against `parameterSchema` (it is only
 * hashed for drift and lightly introspected by the describer audit and the leaf-form UI, neither
 * of which resolves `$ref`), so this is a size optimization only, not a validation change.
 */
export const NAMED_REGION_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "named-region-state",
    version: 1,
    role: "EFFECT",
    label: "Named region",
    description: "A named battlefield region this army produces (starting as its own deployment zone, extended into no-man's-land and the opponent's deployment zone once it holds half that zone's objective markers) and what it does for eligible units within it. Must be the ability's only leaf.",
    starter: {
      region_id: "", owner_faction: "", behavior: "", membership_scope: "",
      beneficiary_operator: "", beneficiary_keywords: [],
      default_branch: { kind: "", roll: "", optional: false }, qualified_branch: { kind: "", roll: "", optional: false },
    },
    parameterSchema: {
      type: "object",
      "$defs": {
        name: { type: "string", minLength: 1 },
        branch: {
          type: "object",
          required: ["kind", "roll"],
          properties: {
            kind: { enum: BRANCH_KINDS },
            roll: { "$ref": "#/$defs/name" },
            subset: { enum: REROLL_SUBSETS, "x-only-when": { kind: ["reroll"] } },
            operation: { enum: MODIFIER_OPERATIONS, "x-only-when": { kind: ["roll-modifier"] } },
            value: { type: "integer", "x-only-when": { kind: ["roll-modifier"] } },
            weapon_keyword: { "$ref": "#/$defs/name" },
            optional: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
      required: ["region_id", "owner_faction", "behavior", "membership_scope", "beneficiary_operator", "beneficiary_keywords", "default_branch", "qualified_branch"],
      properties: {
        region_id: { "$ref": "#/$defs/name" },
        owner_faction: { "$ref": "#/$defs/name" },
        behavior: { enum: BEHAVIORS },
        // "model" narrows the qualifying condition to this model wholly within the region;
        // "whole-unit" narrows it to every model of the unit wholly within.
        membership_scope: { enum: MEMBERSHIP_SCOPES },
        beneficiary_operator: { enum: BENEFICIARY_OPERATORS },
        beneficiary_keywords: { type: "array", items: { "$ref": "#/$defs/name" }, minItems: 1, uniqueItems: true },
        beneficiary_faction: { "$ref": "#/$defs/name" },
        // Present only when a unit also qualifies by keyword alone, without needing to be in the
        // region (Hallowed Ground: a Purifier Squad qualifies whether or not it stands in it).
        qualifies_by_keyword: { "$ref": "#/$defs/name" },
        // Present only when the qualified branch is further gated by the attack's own kind
        // (Hallowed Ground: melee, or ranged only while the target is visible).
        melee_or_visible_ranged: { type: "boolean" },
        proximity_extension: {
          type: "object",
          required: ["gate_ref", "keywords", "radius_inches"],
          properties: {
            gate_ref: { "$ref": "#/$defs/name" },
            keywords: { type: "array", items: { "$ref": "#/$defs/name" }, minItems: 1, uniqueItems: true },
            radius_inches: { type: "number", exclusiveMinimum: 0 },
          },
          additionalProperties: false,
        },
        default_branch: { "$ref": "#/$defs/branch" },
        qualified_branch: { "$ref": "#/$defs/branch" },
      },
      additionalProperties: false,
    },
  },
];

function normalizeBranch(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  const input = value as Record<string, unknown>;
  const kind = enumValue(input.kind, BRANCH_KINDS, `${label}.kind`);
  const allowed = new Set(["kind", "roll", "weapon_keyword", "optional", ...(kind === "reroll" ? ["subset"] : ["operation", "value"])]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError(`${label} parameters must be kind, roll, weapon_keyword, optional, and ${kind === "reroll" ? "subset" : "operation, value"} only.`);
  }
  if (typeof input.roll !== "string" || !input.roll) throw new TypeError(`${label}.roll must be a nonblank string.`);
  const result: Record<string, unknown> = { kind, roll: input.roll, optional: Boolean(input.optional) };
  if (kind === "reroll") result.subset = enumValue(input.subset, REROLL_SUBSETS, `${label}.subset`);
  else {
    result.operation = enumValue(input.operation, MODIFIER_OPERATIONS, `${label}.operation`);
    result.value = boundedInteger(input.value, -20, 20, `${label}.value`);
  }
  if (input.weapon_keyword !== undefined) {
    if (typeof input.weapon_keyword !== "string" || !input.weapon_keyword) throw new TypeError(`${label}.weapon_keyword must be a nonblank string.`);
    result.weapon_keyword = input.weapon_keyword;
  }
  return result;
}

export function normalizeNamedRegionParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "named-region-state") return null;
  const optionalKeys = ["beneficiary_faction", "qualifies_by_keyword", "melee_or_visible_ranged", "proximity_extension"].filter((key) => key in input);
  exactKeys(input, ["region_id", "owner_faction", "behavior", "membership_scope", "beneficiary_operator", "beneficiary_keywords", "default_branch", "qualified_branch", ...optionalKeys], family);
  const result: Record<string, unknown> = {
    region_id: String(input.region_id),
    owner_faction: String(input.owner_faction),
    behavior: enumValue(input.behavior, BEHAVIORS, "named-region-state.behavior"),
    membership_scope: enumValue(input.membership_scope, MEMBERSHIP_SCOPES, "named-region-state.membership_scope"),
    beneficiary_operator: enumValue(input.beneficiary_operator, BENEFICIARY_OPERATORS, "named-region-state.beneficiary_operator"),
    beneficiary_keywords: enumSet(input.beneficiary_keywords, (input.beneficiary_keywords as string[]) ?? [], "named-region-state.beneficiary_keywords"),
    default_branch: normalizeBranch(input.default_branch, "named-region-state.default_branch"),
    qualified_branch: normalizeBranch(input.qualified_branch, "named-region-state.qualified_branch"),
  };
  if (!Array.isArray(input.region_id) && !result.region_id) throw new TypeError("named-region-state.region_id must be a nonblank string.");
  if ("beneficiary_faction" in input) result.beneficiary_faction = String(input.beneficiary_faction);
  if ("qualifies_by_keyword" in input) result.qualifies_by_keyword = String(input.qualifies_by_keyword);
  if ("melee_or_visible_ranged" in input) {
    if (input.melee_or_visible_ranged !== true) throw new TypeError("named-region-state.melee_or_visible_ranged must be true, or omitted.");
    result.melee_or_visible_ranged = true;
  }
  if ("proximity_extension" in input) {
    const ext = input.proximity_extension as Record<string, unknown>;
    if (ext === null || typeof ext !== "object" || Array.isArray(ext)) throw new TypeError("named-region-state.proximity_extension must be an object.");
    exactKeys(ext, ["gate_ref", "keywords", "radius_inches"], "named-region-state.proximity_extension");
    if (typeof ext.gate_ref !== "string" || !ext.gate_ref) throw new TypeError("named-region-state.proximity_extension.gate_ref must be a nonblank string.");
    if (typeof ext.radius_inches !== "number" || !(ext.radius_inches > 0)) throw new TypeError("named-region-state.proximity_extension.radius_inches must be a positive number.");
    result.proximity_extension = {
      gate_ref: ext.gate_ref,
      keywords: enumSet(ext.keywords, (ext.keywords as string[]) ?? [], "named-region-state.proximity_extension.keywords"),
      radius_inches: ext.radius_inches,
    };
  }
  return result;
}
