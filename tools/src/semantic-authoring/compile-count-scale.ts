import { condition } from "./compile-conditions.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { placements } from "./compile-placement.js";
import { ANTECEDENT } from "./antecedent-families.js";

/**
 * Counting, folded into the leaf whose amount it multiplies, before unit-filters fold:
 *
 * - "+1 A" + "for each" (count-scale) + "enemy unit" + "within 6\" of this model" + "(to a maximum
 *   of +3 A)" (scale-cap): the effect before the count-scale in its sentence (else the first one
 *   after it) gains `scaling` {per, of, within_inches, keyword, max_value}, which effect lowering
 *   (`compile-scaling.ts`) puts on its DSL node. Only a counted set an existing DSL scaling source
 *   names compiles; anything narrower is refused by name, never dropped.
 * - "contains 1 model" (unit-size) + "for each" + "model" + "in this unit": the unit-size takes the
 *   count as its value, which `compile-model-state.ts` folds into the add-unit before it.
 * - "for each of the following conditions you satisfy" (count-scale counts following-items): the
 *   effect applies once per bulleted item after it whose conditions hold.
 * - "roll one D6" + "for each" + "WRACKS model" + "in your unit" … "for each 3+" + mortal wounds:
 *   a bare quantifier over models beside a plain roll is one die per counted model, the roll's
 *   `for_each` selector (`compile-dice.ts`), not an iteration.
 */

/**
 * A condition right after a counted filter whose subject points back ("that made a Charge move",
 * "engaged with that enemy unit") is about each counted unit or model, whatever else the record
 * selected. It is marked before anaphors bind, so the selection does not claim it.
 */
export const COUNTED = "counted";

/** The count of models equipped with a wargear item (count-scale counts models-equipped-with). */
const MODELS_EQUIPPED_WITH = "models-equipped-with";

const KEYWORD_SOURCES = new Set(["enemy-models-in-range", "friendly-models-in-range", "models-in-bearer-unit", "models-in-or-embarked-in-bearer", "models-embarked-in-bearer"]);
const BEARER = new Set(["this-unit", "this-model", undefined]);

type Group = { filter: number; qualifiers: number[]; end: number };

const isFilter = (leaf: CompileLeaf | undefined, fragment: string | undefined) => leaf?.family_id === "unit-filter" && leaf.fragment === fragment;
const bareQuantifier = (leaf: CompileLeaf | undefined) => leaf?.family_id === "for-each-unit-select" && Object.keys(leaf.parameters).length === 0;
const countsFilter = (leaf: CompileLeaf | undefined) => leaf?.family_id === "count-scale" && (leaf.parameters.counts ?? "following-filter") === "following-filter";

/** A leaf that narrows the counted filter before it: a range, a membership, a "from your army", or a condition on each counted thing. */
function narrows(leaf: CompileLeaf | undefined, fragment: string | undefined): boolean {
  if (!leaf || leaf.fragment !== fragment) return false;
  if (leaf.family_id === "membership" || leaf.family_id === "unit-owner") return true;
  if (leaf.family_id === "aura-range") return leaf.parameters.side === undefined;
  return leaf.role === "CONDITION" && (leaf.parameters.subject === ANTECEDENT || leaf.parameters.subject === COUNTED);
}

/** The counted filter right after an anchor (a count-scale or quantifier), and the leaves that narrow it. */
function countedGroup(list: readonly CompileLeaf[], anchor: number): Group | null {
  const fragment = list[anchor]!.fragment;
  if (!isFilter(list[anchor + 1], fragment)) return null;
  const qualifiers: number[] = [];
  let at = anchor + 2;
  while (narrows(list[at], fragment)) qualifiers.push(at++);
  return { filter: anchor + 1, qualifiers, end: at };
}

/**
 * The leaves around a bare quantifier, up to the moments on either side in its fragment: one die
 * per counted model when they hold one plain roll, a result band and mortal wounds.
 */
