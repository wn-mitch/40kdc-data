# Share Tokens (`share-v1`)

A **share token** is a compact, URL-safe binary encoding of an army list used in list-builder `#l=<token>` links. Because the token stores entity IDs as small integer indices into a shared registry, an entire army list fits in a URL fragment with no backend storage; decoders reconstruct unit names, points, and profiles from the embedded dataset.

Reference implementations exist in TypeScript (`tools/src/share/`), Rust (`crates/wh40kdc/src/share/`), Python (`python/src/wh40kdc/share.py`), and Go (`go/share.go`, exposed via the Go conformance runner). Byte-for-byte parity is pinned by `conformance/share/`.

## Why Gzip Is Not Used

The ID registry already performs the dictionary substitution that general-purpose compression would provide, shrinking long kebab-case entity IDs to 1–3 byte varints. For typical army lists, gzip headers and trailers (~18 bytes) add more overhead than compression saves, and an uncompressed varint buffer is straightforward to reproduce identically across languages without pinning deflate parameters. Tokens are encoded directly as unpadded base64url over unsigned LEB128 varints.

## The ID Registry

`data/share-registry.json` is a versioned, append-only dictionary mapping each shareable entity ID to a permanent integer index per kind:

```jsonc
{
  "version": 1,                       // monotonic; increments when `kinds` change
  "kinds": {
    "faction":     ["adepta-sororitas", "adeptus-astartes", "..."], // index = array position
    "detachment":  ["..."],
    "unit":        ["..."],
    "wargear":     ["..."],           // union of weapon and non-weapon wargear IDs
    "enhancement": ["..."],
    "ally_rule":   ["..."],
    "disposition": ["..."]
  },
  "aliases":    { "old-id": "new-id" }, // renames resolved on decode
  "tombstones": ["removed-id"]          // removed IDs whose slots remain reserved
}
```

Registry invariants (enforced by `npm run registry:build`):

- **Append-only indices:** New IDs are appended; existing indices never shift, so newer registries always decode older tokens.
- **Renames:** The original ID stays in its slot and `aliases` maps `old-id -> new-id`. Encoders accept the current ID at that slot, and decoders rewrite the slot back to the current ID.
- **Removals:** Removed IDs stay reserved in `tombstones` so subsequent indices never move.
- **Unknown indices:** An index outside the reader's registry returns `stale-registry` rather than misresolving (occurs only when an older reader encounters a token encoded by a newer registry).

Each language package embeds its copy of the registry (`tools/src/share/registry.generated.ts`, `crates/wh40kdc/src/share/registry.generated.json`, `python/src/wh40kdc/_share_registry.json`, `go/share_registry.json`), regenerated from `data/share-registry.json`.

Decoded IDs resolve in every game-mode view of a `Dataset` because exact ID lookups are not filtered by game mode.

## Decoded Shape (`ShareList`)

Field names use camelCase on the wire and in the conformance corpus:

```ts
interface ShareList {
  name: string;
  factionId: string | null;
  detachmentIds: string[];
  battleSize: "incursion" | "strike-force";
  disposition: string | null;        // force-disposition ID
  units: ShareUnit[];
}

interface ShareUnit {
  datasheetId: string;
  modelCount: number;
  isWarlord: boolean;
  enhancementId: string | null;
  allyFactionId: string | null;      // source faction for an allied unit
  allyRuleId: string | null;         // allied-rule ID permitting inclusion
  attachedToOrdinal: number | null;  // 0-based index into ShareList.units (bodyguard)
  grants: string[];                  // detachment keyword grants (free-form strings)
  loadout: [wargearId: string, count: number][];
}
```

`attachedToOrdinal` indexes into `ShareList.units` rather than referencing a datasheet ID so leaders bind unambiguously when a list contains multiple copies of the same unit.

## Wire Layout

A token is `base64url(buffer)` without padding (`+` -> `-`, `/` -> `_`, trailing `=` stripped). All integers after the 1-byte format version are unsigned LEB128 varints:

```text
formatVersion    1 byte  (= 1)
registryVersion  varint
name             varint byte-length + UTF-8 bytes
factionRef       varint  (0 = none; else faction index + 1)
battleSize       varint  (0 = incursion, 1 = strike-force)
dispositionRef   varint  (0 = none; else disposition index + 1)
detachmentCount  varint
  detachment[i]  varint  (detachment index)                x detachmentCount
unitCount        varint
  per unit:
    unitIdx        varint
    modelCount     varint
    flags          varint  bit0 warlord | bit1 enh | bit2 attach | bit3 ally | bit4 grants
    [enhIdx]       varint                                  if bit1
    [attachOrd]    varint  (ordinal into units)            if bit2
    [allyFaction]  varint  (0 = none, else index + 1)      if bit3
    [allyRule]     varint  (0 = none, else index + 1)      if bit3
    [grantCount]   varint                                  if bit4
      grant[j]     varint byte-length + UTF-8 bytes        x grantCount
    loadoutCount   varint
      loadout[k]   wargearIdx varint, count varint         x loadoutCount
```

Free-form strings (`name`, `grants`) are stored as length-prefixed UTF-8.

## Decode Failure Modes

Decoding returns a typed error result rather than throwing:

- **`malformed`** — invalid base64url, truncated buffer, or unsupported format version byte.
- **`stale-registry`** — a referenced index does not exist in the reader's registry for that kind.

URL fragments distinguish formats by key: `#l=` for `share-v1` tokens and `#list=` for legacy `gzip(roster-json)` links.
