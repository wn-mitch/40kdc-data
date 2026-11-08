import { exactSpan } from "./contracts.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import type { PlannedEffect } from "./compile-part-plan.js";
import { selectUnit } from "./compile-wrappers.js";

/**
 * Several selections that stand apart, each bound by its own name, which the record's leaves name
 * one by one (a leaf's reviewed `selection`): "select one friendly X unit and one friendly Y unit
 * …. That X unit suffers …, and one model in the selected Y unit regains …". The selections nest in
 * printed order, each with its own conditions, and each leaf takes the unit it names.
 */

type Node = Record<string, unknown>;

/** The references a `selection` goes with, by family: the field the compiler fills with the named unit. */
const REFERRING: Record<string, (leaf: CompileLeaf, name: string) => CompileLeaf> = {
  "mortal-wounds": (leaf, name) => ({ ...leaf, parameters: { ...without(leaf.parameters), recipient_selection: name } }),
  "regain-wounds": (leaf, name) => ({ ...leaf, parameters: { ...without(leaf.parameters), subject: { selection_var: name } } }),
  attack: (leaf, name) => ({ ...leaf, parameters: { ...without(leaf.parameters), attacker_filter: { selection_var: name } } }),
};

function without(parameters: Record<string, unknown>): Record<string, unknown> {
  const { selection: _selection, ...rest } = parameters;
  return rest;
}

/**
 * Each leaf's `selection` as the unit its family takes (REFERRING). Refuses a name no select-unit
 * of the record binds, and two select-units that bind one name.
 */
export function bindSelectionRefs(list: readonly CompileLeaf[]): CompileLeaf[] {
  if (!list.some((leaf) => typeof leaf.parameters.selection === "string")) return [...list];
  const names = list.filter((leaf) => leaf.family_id === "select-unit" && typeof leaf.parameters.bind_as === "string").map((leaf) => String(leaf.parameters.bind_as));
  if (new Set(names).size !== names.length) throw new CompileError("Two selections bind the same name.");
  return list.map((leaf) => {
    const name = leaf.parameters.selection;
    if (typeof name !== "string") return leaf;
    if (!names.includes(name)) throw new CompileError(`${leaf.family_id} names the selection "${name}", which this ability does not bind.`);
    const bind = REFERRING[leaf.family_id];
    if (!bind) throw new CompileError(`${leaf.family_id} cannot name a selection.`);
    return bind(leaf, name);
  });
}

/** Whether a leaf names one bound selection by name (after bindSelectionRefs). */
function namesSelection(leaf: CompileLeaf): boolean {
  const isName = (value: unknown) => typeof (value as Node | null | undefined)?.selection_var === "string";
  return typeof leaf.parameters.recipient_selection === "string" || isName(leaf.parameters.subject) || isName(leaf.parameters.attacker_filter);
}

/** A leaf that names a selected unit without saying which: the bare anaphors a single selection would take. */
function namesUnnamedSelected(leaf: CompileLeaf): boolean {
  if (leaf.role !== "EFFECT" && leaf.family_id !== "attack") return false;
  const references = [leaf.parameters.recipient, leaf.parameters.subject, leaf.parameters.unit, leaf.parameters.target];
  return !namesSelection(leaf) && references.some((value) => value === "that-unit" || value === "antecedent" || value === "selected-unit");
}

/**
 * The selections of a named chain in printed order, or null when no leaf names a selection (the
 * caller keeps its other readings). Every selection is bound by its own name and none is measured
 * from or visible to another (that is a bound pair, compile-bound-selection.ts). Refuses a leaf after
 * the selections that names a selected unit without saying which.
 */
