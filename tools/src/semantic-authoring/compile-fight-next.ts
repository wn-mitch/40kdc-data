import type { CompileLeaf } from "./compile-fragments.js";

/** A sentence or clause stop between two leaves. */
const STOP = /[.!?;:](?:\s|$)/u;

/** The parameter keys of a bare next-permission leaf: a grant that only puts the unit next to fight. */
const BARE_NEXT_KEYS = ["activity", "allow", "next", "subject"];

const isFightGrant = (leaf: CompileLeaf | undefined): leaf is CompileLeaf =>
  leaf?.family_id === "eligibility-permission" && leaf.parameters.activity === "fight" && leaf.parameters.allow === true;

/**
 * "… is eligible to fight (even if it has fought) and must be selected to fight next": a bare
 * next-permission leaf directly after a fight permission for the same subject, in the same fragment
 * and clause, merges into it as its `next`. Anywhere else the bare leaf stays a permission of its own
 * (`fight, allow, next`), which is the only carrier the DSL has for the order.
 */
export function foldFightNext(leaves: readonly CompileLeaf[], sourceText: string | undefined): CompileLeaf[] {
  if (sourceText === undefined) return [...leaves];
  const bytes = Buffer.from(sourceText, "utf8");
  const list = [...leaves];
  const drop = new Set<number>();
  list.forEach((leaf, index) => {
    if (!isFightGrant(leaf) || leaf.parameters.next !== true) return;
    if (Object.keys(leaf.parameters).sort().join(",") !== BARE_NEXT_KEYS.join(",")) return;
    const previous = list[index - 1];
    if (!isFightGrant(previous) || drop.has(index - 1) || previous.parameters.next !== undefined) return;
    if ((previous.fragment ?? null) !== (leaf.fragment ?? null) || previous.parameters.subject !== leaf.parameters.subject) return;
    if (STOP.test(bytes.subarray(previous.end_byte, leaf.start_byte).toString("utf8"))) return;
    list[index - 1] = { ...previous, parameters: { ...previous.parameters, next: true } };
    drop.add(index);
  });
  return list.filter((_, index) => !drop.has(index));
}
