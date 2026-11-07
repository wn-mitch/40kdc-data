type Node = Record<string, unknown>;

/** The rounds a battle-round condition holds in, from min to max (no max: every round from min). */
function roundsOf(node: Node): [number, number] | null {
  if (node.type !== "battle-round") return null;
  const parameters = (node.parameters ?? {}) as Node;
  const min = typeof parameters.min === "number" ? parameters.min : 1;
  return [min, typeof parameters.max === "number" ? parameters.max : Number.POSITIVE_INFINITY];
}

/** Every battle-round condition anywhere in a node. */
function roundConditions(node: unknown): Array<[number, number]> {
  if (Array.isArray(node)) return node.flatMap(roundConditions);
  if (node === null || typeof node !== "object") return [];
  const own = roundsOf(node as Node);
  return [...(own ? [own] : []), ...Object.values(node as Node).flatMap(roundConditions)];
}

/**
 * "Battle Round one … At the start of the first battle round, …. Battle round two onwards … during the second … battle
 * rounds, …": the record-wide battle-round conditions that a later part's own battle-round condition excludes (their
 * rounds and the later part's do not meet) head the first part only. Two disjoint round ranges cannot both gate the
 * whole record. Returns those conditions of `global`.
 */
export function firstPartRounds(global: readonly Node[], laterParts: readonly Node[]): Node[] {
  const later = laterParts.flatMap(roundConditions);
  return global.filter((node) => {
    const own = roundsOf(node);
    return own !== null && later.some(([min, max]) => max < own[0] || min > own[1]);
  });
}