export function namedSelectionChain(list: readonly CompileLeaf[], selections: readonly CompileLeaf[]): CompileLeaf[] | null {
  if (selections.length < 2 || !list.some(namesSelection)) return null;
  if (selections.some((leaf) => typeof leaf.parameters.bind_as !== "string")) throw new CompileError("Each of several selections a leaf names by name needs its own name (bind_as).");
  if (selections.some((leaf) => leaf.parameters.within_of !== undefined || leaf.parameters.visible_to !== undefined)) return null;
  const first = list.indexOf(selections[0]!);
  const unnamed = list.slice(first).find(namesUnnamedSelected);
  if (unnamed) throw new CompileError(`${unnamed.family_id} names a selected unit, but this ability selects several; its leaf must say which (selection).`);
  return [...selections];
}

/** "each within 9\" of …": a condition whose printed span opens with "each" is about every selection before it. */
const EACH = /^\s*\**\s*each\b/iu;

/**
 * Each selection's own conditions, from the conditions on the selected unit (`eligibilityIndexes`):
 * a condition belongs to the nearest selection before it, except that one printed after the last
 * selection that opens with "each", and every condition after it, belongs to all of them
 * ("one X unit and one Y unit each within 9\" of and visible to …").
 */
export function chainEligibility(list: readonly CompileLeaf[], chain: readonly CompileLeaf[], eligibilityIndexes: readonly number[], sourceText: string | undefined): number[][] {
  const at = chain.map((leaf) => list.indexOf(leaf));
  const last = at.at(-1)!;
  const opens = eligibilityIndexes.find((index) => {
    const leaf = list[index]!;
    return index > last && sourceText !== undefined && leaf.end_byte !== undefined && EACH.test(exactSpan(sourceText, leaf.start_byte, leaf.end_byte));
  });
  return at.map((selectionAt, position) => eligibilityIndexes.filter((index) => {
    if (opens !== undefined && index >= opens) return true;
    const owner = at.filter((other) => other < index).at(-1);
    return owner === selectionAt && (position === at.length - 1 || index < at[position + 1]!);
  }));
}

/**
 * Whether a loop before the chain runs it once per pass ("for each X unit from your army, you can
 * select one Y unit and one Z unit each within 9\" of that X unit"): the loop comes first in the
 * chain's part, every effect of that part follows the last selection, and a selection's condition
 * measures from or looks to the pass's unit (recipient).
 */
export function chainPerPass(list: readonly CompileLeaf[], loop: CompileLeaf, chain: readonly CompileLeaf[], eligibilityIndexes: readonly number[],
  planned: readonly PlannedEffect[], partOfLeaf: (leaf: CompileLeaf) => number): boolean {
  const loopAt = list.indexOf(loop);
  const first = list.indexOf(chain[0]!);
  const last = list.indexOf(chain.at(-1)!);
  if (loopAt > first || chain.some((leaf) => partOfLeaf(leaf) !== partOfLeaf(loop))) return false;
  if (planned.some((item) => partOfLeaf(list[item.index]!) === partOfLeaf(loop) && item.index < last)) return false;
  return eligibilityIndexes.some((index) => index > first && JSON.stringify(list[index]!.parameters).includes("\"recipient\""));
}

/** The chain's selections around `body`, the first outermost, each gated by its own conditions (chainEligibility). */
export function wrapNamedChain(list: readonly CompileLeaf[], chain: readonly CompileLeaf[], body: Node, eligibilityIndexes: readonly number[],
  sourceText: string | undefined, conditionAt: (index: number) => Node): Node {
  const own = chainEligibility(list, chain, eligibilityIndexes, sourceText);
  return chain.reduceRight((inner, selection, position) => {
    const conditions = own[position]!.map(conditionAt);
    const eligibility = conditions.length === 0 ? null : conditions.length === 1 ? conditions[0]! : { operator: "and", operands: conditions };
    return selectUnit(selection, inner, { eligibility });
  }, body);
}

/** Whether "you can" stands between the loop and the chain's first selection: an offer made in each pass. */
export function passOffer(list: readonly CompileLeaf[], loop: CompileLeaf, chain: readonly CompileLeaf[]): boolean {
  return list.slice(list.indexOf(loop) + 1, list.indexOf(chain[0]!)).some((leaf) => leaf.family_id === "optional-use");
}
