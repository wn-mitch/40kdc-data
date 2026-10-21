/**
 * Humanize an Ability-DSL `effect` tree into natural English — the
 * `ability.print()` of the dataset. Output is an *approximation* generated
 * purely from the structured data (no external rules text): subject-first,
 * GW-datasheet voice, with scope range + duration woven into the sentence and
 * single-leaf conditionals inlined. ASCII-only. It is pinned byte-for-byte
 * across the TS / Rust / Python ports by the `conformance/effect-translation`
 * corpus, so any phrasing change here is a semantic corpus change (bump
 * `conformance/SPEC_VERSION`).
 *
 * Container nodes (`sequence`, `choice`, `dice-gated`, `dice-pool-allocation`,
 * and a `conditional` wrapping a container) render block-style with two-space
 * indentation; a `conditional` wrapping a single leaf inlines to one sentence.
 * Unknown leaf types degrade to a deterministic bracketed form (`[the-type]`).
 */

import { dekebab, describeCondition, titleCase, type Condition } from "./condition.js";
import { conditionLeadIn, describeSelectionEligibility } from "./condition-leadin.js";
import { unitRefPhrase, usageClause } from "./condition-refs.js";
import { describeTrigger, normalizeTriggers, type AbilityTriggerSpec } from "./trigger.js";
import { definedGrantHead, definitionPart, describeLeaf, isDefinedGrant, LEAF_TYPES, type Leaf } from "./effect-leaf.js";
import { expiryTrail } from "./expiry.js";
import { objectiveSelectorPhrase, rollHead, selectObjectiveBlock, selectObjectiveInline, selectionBinding, selectionLimit, selectorCount, selectorNoun, selectorSubject, selectUnitsSubject } from "./effect-bind.js";
import {
  capitalize, diceCase, filterSubject, formatComparison, jstr, orList, quantityPhrase, rangePhrase, regionPhrase, requirementPhrase, resourceNoun, rollKindNoun, scaleSource,
  signed, testName, type Ctx,
} from "./effect-words.js";
export type { Ctx };
export { describeTrigger };

/** Aura modifier surface, including independent canonical role filters. */
export interface AuraModifier {
  range?: unknown;
  range_bonus?: number;
  of?: string;
  emitter_filter?: Record<string, unknown>;
  recipient_filter?: Record<string, unknown>;
  effect?: Effect;
  [key: string]: unknown;
}

/**
 * Minimal structural view of an effect node. Matches the ability-dsl effect
 * schema: a single effect carries `type` + `target` + `modifier`; containers
 * carry their own shape (`steps`, `options`, `condition`/`effect`, dice
 * fields).
 */
export interface Effect {
  type?: string;
  operation?: "establish" | "replace";
  name?: string;
  kind?: string;
  level?: number;
  /** A single effect's unit-ref (or an aura's legacy within-aura target). */
  target?: unknown;
  modifier?: Record<string, unknown> | AuraModifier;
  condition?: Condition;
  effect?: Effect;
  after_move?: Effect;
  steps?: Effect[];
  options?: (Effect & {
    id?: string;
    name?: string;
    // single dice-requirement or an `any_of` set; read structurally by describeRequirement.
    requirement?: unknown;
  })[];
  choice_label?: string;
  choice_prompt?: string;
  min_choices?: number;
  max_choices?: number;
  cost?: Effect;
  trigger?: AbilityTriggerSpec;
  usage?: AbilityUsage | AbilityUsage[];
  dice?: string;
  distinct?: boolean;
  roll_var?: string;
  extra_dice_pool?: string;
  from?: { roll_var: string; successes_on?: number };
  requirement?: unknown;
  threshold?: number | string;
  comparison?: string;
  optional?: boolean;
  test?: { kind: "leadership" | "battle-shock"; subject: unknown; modifiers?: { condition: Condition; value: number }[] };
  outcomes?: {
    results?: number[];
    effect?: Effect;
  }[];
  on_success?: Effect | null;
  on_fail?: Effect | null;
  pool?: { count: number; die: string };
  max_activations?: number;
  selector?: Selector;
  scaling?: {
    per?: number;
    of?: string;
    within?: unknown;
    round?: string;
    max_value?: number;
    /** When the count is taken: live (default) at each use, on-apply once when the rule applies. */
    evaluated?: "live" | "on-apply";
  };
  // designate-target / persistent-designation
  designation?: string;
  select?: { kind?: "unit" | "objective"; selector?: Selector };
  selection_policy?: string;
  allow_while_embarked?: boolean;
  consumer?: {
    relation?: string;
    beneficiary?: string;
    effect?: Effect;
  };
  lifecycle?: {
    replace?: { event?: string; optional?: boolean };
    exclusivity?: string;
  };
  // formation-attachment-grant
  attachment?: { leader_id?: string; bodyguard_id?: string };
  formation_event?: string;
  grant?: { recipient?: string; effect?: Effect };
  applies?: {
    to?: string;
    effect?: Effect;
    attacker_filter?: Record<string, unknown>;
    attacker_unit_filter?: Record<string, unknown>;
    beneficiary?: { selection_var: string } | { event_var: string };
    reference?: { selection_var: string };
  };
  duration?: string;
  // stance-select
  mode?: string;
  additive?: boolean;
  // risk-reward
  reward?: Effect;
  risk?: { test?: string; on_fail?: Effect };
  // issue-orders
  count?: number;
  range?: number;
  eligible?: { keyword?: string };
  // resource-action-menu
  menu_id?: string;
  pool_id?: string;
  capacity?: {
    amount: number;
    resource_label: string;
    ability_noun: string;
    refresh: string;
  };
  shared_usage?: {
    unit_max_manoeuvres_per_phase?: number;
    default_manoeuvre_max_per_phase?: number;
  };
  actions?: MenuAction[];
}

/** One entry in a `resource-action-menu`'s `actions` array (a single reactive manoeuvre). */
export interface MenuAction {
  id?: string;
  label?: string;
  when?: AbilityTriggerSpec;
  cost?: { pool_id?: string; amount?: number; resource_label?: string };
  eligibility?: {
    filter?: Record<string, unknown>;
    count?: { min?: unknown; max?: unknown };
    requires?: Condition[];
  };
  usage?: { repeatable_if_different_unit?: boolean };
  duration?: string;
  effect?: Effect;
}

/** Ability scope, as carried on enrichment ability entries. */
export interface AbilityScope {
  duration?: string;
}

/** Curated keyword filter naming which units an ability benefits. */
export interface AbilityAppliesTo {
  all_of?: string[];
  any_of?: string[];
  none_of?: string[];
  not_all_of?: string[];
}

/** Usage-limit block (how often the ability may be used). */
export interface AbilityUsage {
  frequency?: string;
  count?: number;
  per?: string;
}

export type { AbilityTrigger, AbilityTriggerSpec } from "./trigger.js";

/** Minimal ability view for `describeAbility`. */
export interface AbilityLike {
  name?: string;
  effect?: Effect;
  scope?: AbilityScope;
  trigger?: AbilityTriggerSpec | null;
  usage?: AbilityUsage | AbilityUsage[] | null;
  applies_to?: AbilityAppliesTo | null;
}

