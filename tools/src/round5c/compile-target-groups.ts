import { exactSpan } from "./contracts.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import type { FilterAlternative } from "./unit-filter-alternatives.js";

/**
 * A Stratagem's TARGET as target groups. Each target leaf (`stratagem-target`,
 * `triggering-target`) opens a group; the leaves after it, up to the next one, belong to it. A
 * `target-binding` belongs to the group it sits in (before the first target leaf, the first
 * group). "Two **X** units" (count exactly 2) is that many groups with the same restrictions.
 * Groups are named by position (first, second, …); the names are the compiler's, not the
 * source's. One group lowers to the single target_restrictions object, as it always has.
 */

type Node = Record<string, unknown>;

const SELECTORS = new Set(["stratagem-target", "triggering-target"]);
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];

/**
 * One target leaf and what it prints: the targets it names, whose units, their keywords, and the
 * alternatives its filter offers ("one **X** model or one **Y** model"), each with its own keywords.
 */
export type TargetHead = { index: number; selector: CompileLeaf | null; names: string[]; side: string | null; level: string; keywords: string[]; alternatives: string[][]; mode: string | null; mode_cost: { label: string; amount: number } | null };

const SIDES: Record<string, string> = { "your-army": "friendly", enemy: "enemy" };

/** The record's target groups in source order; empty when it has no TARGET leaf. */
export function targetHeads(list: readonly CompileLeaf[]): TargetHead[] {
  const selectors = list.flatMap((leaf, index) => SELECTORS.has(leaf.family_id) ? [index] : []);
  if (selectors.length === 0) {
    const binding = list.findIndex((leaf) => leaf.family_id === "target-binding");
    return binding === -1 ? [] : [{ index: binding, selector: null, names: [ORDINALS[0]!], side: null, level: "unit", keywords: [], alternatives: [], mode: null, mode_cost: null }];
  }
  const sizes = selectors.map((at) => list[at]!.parameters.count === "exactly" ? Number(list[at]!.parameters.count_exact) : 1);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total > ORDINALS.length) throw new CompileError(`A Stratagem names ${total} targets; the compiler names at most ${ORDINALS.length}.`);
  let next = 0;
  return selectors.map((at, position) => {
    const selector = list[at]!;
    // The unit-filters right after a side-less target leaf say whose units and which keywords.
    const filters: CompileLeaf[] = [];
    for (let after = at + 1; list[after]?.family_id === "unit-filter" && list[after]!.fragment === selector.fragment; after += 1) filters.push(list[after]!);
    const p = selector.parameters;
    const triggering = selector.family_id === "triggering-target";
    const side = triggering ? "friendly" : SIDES[String(p.side)] ?? (filters.length ? String(filters[0]!.parameters.side) : null);
    const keywords = [...new Set([...((p.keywords as string[] | undefined) ?? []), ...filters.flatMap((filter) => (filter.parameters.keywords as string[] | undefined) ?? [])])];
    const level = String(p.selects ?? filters.find((filter) => filter.parameters.level !== undefined)?.parameters.level ?? "unit");
    const alternatives = filters.flatMap((filter) => ((filter.parameters.alternatives as FilterAlternative[] | undefined) ?? []).map((item) => item.keywords ?? []));
    const names = ORDINALS.slice(next, next + sizes[position]!);
    next += sizes[position]!;
    return { index: at, selector, names, side: side === "any" ? null : side, level, keywords, alternatives, mode: selector.mode ?? null, mode_cost: selector.mode_cost ?? null };
  });
}

/** Whether no sentence break (. ; :) falls between two leaves, the first before the second. */
function sameSentence(first: CompileLeaf, second: CompileLeaf, sourceText: string | undefined): boolean {
  if (sourceText === undefined || first.end_byte === undefined || second.start_byte < first.end_byte) return false;
  return !/[.;:]/u.test(exactSpan(sourceText, first.end_byte, second.start_byte));
}

/**
 * The group a TARGET leaf belongs to (its index in `targetHeads`), and whether it gates that
 * group: a condition in the sentence that opens a later group, before that group's target leaf
 * ("If that unit is **BATTLELINE**, you can also target one …"), is about the earlier target and
 * decides whether the later one can be selected.
 */
export function targetGroupOf(list: readonly CompileLeaf[], index: number, sourceText: string | undefined): { group: number; gate: boolean } {
  const heads = targetHeads(list);
  const opened = heads.filter((head) => head.index <= index).length - 1;
  const group = Math.max(opened, 0);
  const leaf = list[index]!;
  const next = heads[opened + 1];
  if (opened >= 0 && next && leaf.role === "CONDITION" && leaf.fragment === "TARGET"
    && sameSentence(leaf, list[next.index]!, sourceText) && !sameSentence(list[heads[opened]!.index]!, leaf, sourceText)) {
    return { group: opened + 1, gate: true };
  }
  return { group, gate: false };
}

