import type { CompileOptions } from "./compile.js";
import { exactSpan } from "./contracts.js";
import { AURA_RECIPIENT, momentNamesUnit } from "./compile-antecedent.js";
import { inheritAttackFrames } from "./compile-attack-continuation.js";
import { isBackref } from "./compile-attack-backref.js";
import { groupPermissionAttacks } from "./compile-permission-attacks.js";
import { effect, type CompileLeaf } from "./compile-fragments.js";
import { ATTACK_EVENTS, condition } from "./compile-conditions.js";
import { bindDurations, CONFLICTING_DURATIONS, NO_ROLL_PLUS_SIX } from "./compile-durations.js";
import { triggerMoveEnd } from "./compile-move-end.js";
import { attachMoveEndNearest, bindEngagedPermissions, isBonusNode } from "./compile-move-end-nearest.js";
import { defenderBoundBefore } from "./compile-attack-frame.js";
import { attackFold, isAttackMoment, triggerWindow } from "./compile-attack-window.js";
import { prohibitedRollName } from "./compile-roll-prohibition.js";
import type { PartFrame } from "./compile-part-classify.js";
import { isAdvanceInPlace, PROHIBITIONS, resolveInstead } from "./compile-part-instead.js";

type Node = Record<string, unknown>;

/** One effect as planned: its leaf, its compiled node, the gates on it, whether it is limited to the selected unit, and whether an "instead" made it a replacement. */
export type PlannedEffect = { index: number; leaf: CompileLeaf; node: Node; gate: Node[]; selected: boolean; replaces: boolean };

/**
 * Who makes an attack: a unit-filter folded onto it (compile-unit-filters.ts), any friendly or
 * enemy unit, this model, the aura's recipient or this unit. "That unit" is the unit an earlier
 * leaf introduced: the aura's recipient, else the selected unit, else this unit (a led unit).
 */
function attackerOf(attack: CompileLeaf, thatUnit: string): Node | string {
  if (attack.parameters.attacker_filter !== undefined) return structuredClone(attack.parameters.attacker_filter as Node);
  const unit = attack.parameters.unit;
  if (unit === "friendly-unit") return { owner: "friendly" };
  if (unit === "enemy-unit") return { owner: "enemy" };
  if (unit === "that-unit") return thatUnit;
  return unit === "this-model" ? "this-model" : unit === "recipient" ? "recipient" : "this-unit";
}

/**
 * Compiles each effect of a part with the gates its scope binds, then settles what reshapes the
 * planned effects: result-band moments, durations, reserves arrivals, move ends, "instead" and
 * the no-advance-roll folds. Refusals collect in the frame's `errors`.
 */