function perModelRoll(list: readonly CompileLeaf[], anchor: number): number | null {
  const quantifier = list[anchor]!;
  if (!bareQuantifier(quantifier) || list[anchor + 1]?.parameters.level !== "model" || !isFilter(list[anchor + 1], quantifier.fragment)) return null;
  const moment = (leaf: CompileLeaf) => leaf.family_id === "event";
  let from = anchor;
  while (from > 0 && list[from - 1]!.fragment === quantifier.fragment && !moment(list[from - 1]!)) from -= 1;
  let to = anchor + 1;
  while (to < list.length && list[to]!.fragment === quantifier.fragment && !moment(list[to]!)) to += 1;
  const window = list.slice(from, to).map((leaf, offset) => ({ leaf, at: from + offset }));
  const rolls = window.filter(({ leaf }) => leaf.family_id === "dice-roll");
  // A bonus bound from "adding 1 to the result" (compile-preceding-roll.ts) is refused when the roll resolves.
  const plain = rolls.filter(({ leaf }) => Object.keys(leaf.parameters).every((key) => key === "dice" || key === "bonus"));
  if (plain.length !== 1 || !window.some(({ leaf }) => leaf.family_id === "roll-result") || !window.some(({ leaf }) => leaf.family_id === "mortal-wounds")) return null;
  return plain[0]!.at;
}

/** Mark the conditions about each counted unit or model, before anaphors bind. */
export function markCountedSubjects(input: readonly CompileLeaf[]): CompileLeaf[] {
  const list = [...input];
  list.forEach((leaf, index) => {
    if (!countsFilter(leaf) && perModelRoll(list, index) === null) return;
    const group = countedGroup(list, index);
    for (const at of group?.qualifiers ?? []) {
      const qualifier = list[at]!;
      if (qualifier.role === "CONDITION" && qualifier.parameters.subject === ANTECEDENT) list[at] = { ...qualifier, parameters: { ...qualifier.parameters, subject: COUNTED } };
    }
  });
  return list;
}

/** A counted set with no DSL source yet, named for the refusal. */
function unmapped(what: string): never {
  throw new CompileError(`A count of ${what} has no DSL scaling source; only enemy or friendly models (or enemy units) within range of the bearer, and models in or embarked within the bearer, can be counted yet.`);
}

/** The DSL scaling source (with its range and keyword) the counted filter and its qualifiers name. */
export function scalingSource(list: readonly CompileLeaf[], group: Group): Record<string, unknown> {
  const filter = list[group.filter]!.parameters as { side?: string; keywords?: string[]; level?: string } & Record<string, unknown>;
  const narrower = Object.keys(filter).filter((key) => !["side", "keywords", "level"].includes(key));
  if (narrower.length) unmapped(`units narrowed by ${narrower.join(", ")}`);
  if ((filter.keywords?.length ?? 0) > 1) unmapped("models with several keywords");
  const keyword = filter.keywords?.[0];
  const qualifiers = group.qualifiers.map((at) => list[at]!).filter((leaf) => leaf.family_id !== "unit-owner");
  const ranges = qualifiers.filter((leaf) => leaf.family_id === "aura-range");
  const memberships = qualifiers.filter((leaf) => leaf.family_id === "membership");
  const other = qualifiers.find((leaf) => leaf.family_id !== "aura-range" && leaf.family_id !== "membership");
  if (other) unmapped(`units narrowed by ${other.family_id}`);
  if (ranges.length + memberships.length !== 1) {
    if (ranges.length + memberships.length === 0) unmapped("units with no range or membership");
    throw new CompileError("A counted filter takes one range or one membership after it.");
  }
  const model = filter.level === "model";
  let source: Record<string, unknown>;
  if (ranges.length) {
    const range = ranges[0]!.parameters;
    if (range.wholly === true) unmapped("units wholly within a range");
    if (!BEARER.has(range.of as string | undefined)) unmapped("units within range of anything but the bearer");
    if (model && filter.side === "enemy") source = { of: "enemy-models-in-range", within_inches: range.inches };
    else if (model && filter.side === "friendly") source = { of: "friendly-models-in-range", within_inches: range.inches };
    else if (!model && filter.side === "enemy") source = { of: "enemy-units-in-range", within_inches: range.inches };
    else unmapped(`${String(filter.side)} ${model ? "models" : "units"} within range`);
  } else {
    if (!model) throw new CompileError("A membership qualifies a filter naming models (level model).");
    if (filter.side === "enemy") throw new CompileError("Models in or embarked within the bearer are not enemy models.");
    const { relation } = memberships[0]!.parameters;
    source = { of: relation === "in" ? "models-in-bearer-unit" : relation === "embarked-in" ? "models-embarked-in-bearer" : "models-in-or-embarked-in-bearer" };
  }
  if (keyword !== undefined) {
    if (!KEYWORD_SOURCES.has(String(source.of))) unmapped(`${String(source.of)} with a keyword`);
    source.keyword = keyword;
  }
  return source;
}

