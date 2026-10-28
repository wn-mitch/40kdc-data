import { exactSpan } from "./contracts.js";
import { AURA_RECIPIENT, FILTERED_UNITS } from "./compile-antecedent.js";
import { awaitsFollowingFilter } from "./families/shared.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { isBackref } from "./compile-attack-backref.js";
import { dslUnitFilter, filterOf } from "./compile-unit-filter-dsl.js";

export const isFilter = (leaf: CompileLeaf | undefined) => leaf?.family_id === "unit-filter";
export const openSelect = (leaf: CompileLeaf | undefined) => leaf?.family_id === "select-unit" && leaf.parameters.scope === undefined;
/** A select-unit that is open (no side yet) or names a side; its fold is checked against the filter after it. */
export const selectOf = (leaf: CompileLeaf | undefined) => leaf?.family_id === "select-unit";
export const openAura = (leaf: CompileLeaf | undefined) => leaf?.family_id === "aura-range" && leaf.parameters.side === undefined;
export const openTarget = (leaf: CompileLeaf | undefined) => leaf?.family_id === "stratagem-target" && leaf.parameters.side === undefined;
export const ownerlessEvent = (leaf: CompileLeaf | undefined) => leaf?.family_id === "event" && leaf.parameters.owner === undefined && leaf.parameters.subject === undefined;

/** The filter's side; a model-level filter only where `models` says the fold can name models, "any" only where `anySide` allows it. */
export function side(filter: CompileLeaf, what: string, options: { models?: boolean; anySide?: boolean } = {}): string {
  if (filter.parameters.level === "model" && options.models !== true) throw new CompileError(`A unit-filter naming models has no DSL shape for ${what} yet.`);
  const value = String(filter.parameters.side);
  if (value === "any" && options.anySide !== true) throw new CompileError(`A unit-filter for ${what} must say friendly or enemy.`);
  return value;
}

/** Units a distance after a quantifier's filter can be measured to, as the DSL's unit-refs. */
const NEAR_REFS: Record<string, string> = { target: "defender", "selected-unit": "selected-unit", "event-subject": "event-subject", "event-object": "event-object", attacker: "attacker" };

/**
 * "within 6\" of it" after "each other enemy unit", measured to a unit other than the bearer
 * (the attack's target, a selected unit): which units each pass takes.
 */
export function nearOther(leaf: CompileLeaf | undefined, quantifier: CompileLeaf): Record<string, unknown> | null {
  if (leaf?.family_id !== "unit-position" || leaf.fragment !== quantifier.fragment) return null;
  const p = leaf.parameters;
  if (p.kind !== "within" || p.subject !== AURA_RECIPIENT || p.negated === true || p.wholly === true) return null;
  const of = NEAR_REFS[String(p.of)];
  // Folding would drop the named range (its inches are absent); the distance stays a condition instead.
  if (of !== undefined && p.range_ref !== undefined) throw new CompileError("A distance to another unit by a named range has no quantifier shape yet.");
  return of === undefined ? null : { of, inches: p.inches };
}

/** Whether a filter is a list-building rule's group: the filter after its rule, or the filter its rule points back to. */
export function armyGroup(list: readonly CompileLeaf[], index: number): boolean {
  const before = list[index - 1];
  if (before?.family_id === "army-construction" && followedBy(before, list[index]!)) return true;
  const after = filteredAfter(list, index);
  return after !== null && list[after]!.family_id === "army-construction";
}

/** A distance or engagement in the filter's fragment whose other unit is the filter right after it. */
export function followedBy(leaf: CompileLeaf | undefined, filter: CompileLeaf): boolean {
  return leaf !== undefined && leaf.fragment === filter.fragment && leaf.parameters.following_filter === undefined
    && awaitsFollowingFilter(leaf.parameters);
}

