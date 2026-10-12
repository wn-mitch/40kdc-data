import type { CompileLeaf } from "./compile-fragments.js";

/** A planned node is a JSON object (compile.ts and compile-fragments.ts use the same shape). */
type Node = Record<string, unknown>;

/**
 * Instead after a roll prohibition and after a selected-move restriction (compile.ts, the instead loop).
 * Both helpers mutate `planned` and return what the loop should do: `null` (fall through to the
 * existing checks), `"accepted"` (the replacement stays, the prohibition goes), or a refusal message.
 */

/** The planned effect shape the instead loop uses (compile.ts PlannedEffect; structural, not imported). */
export type PlannedLike = { index: number; leaf: CompileLeaf; node: Node; gate: Node[]; selected: boolean; replaces: boolean };

/** Structural equality of two gate lists (gates are JSON nodes). */
const sameGate = (left: Node[], right: Node[]) => JSON.stringify(left) === JSON.stringify(right);

/** The pool a named ability's own roll pays out, and the amount: the Blood Tithe point its roll gains on a pass. */
const ABILITY_ROLL_POOL = "blood-tithe-pool";
const ABILITY_ROLL_AMOUNT = 1;

/** The prohibited roll as wording: a roll kind by name, or the roll a named ability makes. */
export function prohibitedRollName(roll: unknown): string {
  if (roll !== null && typeof roll === "object") return `the roll of ${String((roll as { ability: unknown }).ability)}`;
  return String(roll);
}

/**
 * "Do not roll <roll> …. Instead, <auto-result>": the instead replaces the roll the prohibition names.
 * Accepted only for a roll-auto-result that passes automatically on that same roll, with the same condition
 * (or none, in which case the prohibition's condition is taken). The roll is not made at all, so the
 * replacement is the whole DSL output and the prohibition node is removed.
 */
export function replaceProhibitedRoll(
  list: readonly CompileLeaf[], places: readonly { sentence: number }[], planned: PlannedLike[], previous: PlannedLike,
  replacement: PlannedLike, boundDuration: Map<number, string>, conflictingDurations: string,
): string | null {
  const sentence = places[previous.index]!.sentence;
  if (list.some((leaf, at) => leaf.family_id === "dice-roll" && places[at]!.sentence === sentence)) {
    return "A roll prohibition shares its sentence with a dice roll; retire the dice roll it forbids.";
  }
  const prohibited = previous.leaf.parameters.roll;
  if (prohibited !== null && typeof prohibited === "object") return replaceProhibitedAbilityRoll(planned, previous, replacement, boundDuration, conflictingDurations, String((prohibited as { ability: unknown }).ability));
  const roll = String(prohibited);
  const leaf = replacement.leaf;
  if (leaf.family_id !== "roll-auto-result" || leaf.parameters.outcome !== "auto-pass" || leaf.parameters.rolls !== undefined || leaf.parameters.roll !== roll) {
    return `"Instead" after a roll prohibition replaces only the roll it names (${roll}).`;
  }
  if (replacement.gate.length > 0 && !sameGate(replacement.gate, previous.gate)) {
    return "\"Instead\" after a roll prohibition needs the same condition as the prohibition.";
  }
  if (boundDuration.has(previous.index)) return conflictingDurations;
  if (replacement.gate.length === 0) replacement.gate = [...previous.gate];
  planned.splice(planned.indexOf(previous), 1);
  return null;
}

/**
 * "Do not roll to gain <pool>. Instead, <gain>" after a named ability's own roll: the instead gains only the pool
 * that roll pays out, and the roll is made to pass, so the ability's own gain follows from the pass. The DSL output
 * is the roll-result pass on that roll alone; no gain is emitted beside it (it would be counted twice).
 */
function replaceProhibitedAbilityRoll(
  planned: PlannedLike[], previous: PlannedLike, replacement: PlannedLike, boundDuration: Map<number, string>,
  conflictingDurations: string, ability: string,
): string | null {
  const leaf = replacement.leaf;
  if (leaf.family_id !== "resource-gain") return `"Instead" after a roll prohibition of ${prohibitedRollName({ ability })} must gain its pool.`;
  if (leaf.parameters.pool !== ABILITY_ROLL_POOL || leaf.parameters.amount !== ABILITY_ROLL_AMOUNT) {
    return `"Instead" after a roll prohibition of ${prohibitedRollName({ ability })} gains only ${ABILITY_ROLL_AMOUNT} point of ${ABILITY_ROLL_POOL}.`;
  }
  if (replacement.gate.length > 0 && !sameGate(replacement.gate, previous.gate)) {
    return "\"Instead\" after a roll prohibition needs the same condition as the prohibition.";
  }
  if (boundDuration.has(previous.index)) return conflictingDurations;
  if (replacement.gate.length === 0) replacement.gate = [...previous.gate];
  replacement.node = { type: "roll-result", target: "this-unit", modifier: { roll: { of_ability: ability }, result: "pass" } };
  planned.splice(planned.indexOf(previous), 1);
  return null;
}

/**
 * "Each time an enemy unit is selected to Fall Back, … that unit must Remain Stationary instead": the instead
 * replaces the move the selection made, which is no authored effect. Accepted only when every selected event
 * names exactly the restricted activity, the permission's subject is the event's subject, the permission has
 * a condition, and no earlier permission of the same activity is still standing (that one is ambiguous). Any
 * other shape returns null and takes the existing path.
 */
export function selectedMoveRestrictionReplacing(
  list: readonly CompileLeaf[], triggerIndexes: readonly number[], planned: PlannedLike[], replacement: PlannedLike,
): null | "accepted" | string {
  const leaf = replacement.leaf;
  if (leaf.family_id !== "eligibility-permission" || leaf.parameters.allow !== false) return null;
  const activity = leaf.parameters.activity;
  const selected = triggerIndexes.map((at) => list[at]!).filter((moment) => moment.family_id === "event" && moment.parameters.kind === "selected");
  if (selected.length === 0 || !selected.every((moment) => JSON.stringify(moment.parameters.move_types) === JSON.stringify([activity]))) return null;
  if (replacement.node.target !== "event-subject" || replacement.gate.length === 0) return null;
  const earlier = planned.some((item) => item.index < replacement.index && item.leaf.family_id === "eligibility-permission"
    && item.leaf.parameters.activity === activity && !item.replaces);
  if (earlier) return "\"Instead\" would replace an earlier permission of the same activity; name the replaced permission.";
  return "accepted";
}
