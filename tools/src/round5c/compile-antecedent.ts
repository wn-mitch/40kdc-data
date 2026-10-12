import { DESTRUCTION_ACTIVITIES } from "./family-extensions-17-triggering-destruction.js";
import { ANTECEDENT, antecedentKeys, keyEnum } from "./antecedent-families.js";
import { reviewedFamily } from "./contracts.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { awaitsFollowingFilter } from "./family-extensions-11.js";
import { destroyedObject, rollOwnerEvent } from "./compile-model-level.js";
import { refuseDestroyedUnitAntecedent, trailingDestroyerFilter } from "./compile-destroying-attack.js";
import { claimedByEmbarkedState } from "./compile-embarked-exclusion.js";
import { isTargetRef, TARGET_REF_KEYS } from "./compile-target-refs.js";
import { placements } from "./compile-placement.js";

/** Leaves that choose a unit an anaphor can point back to. */
/** A Stratagem's TARGET leaves; the target is the unit its effects name as this-unit. */
const STRATAGEM_TARGETS = new Set(["stratagem-target", "triggering-target", "target-binding"]);
/**
 * Event kinds whose moment is a unit acting or being acted on, so "that unit" can be it. Phase,
 * turn, round and step boundaries, resource and designation changes, uses of a rule and named
 * rolls introduce no unit.
 */
export const UNIT_EVENT_KINDS = new Set([
  "attack-made", "hit-roll", "wound-roll", "charge", "unit-destroyed", "model-destroyed", "this-model-destroyed", "after-shooting",
  "selected-to-shoot", "selected-to-fight", "enemy-selected-targets", "enemy-ended-move", "enemy-has-shot", "enemy-declared-charge",
  "disembarked", "damage-allocated", "state-changed", "move-ended", "selected", "targets-selected", "attacks-resolved", "set-up",
]);

/**
 * Whether a moment names a unit "that unit" can be: a unit kind, or a rule used by a named unit
 * ("each time that unit uses its Foo ability", "a unit from your army" + "performs the Bar
 * manoeuvre"). A bare use ("each time an Order is issued") names none.
 */
export function momentNamesUnit(leaves: readonly CompileLeaf[], index: number): boolean {
  const leaf = leaves[index]!;
  if (leaf.family_id !== "event") return false;
  const kind = String(leaf.parameters.kind);
  if (UNIT_EVENT_KINDS.has(kind)) return true;
  if (kind !== "used" || leaf.parameters.owner !== undefined) return false;
  if (leaf.parameters.subject !== undefined || leaf.parameters.subject_filter !== undefined) return true;
  let at = index - 1;
  while (leaves[at]?.family_id === "unit-owner" && leaves[at]!.fragment === leaf.fragment) at -= 1;
  return leaves[at]?.family_id === "unit-filter" && leaves[at]!.fragment === leaf.fragment;
}

/** Moments whose only named unit is the one they happen to (the trigger's object). */
const OBJECT_MOMENTS = new Set(["damage-allocated"]);

/** A Stratagem's own fragments; every other record is one RAW_TEXT. */
const STRATAGEM_FRAGMENTS = new Set(["WHEN", "TARGET", "EFFECT", "RESTRICTIONS"]);

function isStratagem(leaves: readonly CompileLeaf[]): boolean {
  return leaves.some((leaf) => (leaf.fragment !== undefined && STRATAGEM_FRAGMENTS.has(leaf.fragment))
    || STRATAGEM_TARGETS.has(leaf.family_id) || leaf.family_id === "use-window");
}

/**
 * The unit an aura reaches ("While a friendly X unit is within 6\" of this model, that unit …"):
 * the DSL's `recipient`, the unit the aura is being applied to.
 */
export const AURA_RECIPIENT = "recipient";
/**
 * Every unit a unit-filter right before the leaf matches ("Friendly **K** units" + "have the
 * Scouts ability"): an army-wide grant. Folding (`compile-unit-filters.ts`) puts the filter on
 * the leaf as `subject_filter`, which becomes its DSL target.
 */
export const FILTERED_UNITS = "filtered-units";

/** Leaves a unit-filter right after them belongs to: it says which units they pick or aim at. */
const FILTER_ANCHORS = new Set(["select-unit", "stratagem-target", "attack"]);

/**
 * The unit-filter an anaphor right after it names, when nothing else claims the filter: it sits
 * in the same fragment directly before the leaf (a "from your army" between them is the filter's
 * own wording), with no selection, Stratagem target or attack right before it.
 */
export function bareFilter(leaves: readonly CompileLeaf[], index: number): boolean {
  return bareFilterAt(leaves, index) >= 0;
}

