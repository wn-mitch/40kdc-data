import { allOf } from "./compile-conditions.js";

type Node = Record<string, unknown>;

/** A planned effect as `compile.ts` holds it while it applies combinators. */
export type ChoiceItem = { index: number; node: Node; gate: Node[]; selected: boolean; replaces: boolean };

const gated = (gate: Node[], body: Node): Node => {
  const node = allOf(gate);
  return node ? { type: "conditional", condition: node, effect: body } : body;
};

const isBand = (node: Node): boolean => node.type === "__roll-result";

/**
 * The result bands gating one item, as one key. Two items with the same key sit under the same band;
 * an item with no band has the empty key.
 */
const bandKey = (item: ChoiceItem): string => JSON.stringify(item.gate.filter(isBand));

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
  // A band shared by both groups is decided before the choice, so the roll resolves outside it; the
  // options then keep only their own conditions. Different bands are a split and stay refused.
  const band = bandKey(both[0]!);
  if (both.some((item) => bandKey(item) !== band)) return "\"Or:\" cannot choose between groups gated by different roll results; the compiler resolves a roll's bands only outside a choice.";
  const shared = both[0]!.gate.filter(isBand);
  const inside = (item: ChoiceItem): ChoiceItem => ({ ...item, gate: item.gate.filter((node) => !isBand(node)) });
  const option = (group: readonly ChoiceItem[]): Node => group.length === 1
    ? gated(inside(group[0]!).gate, group[0]!.node)
    : { type: "sequence", steps: group.map((item) => gated(inside(item).gate, item.node)) };
  const first = before[0]!;
  first.node = { type: "choice", options: [option(before), option(after)] };
  first.gate = shared;
  for (const item of both.slice(1)) planned.splice(planned.indexOf(item), 1);
  return null;
}
