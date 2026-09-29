import type { SemanticFamilyDefinition } from "./contracts.js";
import { booleanValue, boundedInteger, enumSet, enumValue, exactKeys } from "./family-validation.js";

/**
 * Families for who an attack involves and what must be true of a unit. Each is one meaning:
 * the attack context is an event, and every predicate names its subject (this unit or the
 * attack's target) and can be negated, so "a unit that is not Below Half-strength" is one
 * leaf and "that targets a CHARACTER unit" is another.
 */

export const ATTACK_DIRECTIONS = ["makes", "targeted"] as const;
/** Attack version 1 units. "The bearer" is the model, so version 2 spells it this-model. */
const ATTACK_UNITS_WITH_BEARER = ["this-model", "this-unit", "bearer", "bearers-unit", "that-unit"] as const;
export const ATTACK_UNITS = ["this-model", "this-unit", "bearers-unit", "that-unit"] as const;
export const ATTACK_TYPES = ["any", "melee", "ranged"] as const;
export const SELECT_SCOPES = ["enemy", "friendly"] as const;
const SELECT_DISTANCES = ["any", "within"] as const;
const MAX_INCHES = 48;

/** Who an eligibility-permission, targeting-restriction, counts-as or rule-state leaf changes. */
export const SUBJECTS = ["this-unit", "this-model"] as const;
export const PERMISSION_ACTIVITIES = [
  "shoot", "declare-charge", "fight", "start-action", "embark", "disembark", "fall-back",
  "advance", "use-stratagem", "issue-order", "attempt-ritual", "use-enhancement", "move", "observe",
] as const;
export const PERMISSION_DESPITE = [
  "engaged", "battle-shocked", "shot-this-phase", "fought-this-phase", "disembarked-this-turn",
  "stratagem-used-this-phase", "performing-action", "advanced", "fell-back",
] as const;
export const PERMISSION_AS_IF = ["shooting-phase", "snap-shooting", "fight-phase"] as const;
/** targeting-restriction's subject: who the modifier applies to; enemy-units compiles to an owner filter. */
export const TARGETING_RESTRICTION_SUBJECTS = ["this-unit", "this-model", "enemy-units"] as const;
export const TARGETING_MAY = ["target", "cannot-target", "must-target"] as const;
export const TARGETING_KINDS = ["attack", "shoot", "fight", "charge", "stratagem"] as const;
const TARGETING_WEAPON_SCOPES = ["all", "melee", "ranged"] as const;
export const RULE_KINDS = ["core-rule", "keyword", "ability", "faction-rule"] as const;
export const DAMAGE_REDUCTION_VALUES = ["1", "2", "half", "to-zero"] as const;
/** Kebab-case rule slugs (core-rule, ability, faction-rule); keyword rules are uppercase words instead. */
const RULE_SLUG = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;