/** The index of the unit-filter `bareFilter` finds before the leaf, or -1. */
function bareFilterAt(leaves: readonly CompileLeaf[], index: number): number {
  const leaf = leaves[index]!;
  let at = index - 1;
  // Past a per-recipient condition on the same units ("is within range of an objective, that unit's …").
  while (at >= 0 && leaves[at]!.fragment === leaf.fragment
    && (leaves[at]!.family_id === "unit-owner" || (leaves[at]!.role === "CONDITION" && hasAntecedent(leaves[at]!))
      // "Friendly X units have: Battleline. +1 OC.": each effect of one list takes the same filter. Only an
      // effect passes over another effect; a condition does not skip the effects that precede it.
      || (leaf.role === "EFFECT" && leaves[at]!.role === "EFFECT" && leaves[at]!.parameters.subject === ANTECEDENT))) at -= 1;
  const filter = leaves[at];
  if (filter?.family_id !== "unit-filter" || filter.fragment !== leaf.fragment) return -1;
  const before = leaves[at - 1];
  // A filter with a membership names models of a unit, so a target or attack before it does not make it the target.
  // "If your army includes a X unit, friendly Y units …": the filter before this one is the army-includes
  // condition's own following filter, so this filter still stands alone.
  const conditionsFilter = before?.family_id === "unit-filter" && leaves[at - 2]?.family_id === "army-includes" && leaves[at - 2]!.fragment === leaf.fragment;
  // A select that names the other side ("select one enemy unit." + "Friendly X units' attacks …") does not claim the filter.
  const sides = ["friendly", "enemy"];
  // "That unit" attacking after both stays refused: it could name either group, and no attack fold takes the filter after a select.
  const attackByThatUnit = leaves.slice(at + 1).some((other) => other.fragment === leaf.fragment && other.family_id === "attack" && other.parameters.unit === "that-unit");
  const oppositeSelect = !attackByThatUnit && before?.family_id === "select-unit" && sides.includes(before.parameters.scope as string) && sides.includes(filter.parameters.side as string) && before.parameters.scope !== filter.parameters.side;
  const anchored = before !== undefined && before.fragment === leaf.fragment && !oppositeSelect && (FILTER_ANCHORS.has(before.family_id) || (before.family_id === "unit-filter" && !gateFilter(leaves, at - 1) && !conditionsFilter && !claimedByEmbarkedState(leaves, at, leaf.fragment)));
  return !anchored || filter.parameters.member_of !== undefined ? at : -1;
}

/**
 * A unit-filter a condition before it names as its following filter ("If a friendly X model is your
 * Warlord": the condition's units, which the later effects' units do not share).
 */
export function gateFilter(leaves: readonly CompileLeaf[], index: number): boolean {
  const filter = leaves[index];
  const condition = leaves[index - 1];
  return filter?.family_id === "unit-filter" && condition !== undefined && condition.role === "CONDITION"
    && condition.fragment === filter.fragment && awaitsFollowingFilter(condition.parameters);
}

/**
 * A condition whose units the author named as the unit-filter before it (subject filtered-units
 * written on the leaf), not a value the binder assigned (`antecedent_keys`).
 */
export function namesFilteredUnits(leaf: CompileLeaf | undefined): boolean {
  return leaf !== undefined && leaf.role === "CONDITION" && Object.values(leaf.parameters).includes(FILTERED_UNITS)
    && !(leaf.antecedent_keys ?? []).includes("subject");
}

/**
 * A leaf a bare filter's description runs through on its way to the moment it describes: a
 * condition, a "from your army", or the unit-filter a following-filter distance measures to.
 */
function describes(leaves: readonly CompileLeaf[], at: number, fragment: string | undefined): boolean {
  const leaf = leaves[at];
  if (!leaf || leaf.fragment !== fragment) return false;
  if (leaf.family_id === "unit-owner") return true;
  if (leaf.family_id === "unit-filter") {
    const before = leaves[at - 1];
    return before !== undefined && awaitsFollowingFilter(before.parameters);
  }
  return leaf.role === "CONDITION";
}

/**
 * "an enemy unit" + "engaged with this unit" + "is selected to fight": the index of the ownerless
 * moment that a bare filter, and the conditions between them, describe; null when there is none.
 * The filter is the moment's unit, and each condition is on that unit.
 */
export function momentOfFilter(leaves: readonly CompileLeaf[], filterIndex: number): number | null {
  const filter = leaves[filterIndex];
  if (filter?.family_id !== "unit-filter") return null;
  const before = leaves[filterIndex - 1];
  if (before && before.fragment === filter.fragment && (FILTER_ANCHORS.has(before.family_id) || before.family_id === "unit-filter")) return null;
  let at = filterIndex + 1;
  while (describes(leaves, at, filter.fragment)) at += 1;
  // A condition that names the filter's units outright (subject filtered-units) makes them the units it is about, not the moment's.
  if (leaves.slice(filterIndex + 1, at).some(namesFilteredUnits)) return null;
  const moment = leaves[at];
  // An ownerless moment, or one its filter's own side owns ("an enemy model" + "selects its targets").
  return moment?.family_id === "event" && moment.fragment === filter.fragment && moment.parameters.subject === undefined
    && (moment.parameters.owner === undefined || (filter.parameters.side !== "any" && moment.parameters.owner === filter.parameters.side)) ? at : null;
}

/**
 * The moment's unit a condition between a bare filter and the moment describes, or null: the
 * subject, or, for a destruction the filter names (compile-unit-filters.ts), the destroyed object.
 */
function onMomentUnit(leaves: readonly CompileLeaf[], index: number, sourceText: string | undefined): string | null {
  const leaf = leaves[index]!;
  if (leaf.role !== "CONDITION") return null;
  // Back past the description to the filter it starts with (a filter a following-filter distance
  // measures to is part of the description, so the walk passes it).
  let at = index - 1;
  while (at >= 0 && describes(leaves, at, leaf.fragment)) at -= 1;
  const moment = momentOfFilter(leaves, at);
  if (moment === null || moment <= index) return null;
  // A destruction whose following unit-filter names the destroyer: the moment's unit is that destroyer.
  if (trailingDestroyerFilter(leaves, moment, sourceText) !== null) {
    refuseDestroyedUnitAntecedent(leaves, moment, leaf, sourceText);
    return "event-subject";
  }
  return destroyedObject(leaves[moment], leaves[at]) ? "event-object" : "event-subject";
}

/** "when a friendly X model … is destroyed": a destruction whose object a unit-filter before it names. */
function filterNamesObject(leaves: readonly CompileLeaf[], momentIndex: number): boolean {
  return leaves.some((leaf, at) => at < momentIndex && momentOfFilter(leaves, at) === momentIndex && destroyedObject(leaves[momentIndex], leaf));
}

/**
 * "when a saving throw is failed for a" + "friendly X model": the last roll moment before the leaf
 * whose roll a unit-filter right after it (past "from your army") names, so it introduces a unit.
 */
