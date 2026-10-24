import { oathCondition } from "./compile-oath.js";
import { abilityUseCondition } from "./compile-ability-use.js";
/**
 * Condition and trigger DSL fragments, split out of `compile-fragments.ts` (batch 6) so that
 * file and `compile.ts` stay under the line ceiling. `compile-fragments.ts` keeps the leaf type,
 * `CompileError`, and the EFFECT fragment (`effect()`), which still needs `closed()`; everything
 * here is CONDITION- and EVENT-role composition, used only from `compile.ts`.
 */

import { armyIncludesCondition } from "./compile-army.js";
import { closed, CompileError, weaponScope, type CompileLeaf } from "./compile-fragments.js";
import { isSelectionRef } from "./compile-pair-eligibility.js";
import { dslUnitFilter } from "./compile-unit-filters.js";
import { everyModelFlag } from "./compile-every-model.js";
import { isOneTargetRef } from "./compile-target-refs.js";
import { isTriggeringDestruction, lowerTriggeringDestructions } from "./compile-triggering-destruction.js";
import { abilityChecks, alternativesCheck, stateCheck } from "./compile-wrappers.js";
import { attackedChecks, namesSelection, targetingCondition } from "./compile-targeting-history.js";
import { dslAlternatives } from "./compile-filter-alternatives.js";
import type { FilterAlternative } from "./unit-filter-alternatives.js";
import { DESIGNATION_IDS } from "../translate/designations.js";
import { abilityUsedCondition } from "./compile-named-ability.js";
import { namedRange } from "./named-ranges.js";
import { optionalCostCondition } from "./compile-optional-cost.js";
import { namedEquipmentPredicate } from "./compile-named-equipment.js";
import { checkStratagemActivity, stratagemTargetedAnyOf } from "./compile-opponent-stratagem.js";
import { phaseEdgeDuration } from "./compile-duration-edges.js";
import { PHASE_EDGE_ENDPOINTS } from "./families/durations-and-designations.js";
import { canonicalDesignation } from "./compile-redesignate.js";
import { liftWarlord } from "./core-keywords.js";

type Node = Record<string, unknown>;

const COMPARISONS: Readonly<Record<string, string>> = {
  "greater-than": "gt", "greater-or-equal": "gte", "less-than": "lt", "less-or-equal": "lte", equal: "eq", "at-least": "gte",
};
const comparison = (leaf: CompileLeaf): unknown => COMPARISONS[String(closed(leaf, "comparison"))] ?? closed(leaf, "comparison");
const STAT_NAMES: Readonly<Record<string, string>> = {
  Move: "M", Movement: "M", Toughness: "T", Save: "Sv", Wounds: "W", Leadership: "Ld",
  "Objective Control": "OC", Range: "Range", Attacks: "A", "Weapon Skill": "WS",
  "Ballistic Skill": "BS", Strength: "S", "Armour Penetration": "AP", Damage: "D",
};
const stat = (leaf: CompileLeaf, key: string): unknown => STAT_NAMES[String(closed(leaf, key))] ?? closed(leaf, key);

function countBounds(leaf: CompileLeaf, minimum = "count_min", maximum = "count_max"): Node {
  return {
    ...(leaf.parameters[minimum] === undefined ? {} : { min: closed(leaf, minimum) }),
    ...(leaf.parameters[maximum] === undefined ? {} : { max: closed(leaf, maximum) }),
  };
}

/** Shared weapon scopes narrow attacks without changing their attack classification. */
function attackFilter(leaf: CompileLeaf, source: Node): Node {
  const parameters = weaponScope({ ...leaf, parameters: source });
  for (const key of ["attack_type", "shooting_type", "fight_type", "all_target_same_unit"]) {
    if (source[key] !== undefined) parameters[key] = source[key];
  }
  return parameters;
}

export const DURATIONS: Record<string, string> = {
  "end-of-phase": "phase", "end-of-turn": "turn", "end-of-battle-round": "battle-round", "end-of-battle": "battle",
  "start-of-next-turn": "until-start-next-turn", "start-of-next-command-phase": "until-next-command-phase",
  "start-of-next-movement-phase": "until-next-movement-phase", "start-of-next-battle-round": "until-next-battle-round",
  // Version 3 (batch 7a).
  "end-of-attack-sequence": "attack-sequence", "end-of-this-use": "resolution", "start-of-next-shooting-phase": "until-next-shooting-phase",
  "end-of-your-next-turn": "until-end-of-your-next-turn", "end-of-opponents-next-turn": "until-end-of-opponent-next-turn",
  "this-unit-has-shot": "until-this-unit-has-shot", "control-lost": "control-lost",
  "after-this-use": "after-resolving",
};

/** A unit's own activity, as the history it leaves: [event, filter, window]. */
const ACTIVITIES: Record<string, [string, Node, string]> = {
  "charged-this-turn": ["move-ended", { move_types: ["charge"] }, "turn"],
  "advanced-this-turn": ["move-ended", { move_types: ["advance"] }, "turn"],
  "remained-stationary": ["move-ended", { move_types: ["remain-stationary"] }, "turn"],
  "fought-this-phase": ["selected", { to: "fight" }, "phase"],
  "selected-to-shoot-this-phase": ["selected", { to: "shoot" }, "phase"],
  "selected-to-move-this-phase": ["selected", { to: "move" }, "phase"],
  "declared-charge-this-phase": ["targets-selected", { kind: "charge" }, "phase"],
  "fell-back-this-turn": ["move-ended", { move_types: ["fall-back"] }, "turn"],
  "disembarked-this-turn": ["disembarked", {}, "turn"],
  "made-ingress-move-this-turn": ["move-ended", { move_types: ["ingress"] }, "turn"],
  "set-up-this-turn": ["set-up", {}, "turn"],
  // Version 12: "whose attacks have been resolved this phase".
  "resolved-attacks-this-phase": ["attacks-resolved", {}, "phase"],
  // Version 13: more of a unit's own moves and moments, this phase or turn.
  "fell-back-this-phase": ["move-ended", { move_types: ["fall-back"] }, "phase"],
  "charged-this-phase": ["move-ended", { move_types: ["charge"] }, "phase"],
  "made-normal-move-this-phase": ["move-ended", { move_types: ["normal"] }, "phase"],
  "made-normal-move-this-turn": ["move-ended", { move_types: ["normal"] }, "turn"],
  "disembarked-this-phase": ["disembarked", {}, "phase"],
  "set-up-this-phase": ["set-up", {}, "phase"],
  "made-dark-pact-this-phase": ["used", { kind: "dark-pact" }, "phase"],
};

/**
 * Version 8 history, whose subject is not the unit the event happens to: the unit that destroyed
 * enemy units (the DSL's filter.by), or the unit whose models the triggering attacks destroyed.
 */
