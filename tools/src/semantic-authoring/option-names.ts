/**
 * The printed names of a record's choice options ("Paragon of Hatred", "Mark of Chaos
 * Ascendant"), read from the named-option leaves its choice compiled from. The DSL choice carries
 * no names, so publication writes them beside the effect as the record's `option_names`.
 */
import { namesItsOptions } from "./compile-containers.js";
import type { CompileLeaf } from "./compile-fragments.js";
import { ordered } from "./compile-placement.js";

/** Every `choice` node in an effect tree, outermost first. */
export function choiceNodes(node: unknown, found: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const item of node) choiceNodes(item, found);
  } else if (node !== null && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (record.type === "choice") found.push(record);
    for (const value of Object.values(record)) choiceNodes(value, found);
  }
  return found;
}

/**
 * The option names for a record compiled from `leaves` into `effect`, or null when they cannot be
 * read without guessing: the effect must hold exactly one choice, the leaves exactly one
 * choice-open and no other opener that names its options, and every named-option leaf must come
 * after the choice-open with one label per option. The choice compiles its options in leaf order,
 * splitting at each named-option, so the labels in that order are the options' names.
 */
export function choiceOptionNames(leaves: readonly CompileLeaf[], effect: unknown): string[] | null {
  const choices = choiceNodes(effect);
  if (choices.length !== 1) return null;
  const options = choices[0]!.options;
  if (!Array.isArray(options)) return null;
  const list = ordered(leaves);
  const openers = list.flatMap((leaf, index) => (leaf.family_id === "choice-open" ? [index] : []));
  if (openers.length !== 1) return null;
  if (list.some((leaf) => namesItsOptions(leaf.family_id) || leaf.family_id === "resource-action-menu-open")) return null;
  const named = list.flatMap((leaf, index) => (leaf.family_id === "named-option" ? [{ leaf, index }] : []));
  if (named.length !== options.length || named.some(({ index }) => index < openers[0]!)) return null;
  const labels = named.map(({ leaf }) => leaf.parameters.label);
  if (!labels.every((label): label is string => typeof label === "string" && label.trim().length > 0)) return null;
  return labels.map((label) => label.trim());
}
