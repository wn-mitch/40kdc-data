/**
 * Ability identity as a pure function of the dump: every enumerated ability row is assigned to
 * exactly one identity, and every identity has one id.
 *
 * - Core rows (`_core`) keep bare ids. Rated core abilities ("Deadly Demise D3", "Firing Deck 2",
 *   "Scouts 6\"", "Feel No Pain 5+", "Damaged 4") fold into one identity per rule; the rating is
 *   kept on the identity per datasheet so a grant can carry it. A Core Rules container with the
 *   same name is the same identity.
 * - Faction rows take `<base>-<faction>`, where the faction is the publication that prints them
 *   (D7). The suffix is skipped when the base already ends with `-<faction>` (no double suffix).
 * - Stratagem and enhancement bases are `<name>-<detachment>`; every other base is the name slug.
 * - A datasheet stub that points at an army or detachment rule is that rule's identity.
 * - Rows sharing a (faction, namespace, base) but printing different text are variants (D10):
 *   the primary variant keeps the base, each other variant takes a disambiguator (an owner slug
 *   only it has, its Combat Patrol publication, `legends`, its row kind), in that order.
 */
import { createHash } from "node:crypto";
import type { AbilityRow, AbilityRowKind, AbilityRowSet } from "../dump-prose-rows.js";
import { CORE_FACTION, safeSlug } from "../dump-prose-rows.js";

export type Namespace = "core" | "local" | "stratagem" | "enhancement";

/** Row kinds a unit's datasheet prints as its own abilities (its `ability_ids`). */
export const UNIT_PRINTED_KINDS: ReadonlySet<AbilityRowKind> = new Set(["datasheet-ability", "core-ability", "datasheet-rule", "wargear", "damaged"]);

/**
 * Row kinds that seed a record when the repo lacks one. Sections, menu options, sub-abilities
 * and allegiance rows are parts or options of another rule; Core Rules containers are rules
 * text. They keep a record the repo already has but never create one.
 */
export const SEEDING_KINDS: ReadonlySet<AbilityRowKind> = new Set([
  "datasheet-ability",
  "core-ability",
  "datasheet-rule",
  "wargear",
  "damaged",
  "army-rule",
  "detachment-rule",
  "stratagem",
  "enhancement",
]);

export interface Identity {
  id: string;
  faction: string;
  namespace: Namespace;
  /** The printed name of the primary row (rating stripped for folded core rules). */
  name: string;
  /** The id before the faction suffix and disambiguator. */
  base: string;
  /** The disambiguator a non-primary variant carries, if any. */
  variant?: string;
  rows: AbilityRow[];
  kinds: AbilityRowKind[];
  /** Detachment of a stratagem/enhancement/detachment rule. */
  detachment?: { id: string; slug: string | null };
  /** Rated core abilities: dump datasheet id → printed rating ("D3", "5+", "6\""). */
  ratings?: Record<string, string>;
  /** Owning datasheet ids (unit-printed rows only). */
  datasheetIds: string[];
  /** True when some row is a seeding kind. */
  seeds: boolean;
  /** Distinct texts differed only by combat-patrol/legends/owner; the chosen disambiguator. */
  undecided?: string;
}

