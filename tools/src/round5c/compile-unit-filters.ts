import { FILTERED_UNITS, momentOfFilter } from "./compile-antecedent.js";
import { FOLLOWING_FILTER } from "./family-extensions-11.js";
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

/** A filter's negated states as the DSL's not_states: unengaged is not engaged. */
function notStates(states: readonly string[] | undefined): string[] {
  return [...(states?.includes("unengaged") ? ["engaged"] : []), ...(states?.includes("not-battle-shocked") ? ["battle-shocked"] : [])];
}

/** Where a held unit waits, as the DSL unit-state it is in. */
const HELD_STATES: Record<string, string> = { "strategic-reserves": "in-strategic-reserves", "cult-ambush": "in-cult-ambush" };

/**
 * The who as the DSL's own unit-filter (a unit-ref "any unit that…"), for a trigger's subject or
 * an attack's target. Unengaged is not engaged (`not_states`); a held unit is in its Reserves state.
 */
export function dslUnitFilter(filter: CompileLeaf): Record<string, unknown> {
  const p = filter.parameters as { side: string; keywords?: string[]; any_keywords?: string[]; excluded_keywords?: string[]; states?: string[]; other?: boolean; visible?: boolean; held_in?: string };
  const held = p.held_in === undefined ? undefined : HELD_STATES[p.held_in];
  if (p.held_in !== undefined && held === undefined) throw new CompileError(`A unit held in ${p.held_in} has no DSL unit-state.`);
  if (held !== undefined && p.states?.includes("battle-shocked")) throw new CompileError("A unit-filter holds one state; a held unit cannot also be Battle-shocked here.");
  return {
    owner: p.side,
    ...(p.keywords?.length ? { all_of: p.keywords } : {}),
    ...(p.any_keywords?.length ? { any_of: p.any_keywords } : {}),
    ...(p.excluded_keywords?.length ? { none_of: p.excluded_keywords } : {}),
    ...(p.states?.includes("battle-shocked") ? { state: "battle-shocked" } : {}),
    ...(held !== undefined ? { state: held } : {}),
    ...(notStates(p.states).length ? { not_states: notStates(p.states) } : {}),
    ...(Array.isArray(filter.parameters.excluded_all_keywords) ? { not_all_of: filter.parameters.excluded_all_keywords } : {}),
    ...(p.visible === true ? { visible: true } : {}),
    ...(p.other === true ? { excluding: "this-unit" } : {}),
    ...(filter.parameters.level === "model" ? { level: "model" } : {}),
    ...(Array.isArray(filter.parameters.excluded_abilities) ? { lacks_ability: filter.parameters.excluded_abilities } : {}),
  };
}

function side(filter: CompileLeaf, what: string): string {
  if (filter.parameters.level === "model") throw new CompileError(`A unit-filter naming models has no DSL shape for ${what} yet.`);
  const value = String(filter.parameters.side);
  if (value === "any") throw new CompileError(`A unit-filter for ${what} must say friendly or enemy.`);
  return value;
}

/**
 * The filter's keyword fields, as the folded leaf carries them. Selections, auras and Stratagem
 * targets carry them into their own eligibility (compile-wrappers.ts, compile-conditions.ts); a
 * held unit ("that is in Reserves") is one more state there, its DSL Reserves unit-state.
 */
function filterOf(filter: CompileLeaf): Record<string, unknown> {
  const { side: _side, visible: _visible, level: _level, held_in: heldIn, ...rest } = filter.parameters;
  if (heldIn === undefined) return rest;
  const held = HELD_STATES[String(heldIn)];
  if (held === undefined) throw new CompileError(`A unit held in ${String(heldIn)} has no DSL unit-state.`);
  return { ...rest, states: [...((rest.states as string[] | undefined) ?? []), held] };
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

type FilterParameters = { side?: string; keywords?: string[]; any_keywords?: string[]; excluded_keywords?: string[]; states?: string[]; visible?: boolean; other?: boolean; level?: string; held_in?: string; excluded_abilities?: string[] };

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
  if (a.held_in !== undefined && b.held_in !== undefined && a.held_in !== b.held_in) return null;
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
  // Fields only the DSL unit-filter keeps carry over rather than being dropped by the merge.
  const held = a.held_in ?? b.held_in;
  if (held !== undefined) parameters.held_in = held;
  const abilities = union(a.excluded_abilities, b.excluded_abilities);
  if (abilities.length) parameters.excluded_abilities = abilities;
  return { ...first, parameters };
}