const HISTORY: Record<string, (subject: string | undefined, attackType?: string) => Node> = {
  // Version 15: "whose melee attacks destroyed an enemy unit"; attackType narrows the destroying attacks.
  "destroyed-enemy-unit-this-phase": (subject, attackType) => ({ event: "destroyed", object: { owner: "enemy" }, filter: { by: subject ?? "this-unit", ...(attackType ? { attack_type: attackType } : {}) }, window: "phase" }),
  "destroyed-enemy-unit-this-turn": (subject, attackType) => ({ event: "destroyed", object: { owner: "enemy" }, filter: { by: subject ?? "this-unit", ...(attackType ? { attack_type: attackType } : {}) }, window: "turn" }),
  "set-up-by-deep-strike-this-phase": (subject) => ({ ...(subject ? { subject } : {}), event: "set-up", filter: { from: "deep-strike" }, window: "phase" }),
  "set-up-by-deep-strike-this-turn": (subject) => ({ ...(subject ? { subject } : {}), event: "set-up", filter: { from: "deep-strike" }, window: "turn" }),
  // Version 9: "that disembarked from this TRANSPORT this turn"; the Transport is this unit.
  // Version 10: "that arrived from Reserves this turn"; Reserves are Strategic Reserves.
  "set-up-from-reserves-this-phase": (subject) => ({ ...(subject ? { subject } : {}), event: "set-up", filter: { from: "strategic-reserves" }, window: "phase" }),
  "set-up-from-reserves-this-turn": (subject) => ({ ...(subject ? { subject } : {}), event: "set-up", filter: { from: "strategic-reserves" }, window: "turn" }),
  "disembarked-from-this-transport-this-turn": (subject) => ({ ...(subject ? { subject } : {}), event: "disembarked", filter: { transport: "this-unit" }, window: "turn" }),
  // Version 13: models the subject lost, and enemy models it destroyed.
  "lost-models-this-phase": (subject) => ({ event: "model-destroyed", object: !subject || subject === "this-unit" ? "model-in-this-unit" : { level: "model", member_of: subject }, window: "phase" }),
  "destroyed-enemy-model-this-phase": (subject) => ({ event: "model-destroyed", object: { owner: "enemy", level: "model" }, filter: { by: subject ?? "this-unit" }, window: "phase" }),
  "destroyed-enemy-model-this-turn": (subject) => ({ event: "model-destroyed", object: { owner: "enemy", level: "model" }, filter: { by: subject ?? "this-unit" }, window: "turn" }),
  "lost-models-to-triggering-attacks": (subject) => ({
    event: "model-destroyed", object: !subject || subject === "this-unit" ? "model-in-this-unit" : { level: "model", member_of: subject },
    filter: { by: "event-subject" }, window: "event",
  }),
  // "targets the enemy unit that just destroyed your unit": the subject destroyed the Stratagem's target (compile-triggering-destruction.ts guards the record).
  "destroyed-stratagem-target": (subject) => ({ event: "destroyed", object: "stratagem-target", filter: { by: subject ?? "this-unit" }, window: "battle" }),
  // Wave 10: "lost a wound as a result of those attacks" (the attacks of the moment, by its subject).
  "lost-wounds-to-triggering-attacks": (subject) => ({ event: "damage-allocated", object: subject ?? "this-unit", filter: { by: "event-subject" }, window: "event" }),
  // Wave 10: "suffers mortal wounds as a result of this ability", and the models they destroy.
  "suffered-mortal-wounds-from-this-ability": (subject) => ({ event: "damage-allocated", object: subject ?? "this-unit", filter: { attack_type: "mortal" }, window: "event" }),
  "lost-models-to-own-mortal-wounds": (subject) => ({ event: "model-destroyed", object: { level: "model", member_of: subject ?? "this-unit" }, filter: { attack_type: "mortal" }, window: "event" }),
  // Wave 10: "was charged this turn": the unit was the target of a declared charge.
  "was-charged-this-turn": (subject) => ({ event: "targets-selected", subject: { owner: "any" }, object: subject ?? "this-unit", filter: { kind: "charge" }, window: "turn" }),
  // Past targeting: targeted by any unit's attacks this phase, and attacks the subject made at this unit.
  "targeted-by-attacks-this-phase": (subject) => ({ event: "targets-selected", subject: { owner: "any" }, object: subject ?? "this-unit", filter: { kind: "attack" }, window: "phase" }),
  "made-attacks-targeting-this-phase": (subject) => {
    if (subject === undefined) throw new CompileError("unit-activity made-attacks-targeting-this-phase names the unit that attacked this unit; this unit cannot be it.");
    return { event: "targets-selected", subject, object: "this-unit", filter: { kind: "attack" }, window: "phase" };
  },
};

/** A unit-state leaf's states that are not core-rules unit states. */
const STRENGTH_STATES: Record<string, string> = { "below-starting-strength": "starting", "below-half-strength": "half" };

/** Marks as the designations an effect applies, uppercase as the rules print them. */
const MARK_TAGS: Record<string, string> = {
  "oath-of-moment": "OATH OF MOMENT TARGET", afflicted: "AFFLICTED", spotted: "SPOTTED", hidden: "HIDDEN", marked: "MARKED",
  "riled-up": "riled-up",
};

/** Lower a source predicate directly to the one canonical candidate-filter representation. */
export function pred(type: string, parameters: Node, subject?: unknown): Node {
  const who = subject === undefined ? {} : { subject };
  let filter: Node | undefined;
  if (type === "has-keyword" && parameters.chosen_by === undefined) filter = parameters;
  else if (type === "has-ability") filter = { has_ability: [parameters.ability] };
  else if (type === "owned-by") filter = { owner: parameters.owner };
  else if (type === "unit-state" && (parameters.at === undefined || parameters.at === "now")) {
    if (parameters.with === undefined) filter = { state: parameters.state };
    else if (parameters.state === "engaged") filter = { engaged_with: parameters.with };
  } else if (type === "within" && (parameters.at === undefined || parameters.at === "now")
    && parameters.models === undefined && parameters.count === undefined) {
    const { at: _at, ...within } = parameters;
    filter = { within };
  } else if (type === "visible" && parameters.fully !== true && parameters.blocked_by === undefined) {
    filter = { visible: { to: parameters.to ?? "attacker" } };
  } else if (type === "designated" && parameters.objective === undefined && parameters.count === undefined
    && parameters.count_min === undefined && parameters.count_max === undefined) {
    filter = { designated: parameters.tag, ...(parameters.by === undefined ? {} : { designated_by: parameters.by }) };
  }
  return filter === undefined ? { type, parameters: { ...who, ...parameters } } : { type: "matches", parameters: { ...who, filter } };
}

/** Event kinds an attack-time effect already implies (event versions before 4); they add nothing. */
export const ATTACK_EVENTS = new Set(["attack-made", "hit-roll", "wound-roll"]);

/** Several alternatives are any one of them. */
/** The attack-filter fields a hit's event filter can carry. */
export const HIT_FILTER_KEYS = new Set(["attack_type", "weapon_name", "weapon_keyword"]);
export const HIT_ATTACK_TYPES = new Set(["ranged", "melee", "psychic"]);

/**
 * "Hit by one or more of those attacks made with Arcane Fire", "hit by those ranged attacks": an
 * attack-filter right after a hit-by-attacks leaf (only spaces or emphasis between) says which
 * hits count, so it narrows that hit's event filter rather than gating the whole ability on an
 * attack that, at the ability's moment, is not being made.
 */
export function foldHitFilters(leaves: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (sourceText === undefined || !leaves.some((leaf) => leaf.family_id === "hit-by-attacks")) return [...leaves];
  const bytes = Buffer.from(sourceText, "utf8");
  const out: CompileLeaf[] = [];
  for (const leaf of leaves) {
    const hit = out.at(-1);
    const keys = Object.keys(leaf.parameters);
    const foldable = hit?.family_id === "hit-by-attacks" && hit.parameters.hit_filter === undefined && leaf.family_id === "attack-filter"
      && leaf.parameters.negated !== true && keys.length > 0 && keys.every((key) => HIT_FILTER_KEYS.has(key))
      && (leaf.parameters.attack_type === undefined || HIT_ATTACK_TYPES.has(String(leaf.parameters.attack_type)))
      && /^[\s*]*$/u.test(bytes.subarray(hit.end_byte, leaf.start_byte).toString("utf8"));
    if (!foldable) { out.push(leaf); continue; }
    out[out.length - 1] = { ...hit, end_byte: leaf.end_byte, parameters: { ...hit.parameters, hit_filter: { ...leaf.parameters } } };
  }
  return out;
}

/** The units a designated-filter's subject can name. */
const DESIGNATED_SUBJECTS = new Set(["this-model", "model-in-this-unit", "attacker", "defender", "event-subject", "event-object", "selected-unit", "recipient"]);

/**
 * "While a unit is enfeebled, subtract 2\" from the Move characteristic of models in that unit": a
 * designation check that names no unit is about the unit its next effect changes, not this unit.
 * A count ("while two or more units are pinned") names no one unit and stays as it is.
 */
