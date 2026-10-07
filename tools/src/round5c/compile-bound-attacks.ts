import { ANTECEDENT } from "./antecedent-families.js";
import { momentOfFilter } from "./compile-antecedent.js";
import { ATTACK_EVENTS } from "./compile-conditions.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { boundAttacksProblem } from "./family-extensions-w8-hidden.js";

/**
 * "When this unit has shot, those attacks do not prevent it from being hidden": "those attacks"
 * (an attack-filter of antecedent) are the attacks of the record's shooting moment. The moment's
 * trigger binds them (`binds_event_variable`) and the hidden suppression after the filter names
 * them (`modifier.attacks`), so exactly those attacks never count against Hidden, however long
 * the effect itself lasts.
 */

/** The event variable a record's one bound shooting moment gets; a second moment numbers them. */
const THOSE_ATTACKS = "those-attacks";

/** EVENT leaves that are not a moment of their own: attacks, selections, loops and rolls. */
const NOT_MOMENTS = new Set(["attack", "select-unit", "for-each-unit-select", "dice-roll"]);

function isMoment(leaf: CompileLeaf): boolean {
  if (leaf.role !== "EVENT" || NOT_MOMENTS.has(leaf.family_id)) return false;
  return !(leaf.family_id === "event" && ATTACK_EVENTS.has(String(leaf.parameters.kind)));
}

/** A moment whose unit is shooting: selected to shoot, or its shooting attacks resolved. */
function isShootingMoment(leaf: CompileLeaf): boolean {
  if (leaf.family_id !== "event") return false;
  const { kind, to, action_kind: action } = leaf.parameters;
  return (kind === "selected" && to === "shoot") || kind === "selected-to-shoot" || kind === "after-shooting"
    || (kind === "attacks-resolved" && action === "shoot");
}

/** A moment after the attacks it names were made. */
function isResolvedMoment(leaf: CompileLeaf): boolean {
  return leaf.family_id === "event" && (leaf.parameters.kind === "attacks-resolved" || leaf.parameters.kind === "after-shooting");
}

function isBound(leaf: CompileLeaf): boolean {
  return leaf.family_id === "attack-filter" && leaf.parameters.of === ANTECEDENT;
}

function isHiddenSuppression(leaf: CompileLeaf | undefined): boolean {
  return leaf?.family_id === "rule-state" && leaf.parameters.direction === "suppressed"
    && leaf.parameters.rule_kind === "core-rule" && leaf.parameters.rule === "attacking-ends-hidden";
}

/** The nearest moment before a leaf, or -1. */
function momentBefore(leaves: readonly CompileLeaf[], at: number): number {
  for (let index = at - 1; index >= 0; index -= 1) if (isMoment(leaves[index]!)) return index;
  return -1;
}

/**
 * Name each bound "those attacks" after the moment it binds to, across the whole record, before
 * it is split into independent parts: one bound moment is `those-attacks`, several are numbered
 * in source order. A name already given (a nested option compiled again) is kept.
 */
export function nameBoundAttacks(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  const bound = leaves.flatMap((leaf, index) => isBound(leaf) && leaf.parameters.event_var === undefined ? [index] : []);
  if (bound.length === 0) return [...leaves];
  const moments = [...new Set(bound.map((index) => momentBefore(leaves, index)).filter((at) => at !== -1))].sort((a, b) => a - b);
  return leaves.map((leaf, index) => {
    if (!bound.includes(index)) return leaf;
    const moment = momentBefore(leaves, index);
    if (moment === -1) return leaf;
    const name = moments.length === 1 ? THOSE_ATTACKS : `${THOSE_ATTACKS}-${moments.indexOf(moment) + 1}`;
    return { ...leaf, parameters: { ...leaf.parameters, event_var: name } };
  });
}

/**
 * Whether a bound suppression's unit is the shooting moment's unit: the triggering unit; this
 * unit when a Stratagem's target is bound to the triggering unit; or this unit when the moment is
 * this unit's own (no filter or other unit names whose moment it is).
 */
function namesMomentUnit(leaves: readonly CompileLeaf[], momentAt: number, subject: unknown): boolean {
  if (subject === "event-subject") return true;
  if (subject !== "this-unit") return false;
  if (leaves.some((leaf) => leaf.family_id === "triggering-target" || (leaf.family_id === "target-binding" && leaf.parameters.bound_to === "triggering-unit"))) return true;
  const moment = leaves[momentAt]!.parameters;
  if ((moment.subject !== undefined && moment.subject !== "this-unit") || moment.owner !== undefined || moment.by !== undefined) return false;
  return !leaves.some((leaf, index) => index < momentAt && momentOfFilter(leaves, index) === momentAt);
}

/**
 * Fold each bound "those attacks" into the hidden suppression right after it, and bind the
 * shooting moment before it. Refuses a bound filter with no shooting moment before it, one whose
 * next leaf is anything but that suppression, one that narrows the attacks, and one whose
 * suppression names a unit other than the shooter. Also refuses an unbound hidden suppression
 * after a moment whose attacks are already resolved: it would cover none of them.
 */
export function foldBoundAttacks(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  const out = [...leaves];
  const consumed = new Set<number>();
  out.forEach((leaf, index) => {
    if (!isBound(leaf)) return;
    const { event_var: name, ...filter } = leaf.parameters;
    const problem = boundAttacksProblem(filter);
    if (problem) throw new CompileError(problem);
    const momentAt = momentBefore(out, index);
    if (momentAt === -1 || !isShootingMoment(out[momentAt]!)) {
      throw new CompileError(`"Those attacks" at byte ${leaf.start_byte} names the attacks of a shooting moment, but the moment before it is ${momentAt === -1 ? "missing" : `${String(out[momentAt]!.parameters.kind ?? out[momentAt]!.family_id)}, not a shooting`}.`);
    }
    const next = out[index + 1];
    if (!isHiddenSuppression(next) || next!.fragment !== leaf.fragment) {
      throw new CompileError(`"Those attacks" at byte ${leaf.start_byte} binds only an attacking-ends-hidden suppression right after it; ${next ? `${next.family_id} follows` : "nothing follows"}.`);
    }
    if (!namesMomentUnit(out, momentAt, next!.parameters.subject)) {
      throw new CompileError(`"Those attacks" are the shooting unit's, but the hidden suppression at byte ${next!.start_byte} names ${String(next!.parameters.subject)}, which is not that unit.`);
    }
    const variable = typeof name === "string" ? name : THOSE_ATTACKS;
    const moment = out[momentAt]!;
    const existing = moment.parameters.binds_event_variable;
    if (existing !== undefined && existing !== variable) throw new CompileError(`One shooting moment is bound as both ${String(existing)} and ${variable}.`);
    out[momentAt] = { ...moment, parameters: { ...moment.parameters, binds_event_variable: variable } };
    out[index + 1] = { ...next!, parameters: { ...next!.parameters, attacks_var: variable } };
    consumed.add(index);
  });
  out.forEach((leaf, index) => {
    if (!isHiddenSuppression(leaf) || leaf.parameters.attacks_var !== undefined) return;
    const momentAt = momentBefore(out, index);
    if (momentAt !== -1 && isResolvedMoment(out[momentAt]!)) {
      throw new CompileError(`The hidden suppression at byte ${leaf.start_byte} follows a moment whose attacks are already made, so it covers none of them; name those attacks (attack-filter of ${ANTECEDENT}).`);
    }
  });
  return out.filter((_, index) => !consumed.has(index));
}
