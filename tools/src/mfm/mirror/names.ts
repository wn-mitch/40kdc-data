/**
 * Name matching between a repo id and printed dump names, by tiers: the exact slug or the id
 * without its detachment or faction suffix and `-aura`/`-psychic` tails; then spelling-insensitive
 * (hyphens and apostrophes ignored, D11); last, the longest printed name the id extends with an
 * owner suffix ("rapid-strike-gilded-blades"). Only the first tier with a hit counts.
 */
import type { AbilityRow } from "../dump-prose-rows.js";
import { safeSlug } from "../dump-prose-rows.js";
import { splitRating } from "./identity.js";

const compact = (s: string): string => s.replace(/[^a-z0-9]/g, "");

/** A row's exact name keys: its slug and the slug without a trailing "(…)" qualifier, for its name and aliases. */
export function nameKeys(r: AbilityRow): string[] {
  const keys = new Set<string>();
  const names = [r.name, ...(r.aliases ?? [])];
  if (r.kind === "core-ability") names.push(splitRating(r.name).base);
  for (const n of names) {
    for (const v of [n, n.replace(/\s*\([^)]*\)\s*$/, "")]) {
      const s = safeSlug(v);
      if (s) keys.add(s);
    }
  }
  return [...keys];
}

export type Tier = "exact" | "relaxed" | "spelling" | "extended";

/** The id's relaxed spellings: owner suffixes and `-aura`/`-psychic` tails removed. */
function relaxedForms(id: string, suffixes: readonly string[]): string[] {
  const forms = new Set([id]);
  for (const s of suffixes) {
    for (const f of [...forms]) if (s && f.endsWith(`-${s}`)) forms.add(f.slice(0, -s.length - 1));
  }
  for (const f of [...forms]) {
    let t = f;
    while (/-(aura|psychic)$/.test(t)) {
      t = t.replace(/-(aura|psychic)$/, "");
      forms.add(t);
    }
  }
  return [...forms];
}

/** Rows whose printed name the repo id names, with the tier that matched. */
export function matchName(rows: readonly AbilityRow[], id: string, suffixes: readonly string[] = []): { rows: AbilityRow[]; tier: Tier } | null {
  const keyed = rows.map((r) => ({ r, keys: nameKeys(r) }));
  // Exact and relaxed compete in one tier: "force-edge-psychic" names both "Force Edge (Psychic)"
  // and "Force Edge"; the caller picks among them by owner, not by which spelling kept the tail.
  const forms = relaxedForms(id, suffixes);
  const relaxed = keyed.filter((k) => k.keys.some((key) => forms.includes(key)));
  if (relaxed.length) return { rows: relaxed.map((k) => k.r), tier: relaxed.some((k) => k.keys.includes(id)) ? "exact" : "relaxed" };
  const compactForms = new Set(forms.map(compact));
  const spelled = keyed.filter((k) => k.keys.some((key) => compactForms.has(compact(key))));
  if (spelled.length) return { rows: spelled.map((k) => k.r), tier: "spelling" };
  const extended = keyed.map((k) => ({ r: k.r, len: Math.max(0, ...k.keys.filter((key) => id.startsWith(`${key}-`)).map((key) => key.length)) }));
  const longest = Math.max(0, ...extended.map((e) => e.len));
  return longest ? { rows: extended.filter((e) => e.len === longest).map((e) => e.r), tier: "extended" } : null;
}

/** Diagnostics: every row anywhere whose name is spelling-equal to the id (or its relaxed forms). */
export function spellingMatches(rows: readonly AbilityRow[], id: string, suffixes: readonly string[] = []): AbilityRow[] {
  const forms = new Set(relaxedForms(id, suffixes).map(compact));
  return rows.filter((r) => nameKeys(r).some((k) => forms.has(compact(k))));
}
