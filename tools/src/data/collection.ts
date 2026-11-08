/**
 * A queryable, iterable view over one entity collection.
 *
 * Indexes (by id, by normalized name, by faction) are built once at construction.
 * Records are deduplicated by {@link CollectionConfig.dedupeKeyOf} (default: id,
 * first occurrence wins). Some records are intentionally shared: the same id
 * (e.g. unit `ministorum-priest`, ability `deadly-demise-d3`) appears under
 * several factions with per-faction copies that may diverge, so those
 * collections dedupe on `(faction_id, id)` to keep each faction's copy and
 * resolve faction-scoped.
 *
 * `get(id)`/`find` return the first match when an id is shared across factions;
 * use {@link Collection.byFaction} or {@link Collection.findAll} to disambiguate.
 *
 * Collections whose copies genuinely diverge per faction (units: different
 * points, keywords and profiles) set {@link CollectionConfig.guardUnscoped} so a
 * faction-less {@link Collection.get} of an id that exists under several factions
 * throws outside production — a faction-unaware lookup there is a bug (it would
 * silently return whichever faction's copy registered first). Code that has no
 * faction context on purpose (roster import, the conformance runner) calls
 * {@link Collection.getAny} instead.
 *
 * A collection may be game-mode scoped (see {@link CollectionConfig.gameModesOf}):
 * listing methods (`all`, iteration, `size`, `byFaction`, `find`, `findAll`)
 * skip records whose effective game modes lack the collection's mode, while id
 * lookups (`get`, `getAny`, `getInFaction`, `has`, `byExternalRef`) resolve
 * every record whatever the mode, so share tokens, saved rosters and internal
 * references keep resolving. {@link Collection.withGameMode} builds a view over
 * the same indexes for another mode.
 *
 * @packageDocumentation
 */
import { externalRefKey } from "../external-refs.js";
import type { GameModeId } from "../generated.js";
import { normalizeName } from "./normalize.js";

/** A game mode a dataset view lists, or `"all"` to list every record. */
export type GameModeView = GameModeId | "all";

/** Every accepted {@link GameModeView} value. */
export const GAME_MODE_VIEWS: readonly GameModeView[] = [
  "matched-play",
  "combat-patrol",
  "boarding-actions",
  "crusade",
  "all",
];

/** The view a dataset lists when no mode is chosen: matched play. */
export const DEFAULT_GAME_MODE: GameModeView = "matched-play";

/** Throw unless `mode` is a {@link GameModeView}. */
export function assertGameModeView(mode: string): asserts mode is GameModeView {
  if (!(GAME_MODE_VIEWS as readonly string[]).includes(mode)) {
    throw new Error(
      `Unknown game mode "${mode}"; expected one of ${GAME_MODE_VIEWS.join(", ")}`,
    );
  }
}

/**
 * Whether a record with these `game_modes` is listed in `mode`. An absent or
 * empty `game_modes` means matched play only; `"all"` lists everything.
 */
export function inGameMode(
  gameModes: readonly string[] | null | undefined,
  mode: GameModeView,
): boolean {
  if (mode === "all") return true;
  return gameModes && gameModes.length > 0
    ? gameModes.includes(mode)
    : mode === "matched-play";
}

/**
 * True only in a production build. The {@link CollectionConfig.guardUnscoped}
 * tripwire throws everywhere else (dev servers, `vitest`, CLI tools) so an
 * ambiguous unscoped lookup surfaces immediately; in production it degrades to
 * the historical first-wins behaviour rather than crashing a user's session.
 */
const PRODUCTION =
  typeof process !== "undefined" && process.env?.NODE_ENV === "production";

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
  /**
   * Alternate names a record answers to (spelling variants from other tools'
   * exports). Indexed alongside {@link nameOf} so {@link Collection.find} /
   * {@link Collection.findAll} match an alias exactly, but never returned as the
   * record's display name. The canonical name always wins a collision.
   */
  aliasesOf?: (item: T) => readonly string[] | null | undefined;
  /**
   * Renamed-id map (old id → current id), consulted by id lookups
   * ({@link Collection.get}/{@link Collection.getAny}/{@link Collection.getInFaction}/
   * {@link Collection.has}) only when the exact id misses. Lets a persisted
   * reference to a since-renamed id (e.g. a saved roster or share link authored
   * before an enhancement id was normalized) still resolve to the current
   * record. The map is expected to be pre-flattened (each key maps directly to a
   * terminal live id), so a single hop suffices. Typically the share registry's
   * `aliases`.
   */
  idAliases?: Readonly<Record<string, string>>;
  /** Stable source identities indexed by {@link Collection.byExternalRef}. */
  externalRefsOf?: (
    item: T,
  ) => readonly { namespace: string; id: string }[] | null | undefined;
  /** Owning faction id, if applicable — drives {@link Collection.byFaction}. */
  factionOf?: (item: T) => string | null | undefined;
  /**
   * When set, a faction-less {@link Collection.get} of an id that exists under
   * more than one faction throws outside production (see module docs). Use for
   * collections whose per-faction copies diverge (units), so callers are forced
   * to pass faction via {@link Collection.getInFaction} or opt out explicitly
   * with {@link Collection.getAny}. Requires {@link factionOf}.
   */
  guardUnscoped?: boolean;
  /**
   * Noun used in the {@link guardUnscoped} throw message (e.g. `"unit"`,
   * `"detachment"`). Defaults to `"entity"`. Cosmetic — steers the error toward
   * the right collection without changing behaviour.
   */
  entityLabel?: string;
  /**
   * The record's `game_modes`, for record types that carry the field. When set,
   * the collection is game-mode scoped: listing methods skip records not in
   * {@link gameMode} (see module docs). Unset collections list every record in
   * every mode.
   */
  gameModesOf?: (item: T) => readonly string[] | null | undefined;
  /** The mode listing methods filter to. Defaults to {@link DEFAULT_GAME_MODE}. */
  gameMode?: GameModeView;
  /** Wrap a raw record in its linked view. */
  wrap: (item: T) => V;
}