/** A unit keyword as the DSL writes it: uppercase words, without markdown emphasis. */
const UNIT_KEYWORD = /^[A-Z][A-Z0-9' -]*[A-Z0-9]$/u;

export const TARGETING_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "attack",
    version: 1,
    role: "EVENT",
    label: "Each time an attack is made",
    description: "An attack made by the named model or unit, or an attack that targets it, optionally only melee or only ranged. What the attack targets is a separate condition.",
    starter: { direction: "", unit: "", attack_type: "" },
    parameterSchema: {
      type: "object",
      required: ["direction", "unit", "attack_type"],
      properties: { direction: { enum: ATTACK_DIRECTIONS }, unit: { enum: ATTACK_UNITS_WITH_BEARER }, attack_type: { enum: ATTACK_TYPES } },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "attack",
    version: 2,
    role: "EVENT",
    label: "Each time an attack is made",
    description: "An attack made by the named model or unit, or an attack that targets it, optionally only melee or only ranged. What the attack targets is a separate condition. \"The bearer\" is this model.",
    starter: { direction: "", unit: "", attack_type: "" },
    parameterSchema: {
      type: "object",
      required: ["direction", "unit", "attack_type"],
      properties: { direction: { enum: ATTACK_DIRECTIONS }, unit: { enum: ATTACK_UNITS }, attack_type: { enum: ATTACK_TYPES } },
      additionalProperties: false,
    },
  },
  {
    id: "select-unit",
    version: 1,
    role: "EVENT",
    label: "Select a unit",
    description: "The ability selects one enemy or friendly unit, optionally within a distance or visible, and later wording refers to it as \"that unit\".",
    starter: { scope: "", distance: "", visible: false },
    parameterSchema: {
      type: "object",
      required: ["scope", "distance", "visible"],
      properties: {
        scope: { enum: SELECT_SCOPES },
        distance: { enum: SELECT_DISTANCES },
        inches: { type: "integer", minimum: 1, maximum: MAX_INCHES, "x-only-when": { distance: ["within"] } },
        visible: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    id: "instead",
    version: 1,
    role: "COMBINATOR",
    label: "Instead",
    description: "The effect in this clause replaces an earlier effect of the same kind when this clause's condition holds; it does not add to it.",
    starter: {},
    parameterSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    id: "eligibility-permission",
    version: 1,
    role: "EFFECT",
    label: "Allow or forbid an activity",
    description: "This unit or model is (or is not) eligible to shoot, charge, fight, embark, disembark, Fall Back, Advance, be targeted with Stratagems, issue Orders, attempt Rituals, use Enhancements, move, or act as an Observer, optionally even if something would normally block it, or as if in a different phase.",
    starter: { subject: "", activity: "", allow: true },
    parameterSchema: {
      type: "object",
      required: ["subject", "activity", "allow"],
      properties: {
        subject: { enum: SUBJECTS },
        activity: { enum: PERMISSION_ACTIVITIES },
        allow: { type: "boolean" },
        despite: { type: "array", items: { enum: PERMISSION_DESPITE }, minItems: 1, uniqueItems: true },
        as_if: { enum: PERMISSION_AS_IF },
        stratagem: { type: "string", pattern: RULE_SLUG.source, "x-only-when": { despite: ["stratagem-used-this-phase"] } },
      },
      additionalProperties: false,
    },
  },
  {
    id: "targeting-restriction",
    version: 1,
    role: "EFFECT",
    label: "Who may target whom",
    description: "This unit, this model, or enemy units may, may not, or must target something with an attack, a Stratagem, or a specific kind of attack, optionally only within a range or with a kind of weapon.",
    starter: { subject: "", may: "", kind: "", weapon_type: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "may", "kind", "weapon_type"],
      properties: {
        subject: { enum: TARGETING_RESTRICTION_SUBJECTS },
        may: { enum: TARGETING_MAY },
        kind: { enum: TARGETING_KINDS },
        weapon_type: { enum: TARGETING_WEAPON_SCOPES },
        range: { type: "integer", minimum: 1, maximum: MAX_INCHES, "x-only-when": { may: ["cannot-target", "target"] } },
      },
      additionalProperties: false,
    },
  },
  {
    id: "counts-as",
    version: 1,
    role: "EFFECT",
    label: "Counts as being within range",
    description: "This unit or model counts as being within a range of this model, for the purposes of another rule (a Titan-killer's range, an aura counting itself).",
    starter: { subject: "", within: 1 },
    parameterSchema: {
      type: "object",
      required: ["subject", "within"],
      properties: { subject: { enum: SUBJECTS }, within: { type: "integer", minimum: 1, maximum: MAX_INCHES } },
      additionalProperties: false,
    },
  },
  {
    id: "rule-state",
    version: 1,
    role: "EFFECT",
    label: "Grant or suppress a named rule",
    description: "This unit or model gains or loses a core rule, keyword, ability, or faction rule (a core-rule slug such as the -1 to Hit for shooting in Engagement Range, or a keyword or ability by its own id).",
    starter: { subject: "", direction: "", rule_kind: "", rule: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "direction", "rule_kind", "rule"],
      properties: {
        subject: { enum: SUBJECTS },
        direction: { enum: ["granted", "suppressed"] },
        rule_kind: { enum: RULE_KINDS },
        rule: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    id: "damage-reduction",
    version: 1,
    role: "EFFECT",
    label: "Reduce Damage allocated to it",
    description: "Each time an attack (optionally only melee or ranged) is allocated to this unit or model, reduce its Damage characteristic by 1, by 2, halve it, or change it to 0.",
    starter: { subject: "", reduction: "", weapon_type: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "reduction", "weapon_type"],
      properties: { subject: { enum: SUBJECTS }, reduction: { enum: DAMAGE_REDUCTION_VALUES }, weapon_type: { enum: TARGETING_WEAPON_SCOPES } },
      additionalProperties: false,
    },
  },
];

/** Validate and canonicalise one targeting family's parameters, or return null for other families. */
export function normalizeTargetingParameters(family: string, input: Record<string, unknown>, version = 1): Record<string, unknown> | null {
  switch (family) {
    case "attack":
      exactKeys(input, ["direction", "unit", "attack_type"], family);
      return {
        direction: enumValue(input.direction, ATTACK_DIRECTIONS, "attack.direction"),
        unit: enumValue(input.unit, version === 1 ? ATTACK_UNITS_WITH_BEARER : ATTACK_UNITS, "attack.unit"),
        attack_type: enumValue(input.attack_type, ATTACK_TYPES, "attack.attack_type"),
      };
    case "instead":
      exactKeys(input, [], family);
      return {};
    case "select-unit": {
      const distance = enumValue(input.distance, SELECT_DISTANCES, "select-unit.distance");
      exactKeys(input, distance === "within" ? ["scope", "distance", "inches", "visible"] : ["scope", "distance", "visible"], family);
      return {
        scope: enumValue(input.scope, SELECT_SCOPES, "select-unit.scope"),
        distance,
        ...(distance === "within" ? { inches: boundedInteger(input.inches, 1, MAX_INCHES, "select-unit.inches") } : {}),
        visible: booleanValue(input.visible, "select-unit.visible"),
      };
    }
    case "eligibility-permission": {
      const keys = ["subject", "activity", "allow", ...("despite" in input ? ["despite"] : []), ...("as_if" in input ? ["as_if"] : []), ...("stratagem" in input ? ["stratagem"] : [])];
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = {
        subject: enumValue(input.subject, SUBJECTS, "eligibility-permission.subject"),
        activity: enumValue(input.activity, PERMISSION_ACTIVITIES, "eligibility-permission.activity"),
        allow: booleanValue(input.allow, "eligibility-permission.allow"),
      };
      if ("despite" in input) result.despite = enumSet(input.despite, PERMISSION_DESPITE, "eligibility-permission.despite");
      if ("as_if" in input) result.as_if = enumValue(input.as_if, PERMISSION_AS_IF, "eligibility-permission.as_if");
      const despiteList = (result.despite as string[] | undefined) ?? [];
      const needsStratagem = despiteList.includes("stratagem-used-this-phase");
      if (needsStratagem !== ("stratagem" in input)) {
        throw new TypeError("eligibility-permission.stratagem is required exactly when despite includes stratagem-used-this-phase.");
      }
      if ("stratagem" in input) {
        const stratagem = String(input.stratagem ?? "");
        if (!RULE_SLUG.test(stratagem)) throw new TypeError("eligibility-permission.stratagem must be a kebab-case id.");
        result.stratagem = stratagem;
      }
      return result;
    }
    case "targeting-restriction": {
      const may = enumValue(input.may, TARGETING_MAY, "targeting-restriction.may");
      const keys = ["subject", "may", "kind", "weapon_type", ...("range" in input ? ["range"] : [])];
      exactKeys(input, keys, family);
      if ("range" in input && may !== "cannot-target" && may !== "target") {
        throw new TypeError("targeting-restriction.range only applies when may is cannot-target or target.");
      }
      const result: Record<string, unknown> = {
        subject: enumValue(input.subject, TARGETING_RESTRICTION_SUBJECTS, "targeting-restriction.subject"),
        may,
        kind: enumValue(input.kind, TARGETING_KINDS, "targeting-restriction.kind"),
        weapon_type: enumValue(input.weapon_type, TARGETING_WEAPON_SCOPES, "targeting-restriction.weapon_type"),
      };
      if ("range" in input) result.range = boundedInteger(input.range, 1, MAX_INCHES, "targeting-restriction.range");
      return result;
    }
    case "counts-as":
      exactKeys(input, ["subject", "within"], family);
      return { subject: enumValue(input.subject, SUBJECTS, "counts-as.subject"), within: boundedInteger(input.within, 1, MAX_INCHES, "counts-as.within") };
    case "rule-state": {
      exactKeys(input, ["subject", "direction", "rule_kind", "rule"], family);
      const ruleKind = enumValue(input.rule_kind, RULE_KINDS, "rule-state.rule_kind");
      const rule = String(input.rule ?? "");
      if (ruleKind === "keyword") {
        if (!UNIT_KEYWORD.test(rule)) throw new TypeError("rule-state.rule must be an uppercase keyword when rule_kind is keyword.");
      } else if (!RULE_SLUG.test(rule)) {
        throw new TypeError("rule-state.rule must be a kebab-case id when rule_kind is not keyword.");
      }
      return {
        subject: enumValue(input.subject, SUBJECTS, "rule-state.subject"),
        direction: enumValue(input.direction, ["granted", "suppressed"], "rule-state.direction"),
        rule_kind: ruleKind,
        rule,
      };
    }
    case "damage-reduction":
      exactKeys(input, ["subject", "reduction", "weapon_type"], family);
      return {
        subject: enumValue(input.subject, SUBJECTS, "damage-reduction.subject"),
        reduction: enumValue(input.reduction, DAMAGE_REDUCTION_VALUES, "damage-reduction.reduction"),
        weapon_type: enumValue(input.weapon_type, TARGETING_WEAPON_SCOPES, "damage-reduction.weapon_type"),
      };
    default:
      return null;
  }
}
