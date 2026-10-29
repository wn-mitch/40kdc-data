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
import { dslUnitFilter } from "./compile-unit-filter-dsl.js";
import { mergeStackedFilters } from "./compile-unit-filter-merge.js";
import { FOLLOWING_FILTER } from "./families/shared.js";
import { ARMY_SUBJECT_RULES } from "./families/army.js";

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

/** The one unit-filter a run of stacked filters (and "from your army" leaves) names, as the DSL's. */
function oneFilter(run: readonly CompileLeaf[], sourceText: string | undefined, what: string): Node {
  const merged = mergeStackedFilters(run, sourceText);
  const filters = merged.filter((leaf) => leaf.family_id === "unit-filter");
  if (filters.length !== 1) throw new CompileError(`${what} names one group of units.`);
  const side = filters[0]!.parameters.side;
  if (merged.some((leaf) => leaf.family_id === "unit-owner" && leaf.parameters.owner !== side)) throw new CompileError(`${what}: a unit-filter and the "from your army" after it name different sides.`);
  return dslUnitFilter(filters[0]!);
}

const isCanAttach = (leaf: CompileLeaf | undefined) => leaf?.family_id === "leading-unit" && leaf.parameters.attachment === "can-attach";
const LEADER_GROUP_FAMILIES = new Set(["unit-filter", "unit-owner", "unit-has-ability"]);

/**
 * Leader attachment eligibility, read at muster:
 *
 * - "If a" + "**K** unit" (+ "from your army") + "with the Leader ability" (+ "excluding **E**")
 *   + "can be attached to a" + "**B** unit" + "it can be attached to this unit" (+ "instead"):
 *   one attachment rule whose Leaders are the first group (`with`) and whose bodyguard stand-in is
 *   the second (`attach_as`). The trailing "instead" belongs to this pattern and only to it.
 * - "In the Declare Battle Formations step" right before "the bearer can be attached to" + filter:
 *   the step the attachment is chosen in, which the rule already means; the event is dropped.
 *
 * Runs before antecedents bind. A can-attach leaf outside the pattern refuses: the DSL has no
 * runtime "can lead" condition.
 */
