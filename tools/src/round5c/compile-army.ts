/**
 * List-building rules (`army-construction` leaves): which units a rule is about, and how the rule
 * lowers to the DSL's `army-rule`.
 *
 * A rule's group of units comes from one of three sources, in this order: the unit-filter right
 * after the leaf (`with: following-filter`, folded by compile-unit-filters.ts), an earlier leaf the
 * rule points back to (`subject: antecedent`), or the leaf's own `with_keywords`. An antecedent is
 * the group of the nearest earlier composition rule ("You can include up to 3 X units. None of
 * these models can be your WARLORD"), else the units of a unit-filter right before the leaf
 * ("Friendly X units" + "do not count towards …"). Rules about the units themselves put the group
 * in the DSL's `target`; rules that count units put it in `with`.
 */

import { ANTECEDENT } from "./antecedent-families.js";
import { FILTERED_UNITS } from "./compile-antecedent.js";
import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";
import { dslUnitFilter, mergeStackedFilters } from "./compile-unit-filters.js";
import { FOLLOWING_FILTER } from "./family-extensions-11.js";
import { ARMY_SUBJECT_RULES } from "./family-extensions-w8-army-construction.js";

type Node = Record<string, unknown>;

const ARMY = "army-construction";
/** An antecedent bound to the group of the nearest earlier composition rule; resolved after filters fold. */
const COMPOSITION_GROUP = "composition-group";
/** Unit-filter fields that say who is in a list: anything else (states, ranges, visibility) means nothing at muster. */
const MUSTER_FILTER_KEYS = new Set(["owner", "all_of", "any_of", "none_of", "not_all_of", "any_of_filters", "level", "has_ability", "lacks_ability"]);
/** Leaves that claim a unit-filter right after them, so it is not a bare filter an antecedent can point back to. */
const FILTER_CLAIMANTS = new Set(["select-unit", "stratagem-target", "attack", "unit-filter", "for-each-unit-select"]);

const isArmy = (leaf: CompileLeaf | undefined, rule?: string) => leaf?.family_id === ARMY && (rule === undefined || leaf.parameters.rule === rule);
const isSubjectRule = (rule: unknown) => (ARMY_SUBJECT_RULES as readonly unknown[]).includes(rule);

/** Whether a leaf awaits the unit-filter right after it. */
const awaitsFilter = (leaf: CompileLeaf | undefined) => leaf !== undefined && Object.values(leaf.parameters).includes(FOLLOWING_FILTER);

/**
 * The index of a unit-filter right before `index` (past "from your army" leaves) in the same
 * fragment that nothing else claims, or -1.
 */
function bareFilterBefore(leaves: readonly CompileLeaf[], index: number): number {
  const leaf = leaves[index]!;
  let at = index - 1;
  while (at >= 0 && leaves[at]!.family_id === "unit-owner" && leaves[at]!.fragment === leaf.fragment) at -= 1;
  const filter = leaves[at];
  if (filter?.family_id !== "unit-filter" || filter.fragment !== leaf.fragment) return -1;
  const before = leaves[at - 1];
  if (before && before.fragment === leaf.fragment && (FILTER_CLAIMANTS.has(before.family_id) || awaitsFilter(before))) return -1;
  return at;
}

/**
 * Bind every list-building `subject: antecedent` before the general binding runs
 * (compile-antecedent.ts), which knows nothing of muster: to the nearest earlier composition
 * rule's group, else to the unit-filter right before the leaf (folded onto it by
 * compile-unit-filters.ts as for any army-wide effect). Refuses an antecedent with neither.
 */
export function bindArmyAntecedents(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  if (!leaves.some((leaf) => isArmy(leaf) && leaf.parameters.subject === ANTECEDENT)) return [...leaves];
  return leaves.map((leaf, index) => {
    if (!isArmy(leaf) || leaf.parameters.subject !== ANTECEDENT) return leaf;
    if (leaves.slice(0, index).some((other) => isArmy(other, "composition"))) return { ...leaf, parameters: { ...leaf.parameters, subject: COMPOSITION_GROUP } };
    if (bareFilterBefore(leaves, index) >= 0) return { ...leaf, parameters: { ...leaf.parameters, subject: FILTERED_UNITS } };
    throw new CompileError(`army-construction at byte ${leaf.start_byte} points back to a group of units (${ANTECEDENT}), but no earlier composition rule or unit-filter right before it names one.`);
  });
}