const CONTAINER_TYPES = new Set([
  "roll",
  "select-objective",
  "sequence",
  "rules-bundle",
  "ability-part",
  "choice",
  "dice-gated",
  "dice-table",
  "dice-pool-allocation",
  "select-units",
  "for-each-unit",
  "designate-target",
  "persistent-designation",
  "stance-select",
  "risk-reward",
  "issue-orders",
  "resource-action-menu",
]);

interface Selector extends Record<string, unknown> {
  filter?: Record<string, unknown>;
  count?: { min?: unknown; max?: unknown };
  limit?: { count: number; period: string };
  bind_as?: string;
  eligibility?: Condition;
}


function selectUnitsPlural(sel: Record<string, unknown> = {}): boolean {
  return selectorCount(sel).plural;
}

function selectedRecipient(text: string, sel: Record<string, unknown> = {}): string {
  const noun = selectorNoun(sel);
  const recipient = selectUnitsPlural(sel) ? `each selected ${noun}` : `the selected ${noun}`;
  // Membership remains relative to the bearer/current unit, not the selected recipient.
  const membership = "\uE000";
  return text
    .replaceAll("in the unit", membership)
    .replace(/\b[Tt]he unit's\b/g, (match) => match[0] === "T" ? `Each selected ${noun}'s` : `${recipient}'s`)
    .replace(/\b[Tt]he unit\b/g, (match) => match[0] === "T" ? `Each selected ${noun}` : recipient)
    .replaceAll(membership, "in the unit");
}

function selectedContext(ctx: Ctx, sel: Record<string, unknown>): Ctx {
  const selectedModel = selectorNoun(sel) === "model";
  return { ...ctx, selectedUnit: !selectedModel, selectedModel, unitSubject: undefined };
}

function selectUnitsInline(sel: Record<string, unknown>, effect: Effect, ctx: Ctx): string {
  const subject = selectUnitsSubject(sel);
  const binding = selectionBinding(sel);
  const nested = selectedRecipient(describeEffectInline(effect, selectedContext(ctx, sel)), sel);
  return `select ${subject}${binding}: ${nested}`;
}


export function forEachUnitSubject(sel: Record<string, unknown> = {}): string {
  const eligibility = sel.eligibility ? ` ${describeSelectionEligibility(sel.eligibility as Condition)}` : "";
  return `${selectorSubject(sel, false)}${eligibility}${selectionBinding(sel)}${selectionLimit(sel, selectorNoun(sel))}`;
}

/**
 * "(your Suppressed target)" — a designate-target mark's parenthetical. A
 * designation slug that already ends in "target" keeps its own noun
 * ("bio-stimulus-target" → "(your Bio Stimulus Target)", not "… Target target").
 */
function designationLabel(designation: unknown): string {
  const label = titleCase(jstr(designation));
  return /\bTarget$/.test(label) ? ` (your ${label})` : ` (your ${label} target)`;
}

function designationTargetSubject(select: NonNullable<Effect["select"]>): string {
  const selector = select.selector ?? {};
  return select.kind === "objective" ? objectiveSelectorPhrase(selector) : `${selectUnitsSubject(selector)}${selectionBinding(selector)}`;
}

function designationAttackerPhrase(applies: Effect["applies"], block = false): string {
  const model = applies?.attacker_filter;
  const unit = applies?.attacker_unit_filter;
  const attacker = unit
    ? `a ${model ? selectorSubject({ filter: { ...model, owner: "any", level: "model" } }, false) : "model"} in a ${selectorSubject({ filter: { owner: "friendly", ...unit } }, false)}`
    : model ? `a ${selectorSubject({ filter: { owner: "friendly", level: "model", ...model } }, false)}` : "a friendly unit";
  return `each time ${attacker} ${block ? "makes an attack against it" : "attacks it"}`;
}


function persistentDesignationName(designation: unknown, scope: unknown): string {
  const label = titleCase(jstr(designation));
  if (scope === "objective")
    return /\bMarker$/.test(label) ? `your ${label}` : `your ${label} Marker`;
  return /\bTarget$/.test(label) ? `your ${label}` : `your ${label} target`;
}

function persistentDesignationLabel(designation: unknown, scope: unknown): string {
  return ` (${persistentDesignationName(designation, scope)})`;
}

function persistentDesignationSupported(e: Effect): boolean {
  const select = e.select ?? {};
  const consumer = e.consumer ?? {};
  const recipient = consumer.beneficiary === "this-model" || consumer.beneficiary === "this-unit";
  return recipient &&
    ((select.kind === "unit" && consumer.relation === "attacks-selected-unit") ||
      (select.kind === "objective" && consumer.relation === "within-selected-marker"));
}

function persistentDesignationLead(e: Effect): string {
  const select = e.select ?? {};
  const noun = designationTargetSubject(select);
  const label = persistentDesignationLabel(e.designation, select.kind);
  const clauses = [`select ${noun}${label}.`];
  if (e.allow_while_embarked) clauses.push("This selection can be made while this unit is embarked.");
  const lifecycle = e.lifecycle;
  if (e.selection_policy === "replace-on-destroyed" && lifecycle?.replace) {
    const replacement = lifecycle.replace;
    const name = persistentDesignationName(e.designation, select.kind);
    clauses.push(`When ${name} is destroyed, ${replacement.optional ? "you may" : "you must"} select ${noun} to replace it.`);
  }
  if (lifecycle?.exclusivity === "one-active-per-bearer-unit") clauses.push("Only one such designation can be active for this bearer unit.");
  return clauses.join(" ");
}

function persistentDesignationWhen(e: Effect): string {
  const select = e.select ?? {};
  const consumer = e.consumer ?? {};
  const name = persistentDesignationName(e.designation, select.kind);
  const bearer = consumer.beneficiary === "this-unit" ? "a model in this unit" : "this model";
  const relation = consumer.relation === "within-selected-marker"
    ? `while ${bearer} is within range of ${name}`
    : `each time ${bearer} makes an attack against it`;
  const { trail } = durationClauses(e.duration);
  return trail ? `${capitalize(trail)}, ${relation}` : relation;
}

function persistentDesignationReplacement(e: Effect): string {
  const select = e.select ?? {};
  const replacement = e.lifecycle?.replace;
  const previous = persistentDesignationName(e.designation, select.kind);
  const label = persistentDesignationLabel(e.designation, select.kind);
  const embarked = e.allow_while_embarked ? ". This selection can be made while this unit is embarked" : "";
  return `when ${previous} is destroyed, ${replacement?.optional ? "you may" : "you must"} select ${designationTargetSubject(select)}${label} to replace this bearer unit's existing designation. Its existing effects apply to the new target without changing the designation's expiry${embarked}`;
}


/**
 * Duration → woven clause. `lead` sits at the very front of the sentence
 * ("Once per battle, …"); `trail` sits after the trigger/condition and before
 * the effect ("…, until the end of the phase, …"). `permanent` adds nothing.
 */
export function durationClauses(duration: string | undefined): { lead: string; trail: string } {
  return { lead: "", trail: expiryTrail(duration) };
}


/** A menu action's `eligibility` → a trailing parenthetical naming which unit may use it and any extra requirements (`eligibility.requires` conditions, rendered via the shared `describeCondition` and joined with "and"). `""` when the action is open to any unit with no further gate. */
function menuActionEligibilityClause(elig: MenuAction["eligibility"]): string {
  if (!elig) return "";
  const hasKeywordGate = elig.filter != null || elig.count != null;
  const requirementPhrases = (elig.requires ?? []).map(describeCondition);
  if (!hasKeywordGate && requirementPhrases.length === 0) return "";
  const parts: string[] = [];
  if (hasKeywordGate) parts.push(`only usable by ${selectUnitsSubject({ filter: elig.filter ?? {}, count: elig.count ?? { min: 1, max: 1 } })}`);
  if (requirementPhrases.length) parts.push(requirementPhrases.join(" and "));
  return parts.length ? ` (${parts.join(", ")})` : "";
}


/** One `resource-action-menu` action → a bullet body ("Label: trigger, spend N tokens, effect, duration (notes)."). */
function describeMenuAction(a: MenuAction, ctx: Ctx): string {
  const label = jstr(a.label ?? a.id);
  const triggers = normalizeTriggers(a.when);
  const trig = triggers.map(describeTrigger).filter((s) => s.length > 0).join(" or ");
  const cost = a.cost ?? {};
  const costPhrase = `spend ${jstr(cost.amount)} ${resourceNoun(cost.pool_id, cost.resource_label, cost.amount)}`;
  const effClause = describeEffectInline(a.effect ?? {}, ctx);
  const durClause = a.duration === "resolution" ? "" : expiryTrail(a.duration);
  const usageNote = a.usage?.repeatable_if_different_unit
    ? " (may be triggered more than once per phase if a different unit performs it each time)"
    : "";
  const body = [`${trig}${menuActionEligibilityClause(a.eligibility)}`, costPhrase, effClause, durClause]
    .filter((p) => p.length > 0)
    .join(", ");
  return `${label}: ${body}${usageNote}.`;
}

/** `capacity` → the menu's per-refresh budget sentence. `""` when absent. */
function capacityClause(capacity: Effect["capacity"]): string {
  if (!capacity) return "";
  const label = jstr(capacity.resource_label);
  const noun = jstr(capacity.ability_noun);
  const amount = jstr(capacity.amount);
  const refresh =
    {
      "battle-round": "battle round",
      turn: "turn",
      phase: "phase",
      battle: "battle",
    }[jstr(capacity.refresh)] ?? dekebab(jstr(capacity.refresh));
  return `This unit has a ${label} of ${amount}. In each ${refresh}, it can use ${noun} abilities whose combined ${label} does not exceed ${amount}.`;
}

/** `shared_usage` → a menu-level sentence fragment ("a unit may perform at most one action per phase; unless stated otherwise, a given action may be triggered once per phase"). `""` when absent. */
function sharedUsageClause(su: Effect["shared_usage"]): string {
  if (!su) return "";
  const parts: string[] = [];
  if (su.unit_max_manoeuvres_per_phase != null) {
    parts.push(
      su.unit_max_manoeuvres_per_phase === 1
        ? "a unit may perform at most one action per phase"
        : `a unit may perform at most ${jstr(su.unit_max_manoeuvres_per_phase)} actions per phase`,
    );
  }
  if (su.default_manoeuvre_max_per_phase != null) {
    parts.push(
      su.default_manoeuvre_max_per_phase === 1
        ? "unless stated otherwise, a given action may be triggered once per phase"
        : `unless stated otherwise, a given action may be triggered up to ${jstr(su.default_manoeuvre_max_per_phase)} times per phase`,
    );
  }
  return parts.join("; ");
}


/** "against a unit that is not a Monster or Vehicle" from a run of excluded target keywords. */
/** Capitalize the first character and lowercase the rest (`MONSTER` -> `Monster`). */

/** A `scaling` block → trailing clause ("for every 5 enemy models within 6\""). */
function scalingClause(s: NonNullable<Effect["scaling"]>): string {
  const clause = scalingWording(s);
  return s.evaluated === "on-apply" ? `${clause} (counted when the rule applies)` : clause;
}

function scalingWording(s: NonNullable<Effect["scaling"]>): string {
  if (s.of === "battle-round") return `multiplied by the battle round number${s.max_value != null ? ` (to a maximum of ${jstr(s.max_value)})` : ""}`;
  // A summed characteristic is counted in points: "for every point of Objective Control of the models embarked within this model".
  if (s.of === "embarked-models-oc") return `for every ${Number(s.per) === 1 ? "point" : `${jstr(s.per)} points`} of ${scaleSource(s as Record<string, unknown>)}${s.max_value != null ? ` (to a maximum of ${jstr(s.max_value)})` : ""}`;
  let c = `for every ${jstr(s.per)} ${scaleSource(s as Record<string, unknown>)}`;
  if (s.round === "up") c += " (rounding up)";
  if (s.max_value != null) c += ` (to a maximum of ${jstr(s.max_value)})`;
  return c;
}


/** Preserve independent aura predicates while sharing canonical filter vocabulary. */
function auraRoleFilter(filter: Record<string, unknown>, noun: string): string {
  const { all_of, any_of, none_of, not_all_of, ...relations } = filter;
  const all = Array.isArray(all_of) ? ` with ${all_of.map(jstr).join(" and ")}` : "";
  const any = Array.isArray(any_of) ? ` with at least one of ${orList(any_of.map(jstr))}` : "";
  const none = Array.isArray(none_of) ? ` without ${orList(none_of.map(jstr))}` : "";
  const notAll = Array.isArray(not_all_of) ? ` without all of ${not_all_of.map(jstr).join(" and ")}` : "";
  const other = Object.keys(relations).length ? ` matching ${filterSubject(relations)}` : "";
  return `${noun}${all}${any}${none}${notAll}${other}`;
}

/**
 * Who an aura is measured from. A filter that names an owner is army-wide: any of that side's
 * models with its keywords ("one or more friendly DEATH GUARD models"; owner any names no side).
 * Without one it narrows this model.
 */
function auraEmitter(filter: Record<string, unknown>): string {
  const { owner, all_of, ...rest } = filter;
  if (typeof owner !== "string") return auraRoleFilter(filter, "this model");
  const keywords = Array.isArray(all_of) ? all_of.map((keyword) => ` ${jstr(keyword)}`).join("") : "";
  return auraRoleFilter(rest, `one or more${owner === "any" ? "" : ` ${owner}`}${keywords} models`);
}

function auraClause(e: Effect, m: Record<string, unknown>, ctx: Ctx): string {
  // Range-extension of a named aura (e.g. Gift of Poxes: contagion +3").
  if (m.range_bonus != null) {
    const named = m.of != null ? `${titleCase(jstr(m.of))} ` : "";
    return `the range of this model's ${named}abilities is increased by ${jstr(m.range_bonus)}"${m.range_cap != null ? ` (to a maximum of ${jstr(m.range_cap)}")` : ""}`;
  }
  const rangeText = m.range != null ? rangePhrase(m.range) : "range";
  const capped = m.range_cap != null ? ` (to a maximum of ${jstr(m.range_cap)}", extensions included)` : "";
  const owner = e.target === "friendly-within-aura" ? "friendly" : "enemy";
  const recipientFilter = (m.eligible ?? m.recipient_filter ?? {}) as Record<string, unknown>;
  const subject = filterSubject({ owner, ...recipientFilter }, ctx).replace(/^all /, "").replace(/\bunits\b/, "unit").replace(/\bmodels\b/, "model").replace(/\bthat are\b/, "that is");
  const eligibleWho = `${/^[aeiou]/i.test(subject) ? "an" : "a"} ${subject}`;
  const recipient = m.eligible != null && m.recipient_filter != null ? auraRoleFilter(m.recipient_filter as Record<string, unknown>, eligibleWho) : eligibleWho;
  const emitter = m.emitter_filter != null ? auraEmitter(m.emitter_filter as Record<string, unknown>) : "this model";
  const effectText = m.effect != null ? describeEffectInline(m.effect as Effect, { ...ctx, auraRecipient: true }) : "that unit is affected";
  return `while ${recipient} is ${m.wholly === true ? "wholly " : ""}within ${rangeText}${capped} of ${emitter}, ${effectText}`;
}

/**
 * Single-clause translation for leaf effects (lowercase-initial, no period),
 * with any `scaling` block woven on as a trailing "for every …" clause.
 */
export function describeEffectInline(e: Effect, ctx: Ctx = {}): string {
  let base = describeEffectInlineBase(e, ctx);
  if (e.type === "movement-modifier" && e.after_move) base += `; if it does, ${describeEffectInline(e.after_move, ctx)}`;
  if (e.type === "mortal-wounds" && e.modifier?.in_addition_to_normal_damage === true) base += ", in addition to normal damage";
  return e.scaling ? `${base} ${scalingClause(e.scaling)}` : base;
}

/** The leaf/container switch; {@link describeEffectInline} wraps it to append scaling. */
/**
 * Render a dice-pool option requirement as a noun phrase: `pair of 4+`, or, for an
 * `any_of` set (a blessing that triggers on a double of X OR a triple of Y — World
 * Eaters Blessings of Khorne), the alternatives joined with " or ":
 * `pair of 6+ or triple of 3+`. The single-requirement output is byte-identical to
 * the pre-`any_of` phrasing (no leading article) so existing goldens don't move.
 */
function describeRequirement(req: unknown): string {
  return requirementPhrase(req);
}

function diceTableResultLabel(results: unknown): string {
  if (!Array.isArray(results)) return "";
  const faces = results.filter((value): value is number => typeof value === "number").sort((a, b) => a - b);
  if (faces.length > 1 && faces.every((face, index) => index === 0 || face === faces[index - 1] + 1)) {
    return `${faces[0]}-${faces[faces.length - 1]}`;
  }
  return faces.join(", ");
}

/** "roll one D6", or "roll 2 D6 and resolve each one (re-rolling any repeated result)". */
function diceTableHead(e: Effect): string {
  if (typeof e.count !== "number" || e.count < 2) return `roll one ${diceCase(e.dice)}`;
  return `roll ${e.count} ${diceCase(e.dice)} and resolve each one${e.distinct === true ? " (re-rolling any repeated result)" : ""}`;
}

function diceTableInline(e: Effect, ctx: Ctx): string {
  const outcomes = (e.outcomes ?? []).map(
    (outcome) => `on ${diceTableResultLabel(outcome.results)}, ${describeEffectInline(outcome.effect ?? {}, ctx)}`
  );
  return `${diceTableHead(e)}: ${outcomes.join("; ")}`;
}

/**
 * A roll-with-rider `sequence`: `[dice-gated rider, unconditional primary]`. The
 * rider fires on the roll; the primary always resolves. The leading "Regardless
 * of the result" is required so the rider cannot be misread as a gate on the
 * primary. Only compositions whose gate declares `rider: true` qualify — a
 * structurally similar but genuinely gating sequence must not pick this up.
 */
function rollWithRider(steps: Effect[], ctx: Ctx): string | null {
  if (steps.length !== 2) return null;
  const [first, second] = steps;
  if (first?.type !== "dice-gated" || (first as { rider?: unknown }).rider !== true) return null;
  const g = first as { dice?: unknown; comparison?: unknown; threshold?: unknown; on_success?: Effect | null };
  if (g.on_success == null) return null;
  const comp = formatComparison(jstr(g.comparison ?? "gte"), g.threshold);
  return `roll one ${diceCase(g.dice)}. On ${comp}, ${describeEffectInline(g.on_success, ctx)}. Regardless of the result, ${describeEffectInline(second, ctx)}`;
}

function describeEffectInlineBase(e: Effect, ctx: Ctx = {}): string {
  const m = e.modifier ?? {};

  switch (e.type) {
    case "named-region-state":
      return describeNamedRegionState(m, ctx);
    case "aura":
      return auraClause(e, m, ctx);
    case "no-effect":
      return "nothing happens";
    // Container types — inline forms.
    case "conditional":
      if (e.effect?.type === "named-region-state")
        return describeNamedRegionConditional(e.effect.modifier ?? {}, e.condition ?? {}, ctx);
      return `${conditionLeadIn(e.condition ?? {})}, ${describeEffectInline(e.effect ?? {}, ctx)}`;
    case "rules-bundle":
    case "sequence": {
      const rider = rollWithRider(e.steps ?? [], ctx);
      return rider ?? (e.steps ?? []).map((s) => describeEffectInline(s, ctx)).join("; ");
    }
    case "ability-part":
      return partInline(e, ctx);
    case "choice": {
      const prompt = choicePrompt(e);
      return `${prompt}: ${(e.options ?? []).map((o) => describeEffectInline(o, ctx)).join(" / ")}`;
    }
    case "dice-gated":
      if (e.test) return leadershipTest(e, ctx);
      return diceGate(e, ctx);
    case "roll":
      return `${rollHead(e as Record<string, unknown>)}; then ${describeEffectInline(e.effect ?? {}, ctx)}`;
    case "select-objective":
      return selectObjectiveInline(e as Record<string, unknown>, (x) => describeEffectInline((x ?? {}) as Effect, ctx));
    case "dice-table":
      return diceTableInline(e, ctx);
    case "dice-pool-allocation": {
      const pool = e.pool ? `${jstr(e.pool.count)}${jstr(e.pool.die)}` : "your dice pool";
      const opts = (e.options ?? [])
        .map((o) => `${jstr(o.name)} (requires ${describeRequirement(o.requirement)}): ${describeEffectInline(o.effect ?? {}, ctx)}`)
        .join(" / ");
      return `roll ${pool}: ${opts}`;
    }
    case "select-units":
      return selectUnitsInline(e.selector ?? {}, e.effect ?? {}, ctx);
    case "persistent-designation":
      if (e.operation === "replace") return persistentDesignationReplacement(e);
      if (!persistentDesignationSupported(e)) return "[persistent-designation]";
      return `${persistentDesignationLead(e)} ${persistentDesignationWhen(e)}, ${describeEffectInline(e.consumer?.effect ?? {}, ctx)}`;
    case "for-each-unit": {
      const selectedCtx = selectedContext(ctx, e.selector ?? {});
      return `for each ${forEachUnitSubject(e.selector)}: ${describeEffectInline(e.effect ?? {}, selectedCtx)}`;
    }
    case "designate-target": {
      const sel = e.select ?? {};
      const desig = e.designation ? designationLabel(e.designation) : "";
      const { trail: durTrail } = durationClauses(e.duration);
      const when =
        e.applies?.to === "target"
          ? "while it is your target"
          : e.applies?.to === "bearer-attacks-target"
            ? "each time this unit attacks it"
            : e.applies?.to === "bound-unit-attacks-reference"
              ? designatedAttackWhen(e.applies as Record<string, unknown>)
              : designationAttackerPhrase(e.applies);
      const whenClause = durTrail ? `${durTrail}, ${when}` : when;
      const recipientCtx = designatedRecipientContext(e.applies, ctx);
      return `select ${designationTargetSubject(sel)}${desig}; ${whenClause}, ${describeEffectInline(e.applies?.effect ?? {}, recipientCtx)}`;
    }
    case "stance-select":
      return `${stancePick(e)}${e.mode === "consumable" ? " (each may be chosen once per battle)" : ""}${stanceAdditive(e)}: ${(e.options ?? []).map((o) => `${jstr(o.name)} (${describeEffectInline(o.effect ?? {}, ctx)})`).join(" / ")}`;
    case "stance-selection-capacity": {
      const m = (e.modifier ?? {}) as {
        ability_id?: unknown;
        option?: { ability_id?: string; option_id?: string };
        options?: { ability_id?: string; option_id?: string }[];
        additional_selections?: unknown;
        allocation?: unknown;
      };
      const n = Number(m.additional_selections) || 1;
      const times = n === 1 ? "one additional time" : `${jstr(n)} additional times`;
      // A shared allowance narrowed to some options: spent on any one of them, not one of each.
      if (m.allocation !== "fixed-option" && Array.isArray(m.options)) {
        return `you can select ${orList(m.options.map((option) => titleCase(jstr(option.option_id))))} ${times} per battle, shared between them`;
      }
      const subject =
        m.allocation === "fixed-option" && m.option != null
          ? titleCase(jstr(m.option.option_id))
          : `one option of ${titleCase(jstr(m.ability_id))}`;
      return `you can select ${subject} ${times} per battle`;
    }
    case "risk-reward":
      return `take a ${testName(e.risk?.test)} test (on a failure, ${e.risk?.on_fail ? describeEffectInline(e.risk.on_fail, ctx) : "suffer a consequence"}), then ${describeEffectInline(e.reward ?? {}, ctx)}`;
    case "issue-orders":
      return `issue Orders, each one of: ${(e.options ?? []).map((o) => jstr(o.name)).join(" / ")}`;
    case "resource-action-menu":
      return `actions may be performed when their conditions are met: ${(e.actions ?? []).map((a) => describeMenuAction(a, ctx)).join(" / ")}`;




    default:
      if (LEAF_TYPES.has(e.type ?? "")) return describeLeaf(e as Leaf, ctx, (x, c) => describeEffectInline(x as Effect, c));
      return `[${e.type ?? "unknown"}]`;
  }
}

/**
 * A dice gate: roll new dice ("roll one D6: on a 4+, …"), or test the dice of a bound roll against a threshold
 * or a pair/triple requirement ("if that roll's dice include a pair of 3+ (those dice are used), …").
 */
function diceGate(e: Effect, ctx: Ctx): string {
  const success = e.on_success ? describeEffectInline(e.on_success, ctx) : "nothing happens";
  const fail = e.on_fail ? `; otherwise, ${describeEffectInline(e.on_fail, ctx)}` : "";
  if (e.from != null) {
    if (e.requirement != null) return `using a ${describeRequirement(e.requirement)} from that roll's unused dice, ${success}${fail}`;
    return `if ${quantityPhrase(e.from as Record<string, unknown>)} is ${formatComparison(e.comparison ?? "gte", e.threshold)}, ${success}${fail}`;
  }
  const comp = formatComparison(e.comparison ?? "gte", e.threshold);
  const kind = e.kind != null ? ` (${rollKindNoun(e.kind)})` : "";
  // "roll one D6", but "roll 2D6": a dice expression with its own count takes no article.
  const dice = diceCase(e.dice);
  return `roll ${/^\d/.test(dice) ? "" : "one "}${dice}${kind}: on ${comp}, ${success}${fail}`;
}

/** "select one", "select two", "select up to two" — how many menu options are picked. */
/** " (in addition to any already active)" when a stance pick joins the active options. */
function stanceAdditive(e: Effect): string {
  return e.additive === true ? " (in addition to any already active)" : "";
}

function stancePick(e: Effect): string {
  const min = e.min_choices ?? 1;
  const max = e.max_choices ?? 1;
  const n = (k: number): string => ["zero", "one", "two", "three", "four"][k] ?? String(k);
  if (min === max) return `select ${n(max)}`;
  return min <= 1 ? `select up to ${n(max)}` : `select from ${n(min)} to ${n(max)}`;
}

function choicePrompt(e: Effect): string {
  if (typeof e.choice_prompt === "string" && e.choice_prompt.trim().length > 0) return e.choice_prompt;
  if (e.min_choices != null && e.max_choices != null) {
    const quantity = e.min_choices === e.max_choices ? `exactly ${e.max_choices}` : e.min_choices === 0 ? `up to ${e.max_choices}` : `from ${e.min_choices} through ${e.max_choices}`;
    return `select ${quantity} distinct options${e.choice_label ? ` (${titleCase(e.choice_label)})` : ""}`;
  }
  return `select one of the following${e.choice_label ? ` (${titleCase(e.choice_label)})` : ""}`;
}

function namedRegionRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function namedRegionTitle(value: unknown): string {
  return titleCase(jstr(value));
}

function namedRegionRelation(value: unknown): string {
  return jstr(value) === "wholly-within" ? "wholly within" : dekebab(jstr(value));
}


function namedRegionPrefix(m: Record<string, unknown>): string {
  const region = namedRegionTitle(namedRegionRecord(m.region_ref).region_id);
  const producer = namedRegionRecord(m.producer);
  const sentences: string[] = [];
  for (const entry of Array.isArray(producer.baseline) ? producer.baseline : []) {
    const baseline = namedRegionRecord(entry);
    const duration = expiryTrail(baseline.duration as string | undefined);
    sentences.push(`${capitalize(regionPhrase(namedRegionRecord(baseline.region)))} is within ${region}${duration ? ` ${duration}` : ""}.`);
  }
  for (const entry of Array.isArray(producer.phase_extensions) ? producer.phase_extensions : []) {
    const extension = namedRegionRecord(entry);
    const trigger = normalizeTriggers(extension.trigger as AbilityTriggerSpec).map(describeTrigger).filter(Boolean).join(" or ");
    const duration = expiryTrail(extension.duration as string | undefined);
    const place = regionPhrase(namedRegionRecord(extension.region));
    sentences.push(`${capitalize(trigger)}, if ${describeCondition(extension.condition as Condition)}, ${place} is within ${region}${duration ? ` ${duration}` : ""} (evaluated once at that time).`);
  }
  for (const entry of Array.isArray(producer.additive_extensions) ? producer.additive_extensions : []) {
    const addition = namedRegionRecord(entry);
    sentences.push(`The area within ${rangePhrase(addition.range)} of one or more ${filterSubject(namedRegionRecord(addition.filter))} is within ${region}, continuously as those units move.`);
  }
  return sentences.join(" ");
}

function namedRegionSubject(m: Record<string, unknown>): string {
  const consumer = namedRegionRecord(m.consumer);
  return filterSubject(namedRegionRecord(consumer.beneficiary_filter));
}

function namedRegionBranchText(
  m: Record<string, unknown>,
  wholeUnit: boolean,
  qualified: boolean,
  conditional = false,
  ctx: Ctx = {},
): string {
  const consumer = namedRegionRecord(m.consumer);
  const branch = namedRegionRecord(consumer[qualified ? "qualified_branch" : "default_branch"]);
  const subject = namedRegionSubject(m);
  const effect = describeEffectInline(namedRegionRecord(branch.effect) as Effect, { ...ctx, unitSubject: subject });
  if (conditional) return effect;
  if (!qualified) return `${capitalize(effect)}.`;
  const condition = namedRegionRecord(consumer.qualified_condition);
  if (Object.keys(condition).length > 0) return `If ${describeCondition(condition as Condition)}, ${effect} instead`;
  const membership = namedRegionRecord(consumer.membership);
  const region = namedRegionTitle(namedRegionRecord(m.region_ref).region_id);
  const relation = namedRegionRelation(membership.relation);
  const membershipSubject = wholeUnit ? "such a unit" : "such a model";
  return `If ${membershipSubject} is ${relation} ${region}, ${effect} instead`;
}

function describeNamedRegionState(m: Record<string, unknown>, ctx: Ctx = {}): string {
  const consumer = namedRegionRecord(m.consumer);
  const membership = namedRegionRecord(consumer.membership);
  const wholeUnit = membership.unit_scope === "whole-unit";
  const attackGate = consumer.attack_condition ? `For each qualifying attack (${describeCondition(consumer.attack_condition as Condition)}): ` : "";
  return `${namedRegionPrefix(m)} ${attackGate}${namedRegionBranchText(m, wholeUnit, false, false, ctx)} ${namedRegionBranchText(m, wholeUnit, true, false, ctx)}`;
}

function describeNamedRegionConditional(m: Record<string, unknown>, condition: Condition, ctx: Ctx = {}): string {
  const consumer = namedRegionRecord(m.consumer);
  const membership = namedRegionRecord(consumer.membership);
  const wholeUnit = membership.unit_scope === "whole-unit";
  const negated = condition.operator === "not" && condition.operands?.length === 1;
  const predicate = describeCondition(negated ? condition.operands![0]! : condition);
  const defaultText = namedRegionBranchText(m, wholeUnit, false, true, ctx);
  const qualifiedText = namedRegionBranchText(m, wholeUnit, true, true, ctx);
  if (negated) {
    return `${namedRegionPrefix(m)} Unless ${predicate}, ${defaultText}. If ${predicate}, ${qualifiedText}.`;
  }
  return `${namedRegionPrefix(m)} When ${predicate}, ${qualifiedText}. Otherwise, ${defaultText}.`;
}

/**
 * What leads a part: its moment, its usage limit, its name when the rules give one, the choice to
 * use it and its cost ("at the end of your Movement phase, once per battle, you can").
 */
function partHead(e: Effect): string {
  const moment = normalizeTriggers(e.trigger).map(describeTrigger).filter(Boolean).join(" or ");
  const level = e.kind === "psychic" && e.level != null ? ` (Psychic level ${jstr(e.level)})` : "";
  // A named part that always applies is a labelled rule ("Kine Shield: …"), not one to use.
  const label = e.name && !moment && !e.optional ? `${jstr(e.name)}${level}` : "";
  const named = label ? "" : e.name ? `${e.optional ? "you can use " : "use "}${jstr(e.name)}${level}` : e.optional ? "you can" : "";
  const cost = e.cost ? `by paying this cost (${describeEffectInline(e.cost)})` : "";
  return [label, moment, e.usage ? usageClause(e.usage) : "", named, cost, durationClauses(e.duration).trail].filter(Boolean).join(", ");
}

/** A part on one line: its head, then its effect. */
function partInline(e: Effect, ctx: Ctx): string {
  const head = partHead(e);
  const body = describeEffectInline(e.effect ?? {}, ctx);
  return head ? `${head}: ${body}` : body;
}

/**
 * Block translation of a *container* effect tree (multi-line, two-space
 * indentation). Leaves and conditionals are handled inline by the caller.
 */
export function describeEffect(e: Effect, depth: number = 0, ctx: Ctx = {}): string {
  const indent = "  ".repeat(depth);
  const arrow = depth > 0 ? "-> " : "";

  switch (e.type) {
    case "conditional": {
      const inner = e.effect ?? {};
      if (CONTAINER_TYPES.has(inner.type ?? "")) {
        return `${indent}${capitalize(conditionLeadIn(e.condition ?? {}))}:\n` + describeEffect(inner, depth + 1, ctx);
      }
      return `${indent}${arrow}${capitalize(conditionLeadIn(e.condition ?? {}))}, ${describeEffectInline(inner, ctx)}.`;
    }
    case "rules-bundle":
    case "sequence": {
      const rider = rollWithRider(e.steps ?? [], ctx);
      if (rider) return `${indent}${arrow}${capitalize(rider)}.`;
      return (e.steps ?? []).map((s) => describeEffect(s, depth, ctx)).join("\n");
    }
    case "ability-part": {
      // A part is always a bullet of its ability, even at the top level.
      const inner = e.effect ?? {};
      if (CONTAINER_TYPES.has(inner.type ?? "")) return `${indent}-> ${capitalize(partHead(e))}:\n` + describeEffect(inner, depth + 1, ctx);
      return `${indent}-> ${capitalize(partInline(e, ctx))}.`;
    }
    case "ability-grant":
      // A grant printed with its ability: the holder and name, then the ability one level deeper.
      if (isDefinedGrant(e)) return `${indent}${arrow}${capitalize(definedGrantHead(e as Leaf, ctx))}:\n` + describeEffect(definitionPart(e as Leaf) as Effect, depth + 1, ctx);
      return `${indent}${arrow}${capitalize(describeEffectInline(e, ctx))}.`;
    case "choice": {
      const prompt = choicePrompt(e);
      return (
        `${indent}${capitalize(prompt)}:\n` +
        (e.options ?? []).map((o) => `${indent}  - ${capitalize(describeEffectInline(o, ctx))}.`).join("\n")
      );
    }
    case "dice-gated": {
      if (e.test) return `${indent}${arrow}${capitalize(leadershipTest(e, ctx))}.`;
      return `${indent}${arrow}${capitalize(diceGate(e, ctx))}.`;
    }
    case "roll": {
      const inner = e.effect ?? {};
      const head = `${indent}${arrow}${capitalize(rollHead(e as Record<string, unknown>))}`;
      if (CONTAINER_TYPES.has(inner.type ?? "")) return `${head}, then:\n` + describeEffect(inner, depth + 1, ctx);
      return `${head}; then ${describeEffectInline(inner, ctx)}.`;
    }
    case "select-objective": {
      const inner = e.effect ?? {};
      const nested = CONTAINER_TYPES.has(inner.type ?? "") ? describeEffect(inner, depth + 1, ctx) : null;
      return selectObjectiveBlock(e as Record<string, unknown>, indent, arrow, nested, (x) => describeEffectInline((x ?? {}) as Effect, ctx));
    }
    case "dice-table": {
      const lines = [`${indent}${arrow}${capitalize(diceTableHead(e))}:`];
      for (const outcome of e.outcomes ?? []) {
        lines.push(`${indent}  - On ${diceTableResultLabel(outcome.results)}: ${capitalize(describeEffectInline(outcome.effect ?? {}, ctx))}.`);
      }
      return lines.join("\n");
    }
    case "dice-pool-allocation": {
      const pool = e.pool ? `${jstr(e.pool.count)}${jstr(e.pool.die)}` : "your dice pool";
      const upTo =
        e.max_activations != null
          ? ` to activate up to ${jstr(e.max_activations)} of the following`
          : " to activate the following";
      const lines = [`${indent}${arrow}Roll ${pool}; allocate dice${upTo}:`];
      for (const opt of e.options ?? []) {
        lines.push(
          `${indent}  - ${jstr(opt.name)} (requires ${describeRequirement(opt.requirement)}): ${describeEffectInline(opt.effect ?? {}, ctx)}.`
        );
      }
      return lines.join("\n");
    }
    case "select-units": {
      const selector = e.selector ?? {};
      const inner = e.effect ?? {};
      const selectedCtx = selectedContext(ctx, selector);
      const lead = `Select ${selectUnitsSubject(selector)}${selectionBinding(selector)}`;
      const header = `${indent}${arrow}${lead}`;
      if (CONTAINER_TYPES.has(inner.type ?? "")) {
        if (selectUnitsPlural(selector)) {
          const nested = describeEffect(inner, depth + 2, selectedCtx);
          return `${header}:\n${indent}  -> For each selected ${selectorNoun(selector)}:\n${nested}`;
        }
        return `${header.replace(/\.$/, "")}:\n` + describeEffect(inner, depth + 1, selectedCtx);
      }
      const nested = selectedRecipient(describeEffectInline(inner, selectedCtx), selector);
      return `${header}: ${nested}.`;
    }
    case "persistent-designation": {
      if (e.operation === "replace") return `${indent}${arrow}${capitalize(persistentDesignationReplacement(e))}.`;
      if (!persistentDesignationSupported(e))
        return `${indent}${arrow}[persistent-designation].`;
      const inner = e.consumer?.effect ?? {};
      const head = `${indent}${arrow}${capitalize(persistentDesignationLead(e))} ${persistentDesignationWhen(e)}`;
      if (CONTAINER_TYPES.has(inner.type ?? "")) {
        return `${head}:\n` + describeEffect(inner, depth + 1, ctx);
      }
      return `${head}, ${describeEffectInline(inner, ctx)}.`;
    }
    case "for-each-unit": {
      const inner = e.effect ?? {};
      const selectedCtx = selectedContext(ctx, e.selector ?? {});
      const lead = `For each ${forEachUnitSubject(e.selector)}`;
      if (CONTAINER_TYPES.has(inner.type ?? ""))
        return `${indent}${lead}:\n` + describeEffect(inner, depth + 1, selectedCtx);
      return `${indent}${lead}: ${capitalize(describeEffectInline(inner, selectedCtx))}.`;
    }
    case "designate-target": {
      const sel = e.select ?? {};
      const desig = e.designation ? designationLabel(e.designation) : "";
      const applies = e.applies ?? {};
      const inner = applies.effect ?? {};
      const { trail: durTrail } = durationClauses(e.duration);
      const when =
        applies.to === "target"
          ? "while it is your target"
          : applies.to === "bearer-attacks-target"
            ? "each time this unit makes an attack against it"
            : applies.to === "bound-unit-attacks-reference"
              ? designatedAttackWhen(applies as Record<string, unknown>)
              : designationAttackerPhrase(applies, true);
      const whenClause = durTrail ? `${capitalize(durTrail)}, ${when}` : capitalize(when);
      const head = `${indent}${arrow}Select ${designationTargetSubject(sel)}${desig}. ${whenClause}`;
      const recipientCtx = designatedRecipientContext(applies, ctx);
      if (CONTAINER_TYPES.has(inner.type ?? "")) {
        return `${head}:\n` + describeEffect(inner, depth + 1, recipientCtx);
      }
      return `${head}, ${describeEffectInline(inner, recipientCtx)}.`;
    }
    case "stance-select": {
      const consum = e.mode === "consumable" ? " (each may be chosen once per battle)" : "";
      const lines = [`${indent}${arrow}${capitalize(stancePick(e))}${consum}${stanceAdditive(e)}:`];
      for (const opt of e.options ?? []) {
        lines.push(`${indent}  - ${jstr(opt.name)}: ${describeEffectInline(opt.effect ?? {}, ctx)}.`);
      }
      return lines.join("\n");
    }
    case "risk-reward": {
      const risk = e.risk ?? {};
      const onFail = risk.on_fail ? describeEffectInline(risk.on_fail, ctx) : "there is a consequence";
      const reward = describeEffectInline(e.reward ?? {}, ctx);
      return `${indent}${arrow}First take a ${testName(risk.test)} test — on a failure, ${onFail}; then ${reward}.`;
    }
    case "issue-orders": {
      const n = e.count != null ? jstr(e.count) : "one or more";
      const rng = e.range != null ? ` within ${jstr(e.range)}"` : "";
      const elig = e.eligible?.keyword ? ` ${jstr(e.eligible.keyword)}` : "";
      const lines = [`${indent}${arrow}Issue up to ${n} Orders to eligible friendly${elig} units${rng}, each one of:`];
      for (const opt of e.options ?? []) {
        lines.push(`${indent}  - ${jstr(opt.name)}: ${describeEffectInline(opt.effect ?? {}, ctx)}.`);
      }
      return lines.join("\n");
    }
    case "resource-action-menu": {
      const su = sharedUsageClause(e.shared_usage);
      const intro = su ? `Actions may be performed when their conditions are met. ${capitalize(su)}` : "Actions may be performed when their conditions are met";
      const lines = [`${indent}${arrow}${intro}:`];
      for (const action of e.actions ?? []) {
        lines.push(`${indent}  - ${describeMenuAction(action, ctx)}`);
      }
      const cap = capacityClause(e.capacity);
      return cap ? `${indent}${cap}\n${lines.join("\n")}` : lines.join("\n");
    }
    default:
      // Leaf at block position — render as a single capitalized sentence.
      return `${indent}${arrow}${capitalize(describeEffectInline(e, ctx))}.`;
  }
}

/** The lifetime supplied by an ability's duration-only scope. */
export function describeScope(s?: AbilityScope): string {
  if (!s?.duration) return "";
  return `Duration: ${expiryTrail(s.duration) || dekebab(s.duration)}.`;
}

/**
 * `Applies to: units with Possessed.` — the roster-highlighting audience named
 * by a curated `applies_to` filter. Empty string when the filter is absent or
 * carries no keywords (nothing to say). `all_of` reads as an AND set;
 * `any_of`, `none_of` and `not_all_of` keep their distinct predicate meanings.
 */
export function describeAppliesTo(a?: AbilityAppliesTo | null): string {
  if (!a) return "";
  const required = a.all_of ?? [];
  const any = a.any_of ?? [];
  const excluded = a.none_of ?? [];
  const notAll = a.not_all_of ?? [];
  if (required.length === 0 && any.length === 0 && excluded.length === 0 && notAll.length === 0) return "";
  const positive = [required.join(", "), any.length ? `at least one of ${orList(any)}` : ""].filter(Boolean).join(" and ");
  const base = positive ? `units with ${positive}` : "all units";
  const exc = excluded.length ? ` (excluding ${excluded.join(", ")})` : "";
  const partial = notAll.length ? ` (excluding units with all of ${notAll.join(", ")})` : "";
  return `Applies to: ${base}${exc}${partial}.`;
}

/** Join non-empty clauses with ", ", capitalize the sentence, and end with a period. */
function assembleSentence(parts: string[]): string {
  const body = parts.filter((p) => p.length > 0).join(", ");
  if (body.length === 0) return "";
  const period = body.endsWith(".") || body.endsWith(":") ? "" : ".";
  return capitalize(body) + period;
}

/**
 * Full generated text for an ability: a natural-English sentence (effect with
 * scope range + duration woven in, single-leaf conditionals inlined) plus a
 * trailing `Applies to:` line when the ability carries a curated `applies_to`
 * filter. This is the `ability.print()` consumers render when the dataset
 * carries no rules prose.
 */
export function describeAbility(a: AbilityLike): string {
  const core = a.effect ? renderTopLevel(a.effect, a.scope, a.usage, a.trigger) : "";
  const applies = describeAppliesTo(a.applies_to);
  return [core, applies].filter(Boolean).join("\n");
}

/** The inch range of a top-level `within` condition, else undefined. */
function conditionWithinRange(c?: Condition): number | undefined {
  if (c?.type !== "within") return undefined;
  const r = (c.parameters ?? {}).range as { inches?: unknown } | undefined;
  return typeof r?.inches === "number" ? r.inches : undefined;
}

function renderTopLevel(
  e: Effect,
  scope?: AbilityScope,
  usage?: AbilityUsage | AbilityUsage[] | null,
  trigger?: AbilityTriggerSpec | null,
): string {
  const ctx: Ctx = {};
  const { lead: durLead, trail } = durationClauses(scope?.duration);
  // An explicit usage limit supersedes the duration's coarse "once per battle" lead.
  const lead = usage && (Array.isArray(usage) || usage.frequency != null) ? usageClause(usage) : durLead;

  // A reactive trigger (or several — the ability fires on any) opens the
  // sentence ("Each time …"). B2: when a trigger's proximity just restates a
  // within-range condition on the effect, render the range once (drop it here).
  const triggers = normalizeTriggers(trigger).filter((t) => t.event != null);
  if (triggers.some((t) => t.event === "destroyed" || t.event === "model-destroyed")) ctx.destroyedTrigger = true;
  const condRange = conditionWithinRange(e.type === "conditional" ? e.condition : undefined);
  const trig = triggers
    .map((t) =>
      describeTrigger(condRange != null && (t.proximity?.range as { inches?: unknown } | undefined)?.inches === condRange ? { ...t, proximity: undefined } : t),
    )
    // Two triggers that read the same are one trigger in English ("when X or when X").
    .filter((s, i, all) => s.length > 0 && all.indexOf(s) === i)
    .join(" or ");

  if (e.type === "conditional") {
    const inner = e.effect ?? {};
    const leadIn = conditionLeadIn(e.condition ?? {});
    if (CONTAINER_TYPES.has(inner.type ?? "")) {
      // Block: "<trigger>[, <lead-in>][, <duration>]:" then the indented container.
      const header = [trig, lead, leadIn, trail].filter((p) => p.length > 0).join(", ");
      return capitalize(header) + ":\n" + describeEffect(inner, 1, ctx);
    }
    return assembleSentence([trig, lead, leadIn, trail, describeEffectInline(inner, ctx)]);
  }

  if (CONTAINER_TYPES.has(e.type ?? "") || isDefinedGrant(e)) {
    // Containers render block; a trigger/duration lead-in prefixes the block when
    // present. A designate-target carrying its own `duration` renders that
    // duration itself — repeating the scope duration in the head would double it.
    const ownDuration =
      (e.type === "designate-target" || e.type === "persistent-designation") && e.duration != null;
    const head = [trig, lead, ownDuration ? "" : trail].filter((p) => p.length > 0).join(", ");
    // Under a header, the block's steps are indented as they are under a condition's lead-in.
    return head ? capitalize(head) + ":\n" + describeEffect(e, 1, ctx) : describeEffect(e, 0, ctx);
  }

  return assembleSentence([trig, lead, trail, describeEffectInline(e, ctx)]);
}

function leadershipTest(e: Effect, ctx: Ctx): string {
  const who = unitRefPhrase(e.test?.subject);
  const kind = e.test?.kind === "battle-shock" ? "Battle-shock" : "Leadership";
  const modifiers = (e.test?.modifiers ?? []).map((modifier) => `apply ${signed("add", modifier.value)} if ${describeCondition(modifier.condition)}`).join("; ");
  const success = e.on_success ? describeEffectInline(e.on_success, ctx) : "nothing happens";
  const failures = [
    ...(e.test?.kind === "battle-shock" ? [`${who} becomes Battle-shocked`] : []),
    ...(e.on_fail ? [describeEffectInline(e.on_fail, ctx)] : []),
  ];
  const fail = failures.length ? `; otherwise, ${failures.join("; ")}` : "";
  return `${who} takes a ${kind} test (2D6, passing on its current Leadership or higher${modifiers ? `; ${modifiers}` : ""}); if passed, ${success}${fail}`;
}

function selectionRefName(ref: unknown, fallback: string): string {
  const value = ref && typeof ref === "object" ? ref as Record<string, unknown> : {};
  const id = value.selection_var ?? value.event_var;
  return typeof id === "string" && id.length > 0
    ? `the bound ${dekebab(id.replace(/_/g, "-"))}`
    : fallback;
}


function designatedAttackWhen(applies: Record<string, unknown>): string {
  const source = selectionRefName(applies.beneficiary, "the selected beneficiary unit");
  const target = selectionRefName(applies.reference, "the selected designated target");
  return `each time ${source} makes an attack against ${target}`;
}

function designatedRecipientContext(applies: Effect["applies"], ctx: Ctx): Ctx {
  if (applies?.to !== "bound-unit-attacks-reference") return ctx;
  return { ...ctx, unitSubject: selectionRefName(applies.beneficiary, "the selected beneficiary unit") };
}
