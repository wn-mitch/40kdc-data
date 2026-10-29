import { bindAntecedents, hasAntecedent } from "./compile-antecedent.js";
import { activationWindowCondition, allOf, condition } from "./compile-conditions.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { alternativeMoments } from "./compile-segments.js";
import { trigger, triggerLeaves } from "./compile-triggers.js";
import { foldUnitFilters } from "./compile-unit-filters.js";
import { mergeStackedFilters } from "./compile-unit-filter-merge.js";
import { gatedMoment } from "./compile-usability-gate.js";

type Node = Record<string, unknown>;

export type CompiledStratagemActivation = {
  behavior: "activated" | "reactive";
  trigger: Node | Node[] | null;
  /** Phase availability when no event fires; the existing core record must preserve this gate. */
  availability: Node | null;
};

/**
 * Lower only a reviewed Stratagem WHEN fragment. This is not a whole-ability compile:
 * the caller must establish complete trusted timing coverage and retain the existing effect,
 * target, duration and allowance. In particular, TARGET history and EFFECT-local reactions
 * never become activation events. Unknown WHEN leaves fail rather than disappearing.
 */
export function compileStratagemActivation(leaves: readonly CompileLeaf[], sourceText?: string): CompiledStratagemActivation {
  const when = leaves.filter((leaf) => leaf.fragment === "WHEN").sort((left, right) => left.start_byte - right.start_byte);
  if (when.length === 0) throw new CompileError("A timing-only projection requires a reviewed WHEN fragment.");
  const folded = foldUnitFilters(bindAntecedents(mergeStackedFilters(when, sourceText), undefined, sourceText), sourceText);
  const gates: Node[] = [];
  const moments: CompileLeaf[] = [];
  for (const leaf of folded) {
    if (hasAntecedent(leaf)) throw new CompileError("An activation predicate has an unresolved antecedent.");
    if (leaf.family_id === "event" || leaf.family_id === "turn-start") moments.push(leaf);
    else if (leaf.family_id === "use-window" || leaf.family_id === "activation-window") gates.push(activationWindowCondition(leaf.parameters));
    else if (leaf.role === "CONDITION") gates.push(condition(leaf));
    else throw new CompileError(`Timing-only projection cannot consume ${leaf.family_id} in WHEN.`);
  }
  if (!alternativeMoments(moments, sourceText)) throw new CompileError("Nested activation events cannot be flattened to alternatives.");
  const triggers = moments.flatMap(triggerLeaves).map((leaf) => gatedMoment({ ...trigger(leaf), optional: true }, gates));
  return {
    behavior: triggers.length ? "reactive" : "activated",
    trigger: triggers.length === 0 ? null : triggers.length === 1 ? triggers[0]! : triggers,
    availability: triggers.length ? null : allOf(gates),
  };
}
