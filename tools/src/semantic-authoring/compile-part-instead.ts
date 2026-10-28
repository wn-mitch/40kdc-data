import { chooseBetweenGroups } from "./compile-choice-groups.js";
import { type CompileLeaf } from "./compile-fragments.js";
import { allOf, negate } from "./compile-conditions.js";
import { CONFLICTING_DURATIONS, NO_ROLL_AFTER_ADVANCE } from "./compile-durations.js";
import { isRollMarker } from "./compile-dice.js";
import { replaceProhibitedRoll, selectedMoveRestrictionReplacing } from "./compile-roll-prohibition.js";
import { crossFamilyCandidates, inheritBand, replaceAcrossFamilies, tradesSuppressedRule } from "./compile-cross-family-instead.js";
import { inheritAttackFrame, namesBearer } from "./compile-instead-scope.js";
import type { PartFrame } from "./compile-part-classify.js";
import type { PlannedEffect } from "./compile-part-plan.js";

type Node = Record<string, unknown>;

/** Effects that forbid something; an "instead" after one says what happens in its place. */
export const PROHIBITIONS = new Set(["no-advance-roll"]);

/** A gate that tests an Advance already made ("if it Advanced this turn"): no moment where a roll can still be skipped. */
const testsMadeAdvance = (gates: Node[]) => gates.some((gate) => /"type":"happened"[^]*"move_types":\[[^\]]*"advance"/.test(JSON.stringify(gate)));

/** The Move an Advance with no roll adds in place of the roll: the core 6", or 8" (the DSL's move-modifier advance). */
const FIXED_ADVANCES = new Set([6, 8]);

export function isAdvanceInPlace(node: Node): boolean {
  const modifier = node.modifier as Node | undefined;
  return node.type === "stat-modifier" && node.target !== "attacker" && modifier?.stat === "M" && modifier.operation === "add"
    && FIXED_ADVANCES.has(Number(modifier.value)) && modifier.weapons === undefined;
}


/**
 * Resolves each combinator of a part over its planned effects: an "Or:" stretch becomes one
 * choice, and an "instead" makes its clause's effect replace the effect (or group) it names.
 * Planned effects and bound durations change in place; refusals collect in the frame's `errors`.
 */
