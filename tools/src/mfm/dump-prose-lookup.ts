/**
 * Faction-safe prose lookups over the enumerated dump rows: an ability is found only among the
 * rows its (faction, owner) prints. There is no global name fallback: a name another faction or
 * another datasheet prints is never returned, and two different texts under one query are an
 * error that lists them.
 */
import { DEFAULT_DUMP_PATH, loadDump, type MfmDump } from "./loader.js";
import { type AbilityRow, type AbilityRowKind, type AbilityRowSet, CORE_FACTION, enumerateAbilityRows, safeSlug, type UnownedRow } from "./dump-prose-rows.js";

/** Whose prose to search. A unit is a datasheet; `datasheetIds` pins the exact dump rows (a unit's `mfm` external refs). */
export type OwnerQuery =
  | { kind: "unit"; id: string; datasheetIds?: readonly string[] }
  | { kind: "detachment"; id: string; detachmentIds?: readonly string[] }
  | { kind: "enhancement"; id: string }
  | { kind: "army" }
  | { kind: "core" };

export interface ProseQuery {
  /** The repo faction dir(s) to search; `_core` for core rules. */
  faction: string | readonly string[];
  owner: OwnerQuery;
  /** A repo ability id or the printed name's slug. */
  ability: string;
  /** Only rows of these kinds (e.g. `["stratagem"]` under a detachment). */
  kinds?: readonly AbilityRowKind[];
  /** Only rows from (true) or outside (false) Combat Patrol publications. */
  combatPatrol?: boolean;
  /** Only rows from (true) or outside (false) Legends datasheets and publications. */
  legends?: boolean;
}

export interface ProseVariant {
  text: string | undefined;
  /** Every candidate row printing this text, in enumeration order. */
  rows: AbilityRow[];
}

export interface ProseHit {
  text: string | undefined;
  /** The first row's `dump.json#<id>`. */
  ref: string;
  rows: AbilityRow[];
}

const describeQuery = (q: ProseQuery): string => {
  const owner = q.owner.kind === "army" || q.owner.kind === "core" ? q.owner.kind : `${q.owner.kind} ${q.owner.id}`;
  return `${[q.faction].flat().join("|")} / ${owner} / ${q.ability}`;
};

const describeRow = (r: AbilityRow): string => {
  const owner = r.owner.kind === "army" || r.owner.kind === "core" ? r.owner.kind : `${r.owner.kind} "${r.owner.name}"`;
  return `${r.faction} ${owner} ${r.kind} "${r.name}" (${r.publication?.name ?? "no publication"}) ${r.ref}`;
};

/** Two or more different texts answer one query; each variant is listed with the rows that print it. */
export class AmbiguousProseError extends Error {
  constructor(
    readonly query: ProseQuery,
    readonly variants: readonly ProseVariant[],
  ) {
    super(
      `Ambiguous dump prose for ${describeQuery(query)}: ${variants.length} different texts\n` +
        variants.map((v, i) => `  variant ${i + 1}:\n${v.rows.map((r) => `    ${describeRow(r)}`).join("\n")}`).join("\n") +
        "\nNarrow the query (owner datasheetIds/detachmentIds, kinds, combatPatrol, legends).",
    );
    this.name = "AmbiguousProseError";
  }
}

const compact = (s: string): string => s.replace(/[^a-z0-9]/g, "");

/** A row's exact name keys: its slug, and the slug without a trailing "(…)" qualifier, for its name and aliases. */
function exactKeys(r: AbilityRow): string[] {
  const keys = new Set<string>();
  for (const n of [r.name, ...(r.aliases ?? [])]) {
    for (const v of [n, n.replace(/\s*\([^)]*\)\s*$/, "")]) {
      const s = safeSlug(v);
      if (s) keys.add(s);
    }
  }
  return [...keys];
}

/** The query's relaxed spellings: owner suffix and repo `-aura`/`-psychic` tails removed. */
function relaxedForms(q: ProseQuery): string[] {
  const forms = new Set([q.ability]);
  if (q.owner.kind === "detachment" && q.ability.endsWith(`-${q.owner.id}`)) forms.add(q.ability.slice(0, -q.owner.id.length - 1));
  for (const f of [...forms]) {
    let t = f;
    while (/-(aura|psychic)$/.test(t)) {
      t = t.replace(/-(aura|psychic)$/, "");
      forms.add(t);
    }
  }
  return [...forms];
}

/** The enumerated dump rows with faction-safe lookups. */
export class DumpProse implements AbilityRowSet {
  readonly rows: AbilityRow[];
  readonly unowned: UnownedRow[];
  private readonly byFaction = new Map<string, AbilityRow[]>();
  private readonly coreByDatasheet = new Map<string, AbilityRow[]>();

  constructor(set: AbilityRowSet) {
    this.rows = set.rows;
    this.unowned = set.unowned;
    for (const r of set.rows) {
      const g = this.byFaction.get(r.faction);
      if (g) g.push(r);
      else this.byFaction.set(r.faction, [r]);
      for (const ds of r.datasheetIds ?? []) this.coreByDatasheet.set(ds, [...(this.coreByDatasheet.get(ds) ?? []), r]);
    }
  }