function rollOwnerBefore(leaves: readonly CompileLeaf[], index: number): boolean {
  const at = leaves.slice(0, index).map((leaf) => leaf.family_id === "event").lastIndexOf(true);
  if (at < 0) return false;
  let next = at + 1;
  while (leaves[next]?.family_id === "unit-owner") next += 1;
  return next < index && rollOwnerEvent(leaves[at], leaves[next]);
}

/**
 * "a friendly model" + "that disembarked from this TRANSPORT this turn" + "makes an attack": the
 * index of the attack a bare filter and the conditions after it describe, or null. The filter is
 * the attacker (compile-unit-filters.ts), and each condition is on the attacking unit.
 */
export function attackOfFilter(leaves: readonly CompileLeaf[], filterIndex: number): number | null {
  const filter = leaves[filterIndex];
  if (filter?.family_id !== "unit-filter") return null;
  const before = leaves[filterIndex - 1];
  if (before && before.fragment === filter.fragment && (FILTER_ANCHORS.has(before.family_id) || before.family_id === "unit-filter")) return null;
  let at = filterIndex + 1;
  while (describes(leaves, at, filter.fragment) && leaves[at]!.family_id !== "unit-filter") at += 1;
  const attack = leaves[at];
  // A back-reference ("If that attack …") is an earlier attack again; a filter before it is never its attacker.
  return at > filterIndex + 1 && attack?.family_id === "attack" && attack.fragment === filter.fragment && attack.parameters.direction === "makes"
    && attack.parameters.backref !== true && attack.parameters.refers === undefined
    && leaves.slice(filterIndex + 1, at).some((leaf) => leaf.role === "CONDITION") ? at : null;
}

/** Leaves after which "that unit" is a selected unit, a for-each pass's unit or an aura's recipient, not a bare filter's. */
const UNIT_INTRODUCERS = new Set(["select-unit", "for-each-unit-select", "aura-range"]);

/**
 * "While a friendly X unit" + "is within range of an objective" + "attacks that target that unit":
 * the index of the attack on that unit a bare filter and the conditions after it describe, or null.
 * The filter is the defender (compile-unit-filters.ts), and each condition is on it. At least one
 * condition about the filter's unit sits between them (still pointing back, or already bound to the
 * target); without one, or after a selection, aura or for-each, "that unit" is that leaf's unit.
 */
export function targetedAttackOfFilter(leaves: readonly CompileLeaf[], filterIndex: number): number | null {
  const filter = leaves[filterIndex];
  if (filter?.family_id !== "unit-filter") return null;
  const before = leaves[filterIndex - 1];
  if (before && before.fragment === filter.fragment && (FILTER_ANCHORS.has(before.family_id) || before.family_id === "unit-filter")) return null;
  if (leaves.slice(0, filterIndex).some((leaf) => UNIT_INTRODUCERS.has(leaf.family_id))) return null;
  let at = filterIndex + 1;
  while (describes(leaves, at, filter.fragment) && leaves[at]!.family_id !== "unit-filter") at += 1;
  const attack = leaves[at];
  const onUnit = (leaf: CompileLeaf) => leaf.role === "CONDITION" && (hasAntecedent(leaf) || Object.values(leaf.parameters).includes("target"));
  return attack?.family_id === "attack" && attack.fragment === filter.fragment && attack.parameters.direction === "targeted" && attack.parameters.unit === "that-unit"
    && leaves.slice(filterIndex + 1, at).some(onUnit) ? at : null;
}

/**
 * "when an enemy unit makes a ranged attack that targets a friendly X unit …, one model … within 3\"
 * of that target": a unit-position's `of` after an attack the record makes, with a unit-filter
 * between them, names the unit that attack targets, not a unit a selection in between picked. The
 * nearest earlier attack must be the one; a second attack in between stops the search.
 */
function attackedUnitBefore(leaves: readonly CompileLeaf[], index: number): boolean {
  const leaf = leaves[index]!;
  if (leaf.family_id !== "unit-position" || leaf.role !== "CONDITION") return false;
  for (let at = index - 1; at >= 0; at -= 1) {
    const other = leaves[at]!;
    if (other.fragment !== leaf.fragment) continue;
    if (other.family_id === "attack") {
      return other.parameters.direction === "makes" && leaves.slice(at + 1, index).some((between) => between.family_id === "unit-filter" && between.fragment === leaf.fragment);
    }
  }
  return false;
}

/** Whether a condition sits between a bare filter and the attack on that filter's unit. */
function onTargeted(leaves: readonly CompileLeaf[], index: number): boolean {
  const leaf = leaves[index]!;
  if (leaf.role !== "CONDITION") return false;
  let at = index - 1;
  while (at >= 0 && describes(leaves, at, leaf.fragment) && leaves[at]!.family_id !== "unit-filter") at -= 1;
  const attack = targetedAttackOfFilter(leaves, at);
  return attack !== null && attack > index;
}

/** Whether a condition sits between a bare filter and the attack they describe. */
function onAttacker(leaves: readonly CompileLeaf[], index: number): boolean {
  const leaf = leaves[index]!;
  if (leaf.role !== "CONDITION") return false;
  let at = index - 1;
  while (at >= 0 && describes(leaves, at, leaf.fragment) && leaves[at]!.family_id !== "unit-filter") at -= 1;
  const attack = attackOfFilter(leaves, at);
  return attack !== null && attack > index;
}

/** Leaves that claim a unit-filter right before them, so it is not an effect's postfix recipient. */
const FILTER_CLAIMANTS = new Set(["aura-range", "event", "attack"]);