/** Indexes shared by every game-mode view of one collection. */
interface CollectionIndex<T> {
  items: T[];
  byId: Map<string, T>;
  byNorm: Map<string, T[]>;
  byFactionId: Map<string, T[]>;
  byExternalRefKey: Map<string, T[]>;
  idOf: (item: T) => string;
  nameOf?: (item: T) => string | undefined;
  gameModesOf?: (item: T) => readonly string[] | null | undefined;
  idAliases?: Readonly<Record<string, string>>;
  /** Ids registered under >1 faction; only populated when guarding. */
  ambiguousIds?: Set<string>;
  /** Noun for the guard throw message. */
  entityLabel: string;
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
  private readonly ix: CollectionIndex<T>;
  private readonly wrapFn: (item: T) => V;
  /** The game mode listing methods filter to. */
  readonly gameMode: GameModeView;
  /** `ix.items` filtered to {@link gameMode}; the same array when unscoped. */
  private readonly listed: T[];

  constructor(cfg: CollectionConfig<T, V>) {
    this.wrapFn = cfg.wrap;
    this.gameMode = cfg.gameMode ?? DEFAULT_GAME_MODE;
    this.ix = buildIndex(cfg);
    this.listed = this.filterListed(this.ix.items);
  }

  /**
   * A view of this collection listing `mode` instead, sharing every index (no
   * rebuild). `wrap` re-binds linked views to the caller's dataset view;
   * omitted, records wrap as they do here.
   */
  withGameMode(mode: GameModeView, wrap?: (item: T) => V): Collection<T, V> {
    assertGameModeView(mode);
    const view = Object.create(Collection.prototype) as Collection<T, V>;
    const fields = view as unknown as {
      ix: CollectionIndex<T>;
      wrapFn: (item: T) => V;
      gameMode: GameModeView;
      listed: T[];
    };
    fields.ix = this.ix;
    fields.wrapFn = wrap ?? this.wrapFn;
    fields.gameMode = mode;
    fields.listed = view.filterListed(this.ix.items);
    return view;
  }

  /** Whether a record is listed in this view's mode. */
  private isListed(item: T): boolean {
    const modesOf = this.ix.gameModesOf;
    return !modesOf || inGameMode(modesOf(item), this.gameMode);
  }

  /** The records of `items` listed in this view's mode (`items` itself when all are). */
  private filterListed(items: T[]): T[] {
    if (!this.ix.gameModesOf || this.gameMode === "all") return items;
    return items.filter((item) => this.isListed(item));
  }

  /** Every record, deduplicated by id, in first-seen order. */
  get all(): V[] {
    return this.listed.map((item) => this.wrapFn(item));
  }

  /** Number of distinct records. */
  get size(): number {
    return this.listed.length;
  }

  /**
   * Look up by exact id. For a guarded collection (see
   * {@link CollectionConfig.guardUnscoped}), an id that exists under more than
   * one faction throws outside production — pass a faction via
   * {@link getInFaction}, or call {@link getAny} when faction is genuinely
   * unknown. In production this degrades to first-wins.
   */
  get(id: string): V | undefined {
    if (!PRODUCTION && this.ix.ambiguousIds?.has(id)) {
      throw new Error(
        `Ambiguous ${this.ix.entityLabel} lookup: "${id}" exists under multiple factions; ` +
          `faction-less get() would return whichever copy registered first ` +
          `(wrong divergent fields). Use getInFaction("${id}", factionId), ` +
          `or getAny("${id}") when faction is genuinely unknown (import / conformance).`,
      );
    }
    const item = this.rawById(id);
    return item ? this.wrapFn(item) : undefined;
  }

  /**
   * Raw record for an id: exact `byId`, falling back to the {@link idAliases}
   * map (old id → current id) on a miss so a persisted reference to a renamed
   * id still resolves. Aliases are pre-flattened, so one hop is enough.
   */
  private rawById(id: string): T | undefined {
    const direct = this.ix.byId.get(id);
    if (direct) return direct;
    const aliased = this.ix.idAliases?.[id];
    return aliased !== undefined ? this.ix.byId.get(aliased) : undefined;
  }

