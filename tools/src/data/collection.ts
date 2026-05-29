/**
 * A queryable, iterable view over one entity collection.
 *
 * Indexes (by id, by normalized name, by faction) are built once at construction.
 * Records are deduplicated by {@link CollectionConfig.dedupeKeyOf} (default: id,
 * first occurrence wins). Some records are intentionally shared: the same unit
 * id (e.g. `ministorum-priest`) appears under several factions, so units dedupe
 * on `(faction_id, id)` to keep each faction's copy; identical core abilities
 * (e.g. `leader`) copied into many faction files dedupe away on `ability_id`.
 *
 * `get(id)`/`find` return the first match when an id is shared across factions;
 * use {@link Collection.byFaction} or {@link Collection.findAll} to disambiguate.
 *
 * @packageDocumentation
 */
import { normalizeName } from "./normalize.js";

/** How a {@link Collection} reads keys and builds views from raw records. */
export interface CollectionConfig<T, V> {
  items: T[];
  /** Primary id of a record (e.g. `u => u.id`, `a => a.ability_id`). */
  idOf: (item: T) => string;
  /**
   * Uniqueness key used for deduplication. Defaults to {@link idOf}. Set to a
   * composite (e.g. `(faction_id, id)`) for records that share an id across
   * factions, so distinct copies are preserved rather than collapsed.
   */
  dedupeKeyOf?: (item: T) => string;
  /** Display name, if the record has one — drives {@link Collection.find}. */
  nameOf?: (item: T) => string | undefined;
  /** Owning faction id, if applicable — drives {@link Collection.byFaction}. */
  factionOf?: (item: T) => string | null | undefined;
  /** Wrap a raw record in its linked view. */
  wrap: (item: T) => V;
}

/**
 * A collection of one entity type, exposing id/name/faction lookups.
 *
 * Iterable: `for (const unit of units) { … }`.
 *
 * @typeParam T - the raw (generated) record type
 * @typeParam V - the linked view type returned to callers
 */
export class Collection<T, V> implements Iterable<V> {
  private readonly items: T[] = [];
  private readonly byId = new Map<string, T>();
  private readonly byNorm = new Map<string, T[]>();
  private readonly byFactionId = new Map<string, T[]>();
  private readonly idOf: (item: T) => string;
  private readonly nameOf?: (item: T) => string | undefined;
  private readonly wrapFn: (item: T) => V;

  constructor(cfg: CollectionConfig<T, V>) {
    this.idOf = cfg.idOf;
    this.nameOf = cfg.nameOf;
    this.wrapFn = cfg.wrap;
    const dedupeKeyOf = cfg.dedupeKeyOf ?? cfg.idOf;
    const seen = new Set<string>();
    for (const item of cfg.items) {
      const dedupeKey = dedupeKeyOf(item);
      if (seen.has(dedupeKey)) continue; // first-wins dedup
      seen.add(dedupeKey);
      this.items.push(item);

      const id = cfg.idOf(item);
      if (!this.byId.has(id)) this.byId.set(id, item); // first-wins for shared ids

      const name = cfg.nameOf?.(item);
      if (name) push(this.byNorm, normalizeName(name), item);

      const faction = cfg.factionOf?.(item);
      if (faction) push(this.byFactionId, faction, item);
    }
  }

  /** Every record, deduplicated by id, in first-seen order. */
  get all(): V[] {
    return this.items.map((item) => this.wrapFn(item));
  }

  /** Number of distinct records. */
  get size(): number {
    return this.items.length;
  }

  /** Look up by exact id. */
  get(id: string): V | undefined {
    const item = this.byId.get(id);
    return item ? this.wrapFn(item) : undefined;
  }

  /**
   * Look up by exact id *within a faction*. Use this when an id is shared
   * across factions (e.g. `chaos-land-raider` lives under five Chaos factions)
   * and a faction context is known — {@link get} would return whichever copy
   * was registered first, which may belong to the wrong faction. Returns
   * `undefined` when no record with that id belongs to `factionId`.
   */
  getInFaction(id: string, factionId: string): V | undefined {
    const list = this.byFactionId.get(factionId);
    const item = list?.find((i) => this.idOf(i) === id);
    return item ? this.wrapFn(item) : undefined;
  }

  /** Whether a record with this exact id exists. */
  has(id: string): boolean {
    return this.byId.has(id);
  }

  /**
   * Find one record by id or name. Name matching is diacritic- and
   * punctuation-insensitive (see {@link normalizeName}), trying, in order:
   * exact id → exact normalized name → normalized-name substring. Returns the
   * first match; names can repeat across factions, so use {@link findAll} or
   * {@link byFaction} when a query may be ambiguous.
   *
   * @example
   * units.find("Kharn"); // resolves "Khârn the Betrayer"
   */
  find(query: string): V | undefined {
    return this.findAll(query)[0];
  }

  /**
   * All records matching a query, by the same rules as {@link find}. An exact id
   * match returns just that record; otherwise every normalized-name-exact match
   * is returned, falling back to every normalized-name-substring match. Useful
   * to surface (rather than silently collapse) names shared across factions.
   */
  findAll(query: string): V[] {
    const byId = this.byId.get(query);
    if (byId) return [this.wrapFn(byId)];

    const key = normalizeName(query);
    const exact = this.byNorm.get(key);
    if (exact && exact.length > 0) return exact.map((i) => this.wrapFn(i));

    if (!this.nameOf || key === "") return [];
    return this.items
      .filter((item) => normalizeName(this.nameOf!(item) ?? "").includes(key))
      .map((item) => this.wrapFn(item));
  }

  /** All records belonging to a faction id (empty if the type has no faction). */
  byFaction(factionId: string): V[] {
    return (this.byFactionId.get(factionId) ?? []).map((i) => this.wrapFn(i));
  }

  [Symbol.iterator](): Iterator<V> {
    return this.items.map((item) => this.wrapFn(item))[Symbol.iterator]();
  }
}

function push<K, T>(map: Map<K, T[]>, key: K, value: T): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}