/**
 * "for each" + "**INQUISITOR** unit" (+ "you include in your army") (+ "you can") + "include one":
 * a composition limit that applies once per matching unit, the DSL's `per`. Only "from your army"
 * and "you can" may sit between the filter and the rule, in one fragment. Runs before
 * compile-unit-filters.ts, which would otherwise make the "for each" a runtime loop.
 */
export function foldArmyPer(leaves: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (!leaves.some((leaf) => isArmy(leaf, "composition"))) return [...leaves];
  const out: CompileLeaf[] = [];
  for (let index = 0; index < leaves.length; index += 1) {
    const leaf = leaves[index]!;
    const bare = leaf.family_id === "for-each-unit-select" && Object.keys(leaf.parameters).length === 0;
    if (!bare || leaves[index + 1]?.family_id !== "unit-filter") { out.push(leaf); continue; }
    let end = index + 1;
    while (end < leaves.length && leaves[end]!.fragment === leaf.fragment && (leaves[end]!.family_id === "unit-filter" || leaves[end]!.family_id === "unit-owner")) end += 1;
    let at = end;
    while (at < leaves.length && leaves[at]!.fragment === leaf.fragment && (leaves[at]!.family_id === "unit-owner" || leaves[at]!.family_id === "optional-use")) at += 1;
    const rule = leaves[at];
    if (!isArmy(rule, "composition") || rule!.fragment !== leaf.fragment) { out.push(leaf); continue; }
    const merged = mergeStackedFilters(leaves.slice(index + 1, end), sourceText);
    const filters = merged.filter((other) => other.family_id === "unit-filter");
    if (filters.length !== 1) throw new CompileError("A composition limit \"for each\" unit names one group of units to count per.");
    if (merged.some((other) => other.family_id === "unit-owner" && other.parameters.owner !== filters[0]!.parameters.side)) throw new CompileError("A \"for each\" unit-filter and the \"from your army\" after it name different sides.");
    if (rule!.parameters.per_keywords !== undefined) throw new CompileError("A composition limit names its per-unit group once: per_keywords or a \"for each\" unit-filter.");
    // "you can" stays: it says the rule is a permission; "from your army" is the filter's own wording.
    out.push(...leaves.slice(end, at).filter((other) => other.family_id !== "unit-owner"));
    out.push({ ...rule!, parameters: { ...rule!.parameters, per_filter: dslUnitFilter(filters[0]!) } });
    index = at;
  }
  return out;
}

/** The group a composition rule counts, as a DSL unit-filter, or null when it names none. */
function compositionGroup(leaf: CompileLeaf): Node | null {
  if (leaf.parameters.following_filter !== undefined) return structuredClone(leaf.parameters.following_filter as Node);
  if (leaf.parameters.group_filter !== undefined) return structuredClone(leaf.parameters.group_filter as Node);
  const keywords = leaf.parameters.with_keywords as string[] | undefined;
  return keywords?.length ? { owner: "friendly", all_of: [...keywords] } : null;
}

/**
 * After unit-filters fold: each bound antecedent becomes the rule's `group_filter`, the composition
 * group it points back to or the filter folded onto it.
 */
export function resolveArmyGroups(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  return leaves.map((leaf, index) => {
    if (!isArmy(leaf)) return leaf;
    const { subject, subject_filter: filter, ...rest } = leaf.parameters;
    if (subject === COMPOSITION_GROUP) {
      const source = leaves.slice(0, index).reverse().find((other) => isArmy(other, "composition"))!;
      const group = compositionGroup(source);
      if (group === null) throw new CompileError(`army-construction at byte ${leaf.start_byte} points back to a composition rule that names no group of units.`);
      return { ...leaf, parameters: { ...rest, group_filter: group } };
    }
    if (subject === FILTERED_UNITS) {
      if (filter === undefined) throw new CompileError(`army-construction at byte ${leaf.start_byte} points back to the unit-filter right before it, but that filter belongs to another leaf.`);
      return { ...leaf, parameters: { ...rest, group_filter: filter } };
    }
    return leaf;
  });
}

/** A group must name units of your army, by what they are rather than where they are. */
function musterFilter(filter: Node, leaf: CompileLeaf): Node {
  if (filter.owner !== undefined && filter.owner !== "friendly") throw new CompileError(`army-construction at byte ${leaf.start_byte} names ${String(filter.owner)} units; a list-building group is units of your army.`);
  const stray = Object.keys(filter).filter((key) => !MUSTER_FILTER_KEYS.has(key));
  if (stray.length) throw new CompileError(`army-construction at byte ${leaf.start_byte} qualifies its group by ${stray.join(", ")}, which means nothing when mustering an army.`);
  return filter;
}

