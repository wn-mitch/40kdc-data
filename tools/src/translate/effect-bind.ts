/**
 * The binding containers added for the phase-4 shapes: `roll` (one roll whose result nested
 * numeric fields and dice gates share) and `select-objective` (bind objective markers for the
 * nested effect). Renderers take the nested-effect describer as a callback so this module does
 * not import `effect.ts`.
 */

import { objectivePhrase, type P } from "./condition-refs.js";
import { describeSelectionEligibility } from "./condition-leadin.js";
import type { Condition } from "./condition.js";
import { capitalize, diceCase, filterSubject, jstr, quantityPhrase, rollKindNoun, titleCase } from "./effect-words.js";

export function selectorNoun(sel: P): string {
  return (sel.filter as P | undefined)?.level === "model" ? "model" : "unit";
}

export function selectorSubject(sel: P, plural: boolean): string {
  const subject = filterSubject((sel.filter ?? {}) as P).replace(/^all /, "");
  return plural ? subject : subject.replace(/\bunits\b/, "unit").replace(/\bmodels\b/, "model").replace(/\bthat are\b/, "that is");
}

/** A canonical unit selector, including cardinality and eligibility. */
export function selectUnitsSubject(sel: P = {}): string {
  const count = selectorCount(sel);
  const bounds = (sel.count ?? {}) as P;
  const cap = bounds.max != null && typeof bounds.max === "object" && (bounds.min == null || bounds.min === 0) ? bounds.max as P : undefined;
  const capPhrase = cap ? quantityPhrase(cap) : "";
  const phrase = cap ? cap.count_of != null ? "any number of" : `up to ${capPhrase.replace(/ \(.*\)$/, "")}` : count.phrase;
  const tail = cap ? cap.count_of != null ? ` (at most ${capPhrase})` : ` (${capPhrase.replace(/^.*\((.*)\)$/, "$1")})` : "";
  const eligibility = sel.eligibility ? ` ${describeSelectionEligibility(sel.eligibility as Condition)}` : "";
  return `${phrase} ${selectorSubject(sel, count.plural)}${tail}${eligibility}${selectionLimit(sel, selectorNoun(sel))}`;
}

/** "Blessings of Khorne pool" from a pool id. */
function poolTitle(pool: string): string {
  return `${titleCase(pool.replace(/-pool$/, ""))} pool`;
}

/** "roll 8D6, plus one D6 for each die in your Blessings of Khorne pool (a Blessings of Khorne roll)". */
export function rollHead(e: P): string {
  const extra = typeof e.extra_dice_pool === "string" ? `, plus one D6 for each die in your ${poolTitle(e.extra_dice_pool)}` : "";
  const kind = e.kind != null ? ` (${rollKindNoun(e.kind)})` : "";
  return `roll ${diceCase(e.dice)}${extra}${kind}`;
}

/** A canonical selector's inclusive cardinality bounds. */
export function selectorCount(sel: P): { phrase: string; plural: boolean } {
  const bounds = (sel.count ?? {}) as P;
  const quantity = (value: unknown): string => value != null && typeof value === "object" ? quantityPhrase(value as P) : Number(value) === 1 ? "one" : jstr(value);
  if (bounds.min != null && bounds.min === bounds.max) return { phrase: quantity(bounds.min), plural: bounds.max !== 1 };
  if (bounds.min != null && bounds.max != null && bounds.min !== 0) return { phrase: `from ${quantity(bounds.min)} through ${quantity(bounds.max)}`, plural: bounds.max !== 1 };
  if (bounds.max != null) return { phrase: `up to ${quantity(bounds.max)}`, plural: bounds.max !== 1 };
  // "Select one or more models", not "at least one models".
  if (bounds.min != null) return { phrase: Number(bounds.min) === 1 ? "one or more" : `at least ${quantity(bounds.min)}`, plural: true };
  return { phrase: "each", plural: false };
}

export function selectionBinding(sel: P): string {
  return typeof sel.bind_as === "string" && sel.bind_as.length > 0
    ? `, binding ${selectorCount(sel).plural ? "them" : "it"} as ${sel.bind_as.replace(/[-_]/g, " ")}`
    : "";
}

export function selectionLimit(sel: P, noun: string): string {
  const limit = sel.limit as { count?: unknown; period?: unknown } | undefined;
  if (limit == null) return "";
  const times = Number(limit.count) === 1 ? "once" : `${jstr(limit.count)} times`;
  return ` (each ${noun} can be selected for this ability at most ${times} per ${jstr(limit.period).replace(/-/g, " ")} across your army)`;
}

/** "one objective marker you control" with the selector's binding and eligibility. */
export function objectiveSelectorPhrase(sel: P): string {
  const count = selectorCount(sel);
  const base = objectivePhrase((sel.filter ?? {}) as P, false, count.plural ? "objective markers" : "objective marker");
  const eligibility = sel.eligibility ? ` ${describeSelectionEligibility(sel.eligibility as Condition)}` : "";
  return `${count.phrase} ${base}${eligibility}${selectionBinding(sel)}${selectionLimit(sel, "objective marker")}`;
}

type Render = (e: unknown) => string;

function lead(sel: P): string {
  return `${sel.count == null ? "for" : "select"} ${objectiveSelectorPhrase(sel)}`;
}

/** select-objective on one line: "select one objective marker …: <effect>". */
export function selectObjectiveInline(e: P, inline: Render): string {
  return `${lead((e.selector ?? {}) as P)}: ${inline(e.effect)}`;
}

/** select-objective as a block: a header line and the nested effect one level deeper. */
export function selectObjectiveBlock(e: P, indent: string, arrow: string, nested: string | null, inline: Render): string {
  const head = `${indent}${arrow}${capitalize(lead((e.selector ?? {}) as P))}`;
  return nested != null ? `${head}:\n${nested}` : `${head}: ${inline(e.effect)}.`;
}