  /**
   * First-wins lookup by exact id that never throws, for callers with no
   * faction context on purpose (roster import, the conformance runner). For a
   * guarded collection this is the explicit opt-out of {@link get}'s ambiguity
   * tripwire; for an unguarded one it is identical to {@link get}.
   */
  getAny(id: string): V | undefined {
    const item = this.rawById(id);
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
    // Resolve a renamed id to its current form before scoping to the faction.
    const resolvedId = this.ix.byId.has(id)
      ? id
      : (this.ix.idAliases?.[id] ?? id);
    const list = this.ix.byFactionId.get(factionId);
    const item = list?.find((i) => this.ix.idOf(i) === resolvedId);
    return item ? this.wrapFn(item) : undefined;
  }

  /** Whether a record with this exact id (or a renamed alias of it) exists. */
  has(id: string): boolean {
    return this.rawById(id) !== undefined;
  }

  /**
   * Return every canonical record carrying an exact external source identity.
   * External mappings are many-to-many: several records may share one source
   * identity, and one record may carry several ids from the same namespace.
   */
  byExternalRef(namespace: string, id: string): V[] {
    return (
      this.ix.byExternalRefKey.get(externalRefKey(namespace, id)) ?? []
    ).map(
      (item) => this.wrapFn(item),
    );
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
   * Every step skips records outside this view's game mode, the exact-id step
   * included: a name search lists, so it never returns a hidden record (use
   * {@link getAny} to resolve one by id).
   */
  findAll(query: string): V[] {
    const byId = this.rawById(query);
    if (byId && this.isListed(byId)) return [this.wrapFn(byId)];

    const key = normalizeName(query);
    const exact = this.filterListed(this.ix.byNorm.get(key) ?? []);
    if (exact.length > 0) return exact.map((i) => this.wrapFn(i));

    const nameOf = this.ix.nameOf;
    if (!nameOf || key === "") return [];
    return this.listed
      .filter((item) => normalizeName(nameOf(item) ?? "").includes(key))
      .map((item) => this.wrapFn(item));
  }

  /**
   * All records belonging to a faction id that this view's game mode lists
   * (empty if the type has no faction).
   */
  byFaction(factionId: string): V[] {
    return this.filterListed(this.ix.byFactionId.get(factionId) ?? []).map(
      (i) => this.wrapFn(i),
    );
  }

  [Symbol.iterator](): Iterator<V> {
    return this.listed.map((item) => this.wrapFn(item))[Symbol.iterator]();
  }
}

/** Build the shared indexes for a collection's records. */
function buildIndex<T, V>(cfg: CollectionConfig<T, V>): CollectionIndex<T> {
  const ix: CollectionIndex<T> = {
    items: [],
    byId: new Map(),
    byNorm: new Map(),
    byFactionId: new Map(),
    byExternalRefKey: new Map(),
    idOf: cfg.idOf,
    nameOf: cfg.nameOf,
    gameModesOf: cfg.gameModesOf,
    idAliases: cfg.idAliases,
    entityLabel: cfg.entityLabel ?? "entity",
  };
  const dedupeKeyOf = cfg.dedupeKeyOf ?? cfg.idOf;
  const seen = new Set<string>();
  // id -> distinct faction ids it appears under (only tracked when guarding).
  const idFactions = cfg.guardUnscoped
    ? new Map<string, Set<string>>()
    : undefined;
  for (const item of cfg.items) {
    const dedupeKey = dedupeKeyOf(item);
    if (seen.has(dedupeKey)) continue; // first-wins dedup
    seen.add(dedupeKey);
    ix.items.push(item);

    const id = cfg.idOf(item);
    if (!ix.byId.has(id)) ix.byId.set(id, item); // first-wins for shared ids

    const name = cfg.nameOf?.(item);
    if (name) push(ix.byNorm, normalizeName(name), item);

    // Alias names answer to the same record. Index them after the canonical
    // name and skip any alias that normalizes to an already-registered name,
    // so an alias can never displace the canonical owner of a normalized key.
    for (const alias of cfg.aliasesOf?.(item) ?? []) {
      const aliasKey = normalizeName(alias);
      if (
        aliasKey === "" ||
        aliasKey === (name ? normalizeName(name) : undefined)
      )
        continue;
      push(ix.byNorm, aliasKey, item);
    }
    for (const ref of cfg.externalRefsOf?.(item) ?? []) {
      push(ix.byExternalRefKey, externalRefKey(ref.namespace, ref.id), item);
    }

    const faction = cfg.factionOf?.(item);
    if (faction) {
      push(ix.byFactionId, faction, item);
      if (idFactions) {
        const set = idFactions.get(id);
        if (set) set.add(faction);
        else idFactions.set(id, new Set([faction]));
      }
    }
  }
  if (idFactions) {
    ix.ambiguousIds = new Set();
    for (const [id, factions] of idFactions) {
      if (factions.size > 1) ix.ambiguousIds.add(id);
    }
  }
  return ix;
}

function push<K, T>(map: Map<K, T[]>, key: K, value: T): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}
