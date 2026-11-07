import type { CompileLeaf } from "./compile-fragments.js";

/**
 * "…, your opponent must decide whether that unit will take cover or stand firm. You then roll one D6 … and apply
 * the relevant result below: ■ Standing Firm: On a 3+, … ■ Taking Cover: … On a 5+, …": the one roll printed between
 * a choice and its first named option is the roll each option's result bands read. It is no option of its own, so it
 * moves into every option, right after the option's marker. Applies only when the leaves before the first marker are
 * exactly one dice roll, every later group opens with a marker, and each option has a result band for the roll.
 * Returns the options, or the groups unchanged.
 */
export function withSharedRoll(groups: readonly CompileLeaf[][], marker: string): CompileLeaf[][] {
  const [head, ...options] = groups;
  if (head === undefined || head.length !== 1 || head[0]!.family_id !== "dice-roll" || options.length < 2) return [...groups];
  if (!options.every((group) => group[0]?.family_id === marker && group.some((leaf) => leaf.family_id === "roll-result"))) return [...groups];
  return options.map(([opener, ...rest]) => [opener!, head[0]!, ...rest]);
}