  static fromDump(dump: MfmDump): DumpProse {
    return new DumpProse(enumerateAbilityRows(dump));
  }

  /** Every row the query's (faction, owner) prints, before name matching. */
  ownerRows(q: Omit<ProseQuery, "ability">): AbilityRow[] {
    const pool = [q.faction].flat().flatMap((f) => this.byFaction.get(f) ?? []);
    let rows: AbilityRow[];
    const o = q.owner;
    switch (o.kind) {
      case "unit": {
        const ids = new Set(o.datasheetIds ?? pool.flatMap((r) => (r.owner.kind === "datasheet" && r.owner.slug === o.id ? [r.owner.id] : [])));
        rows = pool.filter((r) => r.owner.kind === "datasheet" && ids.has(r.owner.id));
        // Core abilities the unit's datasheets print live once, in `_core`.
        const core = new Set<AbilityRow>();
        for (const id of [...ids].sort()) for (const r of this.coreByDatasheet.get(id) ?? []) core.add(r);
        rows.push(...core);
        break;
      }
      case "detachment": {
        const ids = o.detachmentIds ? new Set(o.detachmentIds) : null;
        rows = pool.filter((r) => r.owner.kind === "detachment" && (ids ? ids.has(r.owner.id) : r.owner.slug === o.id));
        break;
      }
      case "enhancement":
        rows = pool.filter((r) => r.owner.kind === "enhancement" && r.owner.slug === o.id);
        break;
      case "army":
        rows = pool.filter((r) => r.owner.kind === "army");
        break;
      case "core":
        rows = (this.byFaction.get(CORE_FACTION) ?? []).filter((r) => r.owner.kind === "core");
        break;
    }
    return rows.filter(
      (r) =>
        (!q.kinds || q.kinds.includes(r.kind)) &&
        (q.combatPatrol === undefined || (r.publication?.combatPatrol ?? false) === q.combatPatrol) &&
        (q.legends === undefined || r.legends === q.legends),
    );
  }

  /**
   * The owner's rows the ability names, by the first tier that matches: the exact slug; then the
   * query without its detachment suffix or `-aura`/`-psychic` tails; then spelling-insensitive
   * (hyphens and apostrophes ignored, counter-offensive = "Counteroffensive"); last, a repo id
   * that extends one printed name with an owner suffix (rapid-strike-gilded-blades), longest
   * name first.
   */
  candidates(q: ProseQuery): AbilityRow[] {
    const rows = this.ownerRows(q);
    const keyed = rows.map((r) => ({ r, keys: exactKeys(r) }));
    const exact = keyed.filter((k) => k.keys.includes(q.ability));
    if (exact.length) return exact.map((k) => k.r);
    const forms = relaxedForms(q);
    const relaxed = keyed.filter((k) => k.keys.some((key) => forms.includes(key)));
    if (relaxed.length) return relaxed.map((k) => k.r);
    const compactForms = new Set(forms.map(compact));
    const spelled = keyed.filter((k) => k.keys.some((key) => compactForms.has(compact(key))));
    if (spelled.length) return spelled.map((k) => k.r);
    // Repo ids that carry an owner suffix ("<name>-<combat-patrol>"): the longest printed name the id extends.
    const extended = keyed.map((k) => ({ r: k.r, len: Math.max(0, ...k.keys.filter((key) => q.ability.startsWith(`${key}-`)).map((key) => key.length)) }));
    const longest = Math.max(0, ...extended.map((e) => e.len));
    return longest ? extended.filter((e) => e.len === longest).map((e) => e.r) : [];
  }

  /** The distinct texts the query's candidates print (D10: each is its own record). */
  variants(q: ProseQuery): ProseVariant[] {
    const byText = new Map<string, ProseVariant>();
    for (const r of this.candidates(q)) {
      const key = r.text ?? "";
      const v = byText.get(key);
      if (v) v.rows.push(r);
      else byText.set(key, { text: r.text, rows: [r] });
    }
    return [...byText.values()];
  }

  /** The query's prose, null when its owner prints no such ability; throws {@link AmbiguousProseError} on two texts. */
  lookup(q: ProseQuery): ProseHit | null {
    const variants = this.variants(q);
    if (!variants.length) return null;
    if (variants.length > 1) throw new AmbiguousProseError(q, variants);
    const [v] = variants;
    return { text: v!.text, ref: v!.rows[0]!.ref, rows: v!.rows };
  }

  /** Diagnostics only: every row anywhere spelling-equal to `ability`. Never a resolution path. */
  elsewhere(ability: string): AbilityRow[] {
    const want = compact(ability);
    return this.rows.filter((r) => exactKeys(r).some((k) => compact(k) === want));
  }
}

let cached: { path: string; prose: DumpProse } | null = null;

/** The dump's prose index, loaded once per path. */
export function loadDumpProse(filePath: string = DEFAULT_DUMP_PATH): DumpProse {
  if (!cached || cached.path !== filePath) cached = { path: filePath, prose: DumpProse.fromDump(loadDump(filePath)) };
  return cached.prose;
}