export interface IdentitySet {
  identities: Identity[];
  byId: Map<string, Identity>;
  /** `AbilityRow.key` → identity id. */
  byRowKey: Map<string, string>;
  /** `table#rowId` → identity ids (a row placed under several owners/factions). */
  byDumpRow: Map<string, string[]>;
  /** Anything the rules could not decide cleanly. */
  undecided: { id: string; reason: string }[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const norm = (t: string | undefined): string => (t ?? "").replace(/\s+/g, " ").trim();

/** A core ability's rating suffix: "D3", "2D6+6", "5+", "9\"", "12". */
const RATING = /^(?:\d*D\d+(?:\+\d+)?|\d+\+?|\d+")$/i;

/** "Deadly Demise D3" → { base: "Deadly Demise", rating: "D3" }; unrated names pass through. */
export function splitRating(name: string): { base: string; rating?: string } {
  const m = /^(.*\S)\s+(\S+)$/.exec(name.trim());
  if (m && RATING.test(m[2]!)) return { base: m[1]!, rating: m[2]! };
  return { base: name.trim() };
}

/** `<base>-<faction>` unless the base already names the faction. */
export function suffixed(base: string, faction: string): string {
  if (faction === CORE_FACTION) return base;
  if (base === faction || base.endsWith(`-${faction}`)) return base;
  return `${base}-${faction}`;
}

function ownerSlug(r: AbilityRow): string | null {
  return r.owner.kind === "army" || r.owner.kind === "core" ? null : r.owner.slug;
}

function namespaceOf(r: AbilityRow): Namespace {
  if (r.faction === CORE_FACTION) return "core";
  if (r.kind === "stratagem") return "stratagem";
  if (r.kind === "enhancement") return "enhancement";
  return "local";
}

/** The printed name without a trailing qualifier: "(Aura)", "(Psychic)", "(Upgrade)", "(Once per battle, per unit)". */
export function bareName(name: string): string {
  const t = name.replace(/\s*\([^()]*\)\s*$/, "").trim();
  return t || name.trim();
}

function baseOf(r: AbilityRow): string | null {
  if (r.faction === CORE_FACTION) return safeSlug(r.kind === "core-ability" ? splitRating(r.name).base : bareName(r.name));
  // An enhancement keeps its printed tag ("Symphonic Payload (Upgrade)"): roster exports print it,
  // so the id must carry it to round-trip. Other rules drop the qualifier.
  const slug = safeSlug(r.kind === "enhancement" ? r.name : bareName(r.name));
  if (!slug) return null;
  if (r.kind === "stratagem" || r.kind === "enhancement") {
    const det = ownerSlug(r);
    return det ? `${slug}-${det}` : slug;
  }
  return slug;
}

/** The primary variant keeps the bare base: a rule over a datasheet row, codex over patrol/legends, most owners, then first owner. */
function primaryScore(rows: AbilityRow[]): [number, number, number, number, string] {
  const rule = rows.some((r) => r.kind === "army-rule" || r.kind === "detachment-rule") ? 0 : 1;
  const cp = rows.every((r) => r.publication?.combatPatrol) ? 1 : 0;
  const legends = rows.every((r) => r.legends) ? 1 : 0;
  const owners = new Set(rows.map((r) => ownerSlug(r) ?? r.kind));
  const first = [...owners].sort(cmp)[0] ?? "";
  return [rule, cp, legends, -owners.size, first];
}

function compareScore(a: ReturnType<typeof primaryScore>, b: ReturnType<typeof primaryScore>): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x !== y) return typeof x === "number" ? (x as number) - (y as number) : cmp(x as string, y as string);
  }
  return 0;
}

const patrolSlug = (r: AbilityRow): string | null => {
  const s = safeSlug(r.publication?.name);
  return s ? s.replace(/^combat-patrol-/, "") : null;
};

