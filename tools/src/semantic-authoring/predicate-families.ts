import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, booleanValue, enumValue, exactKeys } from "./family-validation.js";
import { ENTITY_ID_PATTERN } from "./core-families.js";

/**
 * New predicate families (batch 6): identity, composition, history and position conditions the
 * old `unit-*` families never covered (owner, ability, model count, wounds, region, objectives).
 * Each compiles in `compile-conditions.ts`'s `condition()`, under its own family id (never the
 * name of an existing `targeting-families.ts` family), so nothing there needs to change.
 */

/** Every unit-ref role the describer already renders a phrase for (`condition-refs.ts` ROLE_PHRASES). */
export const SUBJECT_REF = [
  "this-unit", "this-model", "model-in-this-unit", "attacker", "defender",
  "event-subject", "event-object", "selected-unit", "recipient",
] as const;

const UNIT_KEYWORD = /^[A-Z][A-Z0-9' -]*[A-Z0-9]$/u;

const withSubjectAndNegation = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  required,
  properties: { subject: { enum: SUBJECT_REF }, negated: { type: "boolean" }, ...properties },
  additionalProperties: false,
});

function subjectOptional(input: Record<string, unknown>): string | undefined {
  return "subject" in input ? enumValue(input.subject, SUBJECT_REF, "subject") : undefined;
}