/** The effect a count-scale in a sentence multiplies: the nearest before it, else the first after its counted set, with no moment between. */
function scaledEffect(list: readonly CompileLeaf[], sentences: readonly number[], at: number, after: number): number {
  for (let index = at - 1; index >= 0 && sentences[index] === sentences[at]; index -= 1) {
    if (list[index]!.role === "EVENT") break;
    if (list[index]!.role === "EFFECT") return index;
  }
  for (let index = after; index < list.length && sentences[index] === sentences[at]; index += 1) {
    if (list[index]!.role === "EVENT") break;
    if (list[index]!.role === "EFFECT") return index;
  }
  throw new CompileError("A count-scale (\"for each\") has no effect in its sentence whose amount it multiplies.");
}

/** Bulleted items after a following-items count, as the condition nodes of each item. */
function bulletItems(list: readonly CompileLeaf[], at: number, sourceText: string | undefined, take: Set<number>): Record<string, unknown>[][] {
  const scale = list[at]!;
  if (sourceText === undefined || scale.end_byte === undefined) throw new CompileError("A count of listed items needs the source text to find its bullets.");
  const bytes = Buffer.from(sourceText, "utf8");
  const text = bytes.toString("utf8");
  const items: Array<{ start: number; end: number }> = [];
  let cursor = bytes.subarray(0, scale.end_byte).toString("utf8").length;
  // Each bullet runs from its marker to the end of its line.
  for (;;) {
    const marker = text.slice(cursor).search(/^[ \t]*[■•●▪]/mu);
    if (marker < 0) break;
    const start = cursor + marker;
    const lineEnd = text.indexOf("\n", start);
    const end = lineEnd < 0 ? text.length : lineEnd;
    items.push({ start: Buffer.byteLength(text.slice(0, start), "utf8"), end: Buffer.byteLength(text.slice(0, end), "utf8") });
    cursor = end;
    // The list ends at the first line after a bullet that is not itself a bullet.
    if (!/^\n[ \t]*[■•●▪]/u.test(text.slice(end, end + 8))) break;
  }
  if (items.length === 0) throw new CompileError("A count of the following items has no bulleted item after it.");
  return items.map(({ start, end }) => {
    const own = list.flatMap((leaf, index) => index > at && leaf.fragment === scale.fragment && leaf.start_byte >= start && leaf.start_byte < end ? [index] : []);
    if (own.some((index) => list[index]!.role !== "CONDITION")) throw new CompileError("A counted item holds an effect or a moment; each item is only the conditions it counts.");
    if (own.length === 0) throw new CompileError("A counted item has no condition leaf saying when it counts.");
    for (const index of own) take.add(index);
    return own.map((index) => condition(list[index]!));
  });
}

/** The amount a per-item count multiplies, which must be 1 per item. */
function onePerItem(effect: CompileLeaf): void {
  const amount = effect.parameters.amount ?? effect.parameters.value ?? effect.parameters.count;
  if (String(amount) !== "1") throw new CompileError(`A count of listed items adds 1 per item; ${effect.family_id} has amount ${JSON.stringify(amount)}.`);
}

/** A membership right after a model-level unit-filter that a select-unit opens: the selected model's unit. */
function selectedModelMembership(list: readonly CompileLeaf[], index: number): boolean {
  const filter = list[index - 1];
  return list[index]!.family_id === "membership" && filter?.family_id === "unit-filter" && filter.parameters.level === "model"
    && list[index - 2]?.family_id === "select-unit" && filter.fragment === list[index]!.fragment;
}