/** Build every identity from the enumerated rows. Deterministic in the row set alone. */
export function buildIdentities(set: AbilityRowSet): IdentitySet {
  const undecided: IdentitySet["undecided"] = [];
  const ruleRowKey = new Map<string, AbilityRow[]>();
  for (const r of set.rows) {
    if (r.kind === "army-rule" || r.kind === "detachment-rule") {
      const k = `${r.table}#${r.rowId}`;
      ruleRowKey.set(k, [...(ruleRowKey.get(k) ?? []), r]);
    }
  }

  // Stubs follow the rule they point at (same faction first, else the rule's own faction).
  const stubTarget = new Map<string, AbilityRow>();
  for (const r of set.rows) {
    if (!r.textFrom) continue;
    const rules = ruleRowKey.get(`${r.textFrom.table}#${r.textFrom.rowId}`) ?? [];
    const rule = rules.find((x) => x.faction === r.faction) ?? rules[0];
    if (rule) stubTarget.set(r.key, rule);
  }

  // Group (faction, namespace, base) → rows; the stub joins its rule's group.
  const groups = new Map<string, AbilityRow[]>();
  const groupKeyOf = new Map<string, string>();
  for (const r of set.rows) {
    const anchor = stubTarget.get(r.key) ?? r;
    const base = baseOf(anchor);
    if (!base) {
      undecided.push({ id: r.key, reason: `row has no slug-able name: ${JSON.stringify(r.name)}` });
      continue;
    }
    const gk = `${anchor.faction}\u0000${namespaceOf(anchor)}\u0000${base}`;
    groupKeyOf.set(r.key, gk);
    const g = groups.get(gk);
    if (g) g.push(r);
    else groups.set(gk, [r]);
  }

  const identities: Identity[] = [];
  const byRowKey = new Map<string, string>();
  const taken = new Set<string>();
  for (const gk of [...groups.keys()].sort(cmp)) {
    const [faction, namespace, base] = gk.split("\u0000") as [string, Namespace, string];
    const rows = groups.get(gk)!;
    // Variants: one per distinct text; a stub and the rule it points at share the rule's text.
    const clusters = new Map<string, AbilityRow[]>();
    if (namespace === "core") clusters.set("", rows);
    else {
      for (const r of rows) {
        const anchor = stubTarget.get(r.key);
        const t = norm(anchor ? anchor.text : r.text);
        clusters.set(t, [...(clusters.get(t) ?? []), r]);
      }
    }
    const ordered = [...clusters.values()].sort((a, b) => compareScore(primaryScore(a), primaryScore(b)));
    const ownersOf = (rs: AbilityRow[]): Set<string> => new Set(rs.map((r) => ownerSlug(r)).filter((s): s is string => !!s));
    ordered.forEach((cluster, i) => {
      let variant: string | undefined;
      let note: string | undefined;
      if (i > 0) {
        const others = new Set(ordered.filter((_, j) => j !== i).flatMap((c) => [...ownersOf(c)]));
        const patrol = cluster.every((r) => r.publication?.combatPatrol) ? [...new Set(cluster.map(patrolSlug).filter((s): s is string => !!s))].sort(cmp) : [];
        const isRule = cluster.some((r) => r.kind === "army-rule" || r.kind === "detachment-rule");
        const tokens: string[] = [
          // A patrol's own army or detachment rule is named for its patrol, not a datasheet that cites it.
          ...(isRule ? patrol : []),
          ...[...ownersOf(cluster)].filter((s) => !others.has(s) && s !== base).sort(cmp),
          ...patrol,
          ...(cluster.every((r) => r.legends) ? ["legends"] : []),
          ...[...new Set(cluster.map((r) => r.kind))].sort(cmp),
        ];
        variant = tokens.find((t) => !taken.has(suffixed(`${base}-${t}`, faction)));
        if (!variant) {
          variant = `v${createHash("sha256").update(cluster.map((r) => r.key).sort(cmp).join("|")).digest("hex").slice(0, 6)}`;
          note = "no owner, publication or kind token distinguishes this variant; a row-hash token was used";
        }
      }
      const id = suffixed(variant ? `${base}-${variant}` : base, faction);
      if (taken.has(id)) {
        undecided.push({ id, reason: `derived id collides with another identity (${gk})` });
        return;
      }
      taken.add(id);
      const primary = [...cluster].sort((a, b) => (stubTarget.has(a.key) ? 1 : 0) - (stubTarget.has(b.key) ? 1 : 0) || cmp(a.key, b.key))[0]!;
      const det = cluster.find((r) => r.owner.kind === "detachment");
      const ratings: Record<string, string> = {};
      for (const r of cluster) {
        if (r.kind !== "core-ability") continue;
        const rating = splitRating(r.name).rating;
        if (rating) for (const ds of r.datasheetIds ?? []) ratings[ds] = rating;
      }
      const ident: Identity = {
        id,
        faction,
        namespace,
        name: namespace === "core" && primary.kind === "core-ability" ? splitRating(primary.name).base : primary.name,
        base,
        ...(variant ? { variant } : {}),
        rows: cluster,
        kinds: [...new Set(cluster.map((r) => r.kind))].sort(cmp),
        ...(det && det.owner.kind === "detachment" && (namespace !== "local" || cluster.every((r) => r.owner.kind === "detachment"))
          ? { detachment: { id: det.owner.id, slug: det.owner.slug } }
          : {}),
        ...(Object.keys(ratings).length ? { ratings } : {}),
        datasheetIds: [...new Set(cluster.flatMap((r) => (r.owner.kind === "datasheet" ? [r.owner.id] : (r.datasheetIds ?? []))))].sort(cmp),
        seeds: cluster.some((r) => SEEDING_KINDS.has(r.kind)),
        ...(note ? { undecided: note } : {}),
      };
      if (note) undecided.push({ id, reason: note });
      identities.push(ident);
      for (const r of cluster) byRowKey.set(r.key, id);
    });
  }

  const byDumpRow = new Map<string, string[]>();
  for (const i of identities) {
    for (const r of i.rows) {
      const k = `${r.table}#${r.rowId}`;
      const ids = byDumpRow.get(k) ?? [];
      if (!ids.includes(i.id)) ids.push(i.id);
      byDumpRow.set(k, ids);
    }
  }
  return { identities, byId: new Map(identities.map((i) => [i.id, i])), byRowKey, byDumpRow, undecided };
}

/** "d6-plus-2" → "D6+2", "5-plus" → 5, "1" → 1: the rating an old rated id spells. */
export function ratingFromTail(tail: string): string | number | null {
  const t = tail.replace(/-plus$/, "").replace(/-plus-/, "+").replace(/^(\d*d\d+)-(\d+)$/, "$1+$2");
  if (/^\d+$/.test(t)) return Number(t);
  return /^\d*d\d+(\+\d+)?$/.test(t) ? t.toUpperCase() : null;
}

