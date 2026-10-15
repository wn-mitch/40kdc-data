import { allOf, anyOf, condition, negate } from "./compile-conditions.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/**
 * The designation an optional spend of a pool sets, for version-1 window-use leaves that name no
 * tag. Version 2 leaves name their own tag (optional-cost-paid@2, families/army.ts).
 */
export const OPTIONAL_COST_TAGS: Record<string, string> = { "yp-pool": "yp-spent-this-use" };

/** A read of an optional spend that the ability's own spend feeds: this use, or a trigger later in the ability. */
export function isSpendRead(leaf: CompileLeaf): boolean {
  return leaf.family_id === "optional-cost-paid" && (leaf.parameters.window === "use" || leaf.parameters.window === "trigger");
}

/** Every leaf of an ability, with the conditions folded into an any-of unfolded again. */
export function flatLeaves(list: readonly CompileLeaf[]): CompileLeaf[] {
  return list.flatMap((leaf) => leaf.family_id === "__any-of"
    ? flatLeaves((leaf.parameters.alternatives as CompileLeaf[][]).flat())
    : [leaf]);
}

/** The designation tag a read tests and its spend sets. */
export function optionalCostTag(leaf: CompileLeaf): string {
  if (typeof leaf.parameters.tag === "string") return leaf.parameters.tag;
  const legacy = leaf.family_version === 1 && leaf.parameters.window === "use" ? OPTIONAL_COST_TAGS[String(leaf.parameters.pool)] : undefined;
  if (legacy === undefined) throw new CompileError(`optional-cost-paid window ${String(leaf.parameters.window)} names no designation tag.`);
  return legacy;
}

/**
 * The condition an optional-cost-paid leaf lowers to. Window use and window trigger read the
 * designation their optional spend set on the named subject. Window turn reads the resource-spent
 * events of the turn; "no spend in that turn" is its negation.
 */
export function optionalCostCondition(leaf: CompileLeaf): Node {
  const pool = String(leaf.parameters.pool);
  if (isSpendRead(leaf)) {
    return { type: "designated", parameters: { subject: leaf.parameters.subject, tag: optionalCostTag(leaf) } };
  }
  const spent: Node = { type: "happened", parameters: { event: "resource-spent", filter: { pool }, window: "turn" } };
  return leaf.parameters.negated === true ? { operator: "not", operands: [spent] } : spent;
}

/** The resource-spend leaves of an ability that an optional-cost read makes optional. */
export function optionalSpendLeaves(list: readonly CompileLeaf[]): Set<CompileLeaf> {
  const pools = new Set(flatLeaves(list).filter(isSpendRead).map((leaf) => leaf.parameters.pool));
  return new Set(list.filter((leaf) => leaf.family_id === "resource-spend" && pools.has(leaf.parameters.pool)));
}

/**
 * Refuses a read of an optional spend that does not pair with one spend of its pool in the same
 * ability. Window use: exactly one spend, a used event that starts the ability, and an optional-use.
 * Window trigger: exactly one spend, and the spend is optional, which holds when the ability has an
 * optional-use or when the read and the spend are alternatives joined by "or" (compile-optional-cost.ts,
 * optionalOrPairing). Window turn needs no pairing.
 */
export function checkOptionalCosts(list: readonly CompileLeaf[], sourceText?: string): void {
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
  for (const read of list) {
    if (read.family_id !== "optional-cost-paid" || read.parameters.window !== "trigger") continue;
    const pool = read.parameters.pool;
    const spends = list.filter((leaf) => leaf.family_id === "resource-spend" && leaf.parameters.pool === pool);
    if (spends.length !== 1) {
      throw new CompileError(`A trigger that reads whether ${String(pool)} was spent needs exactly one spend of that pool in its ability; it has ${spends.length}.`);
    }
    const optional = list.some((leaf) => leaf.family_id === "optional-use") || (sourceText !== undefined && optionalOrPairing(list, read, spends[0]!, sourceText));
    if (!optional) {
      throw new CompileError("A spend that a trigger reads is mandatory: it needs an optional-use in the ability, or the read and the spend must be alternatives joined by \"or\".");
    }
  }
}

const OR_AFTER = /^[\s,*()]*(?:or|and\/or)\b/iu;
const OR_BETWEEN = /^[\s,*()]*(?:or|and\/or)[\s*()]*$/iu;

/**
 * Whether a trigger read and its spend are alternatives: a condition in the same fragment sits
 * beside the read joined by "or" (or "and/or"), and the spend sits right beside the read.
 */
