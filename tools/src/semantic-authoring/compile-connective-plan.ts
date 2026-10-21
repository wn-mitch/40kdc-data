import { ATTACK_EVENTS } from "./compile-conditions.js";
import { CompileError, type CompileLeaf, type LeafConnective } from "./compile-fragments.js";
import { ordered, placements, rawSentences } from "./compile-placement.js";

/**
 * What a reviewed condition-of connective (connective-rows.ts) asks of compilation. "If it does" /
 * "If you do" points back to something the player can decline; what follows it in its sentence
 * happens only when the player does it.
 *
 * - The antecedent is an optional-use, or a moment, roll or selection under one ("you can …. If
 *   you do, …"): the existing optional-use lowering already says this, so the plan only checks
 *   that the use covers it (`use`). A unit selection needs nothing: its body is already only for
 *   the unit it selected.
 * - The antecedent is an effect whose own wording is the permission ("it can make a Normal move. If
 *   it does, …"): the effects after the connective in its sentence are its consequents, and the
 *   antecedent with its consequents is one declinable unit (`permission`, compile-connective-lower.ts).
 * - A bare "if"/"while" before a condition leaf, a connective inside a leaf, and a "when doing so"
 *   qualifier mark wording another leaf already decides: they change nothing.
 * - A bare "if" before a moment is a condition on what happened, which has no lowering yet: refused.
 */

/** Which leaf a plan names; folds may move a leaf's start back over what they absorb, never its end. */
export type LeafKey = { fragment: string; start_byte: number; end_byte: number; family_id: string };

export type ConditionOfPlan =
  | { kind: "permission"; antecedent: LeafKey; consequents: LeafKey[] }
  | { kind: "use"; antecedent: LeafKey; use: LeafKey };

/** "If it does", "If you do", "if they do so", "When you do": a reference back to a use. */
const USE_REFERENCE = /^(?:if|when)\s+(?:it|you|they)\s+(?:do|does|did)(?:\s+so)?$/iu;
/** "When doing so", "while doing so": a qualifier on the action before it, not a gate. */
const DOING_SO = /\bdoing\s+so\b/iu;
/** Conditions whose own leaf is the condition the connective prints ("but if it does" after a tall-terrain move). */
const MARKER_CONDITIONS = new Set(["move-passthrough-used"]);
/** EVENT families that are not a moment the ability fires on: a gate, a selection, a loop or a roll. */
const NOT_MOMENTS = new Set(["attack", "select-unit", "for-each-unit-select", "dice-roll"]);

const keyOf = (leaf: CompileLeaf): LeafKey => ({ fragment: leaf.fragment ?? "RAW_TEXT", start_byte: leaf.start_byte, end_byte: leaf.end_byte ?? leaf.start_byte, family_id: leaf.family_id });
const fragmentOf = (leaf: CompileLeaf) => leaf.fragment ?? "RAW_TEXT";
const wording = (connective: LeafConnective) => connective.surface.replace(/[*_]/gu, "").trim();

/** A moment the ability or one of its parts fires on (compile.ts lowers it to a trigger). */
export function isMoment(leaf: CompileLeaf): boolean {
  if (leaf.role !== "EVENT" || NOT_MOMENTS.has(leaf.family_id)) return false;
  return !(leaf.family_id === "event" && ATTACK_EVENTS.has(String(leaf.parameters.kind)));
}

/** An effect whose own wording is a permission the player may decline ("can make a move", "can be set up"). */
export function isDeclinable(leaf: CompileLeaf): boolean {
  if (leaf.role !== "EFFECT") return false;
  switch (leaf.family_id) {
    case "make-move":
    case "ability-activate":
      return true;
    case "set-up":
      return leaf.parameters.mandatory !== true && leaf.parameters.allow !== false;
    case "eligibility-permission":
      return leaf.parameters.allow !== false;
    default:
      return false;
  }
}

/**
 * Plan every condition-of connective on the leaves. Throws a CompileError naming the first one
 * that cannot be planned: no antecedent (R1), an antecedent the player cannot decline (R2), no
 * effect after it (R3), a moment among its consequents (R4), two permission ranges that overlap
 * (R6), or a bare "if" before a moment (class D).
 */
