# Share tokens (`share-v1`)

A **share token** is a compact, URL-safe encoding of an army list — the payload
behind the list builder's `#l=<token>` share links. It exists so a whole list
fits in a short URL with no backend: the token carries only entity ids (the
40kdc interoperability contract) as small integers, and the reader reconstructs
names, points, and everything else from the embedded dataset.

This document is the wire contract for anyone implementing encode/decode against
40kdc tokens (the reference implementations are TypeScript `tools/src/share/`,
Rust `crates/wh40kdc/src/share/`, and Python `python/src/wh40kdc/share.py`; the
`conformance/share/` corpus pins them byte-for-byte).

## Why not gzip?

The registry (below) already does the dictionary substitution that a
general-purpose compressor's backreferences would — a 35-character id becomes a
1–3 byte integer. At realistic list sizes a gzip header + trailer (~18 bytes)
costs more than it saves, and a raw varint buffer is trivially reproducible
byte-for-byte across languages without pinning a shared deflate. So the format
is **gzip-free**: varints straight to base64url.

## The id registry

`data/share-registry.json` is the versioned, **append-only** dictionary mapping
every shareable id to a stable integer index, per kind:

```jsonc
{
  "version": 1,                       // monotonic; bumps when `kinds` change
  "kinds": {
    "faction":     ["adepta-sororitas", "adeptus-astartes", …],  // index = position
    "detachment":  [...],
    "unit":        [...],
    "wargear":     [...],   // weapon ∪ non-weapon-wargear id space (loadout refs)
    "enhancement": [...],
    "ally_rule":   [...],
    "disposition": [...]
  },
  "aliases":    { "old-id": "new-id" },  // renames, applied on decode
  "tombstones": ["removed-id", …]        // removed ids whose slots are retained
}
```

Invariants (`npm run registry:build` enforces them):

- **Indices never move.** New ids are appended; existing indices are permanent.
  A newer registry therefore decodes any older token.
- **Renames** keep the old id in its slot and record `old → new` in `aliases`.
  The encoder accepts the *new* id at that slot; the decoder rewrites the slot's
  old id to the new one. Round-trips cleanly.
- **Removals** keep the slot (listed in `tombstones`) so old indices stay valid.
- An index a reader's registry doesn't have → **stale-registry** (never a silent
  misresolve). This only happens when an older reader meets a token written by a
  newer registry; the safe direction.

Each language package embeds its own copy of the registry (TS inlines it into
`registry.generated.ts`; Rust `include_str!`s `registry.generated.json`; Python
ships `_share_registry.json`), all regenerated from the one committed artifact.

## ShareList

The decoded value. Field names are camelCase (the on-the-wire JSON shape used by
the conformance corpus and the runner protocol):

```ts
interface ShareList {
  name: string;
  factionId: string | null;
  detachmentIds: string[];
  battleSize: "incursion" | "strike-force";
  disposition: string | null;            // force-disposition id
  units: ShareUnit[];
}
interface ShareUnit {
  datasheetId: string;
  modelCount: number;
  isWarlord: boolean;
  enhancementId: string | null;
  allyFactionId: string | null;          // source faction of an allied unit
  allyRuleId: string | null;             // allied-rule it came in under
  attachedToOrdinal: number | null;      // index into ShareList.units (the bodyguard)
  grants: string[];                       // detachment keyword grants (free strings)
  loadout: [wargearId: string, count: number][];
}
```

`attachedToOrdinal` is an index into the list's own `units` array — not a
datasheet id — so a leader binds to a specific row even when several rows share
a datasheet.

## Wire layout

The token is `base64url(buffer)` with no padding (`+`→`-`, `/`→`_`, trailing `=`
stripped). The buffer is, in order — all integers **unsigned LEB128** except the
leading format byte:

```
formatVersion    1 byte  (= 1)
registryVersion  varint
name             varint len + UTF-8 bytes
factionRef       varint  (0 = none; else faction index + 1)
battleSize       varint  (0 = incursion, 1 = strike-force)
dispositionRef   varint  (0 = none; else disposition index + 1)
detachmentCount  varint
  detachment[i]  varint  (detachment index)            × detachmentCount
unitCount        varint
  per unit:
    unitIdx        varint
    modelCount     varint
    flags          varint   bit0 warlord | bit1 enh | bit2 attach | bit3 ally | bit4 grants
    [enhIdx]       varint                       if bit1
    [attachOrd]    varint                       if bit2  (ordinal into units)
    [allyFaction]  varint   (0=none else idx+1)  ┐ if bit3
    [allyRule]     varint   (0=none else idx+1)  ┘
    [grantCount]   varint                        ┐ if bit4
      grant[j]:    varint len + UTF-8 bytes      ┘ × grantCount
    loadoutCount   varint
      loadout[k]:  wargearIdx varint, count varint   × loadoutCount
```

Free text (`name`, `grants`) is the only incompressible part and rides as
length-prefixed UTF-8. `grants` are stored as raw strings rather than registry
indices because the vocabulary is small, open, and per-detachment.

## Decode failure modes

- **malformed** — not valid base64url, truncated, or a leading byte ≠ the format
  version.
- **stale-registry** — a referenced index is outside the reader's registry for
  that kind (a token from a newer registry).

Both are normal return values, not exceptions. URL routing uses a distinct
fragment key per format: `#l=` for `share-v1`, the legacy `#list=` for the old
`gzip(roster-json)` links (still honoured by the builder for backward
compatibility).