/** The wording after a unit-filter (and its owner leaves) up to the next leaf, or undefined when the bytes are unknown. */
function gapAfterFilter(leaves: readonly CompileLeaf[], at: number, sourceText: string | undefined): string | undefined {
  const before = leaves[at - 1];
  const next = leaves[at];
  if (sourceText === undefined || before?.end_byte === undefined || next?.start_byte === undefined) return undefined;
  return Buffer.from(sourceText, "utf8").subarray(before.end_byte, next.start_byte).toString("utf8");
}

/**
 * A back-referring effect after a filter claims it as its own prefix only when a linking verb joins
 * them ("Friendly X units have …"). Other wording ("… K units from your army and add 1 to …") leaves
 * the filter to the effect before it. Without known bytes the claim stands.
 */
const LINKING_VERB = /^\s*(have|has|is|are|can)\b/u;
function linkedToFilter(leaves: readonly CompileLeaf[], at: number, sourceText: string | undefined): boolean {
  const gap = gapAfterFilter(leaves, at, sourceText);
  return gap === undefined || LINKING_VERB.test(gap);
}

/** A destruction by the triggering attacks (family-extensions-17-triggering-destruction.ts). */
function isDestructionActivity(leaf: CompileLeaf): boolean {
  return leaf.family_id === "unit-activity" && ((leaf.parameters.activities as unknown[] | undefined) ?? []).some((activity) => (DESTRUCTION_ACTIVITIES as readonly unknown[]).includes(activity));
}

/**
 * The index of the first leaf after a filter's owner leaves, when the filter sits right after the
 * effect at `index` in the same sentence. A filter in a later sentence ("… is marked. Friendly K units'
 * attacks …") opens that sentence; it never describes the earlier effect.
 */
function afterFilter(leaves: readonly CompileLeaf[], index: number, sourceText?: string): number | undefined {
  const leaf = leaves[index]!;
  const filter = leaves[index + 1];
  if (!ANY_UNIT_KEYS[leaf.family_id] || filter?.family_id !== "unit-filter" || filter.fragment !== leaf.fragment) return undefined;
  if (sourceText !== undefined && leaf.end_byte !== undefined && filter.start_byte !== undefined
    && /[.;!?]/u.test(Buffer.from(sourceText, "utf8").subarray(leaf.end_byte, filter.start_byte).toString("utf8"))) return undefined;
  // "If the enemy WARLORD was destroyed as a result of those attacks": the filter before a destruction verb names what
  // was destroyed (compile-triggering-destruction.ts), so it is no effect's unit.
  const verb = leaves[index + 2];
  if (verb?.fragment === leaf.fragment && isDestructionActivity(verb)) return undefined;
  let at = index + 2;
  while (leaves[at]?.family_id === "unit-owner" && leaves[at]!.fragment === leaf.fragment) at += 1;
  return at;
}

/**
 * "Add 1 to the Strength characteristic of" + "**K** models from your army": an effect whose units
 * a unit-filter right after it names, in the same fragment, when nothing after the filter (past a
 * "from your army") claims it instead.
 */
export function postfixFilter(leaves: readonly CompileLeaf[], index: number, sourceText?: string): boolean {
  const at = afterFilter(leaves, index, sourceText);
  if (at === undefined) return false;
  const leaf = leaves[index]!;
  const next = leaves[at];
  // A back-referring effect after the filter takes it as its own prefix ("Friendly X units have …").
  return !(next && next.fragment === leaf.fragment
    && (FILTER_CLAIMANTS.has(next.family_id) || namesFilteredUnits(next)
      || (next.role === "EFFECT" && Object.values(next.parameters).includes("antecedent") && linkedToFilter(leaves, at, sourceText))));
}

/**
 * An effect with no introducer of its own whose filter a later back-referring effect claims with a
 * linking verb ("Adds 1 to … units. Friendly K units have …" read as one clause). Its anaphor has no
 * unit to point to, so binding it would fall back to this unit.
 */
function claimedByLaterEffect(leaves: readonly CompileLeaf[], index: number, sourceText: string | undefined): boolean {
  const at = afterFilter(leaves, index, sourceText);
  const next = at === undefined ? undefined : leaves[at];
  return next !== undefined && next.fragment === leaves[index]!.fragment && next.role === "EFFECT"
    && Object.values(next.parameters).includes("antecedent") && linkedToFilter(leaves, at!, sourceText);
}

/**
 * The select-unit a set-up names when the selection comes after it ("Redeploy up to three friendly
 * units"): the nearest later select-unit in the same fragment, with only optional-use leaves
 * between. Null for any other leaf, or when no such selection follows.
 */
function selectionFollowsVerb(leaves: readonly CompileLeaf[], index: number): number | null {
  const leaf = leaves[index]!;
  if (leaf.family_id !== "set-up") return null;
  for (let at = index + 1; at < leaves.length; at += 1) {
    const other = leaves[at]!;
    if (other.fragment !== leaf.fragment) return null;
    if (other.family_id === "select-unit") return at;
    if (other.family_id !== "optional-use") return null;
  }
  return null;
}

/**
 * The unit a verb-first set-up binds to: the selection that follows it. Refuses a record it cannot
 * bind unambiguously: a second selection, or an earlier set-up of this unit in the same part
 * (binding to the selection would drop that unit from the set-up).
 */
function verbFirstSelection(leaves: readonly CompileLeaf[], index: number): string {
  const leaf = leaves[index]!;
  if (leaves.filter((other) => other.family_id === "select-unit").length > 1) {
    throw new CompileError(`set-up at byte ${leaf.start_byte}: a second selection makes selected-unit ambiguous.`);
  }
  const earlierSelf = leaves.slice(0, index).some((other) =>
    other.family_id === "set-up" && other.fragment === leaf.fragment && other.parameters.subject === "this-unit");
  if (earlierSelf) {
    throw new CompileError(`set-up at byte ${leaf.start_byte}: an earlier set-up of this unit in the same part makes selected-unit ambiguous with it.`);
  }
  return "selected-unit";
}