export const PREDICATE_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "rule-active",
    version: 1,
    role: "CONDITION",
    label: "A named rule is active",
    description: "Requires a named army or detachment rule (a doctrine, Waaagh!, or pact) to be active right now.",
    starter: { rule: "" },
    parameterSchema: { type: "object", required: ["rule"], properties: { rule: { type: "string", pattern: ENTITY_ID_PATTERN.source }, negated: { type: "boolean" } }, additionalProperties: false },
  },
  {
    id: "unit-owner",
    version: 1,
    role: "CONDITION",
    label: "Unit's owner",
    description: "Requires a unit to be a friendly or an enemy unit.",
    starter: { owner: "" },
    parameterSchema: withSubjectAndNegation({ owner: { enum: ["friendly", "enemy"] } }, ["owner"]),
  },
  {
    id: "unit-has-ability",
    version: 1,
    role: "CONDITION",
    label: "Unit has a named ability",
    description: "Requires a unit to have a named ability (a core ability, Discipline, or ability record id).",
    starter: { ability: "" },
    parameterSchema: withSubjectAndNegation({ ability: { type: "string", pattern: ENTITY_ID_PATTERN.source } }, ["ability"]),
  },
  {
    id: "same-unit",
    version: 1,
    role: "CONDITION",
    label: "Same unit as",
    description: "Requires a unit to be (or not be) the same unit as another named unit reference.",
    starter: { as: "" },
    parameterSchema: withSubjectAndNegation({ as: { enum: SUBJECT_REF } }, ["as"]),
  },
  {
    id: "model-count",
    version: 1,
    role: "CONDITION",
    label: "Unit's model count",
    description: "Requires a unit to contain at least, at most, or between this many models, optionally only of a keyword.",
    starter: { min: 1 },
    parameterSchema: withSubjectAndNegation({
      keyword: { type: "string", pattern: UNIT_KEYWORD.source },
      min: { type: "integer", minimum: 0, maximum: 30 },
      max: { type: "integer", minimum: 0, maximum: 30 },
    }),
  },
  {
    id: "wounds-state",
    version: 1,
    role: "CONDITION",
    label: "Unit or model's wounds",
    description: "Requires a unit or model to have lost wounds, be Damaged, or have at most a number of wounds remaining.",
    starter: { kind: "lost" },
    parameterSchema: withSubjectAndNegation({
      kind: { enum: ["lost", "damaged", "remaining-at-most"] },
      value: { type: "integer", minimum: 0, maximum: 30, "x-only-when": { kind: ["remaining-at-most"] } },
    }, ["kind"]),
  },
  {
    id: "history-compare",
    version: 1,
    role: "CONDITION",
    label: "Compare units destroyed",
    description: "Compares how many enemy units (optionally of a kind) you destroyed this battle against a fixed count or another such tally (mission cards).",
    starter: { comparison: "greater-or-equal", right_kind: "value", right_value: 1 },
    parameterSchema: {
      type: "object",
      required: ["comparison", "right_kind"],
      properties: {
        left_kind: { enum: ["character", "any"] },
        comparison: { enum: ["greater-than", "greater-or-equal"] },
        right_kind: { enum: ["tally", "value", "pool"] },
        right_tally_kind: { enum: ["character", "any"], "x-only-when": { right_kind: ["tally"] } },
        right_value: { type: "integer", minimum: 0, "x-only-when": { right_kind: ["value"] } },
        right_pool: { type: "string", minLength: 1, "x-only-when": { right_kind: ["pool"] } },
        negated: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    id: "in-region",
    version: 1,
    role: "CONDITION",
    label: "Unit is within a region",
    description: "Requires a unit to be (wholly, if set) within a territory (your/enemy deployment zone, no-man's-land) or a tagged terrain area.",
    starter: { region_kind: "territory", territory: "no-mans-land" },
    parameterSchema: withSubjectAndNegation({
      region_kind: { enum: ["territory", "terrain-area"] },
      territory: {
        enum: ["your-territory", "enemy-territory", "no-mans-land", "your-deployment-zone", "enemy-deployment-zone", "attacker-territory"],
        "x-only-when": { region_kind: ["territory"] },
      },
      terrain_tag: { type: "string", minLength: 1, "x-only-when": { region_kind: ["terrain-area"] } },
      wholly: { const: true },
      models: { enum: ["any", "every"] },
    }, ["region_kind"]),
  },
  {
    id: "controls-objective",
    version: 1,
    role: "CONDITION",
    label: "Controls objectives",
    description: "Requires you (or the opponent) to control at least this many objectives matching a role or ownership filter, or more objectives than the opponent holds.",
    starter: { mode: "count", by: "friendly" },
    parameterSchema: {
      type: "object",
      required: ["mode"],
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
      additionalProperties: false,
    },
  },
];

const KNOWN_FAMILIES = new Set(PREDICATE_FAMILIES.map((family) => family.id));

/** Validate and canonicalise one predicate family's parameters, or return null for other families. */
export function normalizePredicateParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  // Bail out before touching `input.subject`: another family's subject vocabulary (e.g.
  // unit-state's "target") is not a member of this module's SUBJECT_REF and must not throw here.
  if (!KNOWN_FAMILIES.has(family)) return null;
  const negated = "negated" in input ? { negated: booleanValue(input.negated, `${family}.negated`) } : {};
  const subject = subjectOptional(input);
  const withSubject = subject === undefined ? {} : { subject };
  switch (family) {
    case "rule-active":
      exactKeys(input, "negated" in input ? ["rule", "negated"] : ["rule"], family);
      return { rule: entityIdValue(input.rule, "rule-active.rule"), ...negated };
    case "unit-owner":
      exactKeys(input, [...(subject === undefined ? [] : ["subject"]), "owner", ...(("negated" in input) ? ["negated"] : [])], family);
      return { ...withSubject, owner: enumValue(input.owner, ["friendly", "enemy"], "unit-owner.owner"), ...negated };
    case "unit-has-ability":
      exactKeys(input, [...(subject === undefined ? [] : ["subject"]), "ability", ...(("negated" in input) ? ["negated"] : [])], family);
      return { ...withSubject, ability: entityIdValue(input.ability, "unit-has-ability.ability"), ...negated };
    case "same-unit":
      exactKeys(input, [...(subject === undefined ? [] : ["subject"]), "as", ...(("negated" in input) ? ["negated"] : [])], family);
      return { ...withSubject, as: enumValue(input.as, SUBJECT_REF, "same-unit.as"), ...negated };
    case "model-count": {
      const keys = ["subject", "keyword", "min", "max", "negated"].filter((key) => key in input || key === "subject" && subject !== undefined);
      exactKeys(input, keys, family);
      if (input.min === undefined && input.max === undefined) throw new TypeError("model-count needs min, max, or both.");
      const result: Record<string, unknown> = { ...withSubject };
      if ("keyword" in input) {
        if (typeof input.keyword !== "string" || !UNIT_KEYWORD.test(input.keyword)) throw new TypeError("model-count.keyword must be a unit keyword.");
        result.keyword = input.keyword;
      }
      if (input.min !== undefined) result.min = boundedInteger(input.min, 0, 30, "model-count.min");
      if (input.max !== undefined) result.max = boundedInteger(input.max, 0, 30, "model-count.max");
      return { ...result, ...negated };
    }
    case "wounds-state": {
      const kind = enumValue(input.kind, ["lost", "damaged", "remaining-at-most"], "wounds-state.kind");
      const keys = [...(subject === undefined ? [] : ["subject"]), "kind", ...(kind === "remaining-at-most" ? ["value"] : []), ...(("negated" in input) ? ["negated"] : [])];
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = { ...withSubject, kind };
      if (kind === "remaining-at-most") result.value = boundedInteger(input.value, 0, 30, "wounds-state.value");
      return { ...result, ...negated };
    }
    case "history-compare": {
      const comparison = enumValue(input.comparison, ["greater-than", "greater-or-equal"], "history-compare.comparison");
      const rightKind = enumValue(input.right_kind, ["tally", "value", "pool"], "history-compare.right_kind");
      const keys = [
        ...(input.left_kind !== undefined ? ["left_kind"] : []), "comparison", "right_kind",
        ...(rightKind === "tally" ? ["right_tally_kind"] : rightKind === "value" ? ["right_value"] : ["right_pool"]),
        ...(("negated" in input) ? ["negated"] : []),
      ];
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = { comparison, right_kind: rightKind };
      if (input.left_kind !== undefined) result.left_kind = enumValue(input.left_kind, ["character", "any"], "history-compare.left_kind");
      if (rightKind === "tally") result.right_tally_kind = enumValue(input.right_tally_kind, ["character", "any"], "history-compare.right_tally_kind");
      else if (rightKind === "value") result.right_value = boundedInteger(input.right_value, 0, 30, "history-compare.right_value");
      else result.right_pool = nonEmpty(input.right_pool, "history-compare.right_pool");
      return { ...result, ...negated };
    }
    case "in-region": {
      const regionKind = enumValue(input.region_kind, ["territory", "terrain-area"], "in-region.region_kind");
      const own = regionKind === "territory" ? ["territory"] : ["terrain_tag"];
      const keys = [...(subject === undefined ? [] : ["subject"]), "region_kind", ...own,
        ...(input.wholly !== undefined ? ["wholly"] : []), ...(input.models !== undefined ? ["models"] : []), ...(("negated" in input) ? ["negated"] : [])];
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = { ...withSubject, region_kind: regionKind };
      if (regionKind === "territory") {
        result.territory = enumValue(
          input.territory,
          ["your-territory", "enemy-territory", "no-mans-land", "your-deployment-zone", "enemy-deployment-zone", "attacker-territory"],
          "in-region.territory",
        );
      } else result.terrain_tag = nonEmpty(input.terrain_tag, "in-region.terrain_tag");
      if (input.wholly !== undefined) result.wholly = trueFlag(input.wholly, "in-region.wholly");
      if (input.models !== undefined) result.models = enumValue(input.models, ["any", "every"], "in-region.models");
      return { ...result, ...negated };
    }
    case "controls-objective": {
      const mode = enumValue(input.mode, ["count", "more-than-opponent"], "controls-objective.mode");
      if (mode === "more-than-opponent") {
        exactKeys(input, [...(("negated" in input) ? ["negated"] : []), "mode"], family);
        return { mode, ...negated };
      }
      const optional = ["by", "objective_role", "home_of", "objective_territory", "count_min", "count_max"].filter((key) => key in input);
      exactKeys(input, ["mode", ...optional, ...(("negated" in input) ? ["negated"] : [])], family);
      const result: Record<string, unknown> = { mode };
      if (input.by !== undefined) result.by = enumValue(input.by, ["friendly", "enemy"], "controls-objective.by");
      if (input.objective_role !== undefined) result.objective_role = enumValue(input.objective_role, ["central", "expansion", "home", "non-home"], "controls-objective.objective_role");
      if (input.home_of !== undefined) result.home_of = enumValue(input.home_of, ["friendly", "enemy"], "controls-objective.home_of");
      if (input.objective_territory !== undefined) result.objective_territory = enumValue(input.objective_territory, ["your-territory", "enemy-territory", "no-mans-land"], "controls-objective.objective_territory");
      if (input.count_min !== undefined) result.count_min = boundedInteger(input.count_min, 0, 6, "controls-objective.count_min");
      if (input.count_max !== undefined) result.count_max = boundedInteger(input.count_max, 0, 6, "controls-objective.count_max");
      return { ...result, ...negated };
    }
    default:
      return null;
  }
}

function entityIdValue(value: unknown, label: string): string {
  if (typeof value === "string" && ENTITY_ID_PATTERN.test(value)) return value;
  throw new TypeError(`${label} must be a kebab-case entity id.`);
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new TypeError(`${label} must be a nonempty string.`);
}

/** A presence flag whose only legal value is true (the DSL field is absent, never false). */
function trueFlag(value: unknown, label: string): true {
  if (value === true) return true;
  throw new TypeError(`${label} must be true.`);
}
