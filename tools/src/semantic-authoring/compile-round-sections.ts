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

/** The atoms of a condition: an `and` node's operands, recursively; any other node is one atom. */
function atomsOf(node: Node): Node[] {
  return node.operator === "and" && Array.isArray(node.operands) ? (node.operands as Node[]).flatMap(atomsOf) : [node];
}

/** Every condition-shaped node in a later part, each with whether it is the operand of a `not`. */
function laterConditions(node: unknown, negated = false, out: Array<{ node: Node; negated: boolean }> = []): Array<{ node: Node; negated: boolean }> {
  if (Array.isArray(node)) { for (const item of node) laterConditions(item, negated, out); return out; }
  if (node === null || typeof node !== "object") return out;
  const object = node as Node;
  if (typeof object.type === "string" || typeof object.operator === "string") out.push({ node: object, negated });
  const inner = object.operator === "not";
  for (const value of Object.values(object)) laterConditions(value, inner ? !negated : negated, out);
  return out;
}

const PARAMETER_KEY: Record<string, string> = { "phase-is": "phase", "player-turn-is": "turn" };

/**
 * "In your Shooting phase, …, if this unit is unengaged, … Or: At the end of your opponent's Fight phase, if this
 * unit is engaged, …": the record-wide conditions that a later part contradicts head the first part only. A gate
 * is contradicted when a later part names another phase or player turn, a battle round its rounds do not meet,
 * or the negation of one of its conditions; such a gate cannot hold for the whole record. Returns those
 * conditions of `global`.
 */
export function firstPartContradicted(global: readonly Node[], laterParts: readonly Node[]): Node[] {
  const rounds = firstPartRounds(global, laterParts);
  const later = laterConditions(laterParts);
  const same = (a: Node, b: Node) => JSON.stringify(a) === JSON.stringify(b);
  const contradicted = (atom: Node): boolean => {
    const key = typeof atom.type === "string" ? PARAMETER_KEY[atom.type] : undefined;
    if (key !== undefined) {
      const value = (atom.parameters as Node | undefined)?.[key];
      return later.some(({ node, negated }) => !negated && node.type === atom.type && (node.parameters as Node | undefined)?.[key] !== value);
    }
    if (atom.operator === "not" && Array.isArray(atom.operands) && atom.operands.length === 1) {
      const positive = atom.operands[0] as Node;
      return later.some(({ node, negated }) => !negated && same(node, positive));
    }
    return later.some(({ node }) => node.operator === "not" && Array.isArray(node.operands) && node.operands.length === 1 && same(node.operands[0] as Node, atom));
  };
  return global.filter((node) => rounds.includes(node) || atomsOf(node).some(contradicted));
}