/** Whether a unit-filter sits at an index in [from, to). */
function unitFilterBetween(leaves: readonly CompileLeaf[], from: number, to: number): boolean {
  for (let at = from; at < to; at += 1) if (leaves[at]?.family_id === "unit-filter") return true;
  return false;
}

/**
 * Whether an attack earlier in the leaf's fragment names its target by the unit-filter right after it
 * ("makes a ranged attack that targets an enemy unit"): that filter is the defender. Bound before the
 * filters fold (compile-unit-filters.ts), so the filter is still a plain unit-filter here.
 */
function defenderNamedBy(leaves: readonly CompileLeaf[], index: number): boolean {
  const fragment = leaves[index]!.fragment;
  return leaves.slice(0, index).some((other, at) => other.family_id === "attack" && other.parameters.target === "following-filter" && other.fragment === fragment
    && leaves[at + 1]?.family_id === "unit-filter" && leaves[at + 1]!.fragment === fragment);
}

/** An enemy unit-filter right before the anaphor that follows an attack made by this record, which names no target. */
function unnamedAttackFilter(leaves: readonly CompileLeaf[], index: number): boolean {
  const filter = leaves[index - 1];
  const attack = leaves[index - 2];
  return filter?.family_id === "unit-filter" && filter.parameters.side === "enemy" && filter.fragment === leaves[index]!.fragment
    && attack?.family_id === "attack" && attack.parameters.direction === "makes" && attack.parameters.target === undefined && attack.fragment === filter.fragment;
}

/**
 * "Friendly X units are eligible to declare a charge" + "in a turn in which they Advanced": a condition
 * right after an effect whose units a bare unit-filter names tests each of those units, not the record's
 * own unit. Null when no such effect precedes it in its sentence, or its keys cannot name a recipient.
 */
function recipientOfFilteredEffect(leaves: readonly CompileLeaf[], index: number, focus: ((index: number) => string | null) | undefined, sourceText: string | undefined): string | null {
  const leaf = leaves[index]!;
  if (leaf.family_id !== "unit-activity" || leaf.role !== "CONDITION") return null;
  let at = index - 1;
  while (at >= 0 && leaves[at]!.fragment === leaf.fragment && leaves[at]!.role === "CONDITION" && hasAntecedent(leaves[at]!)) at -= 1;
  const effect = leaves[at];
  if (effect === undefined || effect.fragment !== leaf.fragment || effect.role !== "EFFECT" || !hasAntecedent(effect)) return null;
  if (sourceText !== undefined && effect.end_byte !== undefined && leaf.start_byte !== undefined
    && /[.;!?]/u.test(Buffer.from(sourceText, "utf8").subarray(effect.end_byte, leaf.start_byte).toString("utf8"))) return null;
  if (antecedentRole(leaves, at, focus, sourceText) !== FILTERED_UNITS) return null;
  return antecedentKeys(leaf.family_id, leaf.parameters).every((key) => boundValue(leaf, key, AURA_RECIPIENT) !== null) ? AURA_RECIPIENT : null;
}

