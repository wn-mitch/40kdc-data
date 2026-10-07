import { allOf } from "./compile-conditions.js";

type Node = Record<string, unknown>;

/** A planned effect as `compile.ts` holds it while it applies combinators. */
export type ChoiceItem = { index: number; node: Node; gate: Node[]; selected: boolean; replaces: boolean };

const gated = (gate: Node[], body: Node): Node => {
  const node = allOf(gate);
  return node ? { type: "conditional", condition: node, effect: body } : body;
};

const hasRollBand = (gate: readonly Node[]): boolean => gate.some((node) => node.type === "__roll-result");

/**
 * "Those attacks do not prevent that unit from being hidden. Or: that unit can make a Normal move
 * …": an "Or:" whose effects are of other kinds than the effect before it offers the player one
 * of two groups. The group before is every effect from the start of its part (or the previous
 * boundary) to the "Or:"; the group after runs from it to the next boundary (a later part's
 * moment or another combinator). Each effect keeps its own conditions inside its option.
 *
 * Replaces the before group's first effect with the choice and drops the rest of both groups
 * from `planned`. Returns why it cannot, or null.
 */
export function chooseBetweenGroups(planned: ChoiceItem[], combinator: number, boundaries: readonly number[]): string | null {
  const lower = Math.max(-1, ...boundaries.filter((at) => at < combinator));
  const upper = Math.min(Number.POSITIVE_INFINITY, ...boundaries.filter((at) => at > combinator));
  const before = planned.filter((item) => item.index > lower && item.index < combinator);
  const after = planned.filter((item) => item.index > combinator && item.index < upper);
  if (before.length === 0 || after.length === 0) return "\"Or:\" needs an effect on each side to choose between.";
  const both = [...before, ...after];
  if (both.some((item) => item.replaces)) return "\"Or:\" cannot choose between groups where an \"instead\" already replaces an effect.";
  if (both.some((item) => item.selected)) return "\"Or:\" cannot choose between groups that are limited to attacks against a selected unit.";
  if (both.some((item) => hasRollBand(item.gate))) return "\"Or:\" cannot choose between groups gated by roll results; the compiler resolves a roll's bands only outside a choice.";
  const option = (group: readonly ChoiceItem[]): Node => group.length === 1
    ? gated(group[0]!.gate, group[0]!.node)
    : { type: "sequence", steps: group.map((item) => gated(item.gate, item.node)) };
  const first = before[0]!;
  first.node = { type: "choice", options: [option(before), option(after)] };
  first.gate = [];
  for (const item of both.slice(1)) planned.splice(planned.indexOf(item), 1);
  return null;
}
