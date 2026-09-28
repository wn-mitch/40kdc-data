/**
 * The binding containers added for the phase-4 shapes: `roll` (one roll whose result nested
 * numeric fields and dice gates share) and `select-objective` (bind objective markers for the
 * nested effect). Renderers take the nested-effect describer as a callback so this module does
 * not import `effect.ts`.
 */

import { objectivePhrase, type P } from "./condition-refs.js";
import { capitalize, diceCase, jstr, rangePhrase, rollKindNoun, titleCase } from "./effect-words.js";

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

const ORIGINS: Record<string, string> = { bearer: "the bearer", "bearer-unit": "the bearer's unit" };

/** "one objective marker you control that the bearer's unit is within range of". */
export function objectiveSelectorPhrase(sel: P): string {
  const each = sel.count === "each";
  const n = Number(sel.count ?? 1);
  const noun = each || n === 1 ? "objective marker" : "objective markers";
  const filter = (sel.filter ?? {}) as P;
  const base = objectivePhrase({ ...filter, ...(sel.controlled_by === "your-army" ? { controlled_by: "friendly" } : sel.controlled_by === "opponent" ? { controlled_by: "enemy" } : {}) }, false, noun);
  const quantity = each ? "each" : n === 1 ? "one" : jstr(n);
  const origin = ORIGINS[jstr(sel.origin ?? "bearer")] ?? "the bearer";
  let s = `${quantity} ${base}`;
  if (sel.range === "objective-control") s += ` that ${origin} is within range of`;
  else if (sel.range != null) s += ` within ${rangePhrase(sel.range)} of ${origin}`;
  else if (sel.range_inches != null) s += ` within ${jstr(sel.range_inches)}" of ${origin}`;
  const req = sel.requires_unit as P | undefined;
  if (req != null) s += ` with ${req.owner === "enemy" ? "an enemy" : "a friendly"} unit with the ${titleCase(jstr(req.requires_ability))} ability within range of it`;
  return s;
}

function selectionLimit(sel: P): string {
  const limit = sel.selection_limit as { count?: unknown; period?: unknown } | undefined;
  if (limit == null) return "";
  const times = Number(limit.count) === 1 ? "once" : `${jstr(limit.count)} times`;
  return ` (each objective marker can be selected for this ability at most ${times} per ${jstr(limit.period).replace(/-/g, " ")})`;
}

type Render = (e: unknown) => string;

function lead(sel: P): string {
  return `${sel.count === "each" ? "for" : "select"} ${objectiveSelectorPhrase(sel)}${selectionLimit(sel)}`;
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
