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
import { describeTiming, eventClause } from "./timing.js";
import { describeTrigger, normalizeTriggers, type AbilityTriggerSpec } from "./trigger.js";
import { describeLeaf, LEAF_TYPES, type Leaf } from "./effect-leaf.js";
import {
  bracketKeyword, capitalize, diceCase, formatComparison, jstr, orList, resourceNoun, rollName, signed, testName, type Ctx,
} from "./effect-words.js";
export type { Ctx };
export { describeTrigger };

/** Independent all-required/none-excluded keyword predicate for aura roles. */
export interface KeywordFilter {
  required_keywords: string[];
  excluded_keywords?: string[];
}

/** Aura modifier surface, including direction-specific keyword predicates. */
export interface AuraModifier {
  range?: number | number[];
  range_bonus?: number;
  of?: string;
  emitter_filter?: KeywordFilter;
  recipient_filter?: KeywordFilter;
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
  usage?: AbilityUsage;
  dice?: string;
  roll_var?: string;
  threshold?: number | string;
  comparison?: string;
  optional?: boolean;
  test?: { kind: "leadership" | "battle-shock"; subject: "unit" | "self" | "target"; modifiers?: { condition: Condition; value: number }[] };
  outcomes?: {
    results?: number[];
    effect?: Effect;
  }[];
  on_success?: Effect | null;
  on_fail?: Effect | null;
  pool?: { count: number; die: string };
  max_activations?: number;
  selector?: {
    count?: number;
    min_count?: number;
    max_count?: number;
    keywords?: string[];
    model_names?: string[];
    excluded_keywords?: string[];
    owner?: string;
    target_kind?: "unit" | "model";
    member_of?: "bearer-unit";
    reference?: "bearer" | "bearer-unit" | "bearer-transport";
    origin?: "bearer" | "bearer-unit";
    controlled_by?: "your-army" | "opponent";
    requires_unit?: { owner: string; requires_ability: string; relation: "within-range" };
    bind_as?: string;
    within_inches_from?: { selection_var: string };
    visible_to?: { selection_var: string };
    selection_limit?: { count: number; period: string };
    within_inches?: number;
    within_objective?: { selection_var: string };
    range_inches?: number;
    visibility_required?: boolean;
    engagement_relation?: "any" | "engaged-with-bearer" | "not-engaged-with-bearer";
    eligibility?: Condition;
  };
  scaling?: {
    per?: number;
    of?: string;
    within_inches?: number;
    round?: string;
    max_value?: number;
  };
  // designate-target / persistent-designation
  designation?: string;
  select?: string | (DesignationSelection & {
    count?: number;
    selection_policy?: string;
    allow_while_embarked?: boolean;
  });
  consumer?: {
    relation?: string;
    beneficiary?: string;
    reference?: { selection_var: string };
    effect?: Effect;
  };
  lifecycle?: {
    replace?: { event?: string; reference?: { selection_var: string }; optional?: boolean };
    exclusivity?: string;
    expiry?: string;
  };
  // leader-model-ability-grant / formation-attachment-grant
  source?: string;
  beneficiary?: string;
  leader_filter?: { identity?: string; keywords?: string[] };
  attached_unit_filter?: string[] | null;
  recipient_binding?: string;
  attachment?: { leader_id?: string; bodyguard_id?: string };
  formation_event?: string;
  grant?: { recipient?: string; effect?: Effect };
  applies?: {
    to?: string;
    effect?: Effect;
    attacker_keywords?: string[];
    attacker_unit_keywords?: string[];
    beneficiary?: { selection_var: string } | { event_var: string };
    reference?: { selection_var: string };
  };
  duration?: string;
  // stance-select
  mode?: string;
  scope?: string;
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
    requires_keyword?: string[];
    excludes_keyword?: string[];
    selector_count?: number;
    requires?: Condition[];
  };
  usage?: { repeatable_if_different_unit?: boolean };
  duration?: string;
  effect?: Effect;
}

/** Ability scope, as carried on enrichment ability entries. */
export interface AbilityScope {
  range?: string;
  duration?: string;
  range_inches?: number;
}

/** Curated keyword filter naming which units an ability benefits. */
export interface AbilityAppliesTo {
  required_keywords?: string[];
  excluded_keywords?: string[];
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
  usage?: AbilityUsage | null;
  applies_to?: AbilityAppliesTo | null;
}

