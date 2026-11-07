import { duration } from "./compile-duration-scope.js";
import type { CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/**
 * "In addition, …, until the start of your next Movement phase, roll one D6 each time that unit ends
 * a move": the one duration printed in a later part's lead-in (from the part's start to its first
 * moment) is that part's lifetime, its window. Null when the lead-in prints none, or several.
 */
export function laterPartWindow(list: readonly CompileLeaf[], partStart: number, momentAt: number): string | null {
  const printed = list.slice(partStart, momentAt).filter((leaf) => leaf.role === "DURATION");
  return printed.length === 1 ? duration(printed[0]!) : null;
}

/**
 * A later part under its window: the part takes the window as its duration, and the effects the
 * same duration wrapped (each bound to it by its sentence) are unwrapped, since the part already
 * lasts that long. Effects with another duration keep their own.
 */
export function withPartWindow(part: Node, window: string): Node {
  const unwrap = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(unwrap);
    if (node === null || typeof node !== "object") return node;
    const value = node as Node;
    if (value.type === "ability-part" && value.trigger === undefined && value.duration === window) return unwrap(value.effect);
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, unwrap(inner)]));
  };
  return { ...part, effect: unwrap(part.effect), duration: window };
}

/**
 * "Select one enemy unit … In addition, … each time that unit ends a move, …": a later part whose
 * moment names the selected unit happens while that selection holds, so it nests in the selection's
 * effect, after its own steps. Returns the entry with the part nested, or null when the entry has no
 * one select-units to hold it.
 */
export function nestInSelection(entry: Node, part: Node): Node | null {
  let found = 0;
  const nest = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(nest);
    if (node === null || typeof node !== "object") return node;
    const value = node as Node;
    if (value.type === "select-units") {
      found += 1;
      const inner = value.effect as Node;
      return { ...value, effect: { type: "sequence", steps: [...(inner.type === "sequence" ? inner.steps as Node[] : [inner]), part] } };
    }
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, nest(inner)]));
  };
  const nested = nest(entry) as Node;
  return found === 1 ? nested : null;
}