export function planConditionOf(leaves: readonly CompileLeaf[], sourceText: string | undefined): ConditionOfPlan[] {
  const list = ordered(leaves);
  if (!list.some((leaf) => leaf.connectives?.some((connective) => connective.relation === "condition-of"))) return [];
  const places = placements(list, sourceText);
  const raw = rawSentences(list, sourceText);
  const plans: ConditionOfPlan[] = [];
  const ranges: Array<{ from: number; to: number }> = [];
  list.forEach((leaf, at) => {
    for (const connective of leaf.connectives ?? []) {
      if (connective.relation !== "condition-of" || connective.within || DOING_SO.test(connective.surface)) continue;
      const word = wording(connective);
      if (!USE_REFERENCE.test(word)) {
        // A bare "if"/"while": the leaf after it says the condition. Before a moment, that is a condition on history.
        if (!connective.trailing && isMoment(leaf)) {
          throw new CompileError(`A condition written as a moment has no history lowering yet: "${word}" introduces the ${String(leaf.parameters.kind ?? leaf.family_id)} moment as a condition, not as when the ability fires.`);
        }
        continue;
      }
      if (connective.trailing) throw new CompileError(`"${word}" has no leaf after it in its fragment, so nothing it gates is reviewed.`);
      if (MARKER_CONDITIONS.has(leaf.family_id)) continue;
      // The antecedent: the nearest leaf before the connective in its fragment that is not a condition or a duration.
      let antecedent = -1;
      for (let back = at - 1; back >= 0 && fragmentOf(list[back]!) === fragmentOf(leaf); back--) {
        const candidate = list[back]!;
        if (candidate.role === "CONDITION" || candidate.role === "DURATION") continue;
        antecedent = back;
        break;
      }
      if (antecedent === -1) throw new CompileError(`"${word}" refers back to something the player does, but no leaf before it in its fragment says what.`);
      const before = list[antecedent]!;
      // A selection's body applies only to a unit it selected, so "if you do" after it is already its scope.
      if (before.family_id === "select-unit") continue;
      // An optional-use offers the antecedent: a declinable permission only from its own sentence ("you can … and
      // it can move"), anything else from anywhere before it in its fragment ("it can do one of the following: …").
      const declinable = isDeclinable(before);
      const use = before.family_id === "optional-use" ? antecedent
        : list.findIndex((other, index) => index < antecedent && other.family_id === "optional-use" && fragmentOf(other) === fragmentOf(before) && (!declinable || raw[index] === raw[antecedent]));
      if (use !== -1) {
        plans.push({ kind: "use", antecedent: keyOf(before), use: keyOf(list[use]!) });
        continue;
      }
      if (!declinable) {
        throw new CompileError(`"${word}" refers back to ${before.family_id}, which the player cannot decline; review an optional-use over the wording that offers it, or a declinable effect.`);
      }
      // The consequents: the effects from the connective to the end of its sentence.
      const range = list.flatMap((other, index) => index >= at && places[index]!.sentence === places[at]!.sentence ? [index] : []);
      const consequents = range.filter((index) => list[index]!.role === "EFFECT");
      if (consequents.length === 0) {
        const written = [...new Set(range.filter((index) => list[index]!.role === "CONDITION").map((index) => list[index]!.family_id))];
        throw new CompileError(`"${word}" after ${before.family_id} gates nothing: no effect follows it in its sentence.${written.length ? ` A consequence written as a condition (${written.join(", ")}) must be reviewed as an effect.` : ""}`);
      }
      const moment = range.find((index) => isMoment(list[index]!));
      if (moment !== undefined) {
        throw new CompileError(`"${word}" after ${before.family_id} is followed by a moment in its sentence; a declinable permission with a later moment has no lowering yet.`);
      }
      const span = { from: antecedent, to: consequents.at(-1)! };
      if (ranges.some((other) => other.from <= span.to && span.from <= other.to)) {
        throw new CompileError(`Two "${word}" ranges overlap: the effect one gates is the permission another refers to, which has no lowering yet.`);
      }
      ranges.push(span);
      plans.push({ kind: "permission", antecedent: keyOf(before), consequents: consequents.map((index) => keyOf(list[index]!)) });
    }
  });
  return plans;
}

/** Whether a (possibly folded) leaf is the one a key names: same fragment, family and end, and a start no later. */
export function matchesKey(leaf: CompileLeaf, key: LeafKey): boolean {
  return fragmentOf(leaf) === key.fragment && leaf.family_id === key.family_id && (leaf.end_byte ?? leaf.start_byte) === key.end_byte && leaf.start_byte <= key.start_byte;
}
