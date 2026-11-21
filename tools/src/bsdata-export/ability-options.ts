/**
 * The named options of an ability that picks one of several ("Paragon of Hatred", "Mark of Chaos
 * Ascendant"): BSData lists each as an Abilities profile of its own beside the ability. An option
 * is described by rendering the ability with its menu replaced by that option alone, so the
 * option keeps the ability's timing and range.
 */
import { describeAbility, type AbilityLike } from "../translate/effect.js";

export interface NamedOption {
  /** Stable within the ability: the stance option's id, else the option's position. */
  readonly key: string;
  readonly name: string;
  readonly description: string;
}

type Node = Record<string, unknown>;
type Menu = { readonly node: Node; readonly options: ReadonlyArray<{ key: string; name: string; effect: unknown }> };

/** Every node in `tree` for which `match` holds, outermost first. */
function nodesWhere(tree: unknown, match: (node: Node) => boolean, found: Node[] = []): Node[] {
  if (Array.isArray(tree)) {
    for (const item of tree) nodesWhere(item, match, found);
  } else if (tree !== null && typeof tree === "object") {
    const node = tree as Node;
    if (match(node)) found.push(node);
    for (const value of Object.values(node)) nodesWhere(value, match, found);
  }
  return found;
}

/**
 * The record's one named menu: its only `choice` when the record carries `option_names`, else
 * its only `stance-select`, whose options may hold unnamed choices of their own (Yarrick's Decisive
 * Command picks one of three). Null when it has none, or more than one, so no option is guessed.
 */
function namedMenu(record: Node): Menu | null {
  const choices = nodesWhere(record.effect, (node) => node.type === "choice");
  const stances = nodesWhere(record.effect, (node) => node.type === "stance-select");
  const names = record.option_names;
  if (Array.isArray(names) && choices.length === 1 && stances.length === 0) {
    const options = choices[0]!.options;
    if (!Array.isArray(options) || options.length !== names.length) return null;
    return { node: choices[0]!, options: options.map((effect, index) => ({ key: String(index), name: String(names[index]), effect })) };
  }
  if (stances.length === 1 && !Array.isArray(names)) {
    const options = stances[0]!.options;
    if (!Array.isArray(options)) return null;
    const named = options.filter((option): option is Node => typeof (option as Node)?.name === "string" && typeof (option as Node)?.id === "string");
    if (named.length !== options.length) return null;
    return { node: stances[0]!, options: named.map((option) => ({ key: String(option.id), name: String(option.name), effect: option.effect })) };
  }
  return null;
}

/** `tree` with the node `target` (by identity) replaced by `replacement`. */
function replaced(tree: unknown, target: Node, replacement: unknown): unknown {
  if (tree === target) return replacement;
  if (Array.isArray(tree)) return tree.map((item) => replaced(item, target, replacement));
  if (tree !== null && typeof tree === "object") {
    return Object.fromEntries(Object.entries(tree as Node).map(([key, value]) => [key, replaced(value, target, replacement)]));
  }
  return tree;
}

/** The ability's named options with their own descriptions; empty when it has no named menu. */
export function namedOptions(record: Node): NamedOption[] {
  const menu = namedMenu(record);
  if (!menu) return [];
  return menu.options.map((option) => ({
    key: option.key,
    name: option.name,
    description: describeAbility({ ...record, effect: replaced(record.effect, menu.node, option.effect) } as unknown as AbilityLike),
  }));
}