const CONTAINER_TYPES = new Set([
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

/** "one enemy Vehicle unit within 12\"" — the `select-units` selector phrase. */
function selectUnitsSubject(sel: Record<string, unknown> = {}): string {
  const kw = ((sel.keywords as unknown[]) ?? []).map((k) => titleCase(jstr(k))).join(" ");
  const exactCount = sel.count ?? (
    sel.min_count != null && Number(sel.min_count) === Number(sel.max_count)
      ? sel.max_count
      : undefined
  );
  const bounded = sel.min_count != null && exactCount == null;
  const count = exactCount ?? sel.max_count;
  const single = Number(count) === 1;
  const nounBase = sel.target_kind === "model" ? "model" : "unit";
  const noun = single ? nounBase : `${nounBase}s`;
  const quantity =
    exactCount != null
      ? single ? "one" : jstr(count)
      : bounded
        ? `from ${jstr(sel.min_count)} through ${jstr(sel.max_count)}`
        : `up to ${jstr(count)}`;
  const boundOrigin = sel.within_inches_from
    ? ` of ${selectionRefName(sel.within_inches_from, "the bound source unit")}`
    : "";
  const within =
    sel.within_inches != null
      ? ` within ${jstr(sel.within_inches)}"${boundOrigin}`
      : sel.range_inches != null
        ? ` within ${jstr(sel.range_inches)}"${boundOrigin || ` of ${referenceOrigin(sel.reference)}`}`
        : "";
  const visible = sel.visible_to
    ? ` visible to ${selectionRefName(sel.visible_to, "the bound source unit")}`
    : sel.visibility_required === true ? " visible to the bearer" : "";
  const inclusive = bounded ? ", inclusive" : "";
  const eligibility =
    typeof sel.eligibility === "object" && sel.eligibility != null
      ? ` ${describeSelectionEligibility(sel.eligibility as Condition)}`
      : "";
  return `${quantity} ${jstr(sel.owner)}${kw ? ` ${kw}` : ""} ${noun}${selectionModelFilters(sel)}${inclusive}${within}${visible}${eligibility}`;
}

function selectionModelFilters(sel: Record<string, unknown>): string {
  const names = Array.isArray(sel.model_names) ? ` named ${orList(sel.model_names.map(jstr))}` : "";
  const exclusions = Array.isArray(sel.excluded_keywords) && sel.excluded_keywords.length
    ? ` (excluding ${sel.target_kind === "model" ? "models" : "units"} with ${orList(sel.excluded_keywords.map(jstr))})`
    : "";
  return names + exclusions;
}

function selectionLimitPhrase(limit: { count: number; period: string }, noun: string): string {
  return `each ${noun} can be selected for this ability at most ${limit.count === 1 ? "once" : `${limit.count} times`} per ${dekebab(limit.period)} across your army`;
}

function selectUnitsEngagement(sel: Record<string, unknown> = {}): string {
  const parts: string[] = [];
  const noun = sel.target_kind === "model" ? "model" : "unit";
  const origin = referenceOrigin(sel.reference);
  if (sel.engagement_relation === "engaged-with-bearer") parts.push(`For each selected ${noun}, it must be within Engagement Range of ${origin}.`);
  if (sel.engagement_relation === "not-engaged-with-bearer") parts.push(`For each selected ${noun}, it must not be within Engagement Range of ${origin}.`);
  const limit = sel.selection_limit as { count: number; period: string } | undefined;
  if (limit) parts.push(`${capitalize(selectionLimitPhrase(limit, noun))}.`);
  return parts.join(" ");
}

function selectUnitsPlural(sel: Record<string, unknown> = {}): boolean {
  return Number(sel.count ?? sel.max_count) > 1;
}

function selectedRecipient(text: string, sel: Record<string, unknown> = {}): string {
  const noun = sel.target_kind === "model" ? "model" : "unit";
  const recipient = selectUnitsPlural(sel) ? `each selected ${noun}` : `the selected ${noun}`;
  return text
    .replace(/\b[Tt]he unit's\b/g, (match) => match[0] === "T" ? `Each selected ${noun}'s` : `${recipient}'s`)
    .replace(/\b[Tt]he unit\b/g, (match) => match[0] === "T" ? `Each selected ${noun}` : recipient);
}

function selectedContext(ctx: Ctx, sel: Record<string, unknown>): Ctx {
  const selectedModel = sel.target_kind === "model";
  return { ...ctx, selectedUnit: !selectedModel, selectedModel, unitSubject: undefined };
}

function selectUnitsInline(sel: Record<string, unknown>, effect: Effect, ctx: Ctx): string {
  const subject = selectUnitsSubject(sel);
  const engagement = selectUnitsEngagement(sel);
  const binding = selectionBinding(sel);
  const nested = selectedRecipient(describeEffectInline(effect, selectedContext(ctx, sel)), sel);
  return engagement
    ? `select ${subject}${binding}. ${engagement} ${capitalize(nested)}`
    : `select ${subject}${binding}: ${nested}`;
}

/** Render the beneficiary-only leader relation without exposing a bearer fallback. */
function leaderModelAbilityGrantClause(e: Effect, ctx: Ctx): string {
  const filter = e.leader_filter ?? {};
  const identity = filter.identity ? titleCase(filter.identity) : "";
  const keywords = (filter.keywords ?? []).map(bracketKeyword).join(" and ");
  const role =
    e.beneficiary === "attached-character-leader"
      ? "the attached CHARACTER leader model"
      : "the attached leader model";
  const leader = `${role}${identity ? ` identified as ${identity}` : ""}${keywords ? ` with ${keywords}` : ""}`;
  const unitKeywords = (e.attached_unit_filter ?? []).map(bracketKeyword).join(" and ");
  const source = `the bearer unit${unitKeywords ? ` with ${unitKeywords}` : ""}`;
  const nested = e.grant?.effect ?? {};
  const rendered = describeEffectInline({ ...nested, target: "this-model" }, ctx).replace(
    /^this model\b/,
    "that leader model",
  );
  return `while ${leader} leads ${source}, ${rendered}`;
}

/** "enemy unit within 6\"" — the `for-each-unit` selector phrase. */
/** Range/engagement origin phrase for a selector's `reference`. */
function referenceOrigin(reference: unknown): string {
  if (reference === "bearer-transport") return "this model's unit's Transport";
  return reference === "bearer-unit" ? "this model's unit" : "the bearer";
}

function forEachUnitSubject(sel: Record<string, unknown> = {}): string {
  const keywordList = Array.isArray(sel.keywords)
    ? sel.keywords.map((keyword) => titleCase(jstr(keyword)))
    : [];
  const keywords =
    keywordList.length === 0
      ? ""
      : sel.keyword_match === "any"
        ? `${orList(keywordList)} `
        : `${keywordList.join(" ")} `;
  const within = [
    sel.within_inches != null ? ` within ${jstr(sel.within_inches)}"` : "",
    sel.within_objective ? ` within range of ${selectionRefName(sel.within_objective, "the selected objective marker")}` : "",
  ].join("");
  const origin = referenceOrigin(sel.reference);
  const engagement =
    sel.engagement_relation === "engaged-with-bearer"
      ? ` in Engagement Range of ${origin}`
      : sel.engagement_relation === "not-engaged-with-bearer"
        ? ` not in Engagement Range of ${origin}`
        : "";
  const noun = sel.target_kind === "model" ? "model" : "unit";
  const eligibility = sel.eligibility ? ` ${describeSelectionEligibility(sel.eligibility as Condition)}` : "";
  return `${jstr(sel.owner)} ${keywords}${noun}${selectionModelFilters(sel)}${sel.member_of === "bearer-unit" ? " in this model's unit" : ""}${within}${engagement}${eligibility}${selectionBinding(sel)}`;
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

type DesignationSelection = {
  scope?: string;
  timing?: string;
  within_inches?: number;
  reference?: "bearer" | "bearer-unit" | "bearer-transport";
  visibility_required?: boolean;
  within_inches_from?: { selection_var: string };
  visible_to?: { selection_var: string };
  excluded_keywords?: unknown[];
  bind_as?: string;
  keywords?: unknown[];
  keyword_match?: string;
  eligibility?: Condition;
  selection_limit?: { count: number; period: string };
};

function designationTargetSubjectBase(sel: DesignationSelection): string {
  const disposition = sel.scope === "friendly-unit" ? "friendly" : "enemy";
  const keywords = Array.isArray(sel.keywords) ? sel.keywords.map((keyword) => titleCase(jstr(keyword))) : [];
  const keywordJoin = sel.keyword_match === "any" ? " or " : " ";
  const keywordText = keywords.length > 0 ? ` ${keywords.join(keywordJoin)}` : "";
  const reference = referenceOrigin(sel.reference);
  const origin = sel.within_inches_from
    ? ` of ${selectionRefName(sel.within_inches_from, "the bound source unit")}`
    : sel.reference ? ` of ${reference}` : "";
  const within = sel.within_inches != null ? ` within ${jstr(sel.within_inches)}"${origin}` : "";
  const visible = sel.visible_to
    ? ` visible to ${selectionRefName(sel.visible_to, "the bound source unit")}`
    : sel.visibility_required ? ` visible to ${reference}` : "";
  const exclusions = Array.isArray(sel.excluded_keywords) && sel.excluded_keywords.length
    ? ` (excluding ${sel.excluded_keywords.map(jstr).join(" and ")} units)`
    : "";
  return `${disposition}${keywordText} unit${within}${visible}${exclusions}`;
}
function designationTargetSubject(sel: DesignationSelection): string {
  const limit = sel.selection_limit ? ` (${selectionLimitPhrase(sel.selection_limit, "unit")})` : "";
  return designationTargetSubjectBase(sel) + (sel.eligibility ? ` ${describeSelectionEligibility(sel.eligibility)}` : "") + selectionBinding(sel) + limit;
}

function designationAttackerPhrase(applies: Effect["applies"], block = false): string {
  const modelKeywords = applies?.attacker_keywords?.join(" ");
  const unitKeywords = applies?.attacker_unit_keywords?.join(" ");
  const attacker = unitKeywords
    ? `a${modelKeywords ? ` ${modelKeywords}` : ""} model in a friendly ${unitKeywords} unit`
    : modelKeywords ? `a friendly ${modelKeywords} model` : "a friendly unit";
  return `each time ${attacker} ${block ? "makes an attack against it" : "attacks it"}`;
}


function persistentDesignationName(designation: unknown, scope: unknown): string {
  const label = titleCase(jstr(designation));
  if (scope === "objective-marker")
    return /\bMarker$/.test(label) ? `your ${label}` : `your ${label} Marker`;
  return /\bTarget$/.test(label) ? `your ${label}` : `your ${label} target`;
}

function persistentDesignationLabel(designation: unknown, scope: unknown): string {
  return ` (${persistentDesignationName(designation, scope)})`;
}

function persistentDesignationSupported(e: Effect): boolean {
  const select = typeof e.select === "object" && e.select ? e.select : {};
  const consumer = e.consumer ?? {};
  const recipient = consumer.beneficiary === "bearer" || consumer.beneficiary === "unit";
  return recipient &&
    ((select.scope === "enemy-unit" && consumer.relation === "attacks-selected-unit") ||
      (select.scope === "objective-marker" && consumer.relation === "within-selected-marker"));
}

function persistentDesignationLead(e: Effect): string {
  const select = typeof e.select === "object" && e.select ? e.select : {};
  const noun = select.scope === "objective-marker" ? "objective marker" : "enemy unit";
  const label = persistentDesignationLabel(e.designation, select.scope);
  const lead = select.timing ? `${describeTiming(select.timing)}, select` : "select";
  const clauses = [`${lead} one ${noun}${label}${selectionBinding(select)}.`];
  if (select.allow_while_embarked) clauses.push("This selection can be made while this unit is embarked.");
  const lifecycle = e.lifecycle;
  if (select.selection_policy === "replace-on-destroyed" && lifecycle?.replace) {
    const replacement = lifecycle.replace;
    const name = selectionRefName(replacement.reference, persistentDesignationName(e.designation, select.scope));
    clauses.push(`When ${name} is destroyed, ${replacement.optional ? "you may" : "you must"} select one new ${noun} to replace it.`);
  }
  if (lifecycle?.exclusivity === "one-active-per-bearer-unit") clauses.push("Only one such designation can be active for this bearer unit.");
  if (lifecycle?.expiry === "battle-end" && e.duration !== "battle") clauses.push("This designation expires at the end of the battle.");
  return clauses.join(" ");
}

function persistentDesignationWhen(e: Effect): string {
  const select = typeof e.select === "object" && e.select ? e.select : {};
  const consumer = e.consumer ?? {};
  const name = selectionRefName(consumer.reference, persistentDesignationName(e.designation, select.scope));
  const bearer = consumer.beneficiary === "unit" ? "a model in this unit" : "this model";
  const relation = consumer.relation === "within-selected-marker"
    ? `while ${bearer} is within range of ${name}`
    : `each time ${bearer} makes an attack against ${consumer.reference ? name : "it"}`;
  const { trail } = durationClauses(e.duration);
  return trail ? `${capitalize(trail)}, ${relation}` : relation;
}

function persistentDesignationReplacement(e: Effect): string {
  const select = typeof e.select === "object" && e.select ? e.select : {};
  const replacement = e.lifecycle?.replace;
  const previous = selectionRefName(replacement?.reference, persistentDesignationName(e.designation, select.scope));
  const label = persistentDesignationLabel(e.designation, select.scope);
  const embarked = select.allow_while_embarked ? ". This selection can be made while this unit is embarked" : "";
  return `when ${previous} is destroyed, ${replacement?.optional ? "you may" : "you must"} select one new enemy unit${label} to replace this bearer unit's existing designation${selectionBinding(select)}. Its existing effects apply to the new target without changing the designation's battle-end expiry${embarked}`;
}


/**
 * Duration → woven clause. `lead` sits at the very front of the sentence
 * ("Once per battle, …"); `trail` sits after the trigger/condition and before
 * the effect ("…, until the end of the phase, …"). `permanent` adds nothing.
 */
export function durationClauses(duration: string | undefined): { lead: string; trail: string } {
  switch (duration) {
    case "attack-sequence":
      return { lead: "", trail: "until that unit finishes resolving its attacks" };
    case "resolution":
      return { lead: "", trail: "when resolving this use" };
    case "phase":
      return { lead: "", trail: "until the end of the phase" };
    case "turn":
      return { lead: "", trail: "until the end of the turn" };
    case "battle":
      return { lead: "", trail: "for the rest of the battle" };
    case "battle-round":
      return { lead: "", trail: "until the end of the battle round" };
    case "until-next-command-phase":
      return { lead: "", trail: "until the start of your next Command phase" };
    case "until-next-movement-phase":
      return { lead: "", trail: "until the start of your next Movement phase" };
    case "until-next-battle-round":
      return { lead: "", trail: "until the start of the next battle round" };
    case "until-start-next-turn":
      return { lead: "", trail: "until the start of your next turn" };
    case "one-use":
      return { lead: "once per battle", trail: "" };
    default: // permanent / absent
      return { lead: "", trail: "" };
  }
}

/** `excludes_keyword`/`requires_keyword` → the eligible-unit noun phrase for a menu action ("one friendly non-TITANIC unit" / "a friendly VEHICLE unit"). Absent eligibility keywords fall back to the plain subject. */
function menuActionSubject(elig: MenuAction["eligibility"]): string {
  const requires = elig?.requires_keyword ?? [];
  const excludes = elig?.excludes_keyword ?? [];
  if (excludes.length) return `one friendly non-${excludes.map(jstr).join("/")} unit`;
  if (requires.length) return `a friendly ${requires.map(jstr).join(" ")} unit`;
  return "the unit";
}

/** A menu action's `eligibility` → a trailing parenthetical naming which unit may use it and any extra requirements (`eligibility.requires` conditions, rendered via the shared `describeCondition` and joined with "and"). `""` when the action is open to any unit with no further gate. */
function menuActionEligibilityClause(elig: MenuAction["eligibility"]): string {
  if (!elig) return "";
  const hasKeywordGate = (elig.requires_keyword?.length ?? 0) > 0 || (elig.excludes_keyword?.length ?? 0) > 0;
  const requirementPhrases = (elig.requires ?? []).map(describeCondition);
  if (!hasKeywordGate && requirementPhrases.length === 0) return "";
  const parts: string[] = [];
  if (hasKeywordGate) parts.push(`only usable by ${menuActionSubject(elig)}`);
  if (requirementPhrases.length) parts.push(requirementPhrases.join(" and "));
  return parts.length ? ` (${parts.join(", ")})` : "";
}

/** A menu action's `duration` → a trailing clause. `immediate` (and absent) render with NO clause — a one-off action whose only lasting result is the board position it leaves behind. */
function menuActionDurationClause(duration: string | undefined): string {
  switch (duration) {
    case "until-end-of-phase":
      return "until the end of the phase";
    case "until-end-of-turn":
      return "until the end of the turn";
    default:
      return "";
  }
}

/** One `resource-action-menu` action → a bullet body ("Label: trigger, spend N tokens, effect, duration (notes)."). */
function describeMenuAction(a: MenuAction, ctx: Ctx): string {
  const label = jstr(a.label ?? a.id);
  const triggers = normalizeTriggers(a.when);
  const trig = triggers.map(describeTrigger).filter((s) => s.length > 0).join(" or ");
  const cost = a.cost ?? {};
  const costPhrase = `spend ${jstr(cost.amount)} ${resourceNoun(cost.pool_id, cost.resource_label, cost.amount)}`;
  const effClause = describeEffectInline(a.effect ?? {}, ctx);
  const durClause = menuActionDurationClause(a.duration);
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

/** Usage limit → front-of-sentence lead clause ("once per turn", "twice per battle per unit"). */
function usageClause(u: AbilityUsage): string {
  const n = Number(u.count ?? 1);
  let base: string;
  switch (u.frequency) {
    case "once-per-turn":
      base = "once per turn";
      break;
    case "once-per-phase":
      base = "once per phase";
      break;
    case "once-per-battle-round":
      base = "once per battle round";
      break;
    case "once-per-command-phase":
      base = "once per Command phase";
      break;
    case "once-per-opponent-turn":
      base = "once per opponent's turn";
      break;
    case "first-this-battle":
      base = "the first time this battle";
      break;
    case "first-time-this-phase":
      base = "the first time this phase";
      break;
    case "n-per-battle":
      base = n === 1 ? "once per battle" : n === 2 ? "twice per battle" : `${jstr(n)} times per battle`;
      break;
    default:
      base = dekebab(jstr(u.frequency));
  }
  return u.per != null ? `${base} per ${jstr(u.per)}` : base;
}

/** "against a unit that is not a Monster or Vehicle" from a run of excluded target keywords. */
/** Capitalize the first character and lowercase the rest (`MONSTER` -> `Monster`). */

/** Humanized noun for a scaling `of` dimension (`enemy-models-in-range` → `enemy models`). */
const SCALE_OF: Record<string, string> = {
  "enemy-models-in-range": "enemy models",
  "friendly-models-in-range": "friendly models",
  "models-in-bearer-unit": "models in this unit",
  "models-in-or-embarked-in-bearer": "models in or embarked within this model",
  "enemy-units-in-range": "enemy units",
  "wounds-lost": "wounds lost",
};

/** A `scaling` block → trailing clause ("for every 5 enemy models within 6\""). */
function scalingClause(s: NonNullable<Effect["scaling"]>): string {
  const ofText = SCALE_OF[jstr(s.of)] ?? dekebab(jstr(s.of));
  let c = `for every ${jstr(s.per)} ${ofText}`;
  if (s.within_inches != null) c += ` within ${jstr(s.within_inches)}"`;
  if (s.round === "up") c += " (rounding up)";
  if (s.max_value != null) c += ` (to a maximum of ${jstr(s.max_value)})`;
  return c;
}

function auraEligibleSubject(who: string, eligible: unknown): string {
  if (typeof eligible !== "object" || eligible == null) return who;
  const e = eligible as Record<string, unknown>;
  const required = Array.isArray(e.required_keywords) ? e.required_keywords.map(jstr) : [];
  const excluded = Array.isArray(e.excluded_keywords) ? e.excluded_keywords.map(jstr) : [];
  const base = required.length ? `${who.slice(0, -4)}${required.join(" ")} unit` : who;
  return `${base}${excluded.length ? ` (excluding ${excluded.join(" ")} units)` : ""}`;
}

/** Generic aura `modifier` → one lowercase-initial clause. */
/** Render one independent aura-role keyword predicate without changing legacy auras. */
function keywordFilterClause(value: unknown, noun: string): string {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return noun;
  const filter = value as Partial<KeywordFilter>;
  const required = Array.isArray(filter.required_keywords)
    ? filter.required_keywords.map(jstr).join(" and ")
    : "";
  const excluded = Array.isArray(filter.excluded_keywords)
    ? filter.excluded_keywords.map(jstr).join(" or ")
    : "";
  return `${noun}${required ? ` with ${required}` : ""}${excluded ? ` without ${excluded}` : ""}`;
}

function auraClause(e: Effect, m: Record<string, unknown>, ctx: Ctx): string {
  // Range-extension of a named aura (e.g. Gift of Poxes: contagion +3").
  if (m.range_bonus != null) {
    const named = m.of != null ? `${titleCase(jstr(m.of))} ` : "";
    return `the range of this model's ${named}abilities is increased by ${jstr(m.range_bonus)}"`;
  }
  const range = m.range;
  const rangeText = Array.isArray(range)
    ? `${(range as number[]).map((r) => `${r}"`).join("/")} (by battle round)`
    : range != null
      ? `${jstr(range)}"`
      : "range";
  const who = e.target === "friendly-within-aura" ? "a friendly unit" : "an enemy unit";
  const eligibleWho = auraEligibleSubject(who, m.eligible);
  const recipient = m.recipient_filter != null ? keywordFilterClause(m.recipient_filter, eligibleWho) : eligibleWho;
  const emitter = m.emitter_filter != null ? keywordFilterClause(m.emitter_filter, "this model") : "this model";
  const effectText = m.effect != null ? describeEffectInline(m.effect as Effect, { ...ctx, auraRecipient: true }) : "that unit is affected";
  return `while ${recipient} is within ${rangeText} of ${emitter}, ${effectText}`;
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
  const one = (r: { type?: unknown; min_value?: unknown } | undefined) =>
    `${jstr(r?.type)} of ${jstr(r?.min_value)}+`;
  const anyOf = (req as { any_of?: unknown } | undefined)?.any_of;
  if (Array.isArray(anyOf)) return anyOf.map(one).join(" or ");
  return one(req as { type?: unknown; min_value?: unknown } | undefined);
}

function diceTableResultLabel(results: unknown): string {
  if (!Array.isArray(results)) return "";
  const faces = results.filter((value): value is number => typeof value === "number").sort((a, b) => a - b);
  if (faces.length > 1 && faces.every((face, index) => index === 0 || face === faces[index - 1] + 1)) {
    return `${faces[0]}-${faces[faces.length - 1]}`;
  }
  return faces.join(", ");
}

function diceTableInline(e: Effect, ctx: Ctx): string {
  const outcomes = (e.outcomes ?? []).map(
    (outcome) => `on ${diceTableResultLabel(outcome.results)}, ${describeEffectInline(outcome.effect ?? {}, ctx)}`
  );
  return `roll one ${diceCase(e.dice)}: ${outcomes.join("; ")}`;
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
    case "dice-gated": {
      if (e.test) return leadershipTest(e, ctx);
      const comp = formatComparison(e.comparison ?? "gte", e.threshold);
      const success = e.on_success ? describeEffectInline(e.on_success, ctx) : "nothing happens";
      const fail = e.on_fail ? `; otherwise, ${describeEffectInline(e.on_fail, ctx)}` : "";
      const binding = e.roll_var ? ` (binding the result as ${dekebab(e.roll_var.replace(/_/g, "-"))})` : "";
      return `roll one ${diceCase(e.dice)}${binding}: on ${comp}, ${success}${fail}`;
    }
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
    case "leader-model-ability-grant":
      return leaderModelAbilityGrantClause(e, ctx);
    case "persistent-designation":
      if (e.operation === "replace") return persistentDesignationReplacement(e);
      if (!persistentDesignationSupported(e)) return "[persistent-designation]";
      return `${persistentDesignationLead(e)} ${persistentDesignationWhen(e)}, ${describeEffectInline(e.consumer?.effect ?? {}, ctx)}`;
    case "for-each-unit": {
      const selectedCtx = selectedContext(ctx, e.selector ?? {});
      return `for each ${forEachUnitSubject(e.selector)}: ${describeEffectInline(e.effect ?? {}, selectedCtx)}`;
    }
    case "designate-target": {
      const sel = (typeof e.select === "object" && e.select ? e.select : {}) as DesignationSelection;
      const desig = e.designation ? designationLabel(e.designation) : "";
      const selectLead = sel.timing ? `${describeTiming(sel.timing)}, select` : "select";
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
      return `${selectLead} one ${designationTargetSubject(sel)}${desig}; ${whenClause}, ${describeEffectInline(e.applies?.effect ?? {}, recipientCtx)}`;
    }
    case "stance-select":
      return `${stancePick(e)}: ${(e.options ?? []).map((o) => `${jstr(o.name)} (${describeEffectInline(o.effect ?? {}, ctx)})`).join(" / ")}`;
    case "stance-selection-capacity": {
      const m = (e.modifier ?? {}) as {
        stance_id?: unknown;
        option_id?: unknown;
        additional_selections?: unknown;
        allocation?: unknown;
      };
      const n = Number(m.additional_selections) || 1;
      const times = n === 1 ? "one additional time" : `${jstr(n)} additional times`;
      const subject =
        m.allocation === "fixed-option" && m.option_id != null
          ? titleCase(jstr(m.option_id))
          : `one option of ${titleCase(jstr(m.stance_id))}`;
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

/** "select one", "select two", "select up to two" — how many menu options are picked. */
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

function namedRegionKeywords(value: unknown): string {
  return Array.isArray(value) ? value.map(jstr).join(" or ") : "?";
}

function namedRegionPrefix(m: Record<string, unknown>): string {
  const ref = namedRegionRecord(m.region_ref);
  const region = namedRegionTitle(ref.region_id);
  const producer = namedRegionRecord(m.producer);
  const sentences: string[] = [];
  const baseline = Array.isArray(producer.baseline) ? producer.baseline : [];
  for (const entry of baseline) {
    const zone = jstr(namedRegionRecord(entry).zone);
    if (zone === "own-deployment-zone") {
      sentences.push(`Your deployment zone is always within ${region}.`);
    } else if (zone !== "?") {
      sentences.push(`${namedRegionTitle(zone)} is always within ${region}.`);
    }
  }
  const phaseExtensions = Array.isArray(producer.phase_extensions) ? producer.phase_extensions : [];
  let hasPhaseExtension = false;
  for (const entry of phaseExtensions) {
    const zone = jstr(namedRegionRecord(entry).zone);
    if (zone === "no-mans-land") {
      sentences.push(
        `At the start of each phase, No Man's Land is within ${region} until the end of that phase if you control at least half of its objective markers.`,
      );
      hasPhaseExtension = true;
    } else if (zone === "opponent-deployment-zone") {
      sentences.push(
        hasPhaseExtension
          ? "The same applies separately to your opponent's deployment zone."
          : `At the start of each phase, your opponent's deployment zone is within ${region} until the end of that phase if you control at least half of its objective markers.`,
      );
      hasPhaseExtension = true;
    } else if (zone !== "?") {
      const label = namedRegionTitle(zone);
      sentences.push(
        `At the start of each phase, ${label} is within ${region} until the end of that phase if you control at least half of its objective markers.`,
      );
      hasPhaseExtension = true;
    }
  }
  const additions = Array.isArray(producer.additive_extensions) ? producer.additive_extensions : [];
  for (const entry of additions) {
    const addition = namedRegionRecord(entry);
    if (addition.kind !== "unit-proximity") continue;
    const gate = namedRegionRecord(addition.source_gate);
    const predicate = namedRegionRecord(gate.unit_predicate);
    const keywords = Array.isArray(predicate.keywords) ? predicate.keywords.map(jstr).join(" and ") : "?";
    sentences.push(`The area within ${jstr(addition.radius_inches)}" of one or more friendly ${keywords} units is within ${region}, continuously as those units move.`);
  }
  const sourceParts = additions.filter((entry) => namedRegionRecord(entry).kind !== "unit-proximity")
    .map((entry) => {
      const addition = namedRegionRecord(entry);
      const gate = namedRegionRecord(addition.source_gate);
      const predicate = namedRegionRecord(gate.unit_predicate);
      if (Object.keys(predicate).length === 0) return "";
      const faction = namedRegionTitle(predicate.faction);
      const keywords = namedRegionKeywords(predicate.keywords);
      const radius = addition.radius_inches != null ? ` within ${jstr(addition.radius_inches)}"` : "";
      return `${faction} units with ${keywords}${radius}`;
    })
    .filter((part) => part.length > 0);
  const uniqueSourceParts = [...new Set(sourceParts)];
  if (uniqueSourceParts.length > 0) {
    sentences.push(`Selected objective markers extend ${region} around ${uniqueSourceParts.join(" or ")}.`);
  }
  return sentences.join(" ");
}

function namedRegionSubject(m: Record<string, unknown>): string {
  const consumer = namedRegionRecord(m.consumer);
  const gate = namedRegionRecord(consumer.beneficiary_gate);
  const faction = gate.faction != null ? namedRegionTitle(gate.faction) : "";
  const keywords = namedRegionKeywords(gate.keywords);
  const factionPart = faction ? ` from your ${faction} army` : " from your army";
  return `Models in ${keywords} units${factionPart}`;
}

function namedRegionEffect(branch: Record<string, unknown>, qualified: boolean, ctx: Ctx = {}): string {
  const effect = namedRegionRecord(branch.effect);
  const modifier = namedRegionRecord(effect.modifier);
  const roll = rollName(modifier.roll);
  let text: string;
  if (effect.type === "re-roll") {
    const cnt = typeof modifier.count === "number" ? modifier.count : undefined;
    const cappedRoll = jstr(modifier.roll) === "any" ? "" : `${roll} `;
    text =
      cnt != null
        ? `can re-roll ${cnt === 1 ? "one" : `up to ${cnt}`} ${modifier.subset === "all-failures" ? "failed " : ""}${cappedRoll}roll${cnt === 1 ? "" : "s"}${modifier.subset === "ones" ? " of 1" : ""}`
        : modifier.result_scope === "any-result"
          ? `can re-roll the ${roll} roll`
          : modifier.subset === "ones"
            ? `can re-roll ${roll} rolls of 1`
            : `can re-roll ${roll} rolls`;
  } else if (effect.type === "roll-modifier" && modifier.value != null) {
    text = `gets ${signed(modifier.operation, modifier.value)} to ${roll}`;
  } else {
    text = describeEffectInline(effect as Effect, ctx);
  }
  if (branch.optional === false) text = text.replace(/^can re-roll/, "re-roll");
  if (modifier.weapon_keyword != null) {
    text += ` for ${qualified ? "those " : ""}${jstr(modifier.weapon_keyword)} attacks`;
  }
  return text;
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
  const effect = namedRegionEffect(branch, qualified, ctx);
  if (conditional) return `${namedRegionSubject(m)} ${effect}`;
  if (!qualified) return `${namedRegionSubject(m)} ${effect}.`;
  const condition = namedRegionRecord(consumer.qualified_condition);
  if (condition.operator != null) return `If ${describeCondition(condition as Condition)}, those models ${effect} instead`;
  const membership = namedRegionRecord(consumer.membership);
  const region = namedRegionTitle(namedRegionRecord(m.region_ref).region_id);
  const relation = namedRegionRelation(membership.relation);
  const subject = wholeUnit
    ? `If such a unit is ${relation} ${region}, those models`
    : `If such a model is ${relation} ${region}, it`;
  return `${subject} ${effect} instead`;
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
  const named = e.name ? `${e.optional ? "you can use " : "use "}${jstr(e.name)}${level}` : e.optional ? "you can" : "";
  const cost = e.cost ? `by paying this cost (${describeEffectInline(e.cost)})` : "";
  return [moment, e.usage ? usageClause(e.usage) : "", named, cost, durationClauses(e.duration).trail].filter(Boolean).join(", ");
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
    case "choice": {
      const prompt = choicePrompt(e);
      return (
        `${indent}${capitalize(prompt)}:\n` +
        (e.options ?? []).map((o) => `${indent}  - ${capitalize(describeEffectInline(o, ctx))}.`).join("\n")
      );
    }
    case "dice-gated": {
      if (e.test) return `${indent}${arrow}${capitalize(leadershipTest(e, ctx))}.`;
      const comp = formatComparison(e.comparison ?? "gte", e.threshold);
      const success = e.on_success ? describeEffectInline(e.on_success, ctx) : "nothing happens";
      const fail = e.on_fail ? `; otherwise, ${describeEffectInline(e.on_fail, ctx)}` : "";
      const binding = e.roll_var ? ` (binding the result as ${dekebab(e.roll_var.replace(/_/g, "-"))})` : "";
      return `${indent}${arrow}Roll one ${diceCase(e.dice)}${binding}: on ${comp}, ${success}${fail}.`;
    }
    case "dice-table": {
      const lines = [`${indent}${arrow}Roll one ${diceCase(e.dice)}:`];
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
      const engagement = selectUnitsEngagement(selector);
      const lead = `Select ${selectUnitsSubject(selector)}${selectionBinding(selector)}`;
      const header = engagement ? `${indent}${arrow}${lead}. ${engagement}` : `${indent}${arrow}${lead}`;
      if (CONTAINER_TYPES.has(inner.type ?? "")) {
        if (selectUnitsPlural(selector)) {
          const nested = describeEffect(inner, depth + 2, selectedCtx);
          return `${header.replace(/\.$/, "")}:\n${indent}  ${depth + 1 > 0 ? "-> " : ""}For each selected ${selector.target_kind === "model" ? "model" : "unit"}:\n${nested}`;
        }
        return `${header.replace(/\.$/, "")}:\n` + describeEffect(inner, depth + 1, selectedCtx);
      }
      const nested = selectedRecipient(describeEffectInline(inner, selectedCtx), selector);
      return engagement
        ? `${header} ${capitalize(nested)}.`
        : `${header}: ${nested}.`;
    }
    case "leader-model-ability-grant":
      return `${indent}${arrow}${capitalize(leaderModelAbilityGrantClause(e, ctx))}.`;
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
      const sel = (typeof e.select === "object" && e.select ? e.select : {}) as DesignationSelection;
      const desig = e.designation ? designationLabel(e.designation) : "";
      const applies = e.applies ?? {};
      const inner = applies.effect ?? {};
      // The mark's timing and duration are content: "After this unit shoots,
      // select …. Until your next Command phase, each time …".
      const selectLead = sel.timing ? `${capitalize(describeTiming(sel.timing))}, select` : "Select";
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
      const head = `${indent}${arrow}${selectLead} one ${designationTargetSubject(sel)}${desig}. ${whenClause}`;
      const recipientCtx = designatedRecipientContext(applies, ctx);
      if (CONTAINER_TYPES.has(inner.type ?? "")) {
        return `${head}:\n` + describeEffect(inner, depth + 1, recipientCtx);
      }
      return `${head}, ${describeEffectInline(inner, recipientCtx)}.`;
    }
    case "stance-select": {
      const when = typeof e.select === "string" ? capitalize(eventClause(e.select)) : "At the start of your turn";
      const consum = e.mode === "consumable" ? " (each may be chosen once per battle)" : "";
      const lines = [`${indent}${arrow}${when}, ${stancePick(e)}${consum}:`];
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

/** `Scope: aura (6"). Duration: phase.` — retained for the legacy translate CLI footer. */
export function describeScope(s?: AbilityScope): string {
  if (!s || (!s.range && !s.duration)) return "";
  const range = dekebab(s.range ?? "");
  const inches = s.range_inches != null ? ` (${jstr(s.range_inches)}")` : "";
  const duration =
    s.duration === "until-next-battle-round"
      ? "until the start of the next battle round"
      : s.duration === "until-start-next-turn"
        ? "until the start of your next turn"
        : dekebab(s.duration ?? "");
  return `Scope: ${range}${inches}. Duration: ${duration}.`;
}

/**
 * `Applies to: units with Possessed.` — the roster-highlighting audience named
 * by a curated `applies_to` filter. Empty string when the filter is absent or
 * carries no keywords (nothing to say). `required_keywords` reads as an AND set;
 * `excluded_keywords` render as a trailing `(excluding …)`.
 */
export function describeAppliesTo(a?: AbilityAppliesTo | null): string {
  if (!a) return "";
  const required = a.required_keywords ?? [];
  const excluded = a.excluded_keywords ?? [];
  if (required.length === 0 && excluded.length === 0) return "";
  const base = required.length ? `units with ${required.join(", ")}` : "all units";
  const exc = excluded.length ? ` (excluding ${excluded.join(", ")})` : "";
  return `Applies to: ${base}${exc}.`;
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
  usage?: AbilityUsage | null,
  trigger?: AbilityTriggerSpec | null,
): string {
  const ctx: Ctx = {};
  const { lead: durLead, trail } = durationClauses(scope?.duration);
  // An explicit usage limit supersedes the duration's coarse "once per battle" lead.
  const lead = usage && usage.frequency != null ? usageClause(usage) : durLead;

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

  if (CONTAINER_TYPES.has(e.type ?? "")) {
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
  const who = e.test?.subject === "self" ? "this model" : e.test?.subject === "target" ? "the target unit" : "that unit";
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

function selectionBinding(sel: Record<string, unknown>): string {
  return typeof sel.bind_as === "string" && sel.bind_as.length > 0
    ? `, binding ${sel.selection_mode === "any-number" ? "them" : "it"} as ${dekebab(sel.bind_as.replace(/_/g, "-"))}`
    : "";
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