/** Fold every count-scale, scale-cap and per-model quantifier into the leaf it multiplies. */
export function foldCountScales(input: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (!input.some((leaf) => leaf.family_id === "count-scale" || leaf.family_id === "scale-cap" || leaf.family_id === "membership" || leaf.family_id === "unit-size" || bareQuantifier(leaf))) return [...input];
  const list = [...input];
  const sentences = placements(list, sourceText).map((place) => place.sentence);
  const take = new Set<number>();
  const caps = list.flatMap((leaf, index) => leaf.family_id === "scale-cap" ? [index] : []);
  list.forEach((leaf, index) => {
    if (leaf.family_id === "for-each-unit-select") {
      const roll = perModelRoll(list, index);
      if (roll === null) return;
      const group = countedGroup(list, index)!;
      list[roll] = { ...list[roll]!, parameters: { ...list[roll]!.parameters, for_each: perModelSelector(list, group) } };
      [index, group.filter, ...group.qualifiers].forEach((at) => take.add(at));
      return;
    }
    if (leaf.family_id !== "count-scale") return;
    if (list[index - 1]?.family_id === "for-each-unit-select") throw new CompileError("A count-scale and a for-each-unit-select cannot share one unit-filter.");
    if (leaf.parameters.counts === "following-items") {
      if (leaf.parameters.timing === "on-apply") throw new CompileError("An on-apply count takes a fixed set once; following-items counts one item at a time.");
      const at = scaledEffect(list, sentences, index, index + 1);
      if (list[at]!.parameters.scaling !== undefined || list[at]!.parameters.per_item !== undefined) throw new CompileError("An effect is scaled by two counts.");
      onePerItem(list[at]!);
      list[at] = { ...list[at]!, parameters: { ...list[at]!.parameters, per_item: bulletItems(list, index, sourceText, take) } };
      take.add(index);
      return;
    }
    if (leaf.parameters.counts === "models-equipped-with") {
      // A count of the models that carry a wargear item: the count names the wargear, not a filter after it.
      if (list[index + 1]?.family_id === "unit-filter" && list[index + 1]!.fragment === leaf.fragment) throw new CompileError("A count of models equipped with a wargear takes no unit-filter after it.");
      const at = scaledEffect(list, sentences, index, index + 1);
      if (list[at]!.parameters.scaling !== undefined || list[at]!.parameters.per_item !== undefined) throw new CompileError("An effect is scaled by two counts.");
      if (Object.keys(list[at]!.parameters).some((key) => key.startsWith("scaling_"))) throw new CompileError("A test that scales its own amount cannot also take a count-scale.");
      list[at] = { ...list[at]!, parameters: { ...list[at]!.parameters, scaling: { per: leaf.parameters.per, of: MODELS_EQUIPPED_WITH, wargear: leaf.parameters.wargear } } };
      take.add(index);
      return;
    }
    const group = countedGroup(list, index);
    if (!group) throw new CompileError("A count-scale (\"for each\") needs the unit-filter it counts right after it, in its fragment.");
    if (list[group.end]?.family_id === "for-each-unit-select") throw new CompileError("A count-scale and a for-each-unit-select cannot share one unit-filter.");
    const onApply = leaf.parameters.timing === "on-apply";
    if (onApply) refuseLaterEventCount(list, group);
    const scaling: Record<string, unknown> = { per: leaf.parameters.per, ...scalingSource(list, group) };
    // A cap belongs to the nearest count-scale before it in its sentence.
    const next = list.findIndex((other, at) => at > index && other.family_id === "count-scale");
    const own = caps.filter((at) => at > index && (next === -1 || at < next) && sentences[at] === sentences[index]);
    if (own.length > 1) throw new CompileError("A scaled amount has two caps.");
    if (own.length === 1) {
      scaling.max_value = list[own[0]!]!.parameters.max;
      take.add(own[0]!);
    }
    [index, group.filter, ...group.qualifiers].forEach((at) => take.add(at));
    // "contains 1 model for each model in this unit": the count is the added unit's size.
    if (list[index - 1]?.family_id === "unit-size") {
      if (onApply) throw new CompileError("An on-apply count does not scale the size of an added unit.");
      const size = list[index - 1]!;
      if (size.parameters.models !== 1 || scaling.per !== 1 || scaling.max_value !== undefined) throw new CompileError("An added unit's size equal to a count is 1 model per counted model, with no cap.");
      const { per: _per, of, ...rest } = scaling;
      list[index - 1] = { ...size, parameters: { ...size.parameters, count: { count_of: of, ...rest } } };
      return;
    }
    const at = scaledEffect(list, sentences, index, group.end);
    if (list[at]!.parameters.scaling !== undefined || list[at]!.parameters.per_item !== undefined) throw new CompileError("An effect is scaled by two counts.");
    if (Object.keys(list[at]!.parameters).some((key) => key.startsWith("scaling_"))) throw new CompileError("A test that scales its own amount cannot also take a count-scale.");
    if (onApply) {
      checkLastingEffect(list, at);
      scaling.evaluated = "on-apply";
    }
    list[at] = { ...list[at]!, parameters: { ...list[at]!.parameters, scaling } };
  });
  for (const at of caps) if (!take.has(at)) throw new CompileError("A scale-cap (\"to a maximum of\") has no count-scale before it in its sentence.");
  list.forEach((leaf, index) => {
    if (take.has(index)) return;
    // "select one X model in your unit": the selection's own membership, folded by compile-unit-filters.ts.
    if (leaf.family_id === "membership" && !selectedModelMembership(list, index)) throw new CompileError("A membership (\"in this unit\") qualifies a counted model-level filter; no count or per-model roll takes it here.");
    if (leaf.parameters.subject === COUNTED) throw new CompileError(`${leaf.family_id} is about each counted model, but no count or per-model roll takes it here.`);
  });
  return list.filter((_, index) => !take.has(index));
}