export function planEffects(frame: PartFrame, sourceText: string | undefined, options: CompileOptions) {
  const {
    list, places, errors, attempt, containerNodes, consumedByContainer, attached, selections, auraLeaf, sentenceGates, clauseGates, attachedGates,
    endClauses, selectedGlobally, selectedSentences, selectedClauses, optionalSpends, inBand, bandTriggers, durations, durationAt, triggers,
    triggerIndexes, moveEnds, combinators,
  } = frame;
  // "a model in that unit makes an attack": the aura's recipient, else the selected unit, else the
  // unit of the moment the ability fires on, else this unit (a led unit).
  const unitMoment = list.some((leaf, at) => momentNamesUnit(list, at) && !ATTACK_EVENTS.has(String(leaf.parameters.kind)));
  const thatUnit = auraLeaf ? AURA_RECIPIENT : selections.length ? "selected-unit" : unitMoment ? "event-subject" : "this-unit";
  const planned: PlannedEffect[] = [];
  list.forEach((leaf, index) => {
    if (consumedByContainer.has(index)) return;
    if (leaf.role !== "EFFECT") return;
    const { sentence, clause } = places[index]!;
    const node = containerNodes.has(index) ? containerNodes.get(index)! : attempt(() => {
      // Find the current attack and event frames without copying the preceding leaves.
      let attack: CompileLeaf | undefined;
      let currentMoment: CompileLeaf | undefined;
      for (let before = index - 1; before >= 0 && (!attack || !currentMoment); before--) {
        const candidate = list[before]!;
        if (!attack && candidate.family_id === "attack" && !isBackref(candidate)) attack = candidate;
        if (!currentMoment && candidate.role === "EVENT") currentMoment = candidate;
      }
      return effect(leaf, {
        attached,
        attacker: attack && attack.parameters.direction === "makes" ? attackerOf(attack, thatUnit) : null,
        // A defender-bound unit-filter before the roll makes the roll the attacker's, unless an
        // attack this unit makes says otherwise.
        incoming: attack?.parameters.direction === "targeted" || (attack?.parameters.direction !== "makes" && defenderBoundBefore(list, index)),
        // An allocation moment before the effect ("Each time an attack … is allocated to a model in that unit"):
        // the attack a makes-attack names is the one allocated to the bearer's unit (compile-fragments.ts attackOwner).
        defended: currentMoment?.family_id === "event" && currentMoment.parameters.kind === "damage-allocated",
        allocatedToModel: currentMoment?.parameters.object === "this-model",
      });
    });
    if (!node) return;
    planned.push({
      index, leaf, node,
      gate: optionalSpends.has(leaf) ? sentenceGates.get(sentence) ?? [] : [...(sentenceGates.get(sentence) ?? []), ...(attachedGates.get(index) ?? []), ...(isBonusNode(node) && endClauses.has(clause) ? [] : clauseGates.get(clause) ?? [])],
      selected: selectedGlobally || selectedSentences.has(sentence) || selectedClauses.has(clause),
      replaces: false,
    });
  });
  attempt(() => groupPermissionAttacks(list, planned));
  // A moment inside a result band holds the effects after it in its sentence as one part of that band's outcome.
  for (const [momentAt, effectAt] of inBand) {
    const members = planned.filter((item) => effectAt.includes(item.index));
    if (members.length === 0) {
      errors.push("A moment inside a result band has no effect it can hold.");
      continue;
    }
    if (members.some((item) => JSON.stringify(item.gate) !== JSON.stringify(members[0]!.gate))) {
      errors.push("The effects after a moment inside a result band take different conditions; they have no common reading.");
      continue;
    }
    const moments = bandTriggers.get(momentAt) ?? [];
    const inner = members.map((item) => item.node);
    const part: Node = { type: "ability-part", trigger: moments.length === 1 ? moments[0]! : moments, effect: inner.length === 1 ? inner[0]! : { type: "sequence", steps: inner } };
    const first = members[0]!;
    planned.splice(planned.indexOf(first), 1, { ...first, node: part });
    for (const item of members.slice(1)) planned.splice(planned.indexOf(item), 1);
  }
  // "…, subtract 1 from the Wound roll as well": the earlier sentence's attacks (compile-attack-continuation.ts).
  attempt(() => inheritAttackFrames(list, places, planned, sourceText, condition));
  // A move-end nearest or a replacing move-must-end is an effect in its own right (it changes the move).
  const movesEnd = list.some((leaf) => leaf.family_id === "move-end-nearest" || (leaf.family_id === "move-must-end" && leaf.parameters.replaces === true));
  if (list.every((leaf) => leaf.role !== "EFFECT") && !movesEnd) errors.push("There is no effect leaf to compile.");
  // Several printed durations: each effect takes its clause's duration, else its sentence's (compile-durations.ts).
  // Bound before the "instead" fold below, which removes an effect and moves its duration to the one it folds into.
  // A per-attack duration inside a phase window folds into the phase when an attack moment ends it (compile-attack-window.ts).
  let fold = attackFold(durations, triggerWindow(list), triggers.some(isAttackMoment));
  if (fold === "refused") errors.push(CONFLICTING_DURATIONS);
  // One duration printed in a later paragraph than an effect ("… have Fights First.\r**Additional Effect:** Until the
  // end of the turn, …") is that paragraph's own, so it binds as one of several would and leaves the earlier effect
  // without it. Only in a record with no moment: after a moment or a selection, the duration is that use's lifetime;
  // and a later sentence on the same line ("; instead, until …", "If it does, until …") still continues the earlier one.
  const lateAt = durationAt[0];
  const lateDuration = durations.length === 1 && lateAt !== undefined && sourceText !== undefined && list.every((leaf) => leaf.role !== "EVENT")
    && list.some((leaf, index) => leaf.role === "EFFECT" && places[index]!.sentence < places[lateAt]!.sentence && leaf.fragment === list[lateAt]!.fragment
      && leaf.end_byte !== undefined && /[\r\n]/u.test(exactSpan(sourceText, leaf.end_byte, list[lateAt]!.start_byte)));
  const split = fold === null && (new Set(durations).size > 1 || lateDuration);
  const firstEffectAt = list.findIndex((leaf) => leaf.role === "EFFECT");
  const leadingAt = [...new Set(triggerIndexes.filter((index) => firstEffectAt === -1 || index < firstEffectAt))];
  const binding = split ? bindDurations(list, places, durationAt, planned.map((item) => item.index), leadingAt, sourceText) : null;
  if (binding?.error) errors.push(binding.error);
  const boundDuration = new Map<number, string>(binding?.effects ?? []);
  const windows = binding?.windows ?? new Map<number, string>();
  // A set-up moment beside another moment, scoping a set-up effect after it (the Deep Strike shape, 8879 and 994),
  // has no reading: the effect's scope would be one of two moments. A set-up moment that is only a trigger stays as it was.
  if (leadingAt.length >= 2 && leadingAt.some((index) => list[index]!.family_id === "event" && list[index]!.parameters.kind === "set-up"
    && planned.some((item) => item.node.type === "set-up" && item.index > index))) {
    errors.push("A set-up moment next to another moment has no reading yet.");
  }
  // A window (W1) is shared by every leading moment: each one has the same printed duration before it, or none does.
  const windowDurations = [...new Set(leadingAt.map((index) => windows.get(index)))];
  if (windows.size > 0 && (leadingAt.some((index) => !windows.has(index)) || windowDurations.length > 1)) errors.push(CONFLICTING_DURATIONS);
  const window: string | null = windows.size > 0 && windowDurations.length === 1 ? windowDurations[0]! : null;
  // "Can make an ingress move in your next Movement phase": the set-up before it returns then. A set-up
  // earlier in the same sentence wins; failing that, the first set-up after it in its sentence (1339's
  // "Remove your unit from the battlefield" is a different sentence from its battlefield set-up).
  for (const [index, leaf] of list.entries()) {
    // An arrival inside a container option is paired by that option's own compile (nestedPart), which sees the option's earlier sentences.
    if (leaf.family_id !== "reserves-arrival" || consumedByContainer.has(index)) continue;
    const sentence = places[index]!.sentence;
    const setUps = planned.filter((item) => item.node.type === "set-up");
    // A set-up inside a named-option container of the same sentence ("choose one: set up …; or …") is
    // reached through the container's node, so the arrival binds the set-up node the option holds.
    // The option's own set-up leaf must sit in the arrival's sentence, after its container.
    const nested = planned.filter((item) => item.node.type !== "set-up" && item.index < index).flatMap((item) => setUpsWithin(item.node).map((node) => ({ index: item.index, node })));
    const nestedSetUp = nested.at(-1);
    const nestedSentence = nestedSetUp !== undefined && list.some((other, at) => at > nestedSetUp.index && at < index && other.family_id === "set-up" && places[at]!.sentence === sentence);
    const setUp = setUps.filter((item) => item.index < index && places[item.index]!.sentence === sentence).at(-1)
      ?? setUps.find((item) => item.index > index && places[item.index]!.sentence === sentence)
      ?? setUps.filter((item) => item.index < index).at(-1)
      ?? (nestedSentence ? nestedSetUp : undefined);
    if (!setUp) { errors.push("A reserves arrival has no set-up before it."); continue; }
    const modifier = setUp.node.modifier as Node;
    modifier.arrives = "next-movement-phase";
    if (leaf.parameters.allow_first_round === true) modifier.allow_first_round = true;
  }
  const endNearestEntry = (at: number, node: Node): PlannedEffect => ({
    index: at, leaf: list[at]!, node, gate: [...(sentenceGates.get(places[at]!.sentence) ?? []), ...(clauseGates.get(places[at]!.clause) ?? [])],
    selected: selectedGlobally || selectedSentences.has(places[at]!.sentence) || selectedClauses.has(places[at]!.clause), replaces: false,
  });
  errors.push(...attachMoveEndNearest(list, planned, (at) => places[at]!.sentence, (at) => [...(sentenceGates.get(places[at]!.sentence) ?? []), ...(clauseGates.get(places[at]!.clause) ?? [])], endNearestEntry, sourceText, options.selectedObjective, consumedByContainer));
  errors.push(...bindEngagedPermissions(planned));
  for (const rule of moveEnds) {
    // "Can end that move more than 6\" … (instead of more than 8\")" replaces the usual threshold of the move the trigger names, not one a make-move makes.
    if (rule.replaces && list.some((leaf) => leaf.family_id === "make-move")) { errors.push("A move-must-end that replaces the usual threshold has no DSL form with a make-move in its ability."); continue; }
    const move = planned.filter((item) => item.index < rule.index && item.node.type === "move").at(-1);
    // A bonus move in the same sentence takes a move-end or a feasibility proviso that follows it.
    const bonus = move ? undefined : planned.filter((item) => item.index < rule.index && isBonusNode(item.node) && places[item.index]!.sentence === places[rule.index]!.sentence).at(-1);
    if (bonus && rule.cannot) { errors.push("\"Cannot end that move\" after a move bonus has no DSL form."); continue; }
    if (!move && !bonus) {
      // "…, and cannot end that move within Engagement Range of them" after the trigger's move, or "must end that charge move …"
      // after a declared charge: no make-move in the ability (compile-move-end.ts decides which trigger it takes).
      const bytes = sourceText === undefined ? null : Buffer.from(sourceText, "utf8");
      const stopBetween = (from: number, to: number) => bytes !== null && /[.;:]/u.test(bytes.subarray(list[from]!.end_byte!, list[to]!.start_byte).toString("utf8"));
      const end = triggerMoveEnd(list, rule, planned.map((item) => ({ index: item.index, node: item.node })), stopBetween, (leaf) => attempt(() => condition(leaf)));
      if ("error" in end) { errors.push(end.error); continue; }
      const { sentence, clause } = places[rule.index]!;
      const at = planned.findIndex((item) => item.index > rule.index);
      const entry = { index: rule.index, leaf: list[rule.index]!, node: end.node, gate: [...(sentenceGates.get(sentence) ?? []), ...(clauseGates.get(clause) ?? [])], selected: selectedGlobally || selectedSentences.has(sentence) || selectedClauses.has(clause), replaces: false };
      // The rule is an effect of its clause, so it takes that clause's duration like any planned effect.
      if (split) {
        const bound = bindDurations(list, places, durationAt, [rule.index], [], sourceText);
        if (bound.error) errors.push(bound.error);
        for (const [item, name] of bound.effects) boundDuration.set(item, name);
      }
      if (at === -1) planned.push(entry); else planned.splice(at, 0, entry);
      continue;
    }
    if (rule.moveTypes) { errors.push("\"Must end that move\" with move types has no DSL form after a make-move."); continue; }
    if (rule.conditions.length === 0) { errors.push("\"Must end that move\" names no condition for where the move ends."); continue; }
    const nodes = rule.conditions.map((at) => attempt(() => condition(list[at]!))).filter((node): node is Node => node !== null);
    if (nodes.length !== rule.conditions.length) continue;
    const where: Node = nodes.length === 1 ? nodes[0]! : { operator: rule.match === "any" ? "or" : "and", operands: nodes };
    // "Cannot end that move …": the move ends anywhere the named place is not.
    // The bonus's own end condition is its feasibility proviso as well: the bonus is available only if
    // a move can end there, and a move that takes it must end there.
    ((move ?? bonus)!.node.modifier as Node).ends_when = rule.cannot ? { operator: "not", operands: [where] } : where;
  }

  resolveInstead(frame, planned, boundDuration, sourceText);

  // A roll prohibition with no instead to replace it, or a dice roll in its own sentence, has no DSL form.
  for (const item of planned.filter((entry) => entry.leaf.family_id === "roll-prohibition")) {
    const sentence = places[item.index]!.sentence;
    const rolled = list.some((leaf, at) => leaf.family_id === "dice-roll" && places[at]!.sentence === sentence);
    errors.push(rolled
      ? "A roll prohibition shares its sentence with a dice roll; retire the dice roll it forbids."
      : `"Do not roll ${prohibitedRollName(item.leaf.parameters.roll)}" has no "instead" saying what happens in its place.`);
  }
  planned.splice(0, planned.length, ...planned.filter((entry) => entry.leaf.family_id !== "roll-prohibition"));

  // An optional spend comes before the effects of its ability, so a clause that reads its designation (an "instead") sees it set.
  if (optionalSpends.size > 0) {
    const spends = planned.filter((item) => optionalSpends.has(item.leaf));
    planned.splice(0, planned.length, ...spends, ...planned.filter((item) => !optionalSpends.has(item.leaf)));
  }

  // "Do not make an Advance roll" followed directly by "add 6\" to Move" (no moment between, no "instead"): the no-roll
  // moves that far in place of the roll, so the +6 (or +8) is that same move and folds into it. The fold needs the same unit and
  // gate on both; otherwise the +6 would stack on the no-roll's move (its own move on another unit, or a gated +6).
  for (const previous of planned.filter((item) => PROHIBITIONS.has(item.leaf.family_id))) {
    const next = planned.filter((item) => item.index > previous.index).at(0);
    if (!next || !isAdvanceInPlace(next.node)) continue;
    if (triggerIndexes.some((moment) => moment > previous.index && moment < next.index)) continue;
    if (combinators.some((combinator) => places[combinator]!.clause === places[next.index]!.clause)) continue;
    if (next.node.target !== previous.node.target || next.gate.length > 0 || next.selected !== previous.selected) {
      errors.push(NO_ROLL_PLUS_SIX);
      continue;
    }
    const folded = boundDuration.get(next.index);
    const kept = boundDuration.get(previous.index);
    if (folded !== undefined && kept !== undefined && folded !== kept) errors.push(CONFLICTING_DURATIONS);
    else if (folded !== undefined && kept === undefined) boundDuration.set(previous.index, folded);
    boundDuration.delete(next.index);
    (previous.node.modifier as Node).advance = `fixed-${Number((next.node.modifier as Node).value)}`;
    planned.splice(planned.indexOf(next), 1);
  }
  return { planned, fold, split, boundDuration, window };
}

/** Every set-up node inside a planned node, depth-first, in source order of the tree. */
function setUpsWithin(node: unknown): Node[] {
  if (node === null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((item) => setUpsWithin(item));
  const record = node as Node;
  return [...(record.type === "set-up" ? [record] : []), ...Object.values(record).flatMap((value) => setUpsWithin(value))];
}