export function bindDesignationSubjects(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  return leaves.map((leaf, index) => {
    if (leaf.family_id !== "designated-filter" || leaf.parameters.subject !== undefined) return leaf;
    // "If a model is your Warlord": the Warlord is named by its list-building designation, never by the next effect.
    if (leaf.parameters.tag === "warlord") return leaf;
    if (leaf.parameters.count_min !== undefined || leaf.parameters.count_max !== undefined) return leaf;
    const after = leaves.slice(index + 1);
    const effect = after.find((other) => other.role === "EFFECT");
    if (!effect || effect.fragment !== leaf.fragment) return leaf;
    // "While a unit is scanned, ranged attacks that target that unit …": the attacks' target.
    const attack = after.slice(0, after.indexOf(effect)).find((other) => other.family_id === "attack");
    // "When an X unit targets that unit": an attack on the designated unit makes it the defender too.
    const who = attack ? (attack.parameters.direction === "targeted" || attack.parameters.target === "that-unit" ? "defender" : undefined) : effect.parameters.subject ?? effect.parameters.target;
    // "each unit struck by X suffers D3 mortal wounds" after a for-each: the check belongs to each iterated unit, which
    // no lowering binds yet. Left unbound it would check the bearer's unit, so the record is refused instead.
    if (who === undefined && attack === undefined && effect.family_id === "mortal-wounds" && effect.parameters.recipient === "that-unit"
      && leaves.some((other) => other.family_id === "for-each-unit-select")) {
      throw new CompileError("A designation check on each unit a for-each passes has no DSL shape yet; it would check the bearer's unit.");
    }
    // A named Stratagem target ("the second unit", minted by compile-target-refs) is a unit too; several targets are not one unit.
    return typeof who === "string" && (DESIGNATED_SUBJECTS.has(who) || isOneTargetRef(who)) ? { ...leaf, parameters: { ...leaf.parameters, subject: who } } : leaf;
  });
}

export function anyOf(nodes: Node[]): Node {
  return nodes.length === 1 ? nodes[0]! : { operator: "or", operands: nodes };
}

/** The opposite of a condition: `not` it, or unwrap a `not`. */
export function negate(node: Node): Node {
  if (node.operator === "not" && Array.isArray(node.operands) && node.operands.length === 1) return node.operands[0] as Node;
  return { operator: "not", operands: [node] };
}

/** A predicate's own polarity: "not below half strength", "does not have FLY". */
function polarity(leaf: CompileLeaf, node: Node): Node {
  return leaf.parameters.negated === true ? negate(node) : node;
}

/** The condition an attack leaf adds: only melee or only ranged attacks. */
export function attackTypeCondition(leaf: CompileLeaf): Node | null {
  const type = closed(leaf, "attack_type");
  return type === "melee" || type === "ranged" || type === "psychic" ? { type: "attack-is", parameters: { attack_type: type } } : null;
}

/**
 * "One or more (other) friendly **K** units" as the DSL's unit-filter: every keyword, the side,
 * and, for "other", not the subject itself.
 */
export function matchingUnit(leaf: CompileLeaf, subject: string | undefined): Node {
  return {
    owner: closed(leaf, "of_side"), ...(leaf.parameters.of_keywords !== undefined ? { all_of: closed(leaf, "of_keywords") } : {}),
    // "(excluding NEUROGAUNT units)": no unit that has any of these keywords.
    ...(leaf.parameters.of_excluded_keywords !== undefined ? { none_of: closed(leaf, "of_excluded_keywords") } : {}),
    // Wave 10: units that carry, or do not carry, a registered designation (unit-filter designated / not_designated).
    ...(leaf.parameters.of_designated !== undefined ? { designated: closed(leaf, "of_designated") } : {}),
    ...(leaf.parameters.of_not_designated !== undefined ? { not_designated: closed(leaf, "of_not_designated") } : {}),
    // "of one or more friendly X VEHICLE or Y units": any one alternative.
    ...dslAlternatives(leaf.parameters.of_alternatives as FilterAlternative[] | undefined),
    ...(leaf.parameters.of_other === true ? { excluding: subject ?? "this-unit" } : {}),
  };
}

/** The objective marker a distance measures to: carries objective_tag, controlled as the leaf says. */
function objectiveFilter(leaf: CompileLeaf): Node {
  const controlled = leaf.parameters.controlled_by === undefined ? "any" : closed(leaf, "controlled_by");
  return {
    designated: closed(leaf, "objective_tag"),
    ...(controlled === "you" ? { controlled_by: "friendly" } : controlled === "opponent" ? { controlled_by: "enemy" } : {}),
  };
}

/**
 * A batch-6-widened predicate's subject value, turned into the DSL's "who": omitted for the
 * implicit default (this-unit), `defender` for the attack's target (the pre-widening
 * convention), everything else (this-model, attacker, event-subject, recipient, selected-unit)
 * passed straight through, since those already spell the unit-ref role the describer expects.
 */
function widenedWho(value: unknown): string | undefined {
  // A bound selection pair's unit (compile-pair-eligibility.ts) is a unit-ref object, passed through.
  if (isSelectionRef(value)) return value as unknown as string;
  const subject = String(value);
  if (subject === "this-unit") return undefined;
  if (subject === "target") return "defender";
  return subject;
}

/** The unit-filter right after a distance or engagement (compile-unit-filters.ts), as its other unit. */
function followingFilter(leaf: CompileLeaf): Node {
  const filter = leaf.parameters.following_filter as Node | undefined;
  if (filter === undefined) throw new CompileError(`${leaf.family_id} measures to the unit-filter after it, but no unit-filter follows it in its clause.`);
  return structuredClone(filter);
}

/**
 * "engaged with nothing except <filter>" (compile-engagement-exclusive.ts folds the qualifier onto
 * the state): engaged with a unit of the filter, and not engaged with a friendly unit the filter does
 * not match. The filter must be a friendly filter of keywords alone, so its complement is a DSL filter too.
 */
function exclusiveEngagement(leaf: CompileLeaf, subject: string | undefined, engaged: Node, state: unknown): Node {
  const filter = followingFilter(leaf);
  const keys = Object.keys(filter);
  if (filter.owner !== "friendly" || !Array.isArray(filter.all_of) || keys.some((key) => key !== "owner" && key !== "all_of")) {
    throw new CompileError("engagement-exclusive needs a friendly unit-filter of keywords alone; its complement is not a DSL filter otherwise.");
  }
  const others = { owner: "friendly", not_all_of: filter.all_of };
  return allOf([engaged, negate(pred("unit-state", { state, with: others }, subject))])!;
}

/** Stands in for a folded filter's units while a condition lowers; replaced by the filter itself. */
const FILTER_STAND_IN = "__filtered-units__";

function withFilter(node: unknown, filter: Node): unknown {
  if (node === FILTER_STAND_IN) return structuredClone(filter);
  if (Array.isArray(node)) return node.map((item) => withFilter(item, filter));
  if (node !== null && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, withFilter(value, filter)]));
  return node;
}

/** A unit-state "embarked within <Transport>": the one state embarked, with the Transport named. */
function isEmbarkedWithin(leaf: CompileLeaf): boolean {
  const states = leaf.parameters.states;
  return Array.isArray(states) && states.length === 1 && states[0] === "embarked" && leaf.parameters.with !== undefined;
}