export function resolveInstead(frame: PartFrame, planned: PlannedEffect[], boundDuration: Map<number, string>, sourceText: string | undefined): void {
  const { list, places, errors, combinators, triggerIndexes, optionalSpends, global } = frame;
  // Where an "Or:" group ends: another combinator, or a moment after the first effect (a later part).
  const leadingEffect = list.findIndex((leaf) => leaf.role === "EFFECT");
  const choiceBoundaries = [...combinators, ...triggerIndexes.filter((index) => leadingEffect !== -1 && index > leadingEffect)];
  // The "Or:" markers of one stretch (no other combinator or later moment between them) make one choice.
  const choices = new Set(combinators.filter((index) => list[index]!.parameters.choice === true));
  const choiceLimits = choiceBoundaries.filter((index) => !choices.has(index));
  const handledChoices = new Set<number>();
  for (const combinator of combinators) {
    if (choices.has(combinator)) {
      if (handledChoices.has(combinator)) continue;
      const lower = Math.max(-1, ...choiceLimits.filter((index) => index < combinator));
      const upper = Math.min(Number.POSITIVE_INFINITY, ...choiceLimits.filter((index) => index > combinator));
      const markers = combinators.filter((index) => choices.has(index) && index > lower && index < upper);
      for (const index of markers) handledChoices.add(index);
      // A bound duration would sit inside the choice's options, which the choice does not carry (no split form yet).
      if (planned.some((item) => item.index > lower && item.index < upper && boundDuration.has(item.index))) errors.push(CONFLICTING_DURATIONS);
      else {
        const problem = chooseBetweenGroups(planned, markers, choiceLimits);
        if (problem) errors.push(problem);
      }
      continue;
    }
    const clause = places[combinator]!.clause;
    const own = planned.filter((item) => places[item.index]!.clause === clause && !optionalSpends.has(item.leaf));
    // "(instead of more than 8\")" after a move-end that replaces the usual threshold: the move-end leaf consumes
    // the instead, which replaces nothing. Any other effect in the clause is kept as it is; two or more are refused.
    const endsInstead = (leaf: CompileLeaf) => (leaf.family_id === "move-end-nearest" && leaf.parameters.instead_of !== undefined)
      || (leaf.family_id === "move-must-end" && leaf.parameters.replaces === true);
    if (list.some((leaf, at) => endsInstead(leaf) && places[at]!.clause === clause)) {
      const others = own.filter((item) => !endsInstead(item.leaf));
      if (others.length > 1) errors.push(`"Instead" needs exactly one effect besides the move-end in its clause; found ${others.length}.`);
      continue;
    }
    // "Do not roll to gain a point, you gain a point instead" (a named ability's own roll): the prohibition shares the
    // clause with the effect that replaces it, so the clause holds two effects and the other one is the replacement.
    const abilityProhibition = own.length === 2 && own.some((item) => item.leaf.family_id === "roll-prohibition" && typeof item.leaf.parameters.roll === "object");
    // "This unit does not have K, but instead, … and …": the loss of a rule is traded for what follows it, and the
    // trade has no condition of its own, so the effects after "instead" apply beside the loss (compile-cross-family-instead.ts).
    if (list[combinator]!.parameters.choice !== true && tradesSuppressedRule(planned, places, combinator)) continue;
    const candidates = abilityProhibition ? own.filter((item) => item.leaf.family_id !== "roll-prohibition") : own;
    if (candidates.length !== 1) {
      errors.push(`"Instead" needs exactly one effect in its clause; found ${own.length}.`);
      continue;
    }
    const replacement = candidates[0]!;
    // "Add 1 to S and 3 to Range. While …, add 2 to S and 6 to Range instead": the instead replaces the earlier
    // sentence's effects as a group, so each effect under the same condition in the instead sentence is a replacement
    // and each effect of the sentence before is a default that holds only when the condition does not.
    const sameGate = (item: PlannedEffect) => JSON.stringify(item.gate) === JSON.stringify(replacement.gate);
    const siblings = planned.filter((item) => item !== replacement && item.index < replacement.index && !item.replaces && !(abilityProhibition && item.leaf.family_id === "roll-prohibition")
      && places[item.index]!.sentence === places[replacement.index]!.sentence && sameGate(item) && !optionalSpends.has(item.leaf));
    // "…, instead of up to two" names the default it replaces after the word, so there is no earlier group to find.
    const namesDefault = sourceText !== undefined && /^\s*of\b/u.test(Buffer.from(sourceText, "utf8").subarray(list[combinator]!.end_byte).toString("utf8"));
    if (siblings.length > 0 && list[combinator]!.parameters.choice !== true && !namesDefault) {
      const group = [...siblings, replacement];
      const sentence = places[replacement.index]!.sentence;
      const before = planned.filter((item) => item.index < group[0]!.index && !item.replaces && !optionalSpends.has(item.leaf)
        && places[item.index]!.sentence < sentence);
      const defaultSentence = before.length > 0 ? Math.max(...before.map((item) => places[item.index]!.sentence)) : null;
      const defaults = before.filter((item) => places[item.index]!.sentence === defaultSentence);
      const families = new Set(group.map((item) => item.leaf.family_id));
      const alternative = allOf(replacement.gate.filter((node) => !isRollMarker(node)));
      if (defaults.length === 0 || defaults.some((item) => !families.has(item.leaf.family_id))) {
        errors.push(`"Instead" over ${group.length} effects needs the sentence before it to hold the effects it replaces.`);
        continue;
      }
      if (!alternative) {
        errors.push(`"Instead" needs a condition in its clause saying when ${replacement.leaf.family_id} is replaced.`);
        continue;
      }
      if (group.some((item) => boundDuration.has(item.index)) !== defaults.some((item) => boundDuration.has(item.index))) {
        errors.push(CONFLICTING_DURATIONS);
        continue;
      }
      for (const item of defaults) item.gate = [...item.gate, negate(alternative)];
      const bands = defaults.map((item) => item.gate.filter(isRollMarker));
      const band = bands[0]!;
      if (band.length === 1 && bands.every((other) => JSON.stringify(other) === JSON.stringify(band))) {
        for (const item of group) if (!item.gate.some(isRollMarker)) item.gate = [...band, ...item.gate];
      }
      for (const item of group) item.replaces = true;
      continue;
    }
    // "Each time an enemy unit is selected to Fall Back, … that enemy unit must Remain Stationary instead": the
    // instead replaces the move the event selected, which is no authored effect. Accepted only when the selected
    // moves are exactly the restricted activity, the permission is on the event's subject and it has a condition.
    const selectedMoveRestriction = selectedMoveRestrictionReplacing(list, triggerIndexes, planned, replacement);
    if (selectedMoveRestriction !== null) {
      if (selectedMoveRestriction !== "accepted") errors.push(selectedMoveRestriction);
      continue;
    }
    const replaced = planned.filter((item) => item.index < replacement.index && item.leaf.family_id === replacement.leaf.family_id && !item.replaces).at(-1);
    // "Do not make an Advance roll; instead, add 6\" to its Move": the no-advance-roll fragment
    // already says what happens in its place, so the clause's effect folds into it. Anything
    // else in its place has no DSL fragment.
    const previous = planned.filter((item) => item.index < replacement.index).at(-1);
    // "Do not roll <roll> …. Instead, <result>": the instead replaces the roll the prohibition names (compile-roll-prohibition.ts).
    if (previous && previous.leaf.family_id === "roll-prohibition") {
      const problem = replaceProhibitedRoll(list, places, planned, previous, replacement, boundDuration, CONFLICTING_DURATIONS);
      if (problem !== null) {
        // The refused prohibition is dropped with its error, so the leftover-prohibition check does not repeat it.
        errors.push(problem);
        const at = planned.indexOf(previous);
        if (at !== -1) planned.splice(at, 1);
      }
      continue;
    }
    if (!replaced && previous && PROHIBITIONS.has(previous.leaf.family_id)) {
      if (isAdvanceInPlace(replacement.node)) {
        // The folded effect's duration is the no-roll's: equal to its own if it has one, else taken from the folded effect.
        const folded = boundDuration.get(replacement.index);
        const kept = boundDuration.get(previous.index);
        // Printed durations on a no-roll gated by an Advance already made would bind the lifetime of a roll that cannot be skipped.
        if ((folded !== undefined || kept !== undefined) && triggerIndexes.length === 0 && testsMadeAdvance([...global, ...previous.gate])) errors.push(NO_ROLL_AFTER_ADVANCE);
        else if (folded !== undefined && kept !== undefined && folded !== kept) errors.push(CONFLICTING_DURATIONS);
        else if (folded !== undefined && kept === undefined) boundDuration.set(previous.index, folded);
        boundDuration.delete(replacement.index);
        // "add 8\" to the Move characteristic … instead": the no-roll advances that far.
        (previous.node.modifier as Node).advance = `fixed-${Number((replacement.node.modifier as Node).value)}`;
        planned.splice(planned.indexOf(replacement), 1);
      }
      else errors.push(`"Instead" after ${previous.leaf.family_id} must add 6" or 8" to Move; ${replacement.leaf.family_id} has no DSL fragment there.`);
      continue;
    }
    if (!replaced) {
      // "It can move up to 6\" instead of up to 3\"": the default it replaces is another rule's,
      // printed after "instead of", so the clause's effect already says the new value.
      const named = sourceText !== undefined && /^\s*of\b/u.test(Buffer.from(sourceText, "utf8").subarray(list[combinator]!.end_byte).toString("utf8"));
      if (!named) {
        // "Recover up to 3 lost wounds or, if it is a KEYWORD unit, return models instead": a restoration pair
        // across families (compile-cross-family-instead.ts). Any other pair has no candidates and keeps the refusal.
        const cands = crossFamilyCandidates(planned, places, optionalSpends, replacement);
        if (cands.length === 0) errors.push(`"Instead" has no earlier ${replacement.leaf.family_id} effect to replace.`);
        else if (cands.length > 1) errors.push(`"Instead" cannot tell which of ${cands.length} earlier effects it replaces.`);
        else {
          const problem = replaceAcrossFamilies(planned, places, boundDuration, replacement, cands[0]!);
          if (problem !== null) errors.push(problem);
        }
      }
      continue;
    }
    const alternative = allOf(replacement.gate.filter((node) => !isRollMarker(node)));
    if (!alternative) {
      errors.push(`"Instead" needs a condition in its clause saying when ${replacement.leaf.family_id} is replaced.`);
      continue;
    }
    // A change to a test someone else takes ("each enemy unit must take a test, subtracting 1 (or 2 if that unit is …)"):
    // the replacement's condition names that taker. A condition on this unit stays when its own wording says the bearer
    // ("-2 … if this unit has 13+ models"), since this-unit is then the bearer and not a mislabelled taker.
    if (typeof replaced.leaf.parameters.test_taker === "string" && list.some((leaf, at) => leaf.role === "CONDITION"
      && places[at]!.clause === places[replacement.index]!.clause && ["this-unit", "this-model"].includes(String(leaf.parameters.subject))
      && !namesBearer(leaf, sourceText))) {
      errors.push("\"Instead\" names this unit in a change to another unit's test; the replacement's condition must name that test's taker.");
      continue;
    }
    replaced.gate = [...replaced.gate, negate(alternative)];
    // A result band that gates the replaced effect ("on a 2+ … instead") covers its replacement too (inheritBand).
    inheritBand(replaced, replacement);
    inheritAttackFrame(list, places, replaced, replacement);
    replacement.replaces = true;
    // An "instead" replacing an effect limited to the selected unit's attacks is limited the same way
    // ("... attacks that target that enemy unit ... by 1, or by 2 instead"): the target condition sits on the first clause only.
    if (replaced.selected) replacement.selected = true;
  }
}
