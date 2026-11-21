import { CompileError } from "./compile-fragments.js";

/**
 * "Spend up to 3YP and … add the number of YP you just spent to the Damage characteristic": a
 * resource-spend binds the amount it spent (`bind_as`), and a `{spent}` amount after it reads it.
 * Each read must name a spend that comes before it in the ability, each name is bound once, and a
 * bound amount must be read. The walk follows the compiled tree in document order.
 */
export function checkSpentReferences(effect: unknown): void {
  const bound: string[] = [];
  const read = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (typeof record.spent === "string" && Object.keys(record).every((key) => key === "spent" || key === "per")) {
      if (!bound.includes(record.spent)) throw new CompileError(`An amount reads what was spent as ${record.spent}, but no resource spend before it binds that name.`);
      read.add(record.spent);
      return;
    }
    if (record.type === "resource-spend") {
      const name = (record.modifier as Record<string, unknown> | undefined)?.bind_as;
      if (typeof name === "string") {
        if (bound.includes(name)) throw new CompileError(`Two resource spends bind the spent amount ${name}.`);
        bound.push(name);
      }
    }
    for (const value of Object.values(record)) walk(value);
  };
  walk(effect);
  const unread = bound.filter((name) => !read.has(name));
  if (unread.length) throw new CompileError(`A resource spend binds ${unread.join(", ")}, but no amount reads it.`);
}
