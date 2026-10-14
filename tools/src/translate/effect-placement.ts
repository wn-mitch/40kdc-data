/**
 * Where a unit or model may be placed: the placement keywords (a single value or a list that
 * all apply) and the `near` / `away_from` / `in_region` constraint lists shared by set-up,
 * add-unit and return-models. Each phrase starts with a space so it appends to its clause.
 */

import { objectivePhrase, type P } from "./condition-refs.js";
import { andList, dekebab, effectSubject, jstr, rangePhrase, regionPhrase, type Ctx } from "./effect-words.js";

const PLACEMENTS: Record<string, string> = {
  "closest-to-destruction": "as close as possible to where it was destroyed",
  "closest-to-original": "as close as possible to its original position",
  coherency: "in Unit Coherency",
  unengaged: "not within Engagement Range of any enemy units",
  "strategic-reserves": "in Strategic Reserves",
  anywhere: "anywhere on the battlefield",
  "connected-sections": "with its sections touching",
  "deployment-zone": "wholly within your deployment zone",
  "on-terrain": "on top of a terrain feature",
};

/** A placement keyword, or a list of them that all apply, with the legacy `range` for (wholly) within. */
export function placementPhrase(m: Record<string, unknown>, origin = "this model"): string {
  const list = Array.isArray(m.placement) ? (m.placement as unknown[]) : m.placement != null ? [m.placement] : [];
  const parts = list.map((p) => {
    const k = jstr(p);
    if (k === "wholly-within") return `wholly within ${rangePhrase(m.range)} of ${origin}`;
    if (k === "within") return `within ${rangePhrase(m.range)} of ${origin}`;
    return PLACEMENTS[k] ?? dekebab(k);
  });
  return parts.length ? ` ${andList(parts)}` : "";
}

/** Something a distance is measured to: a unit, an objective marker, a named marker, an edge or the centre. */
export function placePhrase(of: unknown, ctx: Ctx): string {
  if (of === "battlefield-edge") return "a battlefield edge";
  if (of === "battlefield-centre") return "the centre of the battlefield";
  if (of != null && typeof of === "object") {
    const o = of as P;
    if (o.marker != null) {
      const label = dekebab(jstr(o.marker)).replace(/ marker$/i, "");
      return `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label} marker`;
    }
    if (o.objective != null) {
      const obj = objectivePhrase(o.objective as P, false, "objective marker");
      return (o.objective as P).selection_var != null ? "that objective marker" : `${/^[aeiou]/i.test(obj) ? "an" : "a"} ${obj}`;
    }
  }
  return effectSubject(of ?? "this-model", ctx).replace(/^all /, "");
}

/** Away-from targets read as models: a bare enemy filter is "all enemy models". */
function awayPhrase(of: unknown, ctx: Ctx): string {
  if (of != null && typeof of === "object" && Object.keys(of).length === 1 && (of as P).owner === "enemy") return "all enemy models";
  return placePhrase(of, ctx);
}

/** The near / away_from / in_region lists as trailing limits. */
export function placementLimits(m: Record<string, unknown>, ctx: Ctx): string {
  const parts: string[] = [];
  for (const n of (m.near as P[] | undefined) ?? []) parts.push(`${n.wholly === true ? "wholly " : ""}within ${rangePhrase(n.range)} of ${placePhrase(n.of, ctx)}`);
  const region = m.in_region as P | undefined;
  if (region != null) parts.push(`${region.wholly === true ? "wholly " : ""}within ${regionPhrase(region.region as P)}`);
  const away = (m.away_from as P[] | undefined) ?? [];
  if (away.length) parts.push(`more than ${andList(away.map((a) => `${rangePhrase(a.range)} away from ${awayPhrase(a.of, ctx)}`))}`);
  // One placement reads as a plain limit; several all apply ("wholly within 48\" of this model and more than 8\" away …").
  return parts.length ? ` ${parts.join(" and ")}` : "";
}
