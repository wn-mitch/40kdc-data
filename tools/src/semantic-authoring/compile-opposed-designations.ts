import type { Compiled, CompileOptions } from "./compile.js";
import type { CompileLeaf } from "./compile-fragments.js";

/**
 * "While DRUKHARI units from your army are winning the wager, HARLEQUIN units from your army are
 * losing the wager, and vice versa": two friendly groups hold opposite designations. The sentence
 * is one opposed-designations leaf; it adds no effect of its own. Each designate the rest of the
 * record makes on one group with either tag also tags the other group with the other tag, and
 * each group drops the tag it no longer holds, so the pair can never be held by one group at once.
 */

type Node = Record<string, unknown>;
type Compile = (leaves: CompileLeaf[], sourceText?: string, options?: CompileOptions) => Compiled;

const FAMILY = "opposed-designations";

/** The group a designate's target names: friendly units with exactly these keywords, else null. */
function groupOf(target: unknown): string | null {
  if (target === null || typeof target !== "object" || Array.isArray(target)) return null;
  const filter = target as Node;
  if (filter.owner !== "friendly" || !Array.isArray(filter.all_of) || Object.keys(filter).some((key) => key !== "owner" && key !== "all_of")) return null;
  return JSON.stringify([...(filter.all_of as string[])].sort());
}

const designate = (target: unknown, tag: string, clear = false): Node =>
  ({ type: "designate", target, modifier: { tag, ...(clear ? { clear: true } : {}) } });

/**
 * Compiles a record with one opposed-designations leaf: the record without it, with every
 * designate of either tag on either group paired. Returns null when the record has none.
 */
export function compileOpposedDesignations(
  leaves: readonly CompileLeaf[],
  sourceText: string | undefined,
  options: CompileOptions,
  compile: Compile,
  signatureOf: (leaves: readonly CompileLeaf[]) => string,
): Compiled | null {
  const pairs = leaves.filter((leaf) => leaf.family_id === FAMILY);
  if (pairs.length === 0) return null;
  const signature = signatureOf(leaves);
  const refuse = (message: string): Compiled => ({ ok: false, signature, errors: [message] });
  if (pairs.length > 1) return refuse("A record takes one opposed-designations leaf.");
  const pair = pairs[0]!;
  const { tag, opposite_tag: oppositeTag } = pair.parameters as { tag: string; opposite_tag: string };
  const keywords = pair.parameters.keywords as string[];
  const oppositeKeywords = pair.parameters.opposite_keywords as string[];
  const groups = new Map([[JSON.stringify([...keywords].sort()), oppositeKeywords], [JSON.stringify([...oppositeKeywords].sort()), keywords]]);
  const other = (held: string) => (held === tag ? oppositeTag : tag);
  // The pairing sentence's own wording ("from your army") belongs to the leaf, not the record.
  const rest = leaves.filter((leaf) => leaf !== pair && !(leaf.start_byte >= pair.start_byte && (leaf.end_byte ?? leaf.start_byte) <= (pair.end_byte ?? pair.start_byte)));
  const compiled = compile(rest, sourceText, options);
  if (!compiled.ok) return { ok: false, signature, errors: compiled.errors };
  let paired = 0;
  let stray: string | null = null;
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (node === null || typeof node !== "object") return node;
    const record = node as Node;
    const modifier = record.modifier as Node | undefined;
    if (record.type === "designate" && modifier && (modifier.tag === tag || modifier.tag === oppositeTag)) {
      const opposite = groupOf(record.target) === null ? undefined : groups.get(groupOf(record.target)!);
      if (modifier.clear === true || modifier.subject !== undefined || Object.keys(modifier).length !== 1 || opposite === undefined) {
        stray = "A designation of an opposed pair names neither group, or carries more than its tag; it has no paired reading.";
        return node;
      }
      paired += 1;
      const held = modifier.tag as string;
      const opponents = { owner: "friendly", all_of: opposite };
      return { type: "sequence", steps: [record, designate(record.target, other(held), true), designate(opponents, other(held)), designate(opponents, held, true)] };
    }
    return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, visit(value)]));
  };
  const effect = visit(compiled.mechanics.effect);
  if (stray !== null) return refuse(stray);
  if (paired === 0) return refuse("An opposed-designations leaf pairs no designation the record makes.");
  return { ...compiled, signature, mechanics: { ...compiled.mechanics, effect: effect as typeof compiled.mechanics.effect } };
}
