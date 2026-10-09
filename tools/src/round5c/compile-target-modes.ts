import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * Exclusive target modes of a Stratagem's TARGET ("Up to two X units, or one other Y unit"; "One X
 * unit. Alternatively, you can spend 2YP and target up to two X units instead"). A target that
 * follows an "or" (or "Alternatively") in the uncovered text opens a mode; the player picks one
 * mode, so the targets of an unchosen mode are not selected. The connective is read from the text
 * between leaves, never from a leaf: a leaf says what its wording means, and "or" is not one.
 *
 * Mode letters run a, then b. A mode with a cost ("spend 2YP") carries it as mode_cost on each of
 * its targets, and the resource-spend and optional-use leaves that say it are consumed here, so no
 * effect pays for them.
 */

export type ModeCost = { label: string; amount: number };

/** Leaves that may sit between two targets' wording without ending the first target's group. */
const LEAD_FAMILIES = new Set(["optional-use", "resource-spend", "event"]);
const SELECTOR_FAMILIES = new Set(["stratagem-target"]);
const OR_CONNECTIVE = /(?:^|[\s,;:.])or(?=\s|$)/iu;
const ONE_OR_MORE = /\bor\s+more\b/giu;
const ALTERNATIVELY = /\balternatively\b/iu;

export type ModeAnnotated = { leaves: CompileLeaf[] };

/**
 * Annotates each Stratagem target leaf with its mode (and mode_cost), and drops the lead-in leaves
 * a paid mode consumes. Returns the leaves unchanged when no target opens a mode.
 */
export function assignTargetModes(list: readonly CompileLeaf[], sourceText: string | undefined): ModeAnnotated {
  if (sourceText === undefined) return { leaves: [...list] };
  const bytes = Buffer.from(sourceText, "utf8");
  const selectors = list.flatMap((leaf, index) => SELECTOR_FAMILIES.has(leaf.family_id) && leaf.fragment === "TARGET" ? [index] : []);
  if (selectors.length < 2) return { leaves: [...list] };
  // Each target after the first: the leaf-free text before it, and the leaves that sit in that text.
  const openers = new Map<number, { paid: boolean; consumed: number[] }>();
  for (const at of selectors.slice(1)) {
    const selector = list[at]!;
    const before = list.slice(0, at);
    const prevEnd = Math.max(0, ...before.flatMap((leaf) => LEAD_FAMILIES.has(leaf.family_id) && leaf.fragment === "TARGET" ? [] : [leaf.end_byte ?? leaf.start_byte]));
    const lead = before.flatMap((leaf, index) => LEAD_FAMILIES.has(leaf.family_id) && leaf.fragment === "TARGET" && leaf.start_byte >= prevEnd ? [index] : []);
    const gap = uncoveredText(bytes, prevEnd, selector.start_byte, lead.map((index) => list[index]!));
    const orConnective = OR_CONNECTIVE.test(gap.replace(ONE_OR_MORE, " "));
    const paid = ALTERNATIVELY.test(gap);
    if (!orConnective && !paid) continue;
    const costs = lead.filter((index) => list[index]!.family_id === "resource-spend");
    const consumed = paid && costs.length ? lead.filter((index) => ["optional-use", "resource-spend"].includes(list[index]!.family_id)) : [];
    if (!paid || costs.length === 0) {
      const optional = lead.find((index) => list[index]!.family_id === "optional-use");
      if (optional !== undefined) throw new CompileError("An optional extra target cannot sit in a target mode; state the extra target without \"you can\" or drop the mode.");
    }
    openers.set(at, { paid: paid && costs.length > 0, consumed });
  }
  if (openers.size === 0) return { leaves: [...list] };
  const modes: string[] = [];
  let mode = "a";
  const costOf = new Map<string, ModeCost>();
  const consumedAt = new Set<number>();
  selectors.forEach((at, position) => {
    const opener = openers.get(at);
    if (position === 0) modes.push(mode);
    else if (opener) {
      if (mode === "b") throw new CompileError("A Stratagem names more than two target modes; the compiler names two.");
      mode = "b";
      modes.push(mode);
      if (opener.paid) {
        const cost = costLeaf(list, opener.consumed);
        costOf.set(mode, cost);
        opener.consumed.forEach((index) => consumedAt.add(index));
      }
    } else modes.push(mode);
  });
  // An "instead" that ends a paid mode replaces the first target's use, so the mode decides it.
  if (costOf.size) list.forEach((leaf, index) => {
    if (leaf.family_id === "instead" && leaf.fragment === "TARGET" && leaf.role === "COMBINATOR") consumedAt.add(index);
  });
  // Every other mode-b target must not hold an optional-use of its own (already refused above).
  const out: CompileLeaf[] = [];
  list.forEach((leaf, index) => {
    if (consumedAt.has(index)) return;
    const at = selectors.indexOf(index);
    if (at === -1) { out.push(leaf); return; }
    const cost = costOf.get(modes[at]!);
    out.push({ ...leaf, mode: modes[at]!, ...(cost ? { mode_cost: cost } : {}) });
  });
  return { leaves: out };
}

/** The leaf-free text in [start, end), with the lead-in leaves' spans removed. */
function uncoveredText(bytes: Buffer, start: number, end: number, leaves: readonly CompileLeaf[]): string {
  const keep: Buffer[] = [];
  let at = start;
  for (const leaf of [...leaves].sort((a, b) => a.start_byte - b.start_byte)) {
    const leafEnd = leaf.end_byte ?? leaf.start_byte;
    if (leaf.start_byte > at) keep.push(bytes.subarray(at, Math.min(leaf.start_byte, end)));
    at = Math.max(at, leafEnd);
  }
  if (at < end) keep.push(bytes.subarray(at, end));
  return Buffer.concat(keep).toString("utf8");
}

/**
 * The cost a paid mode names: the resource-spend in its lead-in, one fixed amount of one pool.
 * Refuses a spend that is not a fixed amount ("spend all"), or more than one spend.
 */
function costLeaf(list: readonly CompileLeaf[], consumed: readonly number[]): ModeCost {
  const spends = consumed.map((index) => list[index]!).filter((leaf) => leaf.family_id === "resource-spend");
  if (spends.length !== 1) throw new CompileError("A target mode names one resource spend as its cost.");
  const { pool, amount } = spends[0]!.parameters as { pool: unknown; amount: unknown };
  const label = typeof pool === "string" ? pool : (pool as { source?: unknown } | null)?.source;
  if (typeof label !== "string" || label.length === 0) throw new CompileError("A target mode's cost names its resource pool.");
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) throw new CompileError("A target mode's cost is a fixed whole number of its pool.");
  return { label, amount };
}