/**
 * Stacked unit-filters of one fragment become one, so a selection, aura, target or attack sees a
 * single filter. A "from your army" of the same side between them stays, after the merged filter,
 * where it sits after a single filter.
 */
export function mergeStackedFilters(list: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  const out: CompileLeaf[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const leaf = list[index]!;
    if (!isFilter(leaf)) { out.push(leaf); continue; }
    // Alternatives ("**A** or **B** unit") are groups; filters with nothing between them, or only
    // an exclusion's parentheses, narrow the group they follow.
    const groups: Array<{ filter: CompileLeaf; at: number }> = [{ filter: leaf, at: index + 1 }];
    const owners: CompileLeaf[] = [];
    let last = leaf;
    let sawOr = false;
    for (;;) {
      const group = groups.at(-1)!;
      let next = group.at;
      const between: CompileLeaf[] = [];
      while (list[next]?.family_id === "unit-owner" && list[next]!.fragment === leaf.fragment) between.push(list[next++]!);
      const candidate = list[next];
      if (!isFilter(candidate) || candidate!.fragment !== leaf.fragment) break;
      const joiner = between.length === 0 ? joinerBetween(sourceText, last, candidate!) : null;
      if (joiner !== null && ALTERNATIVE_JOINERS.has(joiner)) {
        sawOr ||= joiner.includes("or");
        groups.push({ filter: candidate!, at: next + 1 });
        last = candidate!;
        continue;
      }
      const side = (group.filter.parameters as FilterParameters).side;
      if (between.some((owner) => owner.parameters.owner !== side)) break;
      const combined = mergedFilter(group.filter, candidate!);
      if (combined === null) break;
      group.filter = combined;
      group.at = next + 1;
      owners.push(...between);
      last = candidate!;
    }
    let merged: CompileLeaf;
    let at: number;
    if (groups.length > 1 && sawOr) {
      merged = alternativeFilter(groups.map((group) => group.filter));
      at = groups.at(-1)!.at;
    } else {
      // A comma list with no "or" ("**A**, **B** unit") still narrows, as stacked filters do.
      merged = groups[0]!.filter;
      at = groups[0]!.at;
      for (const group of groups.slice(1)) {
        const combined = mergedFilter(merged, group.filter);
        if (combined === null) break;
        merged = combined;
        at = group.at;
      }
    }
    out.push(merged, ...owners);
    index = at - 1;
  }
  return out;
}

/** Joiners that make the next filter an alternative to the one before it, read without bold or spaces. */
const ALTERNATIVE_JOINERS = new Set(["or", ",", ",or"]);

/** The source between two leaves, without bold markers, spaces or an exclusion's parentheses. */
function joinerBetween(sourceText: string | undefined, left: CompileLeaf, right: CompileLeaf): string | null {
  if (sourceText === undefined || left.end_byte === undefined || right.start_byte < left.end_byte) return null;
  return Buffer.from(sourceText, "utf8").subarray(left.end_byte, right.start_byte).toString("utf8").replace(/[*\s()]/g, "").toLowerCase();
}

/**
 * One unit-filter for alternatives ("**HERETIC ASTARTES VEHICLE** or **VASHTORR THE ARKIFANE**
 * unit"): the keywords every alternative names stay required, and each alternative's one other
 * keyword joins the any-of. Alternatives that differ in anything else (side, level, an exclusion
 * on one of them, two extra keywords) have no single DSL unit-filter, so they fail rather than
 * narrow to units that are both.
 */
