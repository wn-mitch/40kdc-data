/**
 * The share-token id registry: the versioned, append-only dictionary that maps
 * every shareable entity id to a stable integer index. The committed artifact
 * lives at `data/share-registry.json`; {@link build-share-registry} regenerates
 * it and `codegen:data` inlines it as `registry.generated.ts`.
 *
 * Indices never move (append-only), so a newer registry always decodes an older
 * token. Renames are carried by {@link ShareRegistry.aliases} (old id → current
 * id): the slot keeps the old id, the encoder also accepts the new id at that
 * slot, and the decoder rewrites old → new on the way out. Removed ids sit in
 * {@link ShareRegistry.tombstones} purely to document the retained slot.
 *
 * @packageDocumentation
 */

/** Registry kinds, in fixed order. The wire format references each by name. */
export const SHARE_KINDS = [
  "faction",
  "detachment",
  "unit",
  "wargear",
  "enhancement",
  "ally_rule",
  "disposition",
] as const;

export type ShareKind = (typeof SHARE_KINDS)[number];

/** The committed registry artifact (mirrors `data/share-registry.json`). */
export interface ShareRegistry {
  version: number;
  kinds: Record<ShareKind, string[]>;
  /** Rename map applied on decode: a retained (old) id → its current id. */
  aliases: Record<string, string>;
  /** Ids dropped from the dataset whose slots are retained for old tokens. */
  tombstones: string[];
}

/** Bidirectional lookup over one registry, prepared once for encode/decode. */
export class ShareRegistryIndex {
  readonly version: number;
  /** Per-kind id → index, including reverse-alias entries (new id → old slot). */
  private readonly toIndex: Record<ShareKind, Map<string, number>>;
  /** Per-kind index → id, with aliases pre-applied (old slot → current id). */
  private readonly fromIndex: Record<ShareKind, string[]>;

  constructor(registry: ShareRegistry) {
    this.version = registry.version;
    this.toIndex = {} as Record<ShareKind, Map<string, number>>;
    this.fromIndex = {} as Record<ShareKind, string[]>;

    for (const kind of SHARE_KINDS) {
      const ids = registry.kinds[kind] ?? [];
      const map = new Map<string, number>();
      const out: string[] = [];
      ids.forEach((id, i) => {
        map.set(id, i);
        // Decode resolves a slot to its current id (rewriting a renamed id).
        out.push(registry.aliases[id] ?? id);
      });
      // Encode must also find the *current* id at a renamed slot.
      for (const [oldId, newId] of Object.entries(registry.aliases)) {
        const slot = map.get(oldId);
        if (slot !== undefined && !map.has(newId)) map.set(newId, slot);
      }
      this.toIndex[kind] = map;
      this.fromIndex[kind] = out;
    }
  }

  /** Slot for an id, or undefined if the registry doesn't know it (stale). */
  index(kind: ShareKind, id: string): number | undefined {
    return this.toIndex[kind].get(id);
  }

  /** Current id at a slot, or undefined if the slot is out of range (stale). */
  id(kind: ShareKind, index: number): string | undefined {
    return this.fromIndex[kind][index];
  }

  /** Number of slots in a kind. */
  size(kind: ShareKind): number {
    return this.fromIndex[kind].length;
  }
}