/**
 * "engaged with an enemy unit **engaged** with a friendly CHARACTER unit": the enemy filter (right
 * after the outer state) is engaged with the friendly filter after the inner state. The inner state
 * names "that unit" (its subject is antecedent, bound to the outer filter), so it and the partner are
 * consumed here and the inner subject is not read. An inner state whose subject is this unit ("this
 * unit is engaged with a friendly VEHICLE unit") is a separate condition, so it returns null, as does
 * a leaf list with no inner state awaiting a filter. An antecedent inner state that is not a plain
 * engaged state, or a chain nested a second level, is refused.
 */
export function nestedEngagedChain(list: readonly CompileLeaf[], index: number, filter: CompileLeaf): { partner: Record<string, unknown>; at: number } | null {
  const inner = list[index + 1];
  if (inner?.family_id !== "unit-state" || inner.fragment !== filter.fragment || inner.parameters.with !== "following-filter") return null;
  const partnerAt = index + 2;
  const partner = list[partnerAt];
  if (!isFilter(partner) || partner.fragment !== filter.fragment) return null;
  if (!(inner.antecedent_keys ?? []).includes("subject")) return null;
  const p = inner.parameters;
  const plain = JSON.stringify(p.states) === JSON.stringify(["engaged"]) && p.negated !== true && p.at === undefined && p.exclusive !== true;
  if (!plain) throw new CompileError("An engaged-with chain takes a plain engaged state that names its unit (\"that unit\"), with no at, negation or exclusive qualifier.");
  if (partner.parameters.side === "any") throw new CompileError("An engaged-with chain's partner unit must say friendly or enemy.");
  const at = pastOwners(list, partnerAt, partner);
  const further = list[at];
  if (further?.family_id === "unit-state" && further.fragment === filter.fragment && further.parameters.with === "following-filter") {
    throw new CompileError("An engaged-with chain takes one level of nesting; a further engaged state after its partner unit has no DSL form.");
  }
  return { partner: dslUnitFilter(partner), at };
}

/** An attack whose target is the unit-filter right after it (attack target following-filter), in the filter's fragment. */
export function followsTargetingAttack(prev: CompileLeaf | undefined, filter: CompileLeaf): boolean {
  return prev?.family_id === "attack" && prev.parameters.target === "following-filter" && prev.fragment === filter.fragment;
}

/**
 * A unit-filter right after a condition that re-names the target an earlier attack of its fragment named by the filter
 * right after it ("that enemy model is a MONSTER" after "each time an attack is allocated to an enemy model"). It must
 * say the same side and level as the filter the attack named, and no other moment may come between the attack and it.
 */
export function renamedAttackTarget(out: readonly CompileLeaf[], list: readonly CompileLeaf[], filter: CompileLeaf): boolean {
  const before = out.at(-1);
  if (before?.role !== "CONDITION" || before.fragment !== filter.fragment || before.family_id === "unit-filter-target") return false;
  const attackAt = out.map((leaf) => leaf.family_id === "attack" && leaf.fragment === filter.fragment).lastIndexOf(true);
  if (attackAt === -1 || out.slice(attackAt + 1).some((leaf) => leaf.role === "EVENT" && leaf.fragment === filter.fragment)) return false;
  const attack = out[attackAt]!;
  const named = list[list.findIndex((leaf) => leaf.family_id === "attack" && leaf.start_byte === attack.start_byte && leaf.fragment === attack.fragment) + 1];
  return isFilter(named) && named.fragment === filter.fragment && named.parameters.side === filter.parameters.side
    && named.parameters.level === filter.parameters.level && filter.parameters.side !== "any";
}

/** A side-only unit-filter right after a moment whose object owner is already that side. */
export function restatesObjectOwner(event: CompileLeaf | undefined, filter: CompileLeaf): boolean {
  return event?.family_id === "event" && event.fragment === filter.fragment && event.parameters.object_filter === undefined
    && event.parameters.object_owner !== undefined && event.parameters.object_owner === filter.parameters.side
    && Object.keys(filterOf(filter)).length === 0 && filter.parameters.level === undefined;
}

/** The index past any "from your army" of the filter's own side right after it. */
export function pastOwners(list: readonly CompileLeaf[], index: number, filter: CompileLeaf): number {
  let at = index + 1;
  while (list[at]?.family_id === "unit-owner" && list[at]!.parameters.owner === filter.parameters.side) at += 1;
  return at;
}