export function optionalOrPairing(list: readonly CompileLeaf[], read: CompileLeaf, spend: CompileLeaf, sourceText: string): boolean {
  const bytes = Buffer.from(sourceText, "utf8");
  const sameFragment = (leaf: CompileLeaf) => leaf !== read && leaf.role === "CONDITION" && leaf.fragment === read.fragment && leaf.end_byte !== undefined;
  const before = list.filter((leaf) => sameFragment(leaf) && leaf.end_byte! <= read.start_byte).sort((a, b) => b.end_byte! - a.end_byte!)[0];
  const after = list.filter((leaf) => sameFragment(leaf) && leaf.start_byte >= read.end_byte!).sort((a, b) => a.start_byte - b.start_byte)[0];
  const orBefore = before !== undefined && OR_AFTER.test(bytes.subarray(before.end_byte!, read.end_byte!).toString("utf8"));
  const orAfter = after !== undefined && OR_BETWEEN.test(bytes.subarray(read.end_byte!, after.start_byte).toString("utf8"));
  if (!orBefore && !orAfter) return false;
  const gap = spend.start_byte >= read.end_byte!
    ? bytes.subarray(read.end_byte!, spend.start_byte).toString("utf8")
    : read.start_byte >= spend.end_byte! ? bytes.subarray(spend.end_byte!, read.start_byte).toString("utf8") : null;
  return gap !== null && /^\s*$/u.test(gap);
}

/** The other alternatives a read was folded with into one any-of: each is a group of conditions that hold together. */
function partnerGroups(list: readonly CompileLeaf[], read: CompileLeaf): CompileLeaf[][] {
  for (const leaf of list) {
    if (leaf.family_id !== "__any-of") continue;
    const alternatives = leaf.parameters.alternatives as CompileLeaf[][];
    if (alternatives.some((group) => group.includes(read))) return alternatives.filter((group) => !group.includes(read));
  }
  return [];
}

/**
 * Makes each optional spend a declinable part: `ability-part { optional, effect: [spend, designate] }`.
 * A use's part is offered once per use. A trigger's part is gated on the designation not yet
 * being set on the holder (so a paid spend is not offered again that phase), and on each
 * alternative the read was joined with by "or" not holding (the spend is the other alternative).
 * The designate sets the tag on the holder and clears it at the clause's duration.
 * Declining skips the whole part, so nothing is spent and the designation is not set.
 */
export function wrapOptionalSpends(body: Node | Node[], list: readonly CompileLeaf[], durations: readonly string[]): Node | Node[] {
  const reads = flatLeaves(list).filter(isSpendRead);
  let result: Node | Node[] = body;
  for (const pool of [...new Set(reads.map((leaf) => String(leaf.parameters.pool)))]) {
    const group = reads.filter((leaf) => leaf.parameters.pool === pool);
    const tags = [...new Set(group.map(optionalCostTag))];
    if (tags.length !== 1) throw new CompileError(`The optional spend of ${pool} sets one designation; its reads name ${tags.length}.`);
    const windows = [...new Set(group.map((leaf) => String(leaf.parameters.window)))];
    if (windows.length !== 1) throw new CompileError(`The reads of the optional spend of ${pool} must share one window.`);
    const tag = tags[0]!;
    const holder = windows[0] === "trigger" ? String(group[0]!.parameters.holder ?? "this-unit") : "this-unit";
    if (holder !== "this-unit") throw new CompileError(`A designation held by the ${holder} of a spend of ${pool} has no compiled shape yet.`);
    const clearsOn = durations[0];
    if (windows[0] === "trigger" && clearsOn === undefined) throw new CompileError(`The trigger that reads the optional spend of ${pool} names no duration for its designation.`);
    const gates: Node[] = windows[0] === "trigger" ? triggerGates(list, group, tag, holder) : [];
    const found = { done: false };
    result = replaceSpend(result, pool, (spend) => {
      const designate: Node = { type: "designate", target: holder, modifier: { tag, clears_on: clearsOn ?? "phase" } };
      const sequence: Node = { type: "sequence", steps: [spend, designate] };
      const allowed = allOf(gates);
      return { type: "ability-part", optional: true, effect: allowed ? { type: "conditional", condition: allowed, effect: sequence } : sequence };
    }, found);
    if (!found.done) throw new CompileError(`The optional spend of ${pool} is not in the effects of this ability.`);
  }
  return result;
}

/** A trigger's gates: the designation is not yet set, and no "or" alternative holds. */
function triggerGates(list: readonly CompileLeaf[], reads: readonly CompileLeaf[], tag: string, holder: string): Node[] {
  const gates: Node[] = [negate({ type: "designated", parameters: { subject: holder, tag } })];
  for (const read of reads) {
    const partners = partnerGroups(list, read);
    if (partners.length === 0) continue;
    const alternatives = partners.map((group) => {
      const nodes = group.map(condition);
      return nodes.length === 1 ? nodes[0]! : { operator: "and", operands: nodes };
    });
    gates.push(negate(anyOf(alternatives)));
  }
  return gates;
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