export function condition(leaf: CompileLeaf): Node {
  const specialized = oathCondition(leaf) ?? abilityUseCondition(leaf);
  if (specialized) return specialized;
  // "While an enemy unit is within Engagement Range of this unit": the units of the folded filter
  // (compile-unit-filters.ts), as the DSL's "any unit that …" filter in place of a fixed role.
  if (Object.values(leaf.parameters).includes("filtered-units")) {
    const filter = leaf.parameters.subject_filter as Node | undefined;
    if (filter === undefined) throw new CompileError(`${leaf.family_id} names the units of a unit-filter, but none sits right before it.`);
    const { subject_filter: _filter, ...rest } = leaf.parameters;
    // Version 16: "a BIG MEK model is embarked within this unit" is that filter's units, embarked within the named Transport.
    const withTransport = leaf.family_id === "unit-state" && isEmbarkedWithin(leaf);
    const { with: transport, ...withoutTransport } = rest;
    const parameters = Object.fromEntries(Object.entries(withTransport ? withoutTransport : rest).map(([key, value]) => [key, value === "filtered-units" ? FILTER_STAND_IN : value]));
    if (withTransport && filter.embarked_in !== undefined && filter.embarked_in !== transport) throw new CompileError("A unit-filter embarked within one unit and a state embarked within another name different Transports; one DSL filter holds one.");
    return withFilter(condition({ ...leaf, parameters }), withTransport ? { ...filter, embarked_in: transport } : filter) as Node;
  }
  // A moment a reviewed "if" makes a condition on what happened (compile-connective-history.ts).
  if (leaf.family_id === "__happened") return { type: "happened", parameters: structuredClone(leaf.parameters.happened as Node) };
  // "(excluding units with X that are not Y)" folded by compile-condition-exclusions.ts: none of the units meeting all of the group.
  if (leaf.family_id === "__none-of") return negate(allOf((leaf.parameters.conditions as CompileLeaf[]).map(condition))!);
  // Alternatives folded by compile-alternative-conditions.ts: any one of them, each its own conditions together.
  if (leaf.family_id === "__any-of") {
    const alternatives = leaf.parameters.alternatives as CompileLeaf[][];
    return anyOf(alternatives.map((conditions) => {
      const nodes = conditions.map(condition);
      return nodes.length === 1 ? nodes[0]! : { operator: "and", operands: nodes };
    }));
  }
  const target = closed(leaf, "subject") === "target";
  const who = target ? "defender" : undefined;
  switch (leaf.family_id) {
    case "leading-unit": {
      // Version 5: "unless it is leading a unit" negates; a led unit is the bodyguard's view.
      if (leaf.parameters.negated === true) return negate(condition({ ...leaf, parameters: { ...leaf.parameters, negated: false } }));
      if (leaf.parameters.attachment === "led") {
        const leaders = leaf.parameters.leader_keywords === undefined ? {} : { with: { all_of: closed(leaf, "leader_keywords") } };
        const subject = String(closed(leaf, "subject"));
        return pred("attachment", { role: "led", ...leaders }, subject === "this-model" || subject === "bearers-unit" ? "this-unit" : widenedWho(subject));
      }
      // A Leader is a model, so this model, this unit and the bearer's unit leading all say the
      // Leader model is leading. Version 1 leaves only ever meant leading.
      const attachment = leaf.family_version >= 2 ? closed(leaf, "attachment") : "leading";
      // Version 4: the unit it is attached to has these keywords.
      const attachedTo = leaf.parameters.attached_to_keywords === undefined ? {} : { with: { all_of: closed(leaf, "attached_to_keywords") } };
      // Version 5: another model or unit ("that CHARACTER model is leading a unit").
      const named = String(closed(leaf, "subject"));
      if (!["this-model", "this-unit", "bearers-unit"].includes(named)) {
        if (attachment === "supporting") throw new CompileError("leading-unit supporting for another unit has no DSL condition yet.");
        return pred("attachment", { role: attachment === "leading" ? "leading" : "attached", ...attachedTo }, widenedWho(named));
      }
      if (attachment === "leading") return pred("attachment", { role: "leading", ...attachedTo }, "this-model");
      // Attached in either role: the model, or the unit (the bearer's unit is this unit), is part of an attached unit.
      if (attachment === "any") return pred("attachment", { role: "attached", ...attachedTo }, closed(leaf, "subject") === "this-model" ? "this-model" : "this-unit");
      if (leaf.parameters.attached_to_keywords !== undefined) throw new CompileError("leading-unit supporting a named unit has no DSL condition yet.");
      // The DSL has no supporting role. A model attached in support is part of an attached unit,
      // and a Support model is attached only in support, so "this model is supporting a unit"
      // is "this model is part of an attached unit". A unit is attached whether it is led or
      // supported, so a supporting unit has no DSL condition yet.
      if (attachment === "supporting" && closed(leaf, "subject") === "this-model") return pred("attachment", { role: "attached" }, "this-model");
      throw new CompileError(`leading-unit ${String(attachment)} with subject ${JSON.stringify(leaf.parameters.subject)} has no DSL condition yet.`);
    }
    case "below-starting-strength":
      return pred("strength", { below: "starting" }, target || leaf.parameters.subject === "target-unit" ? "defender" : undefined);
    case "unit-state": {
      // Version 4 (batch 6) widens subject beyond this-unit/this-model/target; below that,
      // only being on the battlefield could ever be said of this model.
      const wide = leaf.family_version >= 4;
      return polarity(leaf, anyOf((leaf.parameters.states as string[]).map((state) => {
        const subject = wide ? widenedWho(closed(leaf, "subject"))
          : STRENGTH_STATES[state] ? who
            : state === "on-battlefield" && !target && leaf.parameters.subject === "this-model" ? "this-model" : who;
        if (leaf.parameters.at !== undefined && (STRENGTH_STATES[state] || state === "carrying-units" || state === "embarked")) throw new CompileError(`unit-state ${state} has no DSL form for an earlier point (at).`);
        if (STRENGTH_STATES[state]) return pred("strength", { below: STRENGTH_STATES[state] }, subject);
        // Version 13: the subject is embarked within some Transport (the state itself, not the units it carries).
        if (state === "embarked" && leaf.parameters.with !== undefined) throw new CompileError("DSL_GAP: a named unit embarked within a named Transport has no DSL form; unit-state has no embarked-within reference.");
        if (state === "embarked") return pred("unit-state", { state: "embarked" }, subject);
        // A Transport carries units when some unit is embarked in that Transport.
        if (state === "carrying-units") return pred("unit-state", { state: "embarked" }, { embarked_in: subject ?? "this-unit" });
        // Version 5: engaged with one named unit, the DSL's `with`.
        // Version 10: the state as it was at the start of the phase or turn.
        const at = leaf.parameters.at === undefined ? {} : { at: closed(leaf, "at") };
        if (leaf.parameters.with === "following-filter") {
          const engaged = pred("unit-state", { state, with: followingFilter(leaf), ...at }, subject);
          return leaf.parameters.exclusive === true ? exclusiveEngagement(leaf, subject, engaged, state) : engaged;
        }
        // The DSL's `with` absent means engaged with any unit, so this unit is named, not defaulted.
        if (leaf.parameters.with !== undefined) return pred("unit-state", { state, with: widenedWho(closed(leaf, "with")) ?? "this-unit", ...at }, subject);
        // Version 8: "in Reserves" is Strategic Reserves in the rules; the DSL has only that state.
        return pred("unit-state", { state: state === "in-reserves" ? "in-strategic-reserves" : state, ...at }, subject);
      })));
    }
    case "unit-keyword": {
      // Version 2 widens the subject; version 6 can reference an ability's keyword choice.
      const subject = leaf.family_version >= 2 ? widenedWho(closed(leaf, "subject")) : who;
      if (leaf.parameters.chosen_by !== undefined) return polarity(leaf, pred("has-keyword", { chosen_by: closed(leaf, "chosen_by") }, subject));
      const keywords = leaf.parameters.keywords as string[];
      // "not a MONSTER or VEHICLE" excludes both, so each keyword carries the negation.
      if (leaf.parameters.negated === true) {
        const each = keywords.map((keyword) => negate(pred("has-keyword", { all_of: [keyword] }, subject)));
        return each.length === 1 ? each[0]! : { operator: "and", operands: each };
      }
      return pred("has-keyword", keywords.length === 1 ? { all_of: keywords } : { any_of: keywords }, subject);
    }
    // "In a turn in which it used its Foo ability", "while it is performing a Bar" (compile-named-ability.ts).
    case "ability-used":
      return abilityUsedCondition(leaf);
    case "unit-activity": {
      // "if those attacks destroyed an enemy unit": the folded destruction (compile-triggering-destruction.ts), which names no subject.
      if (isTriggeringDestruction(leaf)) {
        const happened = lowerTriggeringDestructions(leaf).map((parameters) => ({ type: "happened", parameters }));
        return polarity(leaf, happened.length === 1 ? happened[0]! : anyOf(happened));
      }
      // Version 3 (batch 6) widens subject beyond this-unit/target.
      const subject = leaf.family_version >= 3 ? widenedWho(closed(leaf, "subject")) : who;
      // Version 4 names several activities: any of them, and negated none of them.
      const activities = leaf.family_version >= 4 ? closed(leaf, "activities") as string[] : [String(closed(leaf, "activity"))];
      // Version 15: "not chosen by the Foo Gadget this phase" names its Gadgets (compile-opponent-stratagem.ts).
      if (checkStratagemActivity(leaf, activities)) return polarity(leaf, stratagemTargetedAnyOf(leaf, subject));
      const own = anyOf(activities.map((activity) => {
        const history = HISTORY[activity];
        if (history) return { type: "happened", parameters: history(subject, leaf.parameters.attack_type as string | undefined) };
        const [event, filter, window] = ACTIVITIES[activity]!;
        return pred("happened", { event, ...(Object.keys(filter).length ? { filter: structuredClone(filter) } : {}), window }, subject);
      }));
      // A set-up through a named ability (compile-named-ability.ts): the set-up, and a use of that ability aimed at this unit in the same window.
      const via = leaf.parameters.via_ability as { id: string; filter?: Node } | undefined;
      if (via === undefined) return polarity(leaf, own);
      const used: Node = { type: "happened", parameters: { event: "used", subject: via.filter ?? { owner: "any" }, object: subject ?? "this-unit", filter: { kind: "ability", id: via.id }, window: ACTIVITIES[activities[0]!]![2] } };
      return polarity(leaf, { operator: "and", operands: [own, used] });
    }
    // "If you spent YP during this use", "if you spent no YP in that turn" (compile-optional-cost.ts).
    case "optional-cost-paid":
      return optionalCostCondition(leaf);
    case "hit-by-attacks":
      // "Hit by those attacks": a successful Hit roll against the subject by whoever made the
      // attacks of the ability's moment ("after this model has shot"), during that moment.
      // `hit_filter` is the attack-filter foldHitFilters or foldLeadingHitFilters folded in ("… made with its Plague Wind").
      // Window phase: any hit this phase, by the moment's unit or by the units of the unit-filter after it.
      // Version 4: object following-filter names the unit hit as the unit-filter after it ("scored a hit against an enemy unit").
      return { type: "happened", parameters: {
        event: "after-roll", subject: leaf.parameters.by === "following-filter" ? followingFilter(leaf) : "event-subject",
        object: leaf.parameters.object === "following-filter" ? followingFilter(leaf) : widenedWho(closed(leaf, "subject")) ?? "this-unit",
        filter: { roll: "hit", result: "success", ...attackFilter(leaf, (leaf.parameters.hit_filter ?? {}) as Node) },
        window: leaf.parameters.window === "phase" ? "phase" : "event",
      } };
    case "unit-filter-target": {
      // A who folded onto an attack's target ("that targets a VEHICLE unit"): each of its fields, said of the defender.
      const filter = dslUnitFilter(leaf, { warlordTarget: true });
      if (filter.visible) throw new CompileError("An attack's target is already visible to the attacker; drop visible from its unit-filter.");
      if (leaf.parameters.owner_explicit !== true || filter.owner === "any") delete filter.owner;
      if (Object.keys(filter).length === 0) throw new CompileError("An attack's target unit-filter that names only a side says nothing the attack does not.");
      return { type: "matches", parameters: { subject: "defender", filter } };
    }
    case "unit-mark":
      return polarity(leaf, pred("designated", { tag: MARK_TAGS[String(closed(leaf, "mark"))] }, who));
    case "unit-position": {
      const kind = closed(leaf, "kind");
      // Widened for every version: v1 always authored subject as "target", so widenedWho gives
      // the same "defender" it always compiled to; only v2 (batch 6) can author anything else.
      const subject = widenedWho(closed(leaf, "subject"));
      if (kind === "closest-eligible") {
        const parameters: Node = { among: "eligible-targets" };
        if (leaf.parameters.to !== undefined) {
          const to = closed(leaf, "to");
          parameters.to = to === "target" ? "defender" : to;
        }
        if (leaf.parameters.range !== undefined) parameters.range = { inches: closed(leaf, "range") };
        return polarity(leaf, pred("closest", parameters, subject));
      }
      if (kind === "within" && leaf.parameters.weapon_range !== undefined) {
        // Version 15: the distance is the attacking weapon's range, or half of it (compile-attack-properties reads the weapon).
        const range = closed(leaf, "weapon_range") === "half" ? "half-weapon" : "weapon";
        return polarity(leaf, pred("within", { of: "attacker", range }, subject));
      }
      if (kind === "within" || kind === "beyond") {
        // Version 4 names what the distance is measured from; earlier versions always meant the
        // distance from this unit to the attack's target, as the authored data measures it.
        // A named range (range_ref, unit-position@15) replaces inches:
        // its aura carries the anchor, and `of` says whose units the distance is measured to.
        // range_ref engagement is the Engagement Range itself: the DSL names it as the string "engagement", not an aura.
        const engagement = leaf.parameters.range_ref === "engagement";
        const named = leaf.parameters.range_ref !== undefined && !engagement;
        if (named && kind === "beyond") throw new CompileError("A named range is measured within, not beyond.");
        // A weapon distance (distance half-weapon, unit-position@21) is the attacking weapon's half range: a range string, not inches.
        const weaponDistance = leaf.parameters.distance !== undefined;
        const range = (engagement ? "engagement" : named ? { aura_of: namedRange(leaf.parameters.range_ref).aura_of } : weaponDistance ? "half-weapon" : { inches: closed(leaf, "inches") }) as unknown as Node;
        const inchesOnly = (): Node => {
          if (named || engagement || weaponDistance) throw new CompileError(`unit-position of ${String(leaf.parameters.of)} takes inches, not a named range or a weapon distance.`);
          return { inches: closed(leaf, "inches") };
        };
        const wholly = leaf.parameters.wholly === true ? { wholly: true } : {};
        // Version 22: every model of the subject is within (unit-position@23).
        const every = everyModelFlag(leaf);
        // Wave 10: a distance to an objective marker by its designation and controller, or to the
        // enemy deployment zone (a region place, beyond only; compile-set-up-placement folds it).
        const node = leaf.parameters.of === "objective"
          ? pred("within", { of: { objective: objectiveFilter(leaf) }, range: inchesOnly() }, subject)
          : leaf.parameters.of === "enemy-deployment-zone"
          ? pred("within", { of: { territory: "enemy-deployment-zone" }, range: inchesOnly(), ...wholly }, subject)
          : leaf.parameters.of === "battlefield-centre"
          ? pred("within", { of: "battlefield-centre", range: inchesOnly(), ...wholly }, subject)
          : leaf.parameters.of === "marker"
          ? pred("within", { of: { marker: closed(leaf, "of_marker") }, range: inchesOnly(), ...wholly }, subject)
          : leaf.parameters.of === "battlefield-edge"
          ? pred("within", { of: "battlefield-edge", range: inchesOnly(), ...wholly }, subject)
          : leaf.parameters.of === "following-filter"
          ? pred("within", { of: followingFilter(leaf), range: engagement ? range : inchesOnly(), ...wholly, ...every }, subject)
          : leaf.parameters.of === "matching-unit"
          ? pred("within", { of: matchingUnit(leaf, subject), range, ...wholly }, subject)
          : leaf.parameters.of !== undefined
          ? pred("within", { of: widenedWho(closed(leaf, "of")) ?? "this-unit", range, ...wholly, ...every }, subject)
          : pred("within", { of: "defender", range: inchesOnly() });
        return polarity(leaf, kind === "beyond" ? negate(node) : node);
      }
      const controlled = closed(leaf, "controlled_by");
      const objective: Node = controlled === "you" ? { controlled_by: "friendly" } : controlled === "opponent" ? { controlled_by: "enemy" } : {};
      // Version 13: the marker this record selected (bound by compile.ts), or the one carrying a designation.
      if (leaf.parameters.objective === "designated") objective.designated = closed(leaf, "objective_tag");
      if (leaf.parameters.objective === "selected") {
        if (typeof leaf.parameters.selection_var !== "string") throw new CompileError("unit-position names the selected objective marker, but this record selects no objective marker.");
        objective.selection_var = leaf.parameters.selection_var;
      }
      return polarity(leaf, pred("within", { of: { objective }, range: "objective-control", ...everyModelFlag(leaf) }, subject));
    }
    case "deployment-window":
      return polarity(leaf, { type: "deployment-window", parameters: { during: closed(leaf, "during") } });
    case "target-is-selected":
      if (namesSelection(leaf)) return targetingCondition(leaf);
      throw new CompileError("target-is-selected only compiles with a select-unit leaf; the compiler resolves it there.");
    case "targeted":
      return targetingCondition(leaf);
    case "army-faction":
      return polarity(leaf, { type: "army-faction", parameters: { faction: closed(leaf, "faction") } });
    case "army-includes":
      return armyIncludesCondition(leaf);
    case "battle-size":
      return polarity(leaf, { type: "battle-size", parameters: { size: closed(leaf, "size") } });
    case "guided":
      return polarity(leaf, pred("guided", {}, leaf.parameters.subject === undefined ? undefined : closed(leaf, "subject") as string));
    case "moved-over": {
      const window = leaf.parameters.window === undefined ? undefined : closed(leaf, "window");
      return polarity(leaf, pred("moved-over", { by: closed(leaf, "by"), ...(window && window !== "event" ? { window } : {}) }, leaf.parameters.subject === undefined ? undefined : closed(leaf, "subject") as string));
    }
    // ── New predicate families (batch 6, predicate-families.ts) ─────────────────────────────
    case "rule-active": {
      // Version 2: one option of an option-bearing rule (stance-option-ref), or an ability a record
      // defines inside itself (named-ability-ref).
      const rule = closed(leaf, "rule");
      const reference = rule !== null && typeof rule === "object" ? rule as Node : null;
      const ref = reference && (reference.definition_id !== undefined
        ? { ability_id: reference.ability_id, definition_id: reference.definition_id }
        : { ability_id: reference.ability_id, option_id: reference.option_id });
      return polarity(leaf, { type: "rule-active", parameters: { rule: ref ?? rule } });
    }
    case "unit-owner":
      return polarity(leaf, pred("owned-by", { owner: closed(leaf, "owner") }, subjectOf(leaf)));
    case "unit-has-ability":
      // compile.ts binds "this ability" to the record's id before lowering (compile-holder-abilities.ts).
      if (leaf.parameters.own === true) throw new CompileError("unit-has-ability names this ability, which binds to an id only when its record compiles.");
      return polarity(leaf, pred("has-ability", { ability: closed(leaf, "ability") }, subjectOf(leaf)));
    case "same-unit":
      return polarity(leaf, pred("same-unit", { as: closed(leaf, "as") }, subjectOf(leaf)));
    case "model-count": {
      const parameters: Node = {};
      if (leaf.parameters.keyword !== undefined) parameters.keyword = closed(leaf, "keyword");
      if (leaf.parameters.min !== undefined) parameters.min = closed(leaf, "min");
      if (leaf.parameters.max !== undefined) parameters.max = closed(leaf, "max");
      return polarity(leaf, pred("model-count", parameters, subjectOf(leaf)));
    }
    case "wounds-state": {
      const kind = closed(leaf, "kind");
      const parameters: Node = kind === "lost" ? { lost: true } : kind === "damaged" ? { damaged: true } : { remaining_max: closed(leaf, "value") };
      return polarity(leaf, pred("wounds", parameters, subjectOf(leaf)));
    }
    case "history-compare": {
      // Both sides always tally enemy units destroyed this battle; the only variable is whether
      // one side narrows to CHARACTER units (mission-card kill-count comparisons).
      const destroyedSide = (kind: unknown): Node => ({ event: "destroyed", object: { owner: "enemy", ...(kind === "character" ? { all_of: ["CHARACTER"] } : {}) }, window: "battle" });
      const left = destroyedSide(leaf.parameters.left_kind);
      const rightKind = closed(leaf, "right_kind");
      const right: Node = rightKind === "tally" ? destroyedSide(leaf.parameters.right_tally_kind)
        : rightKind === "pool" ? { pool: closed(leaf, "right_pool") } : { value: closed(leaf, "right_value") };
      return polarity(leaf, { type: "happened-compare", parameters: { left, comparison: comparison(leaf), right } });
    }
    case "in-region": {
      const kind = closed(leaf, "region_kind");
      const region: Node = kind === "territory" ? { territory: closed(leaf, "territory") }
        : kind === "rule-region" ? { rule_region: { region_id: closed(leaf, "region_id"), owner_faction: closed(leaf, "owner_faction") } }
        : { terrain_area: { footprint: closed(leaf, "terrain_tag") } };
      const parameters: Node = { region };
      if (leaf.parameters.wholly === true) parameters.wholly = true;
      if (leaf.parameters.models !== undefined) parameters.models = closed(leaf, "models");
      return polarity(leaf, pred("in-region", parameters, subjectOf(leaf)));
    }
    case "controls-objective": {
      if (closed(leaf, "mode") === "more-than-opponent") return polarity(leaf, { type: "controls", parameters: { compare: { owner: "enemy", comparison: "gt" } } });
      const parameters: Node = {};
      if (leaf.parameters.by !== undefined) parameters.by = closed(leaf, "by");
      const objective: Node = {};
      if (leaf.parameters.objective_role !== undefined) objective.role = closed(leaf, "objective_role");
      if (leaf.parameters.home_of !== undefined) objective.home_of = closed(leaf, "home_of");
      if (leaf.parameters.objective_territory !== undefined) objective.territory = closed(leaf, "objective_territory");
      if (Object.keys(objective).length) parameters.objective = objective;
      if (leaf.parameters.count_min !== undefined || leaf.parameters.count_max !== undefined) parameters.count = countBounds(leaf);
      return polarity(leaf, { type: "controls", parameters });
    }
    case "attack-filter": {
      const parameters = attackFilter(leaf, leaf.parameters);
      return polarity(leaf, { type: "attack-is", parameters });
    }
    case "attack-compare": {
      const left: Node = { of: closed(leaf, "left_of"), stat: stat(leaf, "left_stat") };
      if (leaf.parameters.left_reduce !== undefined) left.reduce = closed(leaf, "left_reduce");
      const rightKind = closed(leaf, "right_kind");
      let right: Node;
      if (rightKind === "stat") {
        right = { of: closed(leaf, "right_of"), stat: stat(leaf, "right_stat") };
        if (leaf.parameters.right_reduce !== undefined) right.reduce = closed(leaf, "right_reduce");
      } else right = { value: closed(leaf, "right_value") };
      return polarity(leaf, { type: "attack-compare", parameters: { left, comparison: comparison(leaf), right } });
    }
    case "visible": {
      const parameters: Node = {};
      // Version 3: visible to the unit-filter right after it (compile-unit-filters.ts).
      if (leaf.parameters.to !== undefined) parameters.to = leaf.parameters.to === "following-filter" ? followingFilter(leaf) : closed(leaf, "to");
      if (leaf.parameters.fully === true) parameters.fully = true;
      if (leaf.parameters.blocked_by !== undefined) parameters.blocked_by = closed(leaf, "blocked_by");
      return polarity(leaf, pred("visible", parameters, subjectOf(leaf)));
    }
    case "designated-filter": {
      const parameters: Node = { tag: canonicalDesignation(closed(leaf, "tag")) };
      // The Warlord is one model: a count of Warlords has no meaning.
      if (parameters.tag === "warlord" && (leaf.parameters.count_min !== undefined || leaf.parameters.count_max !== undefined)) throw new CompileError("A count of Warlords is not a Warlord test; the Warlord is one model.");
      if (parameters.tag === "warlord" && leaf.parameters.subject === undefined) throw new CompileError("A Warlord test has no subject: name the model or unit it tests.");
      if (leaf.parameters.by !== undefined) parameters.by = closed(leaf, "by");
      if (leaf.parameters.count_min !== undefined || leaf.parameters.count_max !== undefined) parameters.count = countBounds(leaf);
      return polarity(leaf, pred("designated", parameters, subjectOf(leaf)));
    }
    case "battle-round": {
      // Version 2: any one of several listed rounds.
      if (Array.isArray(leaf.parameters.rounds)) return anyOf((leaf.parameters.rounds as number[]).map((round) => ({ type: "battle-round", parameters: { min: round, max: round } })));
      const parameters: Node = {};
      if (leaf.parameters.min !== undefined) parameters.min = closed(leaf, "min");
      if (leaf.parameters.max !== undefined) parameters.max = closed(leaf, "max");
      return { type: "battle-round", parameters };
    }
    case "roll-outcome": {
      const parameters: Node = { roll: closed(leaf, "roll"), result: closed(leaf, "result") };
      if (leaf.parameters.source !== undefined) parameters.source = { event_var: closed(leaf, "source") };
      return polarity(leaf, { type: "roll-result", parameters });
    }
    case "phase-window": {
      const operands: Node[] = [];
      // Version 2: "in any phase" names no phase; compile.ts drops it when no turn is named either.
      if (leaf.parameters.phase !== undefined && leaf.parameters.phase !== "any") operands.push({ type: "phase-is", parameters: { phase: closed(leaf, "phase") } });
      const turn = leaf.parameters.turn === undefined ? undefined : closed(leaf, "turn");
      if (turn !== undefined && turn !== "either") operands.push({ type: "player-turn-is", parameters: { turn: `${String(turn)}-turn` } });
      if (operands.length === 0) throw new CompileError("phase-window needs a phase, a turn other than either, or both.");
      return operands.length === 1 ? operands[0]! : { operator: "and", operands };
    }
    // ── Mission/composition predicate families (batch 7a, mission-predicate-families.ts) ────
    case "model-profile":
      return polarity(leaf, pred("model-profile", { profile: closed(leaf, "profile") }, subjectOf(leaf)));
    case "loadout": {
      const parameters: Node = { uniform: closed(leaf, "uniform") };
      if (leaf.parameters.model_keyword !== undefined) parameters.model_keyword = closed(leaf, "model_keyword");
      return polarity(leaf, pred("loadout", parameters, subjectOf(leaf)));
    }
    case "named-weapon":
    case "unit-wargear":
      return polarity(leaf, namedEquipmentPredicate(leaf));
    case "equipped-weapon-count": {
      const subject = subjectOf(leaf);
      const name = closed(leaf, "other_than");
      return polarity(leaf, allOf([
        pred("named-weapon", { name, count: 1 }, subject),
        pred("equipped-weapon-count", {
          weapons: { type: closed(leaf, "weapon_type"), exclude_name: name },
          count: { min: closed(leaf, "count"), max: closed(leaf, "count") },
        }, subject),
      ])!);
    }
    case "eligible": {
      const parameters: Node = { to: closed(leaf, "to") };
      // "able to embark within" names the Transport; the DSL reads its unit-ref as given (this-unit or ability-unit).
      if (leaf.parameters.to === "embark-within") {
        parameters.transport = closed(leaf, "transport");
        return polarity(leaf, pred("eligible", parameters, subjectOf(leaf)));
      }
      if (leaf.parameters.source_ability_id !== undefined) {
        const sourceAbility: Node = { ability_id: closed(leaf, "source_ability_id") };
        if (leaf.parameters.source_ability_owner !== undefined) sourceAbility.owner = closed(leaf, "source_ability_owner");
        parameters.source_ability = sourceAbility;
      }
      if (leaf.parameters.at !== undefined) parameters.at = closed(leaf, "at");
      return polarity(leaf, pred("eligible", parameters, subjectOf(leaf)));
    }
    case "resource": {
      const parameters: Node = { pool: closed(leaf, "pool") };
      if (leaf.parameters.at_least !== undefined || leaf.parameters.at_most !== undefined) parameters.count = countBounds(leaf, "at_least", "at_most");
      if (leaf.parameters.below_max === true) parameters.below_max = true;
      if (leaf.parameters.source_ability_id !== undefined) {
        const sourceAbility: Node = { ability_id: closed(leaf, "source_ability_id") };
        if (leaf.parameters.source_ability_owner !== undefined) sourceAbility.owner = closed(leaf, "source_ability_owner");
        parameters.source_ability = sourceAbility;
      }
      if (leaf.parameters.at !== undefined) parameters.at = closed(leaf, "at");
      return polarity(leaf, { type: "resource", parameters });
    }
    case "operation-markers": {
      const parameters: Node = {};
      if (leaf.parameters.side !== undefined) parameters.side = closed(leaf, "side");
      if (leaf.parameters.count_min !== undefined || leaf.parameters.count_max !== undefined) parameters.count = countBounds(leaf);
      for (const flag of ["friendly_unit_in_same_terrain_area", "no_enemy_in_terrain_area"]) {
        if (leaf.parameters[flag] === true) parameters[flag] = true;
      }
      if (leaf.parameters.within_range_of !== undefined) parameters.within = { of: { objective: { home_of: "enemy" } }, range: "objective-control" };
      return polarity(leaf, { type: "operation-markers", parameters });
    }
    case "engagement-fronts":
      return polarity(leaf, { type: "engagement-fronts", parameters: { count: countBounds(leaf) } });
    case "destroyed-while-on-objective": {
      const parameters: Node = {};
      if (leaf.parameters.count_min !== undefined) parameters.count = countBounds(leaf);
      if (leaf.parameters.objective_role !== undefined) parameters.objective_role = closed(leaf, "objective_role");
      for (const flag of ["destroyer_on_objective", "victim_on_objective", "victim_started_turn_on_objective"]) {
        if (leaf.parameters[flag] === true) parameters[flag] = true;
      }
      return polarity(leaf, { type: "destroyed-while-on-objective", parameters });
    }
    case "destroyed-in-tagged-terrain": {
      const parameters: Node = {};
      if (leaf.parameters.count_min !== undefined) parameters.count = countBounds(leaf);
      if (leaf.parameters.tag !== undefined) parameters.tag = closed(leaf, "tag");
      if (leaf.parameters.at_start_of_turn === true) parameters.at_start_of_turn = true;
      return polarity(leaf, { type: "destroyed-in-tagged-terrain", parameters });
    }
    default:
      throw new CompileError(`Condition ${leaf.family_id} has no DSL fragment yet.`);
  }
}