/** The role an earlier leaf of the record gives an anaphor, in order of precedence. */
function antecedentRole(leaves: readonly CompileLeaf[], index: number, focus?: (index: number) => string | null, sourceText?: string): string | null {
  // "makes a ranged attack that targets an enemy unit visible to the bearer": the unit the attack names after it is the defender.
  if (leaves[index]!.family_id === "visible" && defenderNamedBy(leaves, index)) return "defender";
  // "makes an attack that targets an enemy unit visible to the bearer" written without the target: the enemy filter after
  // the attack would name a unit no attack names, and the anaphor would fall back to this model. Refuse instead.
  if (leaves[index]!.family_id === "visible" && unnamedAttackFilter(leaves, index)) {
    throw new CompileError(`visible at byte ${leaves[index]!.start_byte} points back to a unit the attack before it does not name; the attack has no target.`);
  }
  if (postfixFilter(leaves, index, sourceText)) return FILTERED_UNITS;
  // "… are eligible to declare a charge" + "in a turn in which they Advanced": each unit the effect's filter names.
  const filteredRecipient = recipientOfFilteredEffect(leaves, index, focus, sourceText);
  if (filteredRecipient !== null) return filteredRecipient;
  // "an enemy unit" + "engaged with this unit" + "is selected to fight": the moment's unit.
  const momentUnit = onMomentUnit(leaves, index, sourceText);
  if (momentUnit !== null) return momentUnit;
  // "a friendly model" + "that disembarked this turn" + "makes an attack": the attacking unit.
  if (onAttacker(leaves, index)) return "attacker";
  // "destroyed by an enemy unit" + "that enemy unit": the destroyer, once the refusal in compile-destroying-attack.ts passes.
  // Checked before the Stratagem-target and bare-filter rules, which would otherwise take the antecedent.
  let destroyedAt = -1;
  for (let at = 0; at < index; at += 1) if (momentNamesUnit(leaves, at)) destroyedAt = at;
  // A unit-filter between the destroyer filter and the antecedent is the nearer unit, so the later rules take it.
  if (destroyedAt >= 0 && trailingDestroyerFilter(leaves, destroyedAt, sourceText) !== null && !unitFilterBetween(leaves, destroyedAt + 2, index)) {
    refuseDestroyedUnitAntecedent(leaves, destroyedAt, leaves[index]!, sourceText);
    return "event-subject";
  }
  // "a friendly X unit" + "is within range of an objective" + "attacks that target that unit": the defender.
  if (onTargeted(leaves, index)) return "target";
  // "when a saving throw is failed for a friendly X model within 6\" …, that attack": the model whose roll it is.
  if (rollOwnerBefore(leaves, index)) return "event-subject";
  const earlier = leaves.slice(0, index);
  // "Friendly X units' attacks that target that unit": a filter right before an attack-property
  // scope names whose attacks, even after a selection the rest of the record points to.
  if (leaves[index]!.family_id === "weapon-property-scope" && bareFilter(leaves, index)) return FILTERED_UNITS;
  // "each enemy unit within 6 of your unit …" right after its own filter, in a record that also destroys units by the
  // triggering attacks ("if the enemy WARLORD was destroyed …"): the filter names the units, not the selection.
  if (leaves[index]!.family_id === "unit-position" && leaves[index]!.role === "CONDITION" && bareFilter(leaves, index)
    && leaves[index - 1]?.family_id === "unit-filter" && leaves.some(isDestructionActivity)) return FILTERED_UNITS;
  if (earlier.some((other) => other.family_id === "select-unit")) {
    // "While an enemy unit is infested …, that unit …": a bare filter after the last selection is the nearer unit,
    // unless it is the other unit a condition measures to (a following filter).
    const lastSelect = earlier.map((other) => other.family_id === "select-unit").lastIndexOf(true);
    const filterAt = bareFilterAt(leaves, index);
    const measured = filterAt > 0 && awaitsFollowingFilter(leaves[filterAt - 1]!.parameters);
    return filterAt > lastSelect && !measured ? FILTERED_UNITS : "selected-unit";
  }
  // "Redeploy up to three friendly units": a set-up whose selection comes after it, in the same part.
  if (selectionFollowsVerb(leaves, index) !== null) return verbFirstSelection(leaves, index);
  // "For each enemy unit …, that unit …": each pass's unit, which the DSL's for-each-unit calls its recipient.
  if (earlier.some((other) => other.family_id === "for-each-unit-select")) return AURA_RECIPIENT;
  if (bareFilter(leaves, index)) return FILTERED_UNITS;
  if (earlier.some((other) => other.family_id === "aura-range")) return AURA_RECIPIENT;
  const moment = earlier.filter((_other, at) => momentNamesUnit(leaves, at)).at(-1);
  // In a Stratagem's WHEN clause, "an enemy unit ends a move" + "within 8\" of …": the moment's
  // unit, not the Stratagem's target, which only the later clauses name.
  const inWhen = leaves[index]!.fragment === "WHEN" && moment?.fragment === "WHEN";
  // "Each time a ranged attack is allocated to a model, … that model" in a Stratagem: the allocated model is the
  // moment's object, not the Stratagem's target. A bare filter before the anaphor still wins (checked above).
  const allocation = earlier.filter((other) => other.family_id === "event" && other.parameters.kind === "damage-allocated" && other.fragment === leaves[index]!.fragment).at(-1);
  if (allocation && !inWhen) return "event-object";
  // With several targets, the target in focus (compile-target-refs.ts bindTargetRefs) instead.
  if (!inWhen && leaves.some((other) => STRATAGEM_TARGETS.has(other.family_id))) return focus?.(index) ?? "this-unit";
  // "Each time an attack is allocated to a model, … that model": the unit the moment happens to,
  // which the DSL's damage-allocated trigger holds as its object; its subject is the attacker.
  if (moment) return OBJECT_MOMENTS.has(String(moment.parameters.kind)) || filterNamesObject(leaves, leaves.indexOf(moment)) ? "event-object" : "event-subject";
  return null;
}

/**
 * Keys whose lowering takes any DSL unit-ref, so they can name an aura's recipient or the units a
 * filter matches even though their family's own enum lists neither: effects go through
 * `compile-fragments.ts` target(), conditions through widenedWho. A filter's units are a DSL
 * unit-filter object, which only an effect's target can hold.
 */
const ANY_UNIT_KEYS: Readonly<Record<string, readonly string[]>> = {
  "characteristic-modifier": ["subject"], "weapon-ability-grant": ["subject"], "weapon-ability-range": ["subject"], "keyword-grant": ["subject"], "feel-no-pain": ["subject"],
  "regain-wounds": ["subject"], "return-models": ["subject"], "eligibility-permission": ["subject", "into"], "core-ability-grant": ["subject"],
  "invulnerable-save": ["subject"], "ability-record-grant": ["subject"], "move-through": ["subject"],
  "targeting-restriction": ["by", "target"], "weapon-property-scope": ["subject"], "ignore-modifiers": ["subject"],
  "roll-modifier": ["subject"], reroll: ["subject"], "ability-activate": ["subject"],
  "make-move": ["subject"], "set-up": ["subject"], "apply-mark": ["subject"], test: ["target"],
  "damage-reduction": ["subject"],
  "counts-as": ["subject"],
  "ability-modifier": ["subject"],
  // "**K** units from your army are eligible to shoot and declare a charge in a turn in which they Fell Back": every unit the filter matches.
  "act-after-move": ["subject"],
};
const ANY_UNIT_CONDITION_KEYS: Readonly<Record<string, readonly string[]>> = {
  "unit-state": ["subject", "with"], "unit-activity": ["subject"], "unit-position": ["subject", "of"], "unit-keyword": ["subject"], "hit-by-attacks": ["subject"],
  "in-region": ["subject"], "ability-used": ["subject"],
  targeted: ["subject"], "target-is-selected": ["by", "target"],
  // An owned moment's subject, and who destroyed a unit, go into the trigger as is (compile-triggers.ts).
  event: ["subject", "by"],
  // A selected unit able to embark within a named Transport (compile-transport-embark.ts).
  eligible: ["subject"],
};

/** Units a chosen-option-grant holder can bind to: the menu's own-unit effects are retargeted to it. */
const MENU_HOLDERS = new Set(["this-unit", "this-model", "selected-unit", "event-subject", AURA_RECIPIENT]);

