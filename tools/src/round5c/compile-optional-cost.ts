import { CompileError, type CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/**
 * The designation an optional spend of a pool sets on the unit it is spent for. The designation
 * is registered in translate/designations.ts; the read (window use) tests it.
 */
export const OPTIONAL_COST_TAGS: Record<string, string> = { "yp-pool": "yp-spent-this-use" };

/**
 * The condition an optional-cost-paid leaf lowers to. Window use reads the designation its
 * optional spend set on the named subject. Window turn reads the resource-spent events of the
 * turn; "no spend in that turn" is its negation.
 */
export function optionalCostCondition(leaf: CompileLeaf): Node {
  const pool = String(leaf.parameters.pool);
  if (leaf.parameters.window === "use") {
    const tag = OPTIONAL_COST_TAGS[pool];
    if (tag === undefined) throw new CompileError(`optional-cost-paid has no designation for pool ${pool}.`);
    return { type: "designated-filter", parameters: { subject: leaf.parameters.subject, tag } };
  }
  const spent: Node = { type: "happened", parameters: { event: "resource-spent", filter: { pool }, window: "turn" } };
  return leaf.parameters.negated === true ? { operator: "not", operands: [spent] } : spent;
}

/**
 * Refuses an optional-cost-paid (window use) leaf that does not pair with one optional spend of
 * its pool in the same ability: exactly one resource-spend of the pool, a used event that starts
 * the ability, and an optional-use that makes the spend optional. Window turn needs no pairing.
 */
export function checkOptionalCosts(list: readonly CompileLeaf[]): void {
  for (const read of list) {
    if (read.family_id !== "optional-cost-paid" || read.parameters.window !== "use") continue;
    const pool = read.parameters.pool;
    const spends = list.filter((leaf) => leaf.family_id === "resource-spend" && leaf.parameters.pool === pool);
    if (spends.length !== 1) {
      throw new CompileError(`A use that reads whether ${String(pool)} was spent this use needs exactly one spend of that pool in its ability; it has ${spends.length}.`);
    }
    if (spends[0]!.start_byte > read.start_byte) throw new CompileError("A use reads a spend that comes after the read.");
    if (!list.some((leaf) => leaf.family_id === "optional-use")) throw new CompileError("An optional spend read by a use needs an optional-use in the ability.");
    if (!list.some((leaf) => leaf.family_id === "event" && leaf.parameters.kind === "used")) {
      throw new CompileError("A spend read as this use needs a used event that starts the ability.");
    }
  }
}

/**
 * Makes each optional spend a declinable part: `ability-part { optional, effect: [spend, designate] }`.
 * The designate sets the pool's designation on the target unit, and clears it at `clearsOn`.
 * Declining skips the whole part, so nothing is spent and the designation is not set.
 */
export function wrapOptionalSpends(body: Node | Node[], list: readonly CompileLeaf[], clearsOn: string): Node | Node[] {
  const pools = [...new Set(list.filter((leaf) => leaf.family_id === "optional-cost-paid" && leaf.parameters.window === "use").map((leaf) => String(leaf.parameters.pool)))];
  let result: Node | Node[] = body;
  for (const pool of pools) {
    const tag = OPTIONAL_COST_TAGS[pool];
    if (tag === undefined) throw new CompileError(`optional-cost-paid has no designation for pool ${pool}.`);
    const found = { done: false };
    result = replaceSpend(result, pool, (spend) => {
      const designate: Node = { type: "designate", target: "this-unit", modifier: { tag, clears_on: clearsOn } };
      return { type: "ability-part", optional: true, effect: { type: "sequence", steps: [spend, designate] } };
    }, found);
    if (!found.done) throw new CompileError(`The optional spend of ${pool} is not in the effects of this ability.`);
  }
  return result;
}

/** Replaces the first resource-spend of `pool` in a tree, depth first, leaving the rest unchanged. */
function replaceSpend(node: unknown, pool: string, make: (spend: Node) => Node, found: { done: boolean }): any {
  if (found.done) return node;
  if (Array.isArray(node)) return node.map((item) => replaceSpend(item, pool, make, found));
  if (node === null || typeof node !== "object") return node;
  const record = node as Node;
  if (record.type === "resource-spend" && (record.modifier as Node | undefined)?.pool === pool) {
    found.done = true;
    return make(record);
  }
  const out: Node = {};
  for (const [key, value] of Object.entries(record)) out[key] = replaceSpend(value, pool, make, found);
  return out;
}