/**
 * A for-each-unit-select with no parameters: the bare "each" whose units the next leaves name. A
 * before-form hit (compile-weapon-qualified.ts bindBeforeFormHits) is bare too: its `hit` names the
 * attacks that must hit each unit the filter after it selects.
 */
export const bareForEach = (leaf: CompileLeaf) => leaf.family_id === "for-each-unit-select" && Object.keys(leaf.parameters).every((key) => key === "including" || key === "hit");

/** "Engaged with your unit" about each pass's unit (bound to the recipient), in the quantifier's fragment. */
export function engagedWithOwnUnit(leaf: CompileLeaf | undefined, quantifier: CompileLeaf): boolean {
  if (leaf?.family_id !== "unit-state" || leaf.fragment !== quantifier.fragment) return false;
  const p = leaf.parameters;
  return p.subject === AURA_RECIPIENT && p.negated !== true && p.at === undefined
    && (p.with === "this-unit" || p.with === "this-model") && JSON.stringify(p.states) === JSON.stringify(["engaged"]);
}

/** An ownerless, subjectless event in the same fragment as `event`, joined to it by nothing but "or". */
export function orAlternative(event: CompileLeaf, next: CompileLeaf | undefined, sourceText: string | undefined): boolean {
  if (sourceText === undefined || !ownerlessEvent(next) || next!.fragment !== event.fragment || next!.parameters.subject_filter !== undefined) return false;
  const between = Buffer.from(sourceText, "utf8").subarray(event.end_byte, next!.start_byte).toString("utf8");
  return /^[\s*,]*or[\s*]*$/u.test(between);
}

/** An event the filter's side owns and that names no subject of its own. */
export function ownedBy(leaf: CompileLeaf | undefined, side: unknown): boolean {
  return leaf?.family_id === "event" && leaf.parameters.subject === undefined && side !== "any" && leaf.parameters.owner === side;
}

/** A selection, Stratagem target or for-each pass of the filter's fragment earlier in the list: "that unit" may name it. */
export function selectionBefore(list: readonly CompileLeaf[], index: number): boolean {
  return list.slice(0, index).some((other) => other.fragment === list[index]!.fragment && (other.family_id === "select-unit" || other.family_id === "stratagem-target" || other.family_id === "for-each-unit-select"));
}

/**
 * An attack whose maker the filter names: any friendly unit, or a model-level filter before an
 * attack by this unit's models ("each time a PENITENT model in your unit makes a melee attack").
 */
export function attackerAfter(leaf: CompileLeaf | undefined, filter: CompileLeaf, selectionBefore = false): boolean {
  if (leaf?.family_id !== "attack" || leaf.parameters.direction !== "makes" || leaf.parameters.attacker_filter !== undefined) return false;
  // "If that attack targets a" + filter: an earlier attack named again; the filter is its target.
  if (leaf.parameters.backref === true || leaf.parameters.refers !== undefined) return false;
  if (leaf.parameters.unit === "friendly-unit") return filter.parameters.side === "friendly";
  if (leaf.parameters.unit === "enemy-unit") return filter.parameters.side === "enemy";
  // "While a friendly X unit is Y, each time a model in that unit makes an attack": the unit the filter named.
  if (leaf.parameters.unit === "that-unit") return !selectionBefore && (filter.parameters.side === "friendly" || filter.parameters.side === "enemy");
  return leaf.parameters.unit === "this-unit" && filter.parameters.level === "model" && filter.parameters.side === "friendly";
}

/** "an attack made by a" + filter: the attack's own wording, or the words before the filter, say who made it. */
export function madeBy(attack: CompileLeaf | undefined, filter: CompileLeaf, sourceText: string | undefined): boolean {
  if (sourceText === undefined || attack === undefined || attack.fragment !== filter.fragment || filter.start_byte <= attack.start_byte) return false;
  if (!/\bmade by\b/iu.test(exactSpan(sourceText, attack.start_byte, filter.start_byte))) return false;
  if (isBackref(attack)) throw new CompileError("An attack named again by its attacker (\"that attack is made by an X model\") has no DSL shape yet.");
  return attackerAfter(attack, filter);
}

