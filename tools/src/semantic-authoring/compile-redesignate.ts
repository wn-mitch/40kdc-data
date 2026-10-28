import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { DESIGNATION_IDS, designationId } from "../translate/designations.js";

/**
 * Re-designation: a persistent designation whose designated unit is destroyed, and whose
 * replacement selection the same ability names in a later sentence. The record's form is
 * `persistent-designation-open` (start timing) for the first selection, then a trailing sentence
 * `event unit-destroyed`, an optional selection, and `persistent-designation-open` with timing
 * `on-unit-destroyed` for the replacement. `compile-containers.ts` folds that trailing sentence
 * into its origin through the functions below. No leaf of a new family is needed.
 */

const DESTROYED = "on-unit-destroyed";
const TAIL_MESSAGE = "persistent designation replacement takes only its trigger, selection and may-clause";

const isOpener = (leaf: CompileLeaf): boolean => leaf.family_id === "persistent-designation-open";
const isStartOpener = (leaf: CompileLeaf): boolean => isOpener(leaf) && leaf.parameters.timing !== DESTROYED;
/** A destruction-timed opener: a replacement when its ability has an earlier start-timed opener, else a standalone selection. */
export const isDesignationReplacement = (leaf: CompileLeaf): boolean => isOpener(leaf) && leaf.parameters.timing === DESTROYED;
export const isUnitDestroyed = (leaf: CompileLeaf): boolean => leaf.family_id === "event" && leaf.parameters.kind === "unit-destroyed";

/** A designation id in the registry's spelling where the registry has one ("hated foe" is "hated-foe"); any other tag is kept as written. */
export function canonicalDesignation(raw: unknown): string {
  const text = String(raw);
  const id = designationId(text);
  return DESIGNATION_IDS.has(id) ? id : text;
}

export type ReplacementMap = {
  /** Origin opener index to its replacement opener index. */
  origins: Map<number, number>;
  /** Every replacement opener index; each is folded into its origin and builds no node of its own. */
  replacements: Set<number>;
};

/**
 * Pairs each replacement opener with the nearest earlier start-timed opener of the same ability.
 * A destruction-timed opener with no earlier start-timed opener stays a standalone selection.
 * Refuses a replacement that names another designation, scope or beneficiary than its origin, a
 * second replacement for one origin, and any other opener between an origin and its replacement.
 */
export function findReplacementOpeners(list: readonly CompileLeaf[], isLeadingOpener: (leaf: CompileLeaf) => boolean): ReplacementMap {
  const origins = new Map<number, number>();
  const replacements = new Set<number>();
  list.forEach((leaf, index) => {
    if (!isDesignationReplacement(leaf)) return;
    let origin = -1;
    for (let at = index - 1; at >= 0 && origin === -1; at -= 1) if (isStartOpener(list[at]!)) origin = at;
    if (origin === -1) return;
    const start = list[origin]!;
    if (canonicalDesignation(start.parameters.designation) !== canonicalDesignation(leaf.parameters.designation)
      || start.parameters.scope !== leaf.parameters.scope || start.parameters.beneficiary !== leaf.parameters.beneficiary) {
      throw new CompileError("A replacement designation must name the same designation, scope and beneficiary as the designation it replaces.");
    }
    if (origins.has(origin)) throw new CompileError("A designation can be replaced by only one on-unit-destroyed selection in its ability.");
    if (list.slice(origin + 1, index).some(isLeadingOpener)) {
      throw new CompileError("A designation's replacement must follow its own opener with no other container between them.");
    }
    origins.set(origin, index);
    replacements.add(index);
  });
  return { origins, replacements };
}

/**
 * Splits an origin's sentence groups into the consumer sentences and the replacement tail, which
 * starts at the tail's unit-destroyed trigger. Refuses a tail without that trigger.
 */
export function splitReplacementTail(groups: readonly (readonly CompileLeaf[])[]): { groups: CompileLeaf[][]; tail: CompileLeaf[] } {
  const flat = groups.flat();
  const at = flat.findIndex(isUnitDestroyed);
  if (at === -1) throw new CompileError("persistent-designation-open needs exactly one sentence after it, its own effect.");
  const consumer: CompileLeaf[][] = [];
  let offset = 0;
  for (const group of groups) {
    const part = group.slice(0, Math.max(0, at - offset));
    if (part.length) consumer.push([...part]);
    offset += group.length;
  }
  return { groups: consumer, tail: flat.slice(at) };
}

/**
 * Checks a replacement tail against the DSL's replace-on-destroyed selection and returns whether
 * the replacement may be declined. The tail is the trigger, then any order of an optional-use and
 * one selection (count absent or 1, enemy, any distance, not visible, up-to allowed), then the
 * replacement opener itself.
 */