/** Subject-like keys whose values say which of the record's own unit or model it talks about. */
const SELF_KEYS = ["subject", "recipient", "target", "unit", "who", "of", "with", "to"];

/**
 * Outside a Stratagem, an anaphor nothing earlier introduces ("it can be set up anywhere …") is
 * the record's own unit; the model, when the record's other leaves only ever name this model.
 */
function ownRole(leaves: readonly CompileLeaf[]): string {
  const named = new Set(leaves.flatMap((leaf) => SELF_KEYS.map((key) => leaf.parameters[key]).filter((value) => value === "this-unit" || value === "this-model")));
  return named.has("this-model") && !named.has("this-unit") ? "this-model" : "this-unit";
}

/**
 * Whether a key takes any DSL unit-ref, so a filtered set can be bound to it. A rule-state subject
 * is one such key: a suppressed or granted rule lowers to a unit-ref target (compile-fragments.ts
 * target()). `rule-state` stays out of ANY_UNIT_KEYS, since that table also drives postfixFilter,
 * which would claim a unit-filter that follows a rule-state. An aura's recipient does not bind to a
 * rule-state subject: its rule grants would be the wrong mechanic for a region or range count.
 */
function anyUnitKey(leaf: CompileLeaf, key: string): boolean {
  return ANY_UNIT_KEYS[leaf.family_id]?.includes(key) === true || ANY_UNIT_CONDITION_KEYS[leaf.family_id]?.includes(key) === true
    || (leaf.family_id === "rule-state" && key === "subject");
}

/**
 * The value a family records for a bound role, when the family can name it. A recipient of
 * mortal wounds names a selected unit as `that-unit` (`compile-fragments.ts` MORTAL_TARGETS).
 */
function boundValue(leaf: CompileLeaf, key: string, role: string): string | null {
  // visible's subject takes the attack's defender named by the following filter (defenderNamedBy).
  if (role === "defender" && leaf.family_id === "visible" && key === "subject") return role;
  if (isTargetRef(role)) return TARGET_REF_KEYS[leaf.family_id]?.includes(key) ? role : null;
  // "that unit has that ability": the unit whose options the menu before it applies (compile.ts retargets them).
  if (leaf.family_id === "chosen-option-grant") return MENU_HOLDERS.has(role) ? role : null;
  if (role === FILTERED_UNITS) return anyUnitKey(leaf, key) ? role : null;
  if (role === AURA_RECIPIENT) {
    if (ANY_UNIT_KEYS[leaf.family_id]?.includes(key) || ANY_UNIT_CONDITION_KEYS[leaf.family_id]?.includes(key)) return role;
    if (leaf.family_id === "mortal-wounds" && key === "recipient") return role;
    // A family that lists the recipient itself ("each enemy unit … must take a Battle-shock test").
    return keyEnum(reviewedFamily(leaf.family_id, leaf.family_version).parameterSchema, key)?.includes(role) ? role : null;
  }
  const values = keyEnum(reviewedFamily(leaf.family_id, leaf.family_version).parameterSchema, key) ?? [];
  if (values.includes(role)) return role;
  // A selected or triggering unit is a plain DSL unit-ref, which a key lowered as any unit-ref
  // takes even when its family's own enum does not list it.
  if ((role === "selected-unit" || role === "event-subject" || role === "event-object" || role === "attacker")
    && (ANY_UNIT_KEYS[leaf.family_id]?.includes(key) || ANY_UNIT_CONDITION_KEYS[leaf.family_id]?.includes(key))) return role;
  if (leaf.family_id === "mortal-wounds" && role === "selected-unit" && values.includes("that-unit")) return "that-unit";
  return null;
}

/**
 * Bind every `antecedent` to the unit an earlier leaf of the record introduced: the selected
 * unit when a selection precedes the leaf; else the units a unit-filter right before it matches
 * (an army-wide grant); else the unit a preceding aura reaches (its recipient); else, in a
 * Stratagem, its target (this-unit, or with several targets the one `focus` names for the leaf); else the unit of a preceding event whose moment names a unit
 * (the triggering unit); else, outside a Stratagem, the record's own unit (or model). A Stratagem leaf with none of these, or a leaf
 * whose family cannot name the unit it binds to, refuses compilation. Later lowering only sees
 * the bound roles.
 */