/** "T'AU EMPIRE" → tau-empire: the faction id an Army Faction keyword names. */
function factionId(keyword: string): string {
  return keyword.toLowerCase().replace(/[‘’']/gu, "").replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
}

/** Exemptions the DSL's army-rule can hold today. */
const DSL_EXEMPTIONS = new Set(["retinue-limit"]);
/** Rules the family can record whose DSL shape is not settled yet. */
const UNLOWERED_RULES = new Set(["enhancement-source", "limit-exemption"]);

/** One list-building leaf as the DSL's army-rule. */
export function armyRuleEffect(leaf: CompileLeaf): Node {
  const p = leaf.parameters;
  const rule = String(closed(leaf, "rule"));
  if (UNLOWERED_RULES.has(rule)) throw new CompileError(`army-construction rule ${rule} has no DSL army-rule value yet.`);
  if (p.object !== undefined) throw new CompileError("army-construction.object (Leader attachment eligibility) has no DSL army-rule shape yet.");
  const modifier: Node = { rule };
  let target: Node | string = "this-unit";
  const withKeywords = p.with_keywords as string[] | undefined;
  let group: Node | undefined;
  if (p.with === FOLLOWING_FILTER) {
    if (p.following_filter === undefined) throw new CompileError(`army-construction at byte ${leaf.start_byte} takes its group from the unit-filter right after it, but none follows in its fragment.`);
    group = musterFilter(structuredClone(p.following_filter as Node), leaf);
  } else if (p.group_filter !== undefined) {
    group = musterFilter(structuredClone(p.group_filter as Node), leaf);
  }
  if (rule === "detachment-tag-exclusive") {
    // "This Detachment has the COVENS tag": the tag is a name for detachments, not a unit filter.
    if (withKeywords?.length !== 1) throw new CompileError("A detachment-tag-exclusive leaf names exactly one tag in with_keywords.");
    modifier.tag = withKeywords[0];
  } else if (rule === "faction-forbidden") {
    // "You cannot select X as your Army Faction": the keyword names one faction.
    if (group !== undefined) throw new CompileError("A faction-forbidden rule names an Army Faction, not a group of units.");
    if (withKeywords !== undefined) {
      if (withKeywords.length !== 1) throw new CompileError("A faction-forbidden rule names one Army Faction; two factions are two rules.");
      if (p.faction !== undefined && p.faction !== factionId(withKeywords[0]!)) throw new CompileError("A faction-forbidden rule names its Army Faction twice, differently.");
      modifier.faction = factionId(withKeywords[0]!);
    }
    if (modifier.faction === undefined && p.faction === undefined) throw new CompileError("A faction-forbidden rule names no Army Faction.");
  } else if (group !== undefined) {
    if (rule === "attachment") throw new CompileError("A Leader attachment group has no DSL army-rule shape yet.");
    if (isSubjectRule(rule)) target = group;
    else modifier.with = group;
  } else if (withKeywords) {
    if (isSubjectRule(rule)) target = { owner: "friendly", all_of: [...withKeywords] };
    else modifier.with = { all_of: withKeywords };
  }
  if (p.subject === "this-unit" || p.subject === "this-model") target = p.subject;
  if (p.max !== undefined) modifier.max = closed(leaf, "max");
  if (p.led_by !== undefined) modifier.led_by = closed(leaf, "led_by");
  // Allied inclusion counted in points or models, once per matching unit, or for one faction.
  if (p.measure !== undefined && p.measure !== "units") modifier.measure = closed(leaf, "measure");
  if (p.per_keywords !== undefined) modifier.per = { all_of: closed(leaf, "per_keywords") };
  if (p.per_filter !== undefined) {
    if (rule !== "composition") throw new CompileError("Only a composition limit applies once per matching unit.");
    modifier.per = musterFilter(structuredClone(p.per_filter as Node), leaf);
  }
  if (p.faction !== undefined && modifier.faction === undefined) modifier.faction = closed(leaf, "faction");
  if (p.exempt_from !== undefined) {
    const exempt = closed(leaf, "exempt_from") as string[];
    const missing = exempt.filter((item) => !DSL_EXEMPTIONS.has(item));
    if (missing.length) throw new CompileError(`army-construction exemption from ${missing.join(", ")} has no DSL value yet.`);
    modifier.exempt_from = exempt;
  }
  if (p.enhancement_kind !== undefined) modifier.enhancement_kind = closed(leaf, "enhancement_kind");
  return { type: "army-rule", target, modifier };
}
