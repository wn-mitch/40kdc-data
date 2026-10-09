import { wordingBetween } from "./compile-discontiguous-gap.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { ordered } from "./compile-placement.js";
import { normalizeFingerprintParameters } from "./contracts.js";

/**
 * "That Vehicle model's attacks can ignore modifiers to the following until the start of your next
 * Movement phase: BS. Hit rolls and Wound rolls": the lead-in names the list after it, and each
 * list item is one ignore-modifier-list leaf. The binder folds the items onto the lead-in: `what`
 * becomes the kinds the items name, and stats and rolls come from the items. Only a duration may
 * sit between the lead-in and its first item, and the wording must be a colon there and a full stop
 * between items. A lead-in whose own wording says "to the following" must be followed by its list.
 * A lead-in without that wording is an ignore-modifiers leaf with nothing to fold, and it is left
 * as it is.
 */

const LIST = "ignore-modifier-list";
const LEAD = "ignore-modifiers";
const FORWARD = /\bthe following\s*$/iu;
const BEFORE_FIRST = /^[\s*]*:[\s*]*$/u;
const BETWEEN_ITEMS = /^[\s*]*\.[\s*.]*$/u;

type Open = { host: CompileLeaf; items: CompileLeaf[]; pending: CompileLeaf[] };

const isLead = (leaf: CompileLeaf) => leaf.family_id === LEAD && leaf.family_version >= 3 && Array.isArray(leaf.parameters.what);

export function bindIgnoreLists(leaves: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (!leaves.some((leaf) => leaf.family_id === LIST)) return [...leaves];
  if (sourceText === undefined) throw new CompileError("An ignore-modifier list needs source text to verify its clause.");
  const source = Buffer.from(sourceText, "utf8");
  const sorted = ordered(leaves);
  const groups: Open[] = [];
  const awaitsList = (open: Open) => FORWARD.test(source.subarray(open.host.start_byte, open.host.end_byte ?? open.host.start_byte).toString("utf8"));
  const close = (open: Open | null) => {
    if (open === null) return;
    if (open.items.length > 0) { groups.push(open); return; }
    if (awaitsList(open)) throw new CompileError(`The ignore-modifiers lead-in at byte ${open.host.start_byte} names a list after it, and no list follows it in its clause.`);
  };
  let open: Open | null = null;
  for (const leaf of sorted) {
    if (isLead(leaf)) {
      close(open);
      open = { host: leaf, items: [], pending: [] };
      continue;
    }
    if (leaf.family_id === LIST) {
      if (open === null || open.host.fragment !== leaf.fragment) {
        throw new CompileError(`An ignore-modifier list at byte ${leaf.start_byte} has no ignore-modifiers lead-in before it in its clause.`);
      }
      if (open.host.parameters.stats !== undefined || open.host.parameters.rolls !== undefined) {
        throw new CompileError(`The ignore-modifiers lead-in at byte ${open.host.start_byte} already names stats or rolls; its list cannot add more.`);
      }
      const previous = open.items[open.items.length - 1] ?? open.host;
      const gap = wordingBetween(source, previous, leaf, open.pending);
      if (open.items.length === 0) {
        if (!BEFORE_FIRST.test(gap)) throw new CompileError(`The ignore-modifier list at byte ${leaf.start_byte} must follow its lead-in after a colon, after only its duration.`);
      } else {
        if (open.pending.length > 0) throw new CompileError(`A duration sits between ignore-modifier list items at byte ${leaf.start_byte}; only the first item follows a duration.`);
        if (!BETWEEN_ITEMS.test(gap)) throw new CompileError(`The ignore-modifier list item at byte ${leaf.start_byte} must follow the previous item after a full stop.`);
      }
      for (const key of ["stats", "rolls"] as const) {
        if (leaf.parameters[key] !== undefined && open.items.some((item) => item.parameters[key] !== undefined)) {
          throw new CompileError(`Two ignore-modifier list items name ${key}; list each kind once.`);
        }
      }
      open.items.push(leaf);
      open.pending = [];
      continue;
    }
    if (open !== null && leaf.role === "DURATION") { open.pending.push(leaf); continue; }
    if (open !== null && open.items.length === 0 && awaitsList(open)) {
      throw new CompileError(`A ${leaf.family_id} leaf at byte ${leaf.start_byte} sits between the ignore-modifiers lead-in and its list.`);
    }
    close(open);
    open = null;
  }
  close(open);
  const folded = new Map<CompileLeaf, CompileLeaf>();
  const dropped = new Set<CompileLeaf>();
  for (const group of groups) {
    const stats = group.items.find((item) => item.parameters.stats !== undefined)?.parameters.stats;
    const rolls = group.items.find((item) => item.parameters.rolls !== undefined)?.parameters.rolls;
    const parameters: Record<string, unknown> = { ...group.host.parameters, what: [...(stats !== undefined ? ["characteristics"] : []), ...(rolls !== undefined ? ["rolls"] : [])] };
    delete parameters.stats;
    delete parameters.rolls;
    if (stats !== undefined) parameters.stats = stats;
    if (rolls !== undefined) parameters.rolls = rolls;
    let normalized: Record<string, unknown>;
    try {
      normalized = normalizeFingerprintParameters(LEAD, parameters, group.host.family_version);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      throw new CompileError(`The ignore-modifier list at byte ${group.host.start_byte} cannot fold onto its lead-in: ${error.message}`);
    }
    folded.set(group.host, { ...group.host, parameters: normalized });
    for (const item of group.items) dropped.add(item);
  }
  return leaves.flatMap((leaf) => {
    if (dropped.has(leaf)) return [];
    return [folded.get(leaf) ?? leaf];
  });
}
