import { FILTERED_UNITS } from "./compile-antecedent.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * A unit-filter leaf ("friendly **WRAITH CONSTRUCT** unit") folded into the selection or aura it
 * names, before anything else compiles. It belongs to a scope-less select-unit right before it
 * ("select one" + filter) or a side-less aura-range right after it (filter + "within 6\" of this
 * unit"). The folded leaf carries the filter's side as its scope/side and the filter's keywords
 * as `filter`, which selectUnit and wrapAura read. A side-less range right after a selection is
 * that selection's distance; only one after a unit-filter alone is an aura.
 */

const isFilter = (leaf: CompileLeaf | undefined) => leaf?.family_id === "unit-filter";
const openSelect = (leaf: CompileLeaf | undefined) => leaf?.family_id === "select-unit" && leaf.parameters.scope === undefined;
const openAura = (leaf: CompileLeaf | undefined) => leaf?.family_id === "aura-range" && leaf.parameters.side === undefined;
const openTarget = (leaf: CompileLeaf | undefined) => leaf?.family_id === "stratagem-target" && leaf.parameters.side === undefined;
const ownerlessEvent = (leaf: CompileLeaf | undefined) => leaf?.family_id === "event" && leaf.parameters.owner === undefined && leaf.parameters.subject === undefined;

/**
 * The who as the DSL's own unit-filter (a unit-ref "any unit that…"), for a trigger's subject or
 * an attack's target. Unengaged has no field there (state names one state a unit is in).
 */
export function dslUnitFilter(filter: CompileLeaf): Record<string, unknown> {
  const p = filter.parameters as { side: string; keywords?: string[]; any_keywords?: string[]; excluded_keywords?: string[]; states?: string[]; other?: boolean; visible?: boolean };
  if (p.states?.includes("unengaged")) throw new CompileError("An unengaged unit named by a trigger or an attack's target has no DSL unit-filter field yet.");
  return {
    owner: p.side,
    ...(p.keywords?.length ? { all_of: p.keywords } : {}),
    ...(p.any_keywords?.length ? { any_of: p.any_keywords } : {}),
    ...(p.excluded_keywords?.length ? { none_of: p.excluded_keywords } : {}),
    ...(p.states?.includes("battle-shocked") ? { state: "battle-shocked" } : {}),
    ...(p.visible === true ? { visible: true } : {}),
    ...(p.other === true ? { excluding: "this-unit" } : {}),
    ...(filter.parameters.level === "model" ? { level: "model" } : {}),
  };
}

function side(filter: CompileLeaf, what: string): string {
  if (filter.parameters.level === "model") throw new CompileError(`A unit-filter naming models has no DSL shape for ${what} yet.`);
  const value = String(filter.parameters.side);
  if (value === "any") throw new CompileError(`A unit-filter for ${what} must say friendly or enemy.`);
  return value;
}

/** The filter's keyword fields, as the folded leaf carries them. */
function filterOf(filter: CompileLeaf): Record<string, unknown> {
  const { side: _side, visible: _visible, level: _level, ...rest } = filter.parameters;
  return rest;
}

/**
 * A range right after a selection ("select one visible enemy unit within 6\" of this unit") is
 * the selection's distance, not an aura: fold it into the selection just pushed. Returns whether
 * it did.
 */
function reach(out: CompileLeaf[], range: CompileLeaf | undefined): boolean {
  if (!openAura(range)) return false;
  const selection = out.at(-1)!;
  if (selection.parameters.distance === "within") throw new CompileError("A selection already within a distance cannot take a second range.");
  if (range!.parameters.wholly === true) throw new CompileError("A selection of units wholly within a range has no DSL shape yet.");
  out[out.length - 1] = { ...selection, parameters: { ...selection.parameters, distance: "within", inches: range!.parameters.inches } };
  return true;
}

type FilterParameters = { side?: string; keywords?: string[]; any_keywords?: string[]; excluded_keywords?: string[]; states?: string[]; visible?: boolean; other?: boolean; level?: string };

const union = (left: string[] | undefined, right: string[] | undefined) => [...new Set([...(left ?? []), ...(right ?? [])])].sort();

/**
 * One unit-filter from two that name the same units in a row ("friendly **HERETIC ASTARTES**
 * unit" + "(excluding **DAMNED** units)"), or null when they cannot be one: different sides,
 * models against units, or two any-of lists (one unit-filter holds a single any-of).
 */
function mergedFilter(first: CompileLeaf, second: CompileLeaf): CompileLeaf | null {
  const a = first.parameters as FilterParameters;
  const b = second.parameters as FilterParameters;
  const sides = new Set([a.side, b.side].filter((value) => value !== "any"));
  if (sides.size > 1) return null;
  if ((a.level ?? "unit") !== (b.level ?? "unit")) return null;
  if (a.any_keywords?.length && b.any_keywords?.length) return null;
  const parameters: Record<string, unknown> = { side: [...sides][0] ?? "any" };
  const keywords = union(a.keywords, b.keywords);
  const excluded = union(a.excluded_keywords, b.excluded_keywords);
  if (keywords.some((keyword) => excluded.includes(keyword))) throw new CompileError("A unit-filter cannot both require and exclude the same keyword.");
  if (keywords.length) parameters.keywords = keywords;
  const anyOf = a.any_keywords?.length ? a.any_keywords : b.any_keywords;
  if (anyOf?.length) parameters.any_keywords = anyOf;
  if (excluded.length) parameters.excluded_keywords = excluded;
  const states = union(a.states, b.states);
  if (states.length) parameters.states = states;
  if (a.visible === true || b.visible === true) parameters.visible = true;
  if (a.other === true || b.other === true) parameters.other = true;
  if (a.level === "model") parameters.level = "model";
  return { ...first, parameters };
}

/**
 * Stacked unit-filters of one fragment become one, so a selection, aura, target or attack sees a
 * single filter. A "from your army" of the same side between them stays, after the merged filter,
 * where it sits after a single filter.
 */
export function mergeStackedFilters(list: readonly CompileLeaf[]): CompileLeaf[] {
  const out: CompileLeaf[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const leaf = list[index]!;
    if (!isFilter(leaf)) { out.push(leaf); continue; }
    let merged = leaf;
    const owners: CompileLeaf[] = [];
    let at = index + 1;
    for (;;) {
      let next = at;
      const between: CompileLeaf[] = [];
      while (list[next]?.family_id === "unit-owner" && list[next]!.fragment === leaf.fragment) between.push(list[next++]!);
      const candidate = list[next];
      if (!isFilter(candidate) || candidate!.fragment !== leaf.fragment) break;
      const side = (merged.parameters as FilterParameters).side;
      if (between.some((owner) => owner.parameters.owner !== side)) break;
      const combined = mergedFilter(merged, candidate!);
      if (combined === null) break;
      merged = combined;
      owners.push(...between);
      at = next + 1;
    }
    out.push(merged, ...owners);
    index = at - 1;
  }
  return out;
}

export function foldUnitFilters(input: readonly CompileLeaf[]): CompileLeaf[] {
  const held = input.find((leaf) => isFilter(leaf) && leaf.parameters.held_in !== undefined);
  if (held) {
    throw new CompileError(held.parameters.held_in === "cult-ambush"
      ? "A unit in Cult Ambush has no DSL shape: the DSL unit-state lists in-strategic-reserves but no Cult Ambush."
      : "A unit-filter for units held in Strategic Reserves is not lowered yet.");
  }
  if (!input.some((leaf) => isFilter(leaf) || openSelect(leaf) || openAura(leaf) || openTarget(leaf))) return [...input];
  const list = mergeStackedFilters(input);
  const out: CompileLeaf[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const leaf = list[index]!;
    const next = list[index + 1];
    if (openSelect(leaf) && isFilter(next)) {
      out.push({ ...leaf, parameters: {
        ...leaf.parameters, scope: side(next!, "a selection"), filter: filterOf(next!),
        visible: leaf.parameters.visible === true || next!.parameters.visible === true,
      } });
      index += 1;
      reach(out, list[index + 1]) && (index += 1);
    } else if (leaf.family_id === "select-unit" && openAura(next)) {
      out.push(leaf);
      reach(out, next) && (index += 1);
    } else if (isFilter(leaf) && openAura(next)) {
      if (leaf.parameters.visible === true) throw new CompileError("An aura reaches units whether or not they are visible; drop visible from its unit-filter.");
      out.push({ ...next!, parameters: { ...next!.parameters, side: side(leaf, "an aura"), filter: filterOf(leaf) } });
      index += 1;
    } else if (openTarget(leaf) && isFilter(next)) {
      // "One" + "friendly ADEPTA SORORITAS unit" (+ "from your army"): a Stratagem's TARGET.
      const side = String(next!.parameters.side);
      if (side === "any") throw new CompileError("A Stratagem TARGET's unit-filter must say friendly or enemy.");
      const { keywords, excluded_keywords: excluded, ...rest } = filterOf(next!) as { keywords?: string[]; excluded_keywords?: string[] } & Record<string, unknown>;
      out.push({ ...leaf, parameters: {
        ...leaf.parameters, side: side === "friendly" ? "your-army" : "enemy", selects: next!.parameters.level ?? "unit",
        keywords: keywords ?? [], match: "all", excluded_keywords: excluded ?? [], filter: rest,
      } });
      index += 1;
    } else if (isFilter(leaf) && ownerlessEvent(list[pastOwners(list, index, leaf)])) {
      // "each time a friendly AELDARI unit" (+ "from your army") + "makes an attack": the trigger's subject.
      const at = pastOwners(list, index, leaf);
      out.push({ ...list[at]!, parameters: { ...list[at]!.parameters, subject_filter: dslUnitFilter(leaf) } });
      index = at;
    } else if (isFilter(leaf) && ownedBy(list[pastOwners(list, index, leaf)], leaf.parameters.side)) {
      // "just after an ADEPTUS CUSTODES unit" + "from your army Falls Back": the event's owner is
      // the filter's own side, so the filter names the unit whose moment it is.
      const at = pastOwners(list, index, leaf);
      out.push({ ...list[at]!, parameters: { ...list[at]!.parameters, subject_filter: dslUnitFilter(leaf) } });
      index = at;
    } else if (isFilter(leaf) && attackerAfter(list[pastOwners(list, index, leaf)], leaf)) {
      // "each time a friendly AELDARI model" + "makes an attack": who attacks. A model-level filter
      // before "in your unit makes …" is those models of this unit.
      const at = pastOwners(list, index, leaf);
      out.push({ ...list[at]!, parameters: { ...list[at]!.parameters, attacker_filter: attackerFilter(leaf, list[at]!) } });
      index = at;
    } else if (isFilter(leaf) && subjectlessRoll(list[pastOwners(list, index, leaf)]) && !out.some((before) => before.role === "EVENT" && before.fragment === leaf.fragment)) {
      // "Friendly Adeptus Astartes Dreadnought units" + "can re-roll hit rolls of 1": the units
      // whose rolls it is. After an attack or a moment in its fragment the filter belongs to that
      // instead ("destroyed by an X unit"), and the attacker already says whose rolls.
      if (leaf.parameters.side === "any") throw new CompileError("A unit-filter whose units re-roll or modify rolls must say friendly or enemy.");
      const at = pastOwners(list, index, leaf);
      out.push({ ...list[at]!, parameters: { ...list[at]!.parameters, subject_filter: dslUnitFilter(leaf) } });
      index = at;
    } else if (isFilter(leaf) && objectEvent(out.at(-1))) {
      // "just after a mortal wound is allocated to an" + "ADEPTA SORORITAS unit": what the moment
      // happens to. A "from your army" of the same side after it is the filter's own wording.
      const at = pastOwners(list, index, leaf);
      const event = out.at(-1)!;
      out[out.length - 1] = { ...event, parameters: { ...event.parameters, object_filter: dslUnitFilter(leaf) } };
      index = at - 1;
    } else if (isFilter(leaf) && out.at(-1)?.family_id === "attack") {
      // "each time a model in this unit makes an attack" + "that targets a" + "VEHICLE unit": the
      // attack's target. "an enemy unit" alone adds nothing an attack's target is not already.
      if (Object.keys(filterOf(leaf)).length > 0 || leaf.parameters.side === "friendly") out.push({ ...leaf, family_id: "unit-filter-target" });
    } else if (isFilter(leaf) && filteredAfter(list, index) !== null) {
      // "Friendly **K** units (from your army)" + "have the Scouts ability": every unit it
      // matches receives the effect. A "from your army" between them is the filter's own wording.
      const at = filteredAfter(list, index)!;
      const owners = list.slice(index + 1, at);
      if (owners.some((owner) => owner.parameters.owner !== leaf.parameters.side)) throw new CompileError("A unit-filter and the \"from your army\" after it name different sides.");
      if (leaf.parameters.side === "any") throw new CompileError("A unit-filter whose units receive an effect must say friendly or enemy.");
      out.push({ ...list[at]!, parameters: { ...list[at]!.parameters, subject_filter: dslUnitFilter(leaf) } });
      index = at;
    } else if (isFilter(leaf)) {
      throw new CompileError("A unit-filter needs a select-unit or attack right before it, or an aura-range or event right after it, or a Stratagem target leaf before it.");
    } else if (openSelect(leaf)) {
      throw new CompileError("A select-unit without a scope needs a unit-filter right after it.");
    } else if (openTarget(leaf)) {
      throw new CompileError("A Stratagem target leaf without a side needs a unit-filter right after it.");
    } else if (openAura(leaf)) {
      throw new CompileError("An aura-range without a side needs a unit-filter right before it.");
    } else {
      out.push(leaf);
    }
  }
  return out;
}

/** The index past any "from your army" of the filter's own side right after it. */
function pastOwners(list: readonly CompileLeaf[], index: number, filter: CompileLeaf): number {
  let at = index + 1;
  while (list[at]?.family_id === "unit-owner" && list[at]!.parameters.owner === filter.parameters.side) at += 1;
  return at;
}

/** An event the filter's side owns and that names no subject of its own. */
function ownedBy(leaf: CompileLeaf | undefined, side: unknown): boolean {
  return leaf?.family_id === "event" && leaf.parameters.subject === undefined && side !== "any" && leaf.parameters.owner === side;
}

/**
 * An attack whose maker the filter names: any friendly unit, or a model-level filter before an
 * attack by this unit's models ("each time a PENITENT model in your unit makes a melee attack").
 */
function attackerAfter(leaf: CompileLeaf | undefined, filter: CompileLeaf): boolean {
  if (leaf?.family_id !== "attack" || leaf.parameters.direction !== "makes" || leaf.parameters.attacker_filter !== undefined) return false;
  if (leaf.parameters.unit === "friendly-unit") return filter.parameters.side === "friendly";
  return leaf.parameters.unit === "this-unit" && filter.parameters.level === "model" && filter.parameters.side === "friendly";
}

function attackerFilter(filter: CompileLeaf, attack: CompileLeaf): Record<string, unknown> {
  const dsl = dslUnitFilter(filter);
  if (attack.parameters.unit !== "this-unit") return dsl;
  const { owner: _owner, ...rest } = dsl;
  return { ...rest, member_of: "this-unit" };
}

/** Roll effects that carry no subject: whose rolls they are comes from an attack or a filter before them. */
const SUBJECTLESS_ROLLS = new Set(["reroll", "roll-modifier", "roll-auto-result"]);
const subjectlessRoll = (leaf: CompileLeaf | undefined) => leaf !== undefined && SUBJECTLESS_ROLLS.has(leaf.family_id) && leaf.parameters.subject === undefined;

/** Moments that happen to a unit, whose object a unit-filter right after them can name. */
function objectEvent(leaf: CompileLeaf | undefined): boolean {
  if (leaf?.family_id !== "event" || leaf.parameters.object_owner !== undefined || leaf.parameters.object_filter !== undefined) return false;
  // A unit-filter after a plain "is destroyed" names who destroyed it ("by an attack made by a
  // friendly X unit"), not what was destroyed; only "this unit destroys an X unit" names the object.
  return leaf.parameters.kind === "damage-allocated" || (leaf.parameters.kind === "unit-destroyed" && leaf.parameters.by !== undefined);
}

/** The index of the leaf a bare unit-filter's units receive (`FILTERED_UNITS`), past any "from your army". */
function filteredAfter(list: readonly CompileLeaf[], index: number): number | null {
  let at = index + 1;
  while (list[at]?.family_id === "unit-owner") at += 1;
  const leaf = list[at];
  return leaf && Object.values(leaf.parameters).includes(FILTERED_UNITS) ? at : null;
}