function alternativeFilter(filters: readonly CompileLeaf[]): CompileLeaf {
  const params = filters.map((filter) => filter.parameters as FilterParameters);
  const fail = (why: string): never => { throw new CompileError(`Alternative unit-filters (A or B) ${why}; one DSL unit-filter cannot say them.`); };
  const same = (pick: (p: FilterParameters) => unknown) => params.every((p) => JSON.stringify(pick(p) ?? null) === JSON.stringify(pick(params[0]!) ?? null));
  const sides = new Set(params.map((p) => p.side).filter((value) => value !== "any"));
  if (sides.size > 1) fail("are on different sides");
  if (!same((p) => p.level ?? "unit")) fail("name both models and units");
  if (!same((p) => [...(p.excluded_keywords ?? [])].sort())) fail("exclude different keywords");
  if (!same((p) => [...(p.states ?? [])].sort()) || !same((p) => p.held_in) || !same((p) => p.visible === true) || !same((p) => p.other === true)) fail("carry different states");
  if (params.some((p) => p.any_keywords?.length)) fail("already hold an any-of");
  const common = (params[0]!.keywords ?? []).filter((keyword) => params.every((p) => (p.keywords ?? []).includes(keyword)));
  const alternatives = params.map((p) => (p.keywords ?? []).filter((keyword) => !common.includes(keyword)));
  if (alternatives.some((rest) => rest.length !== 1)) fail("differ by more than one keyword");
  const { keywords: _keywords, ...rest } = params[0]!;
  const parameters: Record<string, unknown> = { ...rest, side: [...sides][0] ?? "any", any_keywords: [...new Set(alternatives.map((one) => one[0]!))].sort() };
  if (common.length) parameters.keywords = [...common].sort();
  return { ...filters[0]!, end_byte: filters.at(-1)!.end_byte, parameters };
}