export function replacementTail(tail: readonly CompileLeaf[], replacement: CompileLeaf): { optional: boolean } {
  const [trigger, ...rest] = tail;
  if (!trigger || !isUnitDestroyed(trigger) || Object.keys(trigger.parameters).some((key) => key !== "kind")) {
    throw new CompileError("A persistent designation's replacement takes one trigger: each time the designated unit is destroyed, and no other parameter.");
  }
  if (rest.at(-1) !== replacement) throw new CompileError(TAIL_MESSAGE);
  let optional = false;
  let selections = 0;
  let filters = 0;
  for (const leaf of rest.slice(0, -1)) {
    if (leaf.role === "RESTRICTION" && leaf.family_id === "optional-use") {
      optional = true;
    } else if (leaf.role === "EVENT" && leaf.family_id === "select-unit") {
      selections += 1;
      if (selections > 1) throw new CompileError("A persistent designation's replacement selects one unit.");
      if (leaf.parameters.count !== undefined && leaf.parameters.count !== 1) throw new CompileError("A persistent designation's replacement selects one unit; a count other than one has no designation form.");
      if (leaf.parameters.scope !== undefined && leaf.parameters.scope !== "enemy") throw new CompileError("A persistent designation's replacement selects an enemy unit.");
      if (leaf.parameters.distance !== undefined && leaf.parameters.distance !== "any") throw new CompileError("A persistent designation's replacement selection has no designation form for its distance.");
      if (leaf.parameters.visible === true) throw new CompileError("A persistent designation's replacement selection has no designation form for visibility.");
      if (leaf.parameters.at_least === true) throw new CompileError("A persistent designation's replacement selects one unit; one or more has no designation form.");
      if (leaf.parameters.up_to === true) optional = true;
      refuseSelectionFilter(leaf);
    } else if (leaf.role === "CONDITION" && leaf.family_id === "unit-filter") {
      // Only the enemy side, which the DSL select's scope already says. Any other field has no select form.
      filters += 1;
      if (filters > 1 || Object.keys(leaf.parameters).some((key) => key !== "side") || leaf.parameters.side !== "enemy") {
        throw new CompileError("A persistent designation's replacement selection can only filter by the enemy side; the designation's select has no field for its other filters.");
      }
    } else {
      throw new CompileError(TAIL_MESSAGE);
    }
  }
  return { optional };
}

/** A replacement selection's folded unit-filter may only say the enemy side the DSL scope already holds. */
function refuseSelectionFilter(leaf: CompileLeaf): void {
  const filter = leaf.parameters.filter as Record<string, unknown> | undefined;
  if (filter === undefined) return;
  const others = Object.keys(filter).filter((key) => key !== "side" && filter[key] !== undefined && filter[key] !== false && !(Array.isArray(filter[key]) && filter[key].length === 0));
  if (others.length || (filter.side !== undefined && filter.side !== "enemy")) {
    throw new CompileError("A persistent designation's replacement selection can only filter by the enemy side; the designation's select has no field for its other filters.");
  }
}

/**
 * The optional-use and up-to selection indexes in an opener's own sentence, before the opener
 * and with no effect between them. Those choices belong to the designation's selection.
 */
export function designationChoices(list: readonly CompileLeaf[], sentenceOf: readonly number[], opener: number): number[] {
  const found: number[] = [];
  for (let at = opener - 1; at >= 0 && sentenceOf[at] === sentenceOf[opener] && list[at]!.role !== "EFFECT"; at -= 1) {
    const leaf = list[at]!;
    if (leaf.role === "RESTRICTION" && leaf.family_id === "optional-use") found.push(at);
    else if (leaf.role === "EVENT" && leaf.family_id === "select-unit" && leaf.parameters.up_to === true) found.push(at);
  }
  return found;
}

/** Refuses a designation's own selection in the same span when it selects other than one unit. */
export function refuseEstablishmentCount(list: readonly CompileLeaf[], sentenceOf: readonly number[], opener: number): void {
  for (let at = opener - 1; at >= 0 && sentenceOf[at] === sentenceOf[opener] && list[at]!.role !== "EFFECT"; at -= 1) {
    const leaf = list[at]!;
    if (leaf.family_id === "select-unit" && ((leaf.parameters.count !== undefined && leaf.parameters.count !== 1) || leaf.parameters.at_least === true)) {
      throw new CompileError("A designated unit is one unit; a selection of several has no designation form.");
    }
  }
}

/** Every optional-use or up-to selection that binds to a designation opener, for `compile.ts` to leave out of the ability's own optional flag. */
export function optionalDesignationUses(list: readonly CompileLeaf[], sentenceOf: readonly number[]): Set<number> {
  const found = new Set<number>();
  list.forEach((leaf, index) => {
    if (!isOpener(leaf)) return;
    for (const at of designationChoices(list, sentenceOf, index)) found.add(at);
  });
  return found;
}

/**
 * The moment leaves a start-of-first-battle-round designation already states as its own timing:
 * "At the start of the first battle round" (a turn-start leaf and its round-one gate) or "At the
 * start of the battle" (a battle-started leaf), in the opener's own sentence before it. They are
 * not also the ability's trigger or gate, which would state the same moment twice.
 */
export function timingMoments(list: readonly CompileLeaf[], sentenceOf: readonly number[]): Set<number> {
  const found = new Set<number>();
  list.forEach((leaf, index) => {
    if (!isOpener(leaf) || leaf.parameters.timing !== "start-of-first-battle-round") return;
    for (let at = index - 1; at >= 0 && sentenceOf[at] === sentenceOf[index] && list[at]!.role !== "EFFECT"; at -= 1) {
      const item = list[at]!;
      const battleStart = (item.family_id === "turn-start" && item.parameters.turn === "battle-round")
        || (item.family_id === "event" && item.parameters.kind === "battle-started");
      const roundOne = item.family_id === "battle-round" && item.parameters.min === 1 && item.parameters.max === 1;
      if (battleStart || roundOne) found.add(at);
    }
  });
  return found;
}