/**
 * The subject_filter of the nearest earlier effect in the leaf's fragment that took a postfix
 * recipient, for a later leaf whose units are the same "filtered-units" with no filter of its own.
 */
export function inheritedPostfixFilter(out: readonly CompileLeaf[], list: readonly CompileLeaf[], index: number): Record<string, unknown> | undefined {
  const leaf = list[index]!;
  if (leaf.parameters.subject !== FILTERED_UNITS || leaf.parameters.subject_filter !== undefined) return undefined;
  // A leaf with its own unit-filter after it (past its owners) is not a later leaf: that filter is its recipient.
  let after = index + 1;
  while (list[after]?.family_id === "unit-owner" && list[after]!.fragment === leaf.fragment) after += 1;
  if (isFilter(list[after]) && list[after]!.fragment === leaf.fragment) return undefined;
  const takes = (other: CompileLeaf) => other.fragment === leaf.fragment && other.role === "EFFECT" && other.parameters.subject_filter !== undefined
    && Object.values(other.parameters).includes(FILTERED_UNITS);
  const effect = [...out].reverse().find(takes);
  return effect?.parameters.subject_filter as Record<string, unknown> | undefined;
}

/** An effect bound to the units of the unit-filter right after it (compile-antecedent.ts postfixFilter). */
export function postfixRecipient(leaf: CompileLeaf | undefined): boolean {
  return leaf !== undefined && (leaf.role === "EFFECT" || leaf.family_id === "chosen-option-grant") && leaf.parameters.subject_filter === undefined && Object.values(leaf.parameters).includes(FILTERED_UNITS);
}

/**
 * "while an enemy unit is Afflicted": a designation check right after the filter that names no unit,
 * count or designator, which bindDesignationSubjects leaves for the units the filter names.
 */
export function filterDesignation(leaf: CompileLeaf | undefined, filter: CompileLeaf): boolean {
  return leaf?.family_id === "designated-filter" && leaf.fragment === filter.fragment && leaf.parameters.subject === undefined
    && leaf.parameters.by === undefined && leaf.parameters.count_min === undefined && leaf.parameters.count_max === undefined && leaf.parameters.tag !== "warlord";
}

/** A condition about each recipient of the filter's effect, in the filter's fragment (compile-antecedent.ts). */
const perRecipientCondition = (leaf: CompileLeaf | undefined, filter: CompileLeaf) =>
  leaf !== undefined && leaf.role === "CONDITION" && leaf.fragment === filter.fragment && Object.values(leaf.parameters).includes(AURA_RECIPIENT);

/** The index of the leaf a bare unit-filter's units receive (`FILTERED_UNITS`), past any "from your army". */
/** A condition on the attack's target ("that target that enemy unit"), which a scope's frame keeps in front of it. */
function targetGate(leaf: CompileLeaf | undefined, filter: CompileLeaf): boolean {
  if (leaf?.role !== "CONDITION" || leaf.fragment !== filter.fragment) return false;
  return leaf.family_id === "target-is-selected" || leaf.family_id === "unit-filter-target" || leaf.parameters.subject === "defender" || leaf.parameters.subject === "target";
}

export function filteredAfter(list: readonly CompileLeaf[], index: number): number | null {
  let at = index + 1;
  // Past per-recipient conditions, and past conditions on the attack's target that a property
  // scope folded ahead of its frame ("Friendly X units' attacks that target that unit have …").
  while (list[at]?.family_id === "unit-owner" || perRecipientCondition(list[at], list[index]!) || targetGate(list[at], list[index]!) || filterDesignation(list[at], list[index]!)
    || (list[at]?.role === "DURATION" && list[at]!.fragment === list[index]!.fragment)) at += 1;
  const leaf = list[at];
  return leaf && Object.values(leaf.parameters).includes(FILTERED_UNITS) ? at : null;
}
