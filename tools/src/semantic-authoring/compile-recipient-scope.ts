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

/** The nodes that bind the unit a selection picked, which the DSL calls `selected-unit`. */
const SELECTION_SCOPES = new Set(["select-units", "designate-target", "persistent-designation"]);

/**
 * Whether the mechanics name `selected-unit` with no selection around it: "Select one enemy unit …. At the end of the
 * phase, that unit suffers …" whose later part was assembled beside the selection, not inside it, names a unit nothing
 * picked. An action's own eligibility selector (a selector with a count) picks its candidate, so it binds the unit too.
 */
export function hasUnboundSelectedUnit(tree: unknown): boolean {
  const walk = (node: unknown, bound: boolean): boolean => {
    if (node === "selected-unit") return !bound;
    if (Array.isArray(node)) return node.some((item) => walk(item, bound));
    if (node === null || typeof node !== "object") return false;
    const type = (node as Node).type;
    const eligibility = (node as Node).eligibility as Node | undefined;
    const binds = bound || (typeof type === "string" && SELECTION_SCOPES.has(type)) || (eligibility !== null && typeof eligibility === "object" && "count" in eligibility);
    return Object.values(node as Node).some((value) => walk(value, binds));
  };
  return walk(tree, false);
}