/** Whether the record names two or more targets. */
export const severalTargets = (list: readonly CompileLeaf[]) => targetHeads(list).flatMap((head) => head.names).length > 1;

/**
 * An optional-use in TARGET right before a later target leaf ("you can also target one …"): that
 * target is optional. Returns the group it makes optional, or null when the leaf is not one.
 * Refuses an optional-use in a TARGET with several targets that no target leaf follows.
 */
export function optionalTargetGroup(list: readonly CompileLeaf[], index: number): number | null {
  const leaf = list[index]!;
  if (leaf.family_id !== "optional-use" || leaf.fragment !== "TARGET" || !severalTargets(list)) return null;
  const group = targetHeads(list).findIndex((head) => head.index === index + 1);
  if (group < 1) throw new CompileError("\"You can\" in a TARGET with several targets must sit right before the later target it makes optional.");
  return group;
}

type Build = (parts: readonly CompileLeaf[], eligibility: readonly Node[]) => Node | null;
type TargetCondition = { index: number; node: Node; eachTarget: boolean };

/**
 * The core record's target_restrictions from its TARGET leaves and conditions: the single object
 * for one target, else one named restriction per target. `build` lowers one group (its target
 * leaf, binding and eligibility). An optional later target is up to one unit; a condition with
 * subject each-target holds for every target named before it.
 */
export function groupedTargetRestrictions(list: readonly CompileLeaf[], parts: readonly number[], conditions: readonly TargetCondition[], optional: ReadonlySet<number>, sourceText: string | undefined, build: Build): Node | Node[] | null {
  const heads = targetHeads(list);
  if (heads.flatMap((head) => head.names).length < 2) {
    if (conditions.some((item) => item.eachTarget)) throw new CompileError("A condition about each target needs a Stratagem with several targets.");
    return build(parts.map((at) => list[at]!), conditions.map((item) => item.node));
  }
  const groupOf = (at: number) => targetGroupOf(list, at, sourceText).group;
  const restrictions: Node[] = [];
  heads.forEach((head, position) => {
    const own = parts.filter((at) => groupOf(at) === position).map((at) => list[at]!);
    const eligibility = conditions.flatMap((item) => {
      if (!item.eachTarget) return groupOf(item.index) === position ? [item.node] : [];
      const before = heads.filter((other) => other.index < item.index);
      if (before.length < 2) throw new CompileError("A condition about each target follows only one target; name it on that target.");
      return head.index < item.index ? [item.node] : [];
    });
    const restriction = build(own, [...eligibility, ...distinctFrom(heads, position)]);
    if (!restriction) throw new CompileError(`The ${head.names[0]} target has no restrictions.`);
    const { count, count_max: countMax, ...rest } = restriction;
    let counted: Node = { count, ...(countMax !== undefined ? { count_max: countMax } : {}) };
    if (optional.has(position)) {
      if (count !== "one") throw new CompileError("An optional extra target must be one unit.");
      counted = { count: "up-to", count_max: 1 };
    }
    // "Two X units": that many targets, each one unit under the same restrictions.
    if (count === "exactly") counted = { count: "one" };
    const modeFields: Node = head.mode === null ? {} : { mode: head.mode, ...(head.mode_cost ? { mode_cost: head.mode_cost } : {}) };
    head.names.forEach((name, copy) => {
      const own = structuredClone(rest);
      // "Two X units": each later copy is another unit than the copies before it.
      const others = head.names.slice(0, copy).map(notSameAs);
      if (others.length) own.eligibility = allOf([...(own.eligibility ? [own.eligibility as Node] : []), ...others]);
      restrictions.push({ name, ...structuredClone(counted), ...modeFields, ...own });
    });
  });
  return restrictions;
}

const notSameAs = (name: string): Node => ({ operator: "not", operands: [{ type: "same-unit", parameters: { as: { stratagem_target: name } } }] });

function allOf(nodes: Node[]): Node {
  // Flatten a nested and, so the copies' checks read as one list.
  const flat = nodes.flatMap((node) => node.operator === "and" ? node.operands as Node[] : [node]);
  return flat.length === 1 ? flat[0]! : { operator: "and", operands: flat };
}

/**
 * Stratagem targets are distinct units: a later target is not the same unit as any target named
 * before it in its own mode (targets of an unchosen mode are never selected together). Omitted
 * against an earlier target of the other side, which can never be the same unit.
 */
function distinctFrom(heads: readonly TargetHead[], position: number): Node[] {
  const { side, mode } = heads[position]!;
  return heads.slice(0, position)
    .filter((earlier) => earlier.mode === mode)
    .filter((earlier) => side === null || earlier.side === null || earlier.side === side)
    .flatMap((earlier) => earlier.names.map(notSameAs));
}
