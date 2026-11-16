import { retargetMenu } from "./compile-activation.js";
import { FILTERED_UNITS } from "./compile-antecedent.js";
import { isContainerOpener } from "./compile-containers.js";
import { CompileError } from "./compile-error.js";
import type { CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/** A menu node retargeted to a chosen-option-grant's holder, mapped to the menu as it opened (about its own unit). */
export const MENU_AS_OPENED = new WeakMap<object, Node>();

/**
 * A menu-options-grant leaf ("it has both of the following abilities") as the effects of every
 * option of the last menu opened before it, held by its holder. A choice lists its options as
 * effects; a stance lists {id, name, effect}. The menu itself still compiles where it opens.
 */
export function allMenuOptions(list: readonly CompileLeaf[], index: number, containerNodes: ReadonlyMap<number, Node>): Node {
  const opener = list.slice(0, index).map((other) => isContainerOpener(other.family_id)).lastIndexOf(true);
  if (opener < 0) throw new CompileError("\"Has both of the following abilities\" names every option of a menu, but no menu opens before it.");
  const retargeted = containerNodes.get(opener);
  const menu = retargeted === undefined ? undefined : MENU_AS_OPENED.get(retargeted) ?? retargeted;
  const options = menu && Array.isArray(menu.options) ? (menu.options as unknown[]) : null;
  if (!options || options.length === 0) throw new CompileError("\"Has both of the following abilities\" needs the menu before it to list its options.");
  const effects = options.map((option) => menu!.type === "choice" ? option : (option as Node).effect);
  if (effects.some((item) => item === null || typeof item !== "object")) throw new CompileError("Every option of the menu before \"has both of the following abilities\" needs an effect.");
  const leaf = list[index]!;
  const filtered = leaf.parameters.holder === FILTERED_UNITS;
  if (filtered && leaf.parameters.subject_filter === undefined) throw new CompileError("\"Such a unit has both of the following abilities\" points back to a unit-filter whose units it cannot name.");
  const holder = filtered ? leaf.parameters.subject_filter : String(leaf.parameters.holder);
  const steps = holder === "this-unit" || holder === "this-model" ? effects : effects.map((item) => retargetMenu(item, holder));
  return steps.length === 1 ? steps[0] as Node : { type: "sequence", steps };
}