/** `subjectOf`'s own subject value, when the leaf names one other than the implicit default. */
function subjectOf(leaf: CompileLeaf): string | undefined {
  return leaf.parameters.subject === undefined ? undefined : (closed(leaf, "subject") as string);
}

/** A DURATION leaf's DSL scope. */
export function duration(leaf: CompileLeaf): string {
  if (PHASE_EDGE_ENDPOINTS.includes(String(closed(leaf, "endpoint")))) return phaseEdgeDuration(leaf);
  const found = DURATIONS[String(closed(leaf, "endpoint"))];
  if (!found) throw new CompileError(`Duration ${String(leaf.parameters.endpoint)} has no DSL scope yet.`);
  return found;
}

/** Several conditions all holding, or null when there are none; shared with `compile.ts`'s own gating. */
/**
 * A non-Stratagem ability's own phase window as a gate on the whole ability: any one listed
 * phase, in the turn it belongs to (a phase under `either_phases` holds in both players' turns).
 * The same nodes phase-window emits; a Stratagem's use-window is checked against core instead.
 */
export function activationWindowCondition(parameters: Record<string, unknown>): Node {
  const window = (phases: unknown, turn: "your-turn" | "opponent-turn" | null): Node[] => (phases as string[]).map((phase) => turn
    ? { operator: "and", operands: [{ type: "phase-is", parameters: { phase } }, { type: "player-turn-is", parameters: { turn } }] }
    : { type: "phase-is", parameters: { phase } });
  const nodes = [
    ...window(parameters.your_phases, "your-turn"),
    ...window(parameters.opponent_phases, "opponent-turn"),
    ...window(parameters.either_phases, null),
  ];
  if (nodes.length === 0) throw new CompileError("activation-window must name at least one phase.");
  return nodes.length === 1 ? nodes[0]! : { operator: "or", operands: nodes };
}

