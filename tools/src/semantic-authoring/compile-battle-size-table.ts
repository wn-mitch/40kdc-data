import { CompileError } from "./compile-error.js";
import type { CompileLeaf } from "./compile-fragments.js";

/** The leaves a battle-size table's rows are made of: the size, "you can", and that size's count. */
const TABLE_FAMILIES = new Set(["battle-size", "optional-use", "count-by-battle-size"]);
const SIZES = ["incursion", "strike-force", "onslaught"] as const;

const values = (leaf: CompileLeaf) => SIZES.map((size) => leaf.parameters[size]).join("/");

/**
 * "■ A: … The maximum number … depends on the battle size, as shown below. ■ B: … (the same) …
 * In an Incursion sized battle, you can select up to 2 units. …": the rows printed after the last
 * named option spell out the cap every option names, so they are no part of that last option. A
 * trailing run of the last option made only of battle-size rows (two or more sizes, each row's
 * "you can" and count) is taken off it, when two or more options carry their own
 * count-by-battle-size. Every count in the table must equal every option's, or the table names a
 * different cap from the one an option compiles with. Returns the options without the table.
 */
export function withoutSharedBattleSizeTable(groups: readonly CompileLeaf[][]): CompileLeaf[][] {
  const last = groups.at(-1);
  if (last === undefined || groups.length < 2) return [...groups];
  let start = last.length;
  while (start > 0 && TABLE_FAMILIES.has(last[start - 1]!.family_id)) start -= 1;
  // The run begins at a row's size, not partway through one.
  while (start < last.length && last[start]!.family_id !== "battle-size") start += 1;
  const table = last.slice(start);
  const sizes = new Set(table.filter((leaf) => leaf.family_id === "battle-size").map((leaf) => String(leaf.parameters.size)));
  if (sizes.size < 2 || start === 0) return [...groups];
  const own = (group: readonly CompileLeaf[]) => group.filter((leaf) => leaf.family_id === "count-by-battle-size");
  const options = [...groups.slice(0, -1), last.slice(0, start)];
  const capped = options.filter((group) => own(group).length > 0);
  if (capped.length < 2) return [...groups];
  const caps = new Set([...capped.flatMap(own), ...own(table)].map(values));
  if (caps.size !== 1) throw new CompileError(`The battle-size table after the options names ${[...caps].join(" and ")}; every option's cap must be the table's.`);
  return options;
}
