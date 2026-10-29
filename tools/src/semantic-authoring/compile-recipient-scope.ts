type Node = Record<string, unknown>;

/** The nodes that apply their effect to each unit they reach, which the DSL calls its `recipient`. */
const RECIPIENT_SCOPES = new Set(["aura", "for-each-unit"]);

/** Structural nodes that carry no target of their own. */
const STRUCTURE = new Set(["conditional", "sequence", "ability-part", "choice"]);

/**
 * The first effect whose own target is `recipient` with no aura or for-each-unit around it, or null. Such an
 * effect names "the unit it is applied to" while nothing applies it to any unit, so it reaches no unit at all.
 */
export function unscopedRecipientEffect(tree: unknown): string | null {
  const walk = (node: unknown, scoped: boolean): string | null => {
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item, scoped);
        if (found !== null) return found;
      }
      return null;
    }
    if (node === null || typeof node !== "object") return null;
    const type = (node as Node).type;
    if (typeof type === "string" && !STRUCTURE.has(type) && !scoped && (node as Node).target === "recipient") return type;
    const inner = scoped || (typeof type === "string" && RECIPIENT_SCOPES.has(type));
    for (const value of Object.values(node as Node)) {
      const found = walk(value, inner);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(tree, false);
}