export function allOf(nodes: Node[]): Node | null {
  return nodes.length === 0 ? null : nodes.length === 1 ? nodes[0]! : { operator: "and", operands: nodes };
}

/** A stratagem's target_restrictions from its TARGET leaves; null when the ability has none. */
export function targetRestrictions(parts: readonly CompileLeaf[], eligibility: readonly Node[]): Node | null {
  if (parts.length === 0 && eligibility.length === 0) return null;
  const selectors = parts.filter((leaf) => leaf.family_id === "stratagem-target" || leaf.family_id === "triggering-target");
  const bindings = parts.filter((leaf) => leaf.family_id === "target-binding");
  // The DSL holds several named targets, but an effect leaf cannot yet say which one it applies
  // to ("your unit" after two targets), so a second target refuses until leaves can name it.
  if (selectors.length > 1) throw new CompileError(`A stratagem TARGET names ${selectors.length} targets; no effect leaf can yet say which target it applies to, so the second target has no binding.`);
  if (bindings.length > 1) throw new CompileError("A stratagem TARGET is bound to more than one unit.");
  // "That Frenzied Reavers Jakhals unit." with no selector of its own: the target is the one unit the
  // binding names (the triggering or the attacked unit); the WHEN's own filter says which units qualify.
  if (selectors.length === 0 && bindings.length === 1) {
    const restrictions: Node = { count: "one", selects: "unit", bound_to: bindings[0]!.parameters.bound_to };
    // The attacked unit's filter (compile-targeting-history.ts bindTargetedTarget) says which attacked unit.
    const eligibilityCondition = allOf([...attackedChecks(bindings[0]!.parameters.attacked_filter as Node | undefined), ...eligibility]);
    if (eligibilityCondition) restrictions.eligibility = eligibilityCondition;
    return restrictions;
  }
  if (selectors.length !== 1) throw new CompileError(`A stratagem TARGET needs exactly one target leaf; found ${selectors.length}.`);
  const selector = selectors[0]!;
  const any = selector.parameters.match === "any";
  const triggering = selector.family_id === "triggering-target";
  // "Your DEATH GUARD WARLORD": the Warlord is a typed field, not a keyword (core-keywords.ts liftWarlord).
  // "That X unit" keeps its keywords as written: they also narrow the WHEN moment's own condition.
  const { keywords, warlord } = triggering ? { keywords: selector.parameters.keywords as string[], warlord: false } : liftWarlord(selector.parameters.keywords as string[]);
  if (warlord && any) throw new CompileError("A Stratagem TARGET names the Warlord as one of several alternatives; core has no field for \"the Warlord or another unit\".");
  const excluded = (selector.parameters.excluded_keywords as string[] | undefined) ?? [];
  if (liftWarlord(excluded).warlord) throw new CompileError("A Stratagem TARGET excludes the Warlord; core has no field for a target that is not the Warlord.");
  if (warlord && selector.parameters.side === "enemy") throw new CompileError("An enemy Stratagem TARGET cannot be your Warlord.");
  const restrictions: Node = {
    count: triggering ? "one" : selector.parameters.count,
    ...(selector.parameters.count_max !== undefined ? { count_max: selector.parameters.count_max } : {}),
    ...(triggering ? {} : { side: selector.parameters.side }),
    selects: selector.parameters.selects,
    ...(warlord ? { warlord: true } : {}),
    ...(keywords.length ? { [any ? "required_keywords_any" : "required_keywords"]: keywords } : {}),
    ...(excluded.length ? { excluded_keywords: excluded } : {}),
  };
  // "That X unit" after an enemy unit that targeted a friendly X unit: the unit it attacked.
  const attacked = selector.parameters.attacked_filter as Node | undefined;
  const bound = triggering ? (attacked ? "attacked-unit" : "triggering-unit") : bindings[0]?.parameters.bound_to;
  if (bound) restrictions.bound_to = bound;
  // A folded unit-filter's checks beyond all-of keywords (compile-unit-filters.ts) go to eligibility.
  const filter = (selector.parameters.filter ?? {}) as { any_keywords?: string[]; excluded_all_keywords?: string[]; abilities?: string[]; excluded_abilities?: string[]; states?: string[]; other?: boolean; visible?: boolean; alternatives?: FilterAlternative[] };
  if (filter.visible) throw new CompileError("A Stratagem TARGET has no visibility requirement field.");
  const filtered: Node[] = [
    ...(Array.isArray(selector.parameters.unit_ids) ? [pred("matches", { subject: "this-unit", filter: { level: "unit", unit_ids: selector.parameters.unit_ids } })] : []),
    ...(Array.isArray((filter as Node).unit_ids) ? [pred("matches", { subject: "this-unit", filter: { level: "unit", unit_ids: (filter as Node).unit_ids } })] : []),
    ...(filter.any_keywords?.length ? [pred("has-keyword", { any_of: filter.any_keywords })] : []),
    ...(filter.alternatives?.length ? [alternativesCheck(filter.alternatives)!] : []),
    // Version 3: "That ADEPTUS ASTARTES INFANTRY/MOUNTED unit" also has one of these.
    ...(Array.isArray(selector.parameters.any_keywords) ? [pred("has-keyword", { any_of: selector.parameters.any_keywords })] : []),
    ...(filter.states ?? []).map((state) => stateCheck(state)),
    ...(filter.excluded_all_keywords?.length ? [negate(pred("has-keyword", { all_of: filter.excluded_all_keywords }))] : []),
    ...abilityChecks(filter.excluded_abilities, filter.abilities),
  ];
  // "other" on a unit-filter says the unit is not the bearer. A Stratagem target has no bearer, so the
  // exclusion must be stated in the unit-filter it belongs to, not inferred here.
  if (filter.other === true) throw new CompileError("A Stratagem target has no bearer, so \"other\" has no unit to exclude; state the exclusion in the unit-filter.");
  const anyRequired = any ? keywords : (selector.parameters.any_keywords as string[] | undefined) ?? [];
  const requiredUnitIds = (selector.parameters.unit_ids as string[] | undefined) ?? [];
  const attackedFilter = attackedChecks(attacked, any ? [] : keywords, anyRequired, requiredUnitIds);
  const eligibilityCondition = allOf([...filtered, ...attackedFilter, ...eligibility]);
  if (eligibilityCondition) restrictions.eligibility = eligibilityCondition;
  return restrictions;
}