export function foldArmyAttachments(leaves: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (!leaves.some((leaf) => isArmy(leaf, "attachment") || isCanAttach(leaf))) return [...leaves];
  const out: CompileLeaf[] = [];
  for (let index = 0; index < leaves.length; index += 1) {
    const leaf = leaves[index]!;
    const next = leaves[index + 1];
    if (leaf.family_id === "event" && leaf.parameters.kind === "battle-formations-declared" && isArmy(next, "attachment")
      && next!.parameters.object === FOLLOWING_FILTER && next!.fragment === leaf.fragment) continue;
    if (leaf.family_id !== "unit-filter") { out.push(leaf); continue; }
    // The Leader group: filters, "from your army" and "with the Leader ability" pointing back to them.
    let at = index;
    while (at < leaves.length && leaves[at]!.fragment === leaf.fragment && LEADER_GROUP_FAMILIES.has(leaves[at]!.family_id)
      && (leaves[at]!.family_id !== "unit-has-ability" || leaves[at]!.parameters.subject === ANTECEDENT)) at += 1;
    const link = leaves[at];
    if (!isCanAttach(link) || link!.fragment !== leaf.fragment) { out.push(leaf); continue; }
    let end = at + 1;
    while (end < leaves.length && leaves[end]!.fragment === leaf.fragment && (leaves[end]!.family_id === "unit-filter" || leaves[end]!.family_id === "unit-owner")) end += 1;
    const rule = leaves[end];
    if (!isArmy(rule, "attachment") || rule!.fragment !== leaf.fragment || rule!.parameters.subject !== ANTECEDENT || rule!.parameters.object !== "this-unit") {
      throw new CompileError(`leading-unit can-attach at byte ${link!.start_byte} says which units a Leader may join, which only "it can be attached to this unit" right after its unit-filter turns into a list-building rule.`);
    }
    if (end === at + 1) throw new CompileError(`leading-unit can-attach at byte ${link!.start_byte} needs the unit-filter it can be attached to right after it.`);
    const run = leaves.slice(index, at);
    const leader = oneFilter(run.filter((other) => other.family_id !== "unit-has-ability"), sourceText, "A Leader group");
    const abilities = run.filter((other) => other.family_id === "unit-has-ability");
    const has = abilities.filter((other) => other.parameters.negated !== true).map((other) => String(closed(other, "ability")));
    const lacks = abilities.filter((other) => other.parameters.negated === true).map((other) => String(closed(other, "ability")));
    const leaderGroup: Node = { ...leader, ...(has.length ? { has_ability: [...new Set(has)].sort() } : {}), ...(lacks.length ? { lacks_ability: [...new Set(lacks)].sort() } : {}) };
    const bodyguard = oneFilter(leaves.slice(at + 1, end), sourceText, "The unit a Leader can be attached to");
    const { subject: _subject, object: _object, ...rest } = rule!.parameters;
    out.push({ ...rule!, parameters: { ...rest, leader_group: leaderGroup, attach_as_group: bodyguard } });
    index = end;
    if (leaves[index + 1]?.family_id === "instead" && leaves[index + 1]!.fragment === leaf.fragment) index += 1;
  }
  const stray = out.find(isCanAttach);
  if (stray) throw new CompileError(`leading-unit can-attach at byte ${stray.start_byte} says which units a Leader may join; it lowers only inside "<Leader> can be attached to <unit>, it can be attached to this unit".`);
  return out;
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
    // "it can be attached to this unit": only the Leader-eligibility pattern binds it (foldArmyAttachments).
    if (leaf.parameters.rule === "attachment") throw new CompileError(`army-construction attachment at byte ${leaf.start_byte} points back to a Leader, but no "<Leader> can be attached to <unit>" pattern runs right before it.`);
    // A unit-filter right before the leaf and after the last composition rule is the nearer group ("A X model must be your Warlord").
    const composition = leaves.reduce((last, other, at) => (at < index && isArmy(other, "composition") ? at : last), -1);
    if (composition >= 0 && bareFilterBefore(leaves, index) <= composition) return { ...leaf, parameters: { ...leaf.parameters, subject: COMPOSITION_GROUP } };
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

const isChoiceMarker = (leaf: CompileLeaf | undefined) => leaf?.role === "COMBINATOR" && leaf.parameters.choice === true;

/**
 * The composition rules an antecedent points back to: the nearest earlier one, and with it every
 * composition rule it is a player's pick against ("include either 1 X model or up to 3 Y models"),
 * since "these models" are whichever of them the player took.
 */
function pointedCompositions(leaves: readonly CompileLeaf[], index: number): CompileLeaf[] {
  let at = leaves.slice(0, index).map((other, position) => (isArmy(other, "composition") ? position : -1)).filter((position) => position >= 0).at(-1)!;
  const picked = [leaves[at]!];
  while (isChoiceMarker(leaves[at - 1]) && isArmy(leaves[at - 2], "composition") && leaves[at - 2]!.fragment === leaves[at]!.fragment) {
    at -= 2;
    picked.unshift(leaves[at]!);
  }
  return picked;
}

/**
 * After unit-filters fold: each bound antecedent becomes the rule's `group_filter`, the composition
 * group it points back to (the union of a pick's groups, as `any_of_filters`) or the filter folded onto it.
 */
export function resolveArmyGroups(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  return leaves.map((leaf, index) => {
    if (!isArmy(leaf)) return leaf;
    const { subject, subject_filter: filter, ...rest } = leaf.parameters;
    if (subject === COMPOSITION_GROUP) {
      const groups = pointedCompositions(leaves, index).map(compositionGroup);
      if (groups.some((group) => group === null)) throw new CompileError(`army-construction at byte ${leaf.start_byte} points back to a composition rule that names no group of units.`);
      if (groups.length === 1) return { ...leaf, parameters: { ...rest, group_filter: groups[0]! } };
      if (groups.some((group) => group!.owner !== "friendly")) throw new CompileError(`army-construction at byte ${leaf.start_byte} points back to a pick between groups that are not all units of your army.`);
      const alternatives = groups.map((group) => {
        const { owner: _owner, ...own } = group!;
        return own;
      });
      return { ...leaf, parameters: { ...rest, group_filter: { owner: "friendly", any_of_filters: alternatives } } };
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
  if (filter.owner !== undefined && filter.owner !== "friendly") throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} names ${String(filter.owner)} units; a list-building group is units of your army.`);
  // "designated": only the Warlord, the model chosen at mustering. Any other designation is battle-time state.
  if (filter.designated !== undefined && filter.designated !== "warlord") throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} names a designation, which is not known when mustering an army.`);
  const stray = Object.keys(filter).filter((key) => !MUSTER_FILTER_KEYS.has(key) && !(key === "designated" && filter.designated === "warlord"));
  if (stray.length) throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} qualifies its group by ${stray.join(", ")}, which means nothing when mustering an army.`);
  return filter;
}

/** "T'AU EMPIRE" → tau-empire: the faction id an Army Faction keyword names. */
function factionId(keyword: string): string {
  return keyword.toLowerCase().replace(/[‘’']/gu, "").replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
}

/** Rules whose group can be a list of datasheets: they count units, so `datasheets` sits beside `with`. */
const DATASHEET_RULES = new Set(["composition", "unique"]);

/**
 * A counting rule's group as `with` plus `datasheets`: the datasheet ids leave the unit-filter
 * (which cannot hold them), and a filter left saying only "friendly" is dropped.
 */
function countedGroup(group: Node, rule: string, leaf: CompileLeaf, modifier: Node): void {
  const { datasheets, ...rest } = group;
  if (datasheets !== undefined) {
    if (!DATASHEET_RULES.has(rule)) throw new CompileError(`army-construction rule ${rule} cannot name its group by datasheets; only a composition or unique rule counts units of a datasheet.`);
    modifier.datasheets = datasheets;
  }
  const filter = musterFilter(rest, leaf);
  if (datasheets === undefined || Object.keys(filter).some((key) => key !== "owner")) modifier.with = filter;
}

/** One list-building leaf as the DSL's army-rule. */
export function armyRuleEffect(leaf: CompileLeaf): Node {
  const p = leaf.parameters;
  const rule = String(closed(leaf, "rule"));
  const modifier: Node = { rule };
  let target: Node | string = "this-unit";
  const withKeywords = p.with_keywords as string[] | undefined;
  let group: Node | undefined;
  if (p.with === FOLLOWING_FILTER) {
    if (p.following_filter === undefined) throw new CompileError(`army-construction at byte ${leaf.start_byte} takes its group from the unit-filter right after it, but none follows in its fragment.`);
    group = structuredClone(p.following_filter as Node);
  } else if (p.group_filter !== undefined) {
    group = structuredClone(p.group_filter as Node);
  }
  if (p.leader_group !== undefined) {
    // "If a X unit with the Leader ability can be attached to a Y unit, it can be attached to this unit instead".
    modifier.with = musterFilter(structuredClone(p.leader_group as Node), leaf);
    modifier.attach_as = musterFilter(structuredClone(p.attach_as_group as Node), leaf);
  } else if (p.object !== undefined) {
    // "the bearer can be attached to" + filter: which units it can join besides its datasheet's.
    if (rule !== "attachment" || p.object !== FOLLOWING_FILTER) throw new CompileError(`army-construction at byte ${leaf.start_byte} names an attachment object only in the "<Leader> can be attached to <unit> … this unit" pattern.`);
    if (p.following_filter === undefined) throw new CompileError(`army-construction at byte ${leaf.start_byte} can be attached to the unit-filter right after it, but none follows in its fragment.`);
    if (p.subject !== "this-unit" && p.subject !== "this-model") throw new CompileError(`army-construction at byte ${leaf.start_byte} names who can be attached by subject this-unit or this-model.`);
    modifier.can_lead = musterFilter(structuredClone(p.following_filter as Node), leaf);
  } else if (rule === "detachment-tag-exclusive") {
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
    if (rule === "attachment") throw new CompileError("A Leader attachment names its Leaders by the \"<Leader> can be attached to <unit>\" pattern, not by a group.");
    if (isSubjectRule(rule)) {
      if (group.datasheets !== undefined) throw new CompileError(`army-construction rule ${rule} cannot name its subject by datasheets; a DSL target holds keywords, not datasheet ids.`);
      target = musterFilter(group, leaf);
    } else countedGroup(group, rule, leaf, modifier);
  } else if (withKeywords) {
    if (isSubjectRule(rule)) target = { owner: "friendly", all_of: [...withKeywords] };
    else modifier.with = { all_of: withKeywords };
  }
  if (p.object === undefined && (p.subject === "this-unit" || p.subject === "this-model")) target = p.subject;
  if (p.object !== undefined) target = p.subject as string;
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
  if (p.exempt_from !== undefined) modifier.exempt_from = closed(leaf, "exempt_from");
  if (p.enhancement_kind !== undefined) modifier.enhancement_kind = closed(leaf, "enhancement_kind");
  return { type: "army-rule", target, modifier };
}

/**
 * The army-includes condition: "If your army includes any X units" (the unit-filter after the
 * leaf, folded as its following filter) or "If every model in your army has the X keyword".
 */
export function armyIncludesCondition(leaf: CompileLeaf): Node {
  const p = leaf.parameters;
  if (p.quantifier === "every") {
    const keywords = p.keywords as string[] | undefined;
    const any = p.any_keywords as string[] | undefined;
    return { type: "army-includes", parameters: { filter: { owner: "friendly", ...(keywords ? { all_of: keywords } : {}), ...(any ? { any_of: any } : {}), level: "model" }, every: true } };
  }
  if (p.following_filter === undefined) throw new CompileError(`army-includes at byte ${leaf.start_byte} names its units by the unit-filter right after it, but none follows in its fragment.`);
  const filter = musterFilter(structuredClone(p.following_filter as Node), leaf);
  if (filter.datasheets !== undefined) throw new CompileError("army-includes names its units by keywords; a datasheet list has no DSL condition shape.");
  return { type: "army-includes", parameters: { filter, ...(p.min !== undefined ? { min: closed(leaf, "min") } : {}) } };
}

/**
 * Core checks for what list-building rules name by id: each datasheet a group lists must be a core
 * unit, and each Army Faction a faction-forbidden rule names must be a core faction.
 */
export function armyCoreChecks(leaves: readonly CompileLeaf[]): Array<{ kind: "datasheets"; parameters: { ids: string[] } } | { kind: "army-factions"; parameters: { ids: string[] } }> {
  const ids = leaves.flatMap((leaf) => isArmy(leaf) ? [leaf.parameters.following_filter, leaf.parameters.group_filter] : [])
    .flatMap((filter) => Array.isArray((filter as Node | undefined)?.datasheets) ? (filter as Node).datasheets as string[] : []);
  const factions = leaves.filter((leaf) => isArmy(leaf, "faction-forbidden")).flatMap((leaf) => {
    const keywords = leaf.parameters.with_keywords as string[] | undefined;
    return [...(keywords?.length === 1 ? [factionId(keywords[0]!)] : []), ...(typeof leaf.parameters.faction === "string" ? [leaf.parameters.faction] : [])];
  });
  return [
    ...(ids.length ? [{ kind: "datasheets" as const, parameters: { ids: [...new Set(ids)].sort() } }] : []),
    ...(factions.length ? [{ kind: "army-factions" as const, parameters: { ids: [...new Set(factions)].sort() } }] : []),
  ];
}

/**
 * "You can include any of the following units in your army, and when you do so their Faction keywords
 * are replaced with X:" + the list: a composition rule, then a keyword grant on "their" units, then the
 * unit-filter of the list. The list is the rule's group and the units whose keywords change, so it folds
 * onto both before antecedents bind (the grant points forward, which the general binding cannot read).
 * Only that exact run in one fragment folds; anything else is left to the usual folds.
 */
export function foldForwardComposition(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  const out: CompileLeaf[] = [];
  for (let index = 0; index < leaves.length; index += 1) {
    const rule = leaves[index]!;
    const grant = leaves[index + 1];
    const filter = leaves[index + 2];
    const run = isArmy(rule, "composition") && rule.parameters.with === FOLLOWING_FILTER
      && grant?.family_id === "keyword-grant" && grant.parameters.subject === ANTECEDENT
      && filter?.family_id === "unit-filter" && filter.parameters.side === "friendly"
      && grant.fragment === rule.fragment && filter.fragment === rule.fragment;
    if (!run) { out.push(rule); continue; }
    const group = dslUnitFilter(filter!);
    out.push({ ...rule, parameters: { ...rule.parameters, following_filter: group } });
    out.push({ ...grant!, parameters: { ...grant!.parameters, subject: FILTERED_UNITS, subject_filter: structuredClone(group) } });
    index += 2;
  }
  return out;
}
