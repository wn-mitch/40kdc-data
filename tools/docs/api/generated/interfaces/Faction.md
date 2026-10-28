[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Faction

# Interface: Faction

Defined in: [generated.ts:3060](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3060)

A playable faction or sub-faction.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "faction".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:3061](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3061)

***

### external\_refs?

> `optional` **external\_refs?**: [`ExternalReferenceList`](../type-aliases/ExternalReferenceList.md)

Defined in: [generated.ts:3062](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3062)

***

### name

> **name**: `string`

Defined in: [generated.ts:3063](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3063)

***

### parent\_faction\_id?

> `optional` **parent\_faction\_id?**: `string` \| `null`

Defined in: [generated.ts:3064](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3064)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:3065](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3065)

***

### keywords?

> `optional` **keywords?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:3066](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3066)

***

### aliases?

> `optional` **aliases?**: `string`[]

Defined in: [generated.ts:3067](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3067)

***

### faction\_rule\_ids

> **faction\_rule\_ids**: \[`string`, `...string[]`\]

Defined in: [generated.ts:3073](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3073)

References to the faction-wide abilities in display order

#### Min Items

1

***

### keyword\_limits?

> `optional` **keyword\_limits?**: `object`[]

Defined in: [generated.ts:3077](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3077)

Army-wide caps on units carrying a keyword set, for an army of this faction (e.g. Genestealer Cults: at most one PATRIARCH; Asuryani: at most one TROUPE MASTER). A unit counts toward an entry when it carries every keyword in `keywords` (its keywords, faction keywords or name; see `mode` for alternatives) and none of `exempt_faction_keywords`. A selected detachment's `keyword_limit_overrides` entry with the same `keywords` replaces `max`.

#### keywords

> **keywords**: [`KeywordList`](../type-aliases/KeywordList.md)

#### max

> **max**: `number`

#### mode?

> `optional` **mode?**: `"units"` \| `"alternatives"`

How the cap counts. `units` (default): the number of units carrying every keyword in `keywords` (one datasheet's identity, e.g. PATRIARCH, or EPIC HERO + YVRAINE). `alternatives`: each keyword is an alternative carried by a different datasheet, and the cap is the number of distinct alternatives present in the army (e.g. COMMANDER FARSIGHT / ETHEREAL with max 1: an army has Farsight or Ethereals, not both).

#### exempt\_faction\_keywords?

> `optional` **exempt\_faction\_keywords?**: [`KeywordList8`](../type-aliases/KeywordList8.md)

***

### army\_construction\_rules?

> `optional` **army\_construction\_rules?**: `object`[]

Defined in: [generated.ts:3089](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3089)

Army-construction constraints evaluated against faction keywords. `faction-keyword-cohesion` limits how many distinct additional faction keywords an army built from this faction may include — the Space Marine Chapters rule, where a second Faction keyword names the unit's Chapter and only one Chapter may be fielded.

#### type

> **type**: `"faction-keyword-cohesion"`

#### base\_faction\_keyword

> **base\_faction\_keyword**: `string`

#### additional\_keyword\_source

> **additional\_keyword\_source**: `string`

Which secondary Faction keyword the constraint counts (e.g. `chapter`).

#### max\_distinct

> **max\_distinct**: `number`

Maximum number of distinct additional faction keywords an army may include.

***

### logo\_url?

> `optional` **logo\_url?**: `string`

Defined in: [generated.ts:3104](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3104)

URL to the faction's logo/emblem image.