export function foldUnitFilters(input: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (!input.some((leaf) => isFilter(leaf) || openSelect(leaf) || openAura(leaf) || openTarget(leaf))) return [...input];
  const list = mergeStackedFilters(input, sourceText);
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
    } else if (isFilter(leaf) && followedBy(out.at(-1), leaf)) {
      // "within 8\" of a" + "friendly unengaged unit": the other unit of the distance or engagement
      // before it. A "from your army" after it is the filter's own wording.
      const at = pastOwners(list, index, leaf);
      const condition = out.at(-1)!;
      out[out.length - 1] = { ...condition, parameters: { ...condition.parameters, following_filter: dslUnitFilter(leaf) } };
      index = at - 1;
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
      // "is selected to move" + "or" + "declares a charge": the alternative moment is the same unit's.
      for (let alternative = list[index + 1]; orAlternative(list[index]!, alternative, sourceText); alternative = list[index + 1]) {
        out.push({ ...alternative!, parameters: { ...alternative!.parameters, subject_filter: dslUnitFilter(leaf) } });
        index += 1;
      }
    } else if (isFilter(leaf) && momentOfFilter(list, index) !== null) {
      // "an enemy unit" + "engaged with this unit" + "is selected to fight": the filter is the
      // moment's unit; the conditions between them (bound to that unit by compile-antecedent.ts)
      // stay where they are, with any unit-filter their own distances measure to.
      const at = momentOfFilter(list, index)!;
      const between = foldUnitFilters(list.slice(index + 1, at).filter((other) => other.family_id !== "unit-owner"));
      out.push(...between);
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
    } else if (isFilter(leaf) && postfixRecipient(out.at(-1))) {
      // "Add 1 to the Strength characteristic of" + "**K** models from your army": the units the
      // effect before it applies to. A "from your army" after it is the filter's own wording.
      if (leaf.parameters.side === "any") throw new CompileError("A unit-filter whose units receive an effect must say friendly or enemy.");
      const at = pastOwners(list, index, leaf);
      const effect = out.at(-1)!;
      out[out.length - 1] = { ...effect, parameters: { ...effect.parameters, subject_filter: dslUnitFilter(leaf) } };
      index = at - 1;
    } else if (isFilter(leaf) && filteredAfter(list, index) !== null) {
      // "Friendly **K** units (from your army)" + "have the Scouts ability": every unit it
      // matches receives the effect. A "from your army" between them is the filter's own wording.
      const at = filteredAfter(list, index)!;
      const owners = list.slice(index + 1, at);
      if (owners.some((owner) => owner.parameters.owner !== leaf.parameters.side)) throw new CompileError("A unit-filter and the \"from your army\" after it name different sides.");
      if (leaf.parameters.side === "any") throw new CompileError("A unit-filter whose units receive an effect must say friendly or enemy.");
      out.push({ ...list[at]!, parameters: { ...list[at]!.parameters, subject_filter: dslUnitFilter(leaf) } });
      index = at;
      // "Friendly X units' melee attacks have +1 A and +1 S": every property of one scope after the
      // filter names the same units (a weapon ability keyword carries no subject of its own).
      for (;;) {
        const next = list[index + 1];
        if (!next || next.fragment !== leaf.fragment) break;
        if (next.family_id === "weapon-ability-keyword") { out.push(next); index += 1; continue; }
        if (!Object.values(next.parameters).includes(FILTERED_UNITS) || next.parameters.subject_filter !== undefined) break;
        out.push({ ...next, parameters: { ...next.parameters, subject_filter: dslUnitFilter(leaf) } });
        index += 1;
      }
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

/** A distance or engagement in the filter's fragment whose other unit is the filter right after it. */
function followedBy(leaf: CompileLeaf | undefined, filter: CompileLeaf): boolean {
  return leaf !== undefined && leaf.fragment === filter.fragment && leaf.parameters.following_filter === undefined
    && (leaf.parameters.of === FOLLOWING_FILTER || leaf.parameters.with === FOLLOWING_FILTER);
}

/** The index past any "from your army" of the filter's own side right after it. */
function pastOwners(list: readonly CompileLeaf[], index: number, filter: CompileLeaf): number {
  let at = index + 1;
  while (list[at]?.family_id === "unit-owner" && list[at]!.parameters.owner === filter.parameters.side) at += 1;
  return at;
}

/** An ownerless, subjectless event in the same fragment as `event`, joined to it by nothing but "or". */
function orAlternative(event: CompileLeaf, next: CompileLeaf | undefined, sourceText: string | undefined): boolean {
  if (sourceText === undefined || !ownerlessEvent(next) || next!.fragment !== event.fragment || next!.parameters.subject_filter !== undefined) return false;
  const between = Buffer.from(sourceText, "utf8").subarray(event.end_byte, next!.start_byte).toString("utf8");
  return /^[\s*,]*or[\s*]*$/u.test(between);
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
  // "when an enemy unit targets a friendly X unit": the unit targeted.
  return leaf.parameters.kind === "damage-allocated" || leaf.parameters.kind === "enemy-selected-targets" || leaf.parameters.kind === "targets-selected"
    || (leaf.parameters.kind === "unit-destroyed" && leaf.parameters.by !== undefined);
}

/** An effect bound to the units of the unit-filter right after it (compile-antecedent.ts postfixFilter). */
function postfixRecipient(leaf: CompileLeaf | undefined): boolean {
  return leaf !== undefined && leaf.role === "EFFECT" && leaf.parameters.subject_filter === undefined && Object.values(leaf.parameters).includes(FILTERED_UNITS);
}

/** The index of the leaf a bare unit-filter's units receive (`FILTERED_UNITS`), past any "from your army". */
function filteredAfter(list: readonly CompileLeaf[], index: number): number | null {
  let at = index + 1;
  while (list[at]?.family_id === "unit-owner") at += 1;
  const leaf = list[at];
  return leaf && Object.values(leaf.parameters).includes(FILTERED_UNITS) ? at : null;
}
