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
 * …", "[LETHAL HITS]. Or: [SUSTAINED HITS 1]. Or: if …, both": the reviewed "Or:" markers of one
 * stretch split its effects into the options the player picks from. The stretch runs from the start
 * of its part (or the previous boundary: a later part's moment or another combinator) to the next
 * boundary; each option is every effect between two markers, whatever their kinds, so an option's
 * rider ("and [HAZARDOUS]") stays in that option. Each effect keeps its own conditions inside it.
 *
 * Replaces the first option's first effect with the choice and drops the rest of the options' effects
 * from `planned`. Returns why it cannot, or null.
 */
export function chooseBetweenGroups(planned: ChoiceItem[], markers: readonly number[], boundaries: readonly number[]): string | null {
  const lower = Math.max(-1, ...boundaries.filter((at) => at < markers[0]!));
  const upper = Math.min(Number.POSITIVE_INFINITY, ...boundaries.filter((at) => at > markers.at(-1)!));
  const cuts = [lower, ...markers, upper];
  const groups = cuts.slice(1).map((end, at) => planned.filter((item) => item.index > cuts[at]! && item.index < end));
  if (groups.some((group) => group.length === 0)) return "\"Or:\" needs an effect on each side to choose between.";
  const both = groups.flat();
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
  const first = both[0]!;
  first.node = { type: "choice", options: groups.map(option) };
  first.gate = shared;
  for (const item of both.slice(1)) planned.splice(planned.indexOf(item), 1);
  return null;
}