export function bindAntecedents(leaves: readonly CompileLeaf[], focus?: (index: number) => string | null, sourceText?: string): CompileLeaf[] {
  // "the TRANSPORT this model is embarked within": a Stratagem has no bearer, so it has no such Transport.
  const transport = isStratagem(leaves) ? leaves.find((leaf) => leaf.parameters.subject === "bearer-transport" || leaf.parameters.within_origin === "bearer-transport") : undefined;
  if (transport) throw new CompileError(`${transport.family_id} at byte ${transport.start_byte} names the Transport its bearer is embarked within, but a Stratagem has no bearer.`);
  return leaves.map((leaf, index) => {
    // A filter's membership ("that unit's Character models", written by groupMembership) names the
    // moment's unit, never the filter's own units, which bareFilter must still read as the filter.
    if (leaf.family_id === "unit-filter" && leaf.parameters.member_of === ANTECEDENT) {
      return { ...leaf, parameters: { ...leaf.parameters, member_of: momentUnitRole(leaves, index, sourceText) } };
    }
    const keys = antecedentKeys(leaf.family_id, leaf.parameters);
    if (keys.length === 0) return leaf;
    const introduced = antecedentRole(leaves, index, focus, sourceText);
    if (introduced === null && !isStratagem(leaves) && claimedByLaterEffect(leaves, index, sourceText)) {
      throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} points back to a unit (${ANTECEDENT}), but the unit-filter after it belongs to a later effect and no earlier leaf names it.`);
    }
    if (introduced === null && isStratagem(leaves)) {
      throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} points back to an earlier unit (${ANTECEDENT}), but no earlier leaf selects a unit, targets a Stratagem or names a unit's moment.`);
    }
    // An anaphor no adjacent leaf introduces, after a unit-filter that names designated units (the
    // affected units of a Bondsman): "it" in "While a model is affected by this ability, it is eligible to
    // declare a charge in a turn in which it Advanced" means one of those units, not this unit. Falling back
    // to this unit would test the wrong unit, so refuse.
    if (introduced === null && leaf.role !== "DURATION" && leaves.slice(0, index).some((other, at) => other.family_id === "unit-filter" && other.parameters.designated !== undefined && !gateFilter(leaves, at))) {
      throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} points back to a unit (${ANTECEDENT}), but the only unit it can mean is the one a designated unit-filter before it names, and no leaf binds it to that.`);
    }
    // A weapon-ability range names the units an earlier unit-filter or selection introduced. Without one,
    // the record's own unit is not what the text means, so refuse rather than default to it.
    if (introduced === null && leaf.family_id === "weapon-ability-range") {
      throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} points back to a unit (${ANTECEDENT}), but no earlier unit-filter or selection before it names one.`);
    }
    // "While an enemy unit is within Engagement Range of this unit": a condition on the units a
    // bare filter matches holds when any of them meets it. When a later leaf also points back
    // ("If a friendly X unit is …, that unit …"), the condition is per recipient instead: each
    // unit the effect's filter matches receives it only while that unit meets the condition.
    // Only a later antecedent in the condition's own sentence counts: a later sentence's "that unit" belongs to its own filter.
    const places = introduced === FILTERED_UNITS && leaf.role === "CONDITION" ? placements(leaves, sourceText) : undefined;
    const perRecipient = places !== undefined && leaves.some((other, at) => at > index && hasAntecedent(other) && other.fragment === leaf.fragment && places[at]!.sentence === places[index]!.sentence);
    const parameters = { ...leaf.parameters };
    for (const key of keys) {
      if (perRecipient) {
        if (boundValue(leaf, key, AURA_RECIPIENT) === null) throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} tests each unit a later effect's filter matches, which its ${key} cannot name.`);
        parameters[key] = AURA_RECIPIENT;
        continue;
      }
      // The record's own unit is the unit or its model, whichever the family can name here.
      const own = ownRole(leaves);
      // "within 3\" of that target" after the attack that targets it: the attacked unit, whatever a selection picked.
      const role = key === "of" && attackedUnitBefore(leaves, index) ? "target"
        : introduced ?? (boundValue(leaf, key, own) === null ? (own === "this-unit" ? "this-model" : "this-unit") : own);
      const value = boundValue(leaf, key, role);
      if (value === null) throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} points back to the ${role}, which its ${key} cannot name.`);
      parameters[key] = value;
    }
    if (leaf.family_id === "unit-state" && leaf.parameters.with === ANTECEDENT) refuseUnboundWith(leaves, index, parameters, sourceText);
    // The keys this binding filled in, so a later lowering can tell "that unit" from an authored subject.
    return { ...leaf, parameters, antecedent_keys: keys };
  });
}

/**
 * The unit a moment names for a membership ("that unit's Character models"): the nearest earlier
 * moment naming a unit. A destruction without a destroyer names the object; others name the subject.
 */
function momentUnitRole(leaves: readonly CompileLeaf[], index: number, sourceText: string | undefined): string {
  let at = -1;
  for (let other = 0; other < index; other += 1) if (momentNamesUnit(leaves, other)) at = other;
  if (at < 0) throw new CompileError(`${leaves[index]!.family_id} at byte ${leaves[index]!.start_byte} points back to an earlier unit (${ANTECEDENT}), but no earlier leaf selects a unit, targets a Stratagem or names a unit's moment.`);
  const moment = leaves[at]!.parameters;
  if (trailingDestroyerFilter(leaves, at, sourceText) !== null) {
    refuseDestroyedUnitAntecedent(leaves, at, leaves[index]!, sourceText);
    return "event-subject";
  }
  const object = OBJECT_MOMENTS.has(String(moment.kind)) || ((moment.kind === "unit-destroyed" || moment.kind === "model-destroyed") && moment.by === undefined);
  return object ? "event-object" : "event-subject";
}

/** Families whose leaf introduces a unit a later "that unit" can name: a selection, a moment or a filter. */
const INTRODUCING_FAMILIES = new Set(["select-unit", "stratagem-target", "event", "unit-filter"]);

/**
 * A unit-state "engaged with that unit" binds only when the state's subject is another unit and
 * the same sentence introduces the unit it names. Otherwise the DSL would read the state as
 * engagement with the subject itself, with the unit an enemy filter names, or with a unit that a
 * different sentence introduced. Those are refused rather than lowered.
 */
function refuseUnboundWith(leaves: readonly CompileLeaf[], index: number, bound: Record<string, unknown>, sourceText: string | undefined): void {
  const leaf = leaves[index]!;
  if (bound.subject === bound.with) {
    throw new CompileError(`unit-state at byte ${leaf.start_byte} engages ${ANTECEDENT} with the same unit as its subject (${String(bound.with)}); the DSL cannot name a second unit for it.`);
  }
  const places = placements(leaves, sourceText);
  const sentence = places[index]!.sentence;
  if (!leaves.some((other, at) => at < index && places[at]!.sentence === sentence && INTRODUCING_FAMILIES.has(other.family_id))) {
    throw new CompileError(`unit-state at byte ${leaf.start_byte} names a unit introduced outside this sentence, which the DSL cannot bind.`);
  }
}

/** Whether any parameter of a leaf still points back to an earlier unit. */
export function hasAntecedent(leaf: CompileLeaf): boolean {
  return antecedentKeys(leaf.family_id, leaf.parameters).length > 0;
}