/**
 * Event families a counted set can be narrowed by. A count taken when a rule applies cannot hold
 * one of these: each is a later happening whose count would change during the rule.
 */
const LATER_EVENT_FAMILIES: ReadonlySet<string> = new Set([
  "unit-activity", "hit-by-attacks", "ability-used", "history-compare", "targeted", "roll-outcome",
  "moved-over", "destroyed-while-on-objective", "destroyed-in-tagged-terrain", "optional-cost-paid",
]);

/** An on-apply count's counted set holds no later event (see LATER_EVENT_FAMILIES). */
function refuseLaterEventCount(list: readonly CompileLeaf[], group: Group): void {
  const named = [group.filter, ...group.qualifiers].map((at) => list[at]!.family_id);
  if (named.some((family) => LATER_EVENT_FAMILIES.has(family))) throw new CompileError("An on-apply count cannot count a later event.");
}

/**
 * The effect an on-apply count scales is a lasting modifier, in a rule with a duration or a
 * triggering moment in the same fragment. An instantaneous effect has nothing to hold the count for.
 */
function checkLastingEffect(list: readonly CompileLeaf[], at: number): void {
  const effect = list[at]!;
  if (effect.family_id !== "characteristic-modifier" && effect.family_id !== "roll-modifier") throw new CompileError("An on-apply count is for a lasting modifier.");
  if (!list.some((leaf) => leaf.fragment === effect.fragment && (leaf.role === "DURATION" || leaf.role === "EVENT"))) {
    throw new CompileError("An on-apply count needs a rule that lasts: a duration, or a triggered or used ability, in the same rule.");
  }
}

/** The DSL selector of the models a per-model roll counts: one die for each. */
function perModelSelector(list: readonly CompileLeaf[], group: Group): Record<string, unknown> {
  const filter = list[group.filter]!.parameters as { side: string; keywords?: string[]; any_keywords?: string[]; excluded_keywords?: string[] } & Record<string, unknown>;
  const narrower = Object.keys(filter).filter((key) => !["side", "keywords", "any_keywords", "excluded_keywords", "level"].includes(key));
  if (narrower.length) throw new CompileError(`A per-model roll counting models narrowed by ${narrower.join(", ")} has no DSL selector field yet.`);
  const qualifiers = group.qualifiers.map((at) => list[at]!).filter((leaf) => leaf.family_id !== "unit-owner");
  const memberships = qualifiers.filter((leaf) => leaf.family_id === "membership");
  const ranges = qualifiers.filter((leaf) => leaf.family_id === "aura-range");
  const conditions = qualifiers.filter((leaf) => leaf.family_id !== "membership" && leaf.family_id !== "aura-range");
  if (memberships.length > 1 || ranges.length > 1) throw new CompileError("A per-model roll's models take one membership and one range at most.");
  const candidate: Record<string, unknown> = { owner: filter.side, level: "model" };
  if (memberships.length) {
    const { relation, of } = memberships[0]!.parameters;
    if (relation === "in-or-embarked-in") throw new CompileError("A per-model roll over models in or embarked within the bearer has no DSL selector membership yet.");
    if (filter.side === "enemy") throw new CompileError("Models in or embarked within the bearer are not enemy models.");
    candidate.owner = "friendly";
    if (relation === "in") candidate.member_of = of;
    else candidate.embarked_in = of;
  }
  if (filter.keywords?.length) candidate.all_of = filter.keywords;
  if (filter.any_keywords?.length) candidate.any_of = filter.any_keywords;
  if (filter.excluded_keywords?.length) candidate.none_of = filter.excluded_keywords;
  if (ranges.length) {
    if (!BEARER.has(ranges[0]!.parameters.of as string | undefined) || ranges[0]!.parameters.wholly === true) throw new CompileError("A per-model roll's range is measured from the bearer, not wholly.");
    candidate.within = { range: { inches: ranges[0]!.parameters.inches }, of: ranges[0]!.parameters.of ?? "this-model" };
  }
  // In a selector's eligibility the default subject is the candidate: each counted model.
  const checks = conditions.map((leaf) => condition({ ...leaf, parameters: { ...leaf.parameters, subject: "this-unit" } }));
  return { filter: candidate, ...(checks.length ? { eligibility: checks.length === 1 ? checks[0]! : { operator: "and", operands: checks } } : {}) };
}
