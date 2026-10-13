/**
 * Unit selections as player levers. A `select-units` effect whose nested effect reaches the
 * `selected-unit` is a choice the player makes on the table ("select one friendly DESTROYER CULT
 * unit within 9\"", "select one enemy unit visible to this unit"): which unit is picked, whether
 * the range and visibility hold, and whether a gating roll succeeded are not known to the
 * cruncher. The translator therefore offers the selection's buffs as one opt-in lever on the unit
 * the selection can reach, and records what the player vouches for in the lever's `requires`.
 *
 * This module decides what a selection means for the crunched unit; the translator walks the
 * effect it returns.
 */
import type { BuffApplicability, BuffSource, EngineContext } from "./buffs.js";

/** What a selection contributes to the crunched unit. */
export type SelectionPlan =
  /** Not a selection lever: the translator keeps its general handling. */
  | { kind: "none" }
  /** The crunched unit cannot be the selected unit, so nothing reaches it. */
  | { kind: "skip" }
  | { kind: "unsupported"; reason: string }
  | {
      kind: "lever";
      /** The nested effect with `selected-unit` read from the crunched unit's side. */
      effect: unknown;
      /** Gates on the selected unit's keywords, when it is the other side of the attack. */
      applicability?: BuffApplicability;
      /** DSL fragments the player vouches for: the selection, then any gating roll. */
      requires: unknown[];
      /** Lever label prefix. */
      label: string;
    };

const SELECTED_UNIT = "selected-unit";

/**
 * Plan a `select-units` node for the crunched unit under `perspective`.
 *
 * - A friendly selection reaches the crunched unit when its keywords match the selector. When the
 *   eligibility excludes the ability's own unit, the unit holding the ability cannot pick itself,
 *   so the lever exists only when another unit provides the ability (`abilityKind: "support"`).
 * - An enemy selection reaches the other side of the attack: the defender when the crunched unit
 *   attacks, the attacker when it is attacked.
 * - A top-level dice gate with no failure branch becomes the lever's content; its roll joins
 *   `requires`.
 *
 * Selections that bind models, named models or a named binding stay on the translator's general
 * path, as does a selection whose effect never names the selected unit.
 */
export function planSelection(
  node: Record<string, unknown>,
  source: BuffSource,
  perspective: "attacker" | "target",
  context: EngineContext,
): SelectionPlan {
  const selector = isObject(node.selector) ? node.selector : undefined;
  if (!selector || (selector.owner !== "friendly" && selector.owner !== "enemy")) return { kind: "none" };
  if (selector.target_kind === "model" || selector.model_names != null || selector.bind_as != null) return { kind: "none" };
  if (!referencesSelectedUnit(node.effect)) return { kind: "none" };

  const keywords = selector.keywords;
  const excluded = selector.excluded_keywords;
  if ((keywords !== undefined && !isKeywordList(keywords)) || (excluded !== undefined && !isKeywordList(excluded))) {
    return { kind: "unsupported", reason: "select-units: the selector's keyword lists are malformed" };
  }
  const { effect: _effect, ...selection } = node;
  const requires: unknown[] = [selection];

  let effect: unknown;
  let applicability: BuffApplicability | undefined;
  let label: string;
  if (selector.owner === "friendly") {
    if (excludesAbilityUnit(selector.eligibility) && !(source.kind === "ability" && source.abilityKind === "support")) {
      return { kind: "skip" };
    }
    if (keywords !== undefined || excluded !== undefined) {
      const own = perspective === "attacker" ? context.attackerKeywords : context.targetKeywords;
      if (own === undefined) return { kind: "unsupported", reason: "select-units: the crunched unit's keywords are unavailable for the selector" };
      const holds = (keywords ?? []).every((k) => includesKeyword(own, k)) && !(excluded ?? []).some((k) => includesKeyword(own, k));
      if (!holds) return { kind: "skip" };
    }
    effect = node.effect;
    label = "Selected unit";
  } else {
    const other = perspective === "attacker" ? "defender" : "attacker";
    const gate = selectedEnemyGate(keywords, excluded, perspective);
    if (typeof gate === "string") return { kind: "unsupported", reason: gate };
    applicability = gate;
    effect = retarget(node.effect, other);
    label = "Selected enemy unit";
  }

  if (isObject(effect) && effect.type === "dice-gated") {
    if (effect.on_fail != null) return { kind: "unsupported", reason: "select-units: a dice gate with a failure branch is not a single lever" };
    const { on_success, on_fail: _fail, ...roll } = effect;
    requires.push(roll);
    effect = on_success;
  }
  return { kind: "lever", effect, ...(applicability ? { applicability } : {}), requires, label };
}

/**
 * The keyword gate an enemy selector puts on the selected unit. When the crunched unit attacks, the
 * selected unit is the defender and the gate reads the target's keywords; when it is attacked,
 * only a single required keyword on the attacker can be gated. Returns a reason when the selector
 * asks for a gate the buff layer cannot express.
 */
function selectedEnemyGate(
  keywords: string[] | undefined,
  excluded: string[] | undefined,
  perspective: "attacker" | "target",
): BuffApplicability | undefined | string {
  const out: BuffApplicability = {};
  if (keywords !== undefined && keywords.length > 0) {
    if (keywords.length > 1) return "select-units: more than one required keyword on the selected enemy unit is not gated by the buff layer";
    if (perspective === "attacker") out.requiresTargetKeyword = keywords[0];
    else out.requiresAttackerKeyword = keywords[0];
  }
  if (excluded !== undefined && excluded.length > 0) {
    if (perspective !== "attacker") return "select-units: excluded keywords on the attacking unit are not gated by the buff layer";
    out.excludedTargetKeywords = [...excluded];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Does the effect name the selected unit as a target anywhere, outside a nested selection? */
function referencesSelectedUnit(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(referencesSelectedUnit);
  if (!isObject(node)) return false;
  if (node.type === "select-units") return false;
  if (node.target === SELECTED_UNIT) return true;
  for (const key in node) {
    if (key !== "target" && referencesSelectedUnit(node[key])) return true;
  }
  return false;
}

/** Copy the effect with each `selected-unit` target replaced, leaving nested selections alone. */
function retarget(node: unknown, target: string): unknown {
  if (Array.isArray(node)) return node.map((child) => retarget(child, target));
  if (!isObject(node) || node.type === "select-units") return node;
  const out: Record<string, unknown> = {};
  for (const key in node) {
    out[key] = key === "target" && node[key] === SELECTED_UNIT ? target : retarget(node[key], target);
  }
  return out;
}

/** Does the eligibility forbid selecting the unit that holds the ability (`not same-unit ability-unit`)? */
function excludesAbilityUnit(condition: unknown): boolean {
  if (!isObject(condition)) return false;
  if (condition.operator === "not" && Array.isArray(condition.operands)) {
    return condition.operands.some((operand) => isObject(operand) && operand.type === "same-unit" &&
      isObject(operand.parameters) && operand.parameters.as === "ability-unit");
  }
  if (condition.operator === "and" && Array.isArray(condition.operands)) return condition.operands.some(excludesAbilityUnit);
  return false;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKeywordList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((keyword) => typeof keyword === "string" && keyword.length > 0);
}

function includesKeyword(keywords: readonly string[], keyword: string): boolean {
  const lower = keyword.toLowerCase();
  return keywords.some((candidate) => candidate.toLowerCase() === lower);
}
