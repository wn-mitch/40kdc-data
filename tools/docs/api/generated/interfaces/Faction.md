[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Faction

# Interface: Faction

Defined in: [generated.ts:3187](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3187)

A playable faction or sub-faction.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "faction".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:3188](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3188)

***

### external\_refs?

> `optional` **external\_refs?**: [`ExternalReferenceList`](../type-aliases/ExternalReferenceList.md)

Defined in: [generated.ts:3189](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3189)

***

### name

> **name**: `string`

Defined in: [generated.ts:3190](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3190)

***

### parent\_faction\_id?

> `optional` **parent\_faction\_id?**: `string` \| `null`

Defined in: [generated.ts:3191](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3191)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:3192](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3192)

***

### keywords?

> `optional` **keywords?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:3193](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3193)

***

### aliases?

> `optional` **aliases?**: `string`[]

Defined in: [generated.ts:3194](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3194)

***

### faction\_rule\_ids

> **faction\_rule\_ids**: \[`string`, `...string[]`\]

Defined in: [generated.ts:3200](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3200)

References to the faction-wide abilities in display order

#### Min Items

1

***

### keyword\_limits?

> `optional` **keyword\_limits?**: `object`[]

Defined in: [generated.ts:3204](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3204)

Army-wide caps on units carrying a keyword set, for an army of this faction (e.g. Genestealer Cults: at most one PATRIARCH; Asuryani: at most one TROUPE MASTER). A unit counts toward an entry when it carries every keyword in `keywords` (its keywords, faction keywords or name; see `mode` for alternatives) and none of `exempt_faction_keywords`. A selected detachment's `keyword_limit_overrides` entry with the same `keywords` replaces `max`.

#### keywords

> **keywords**: [`KeywordList`](../type-aliases/KeywordList.md)

#### max

> **max**: `number`

#### mode?

> `optional` **mode?**: `"units"` \| `"alternatives"`

How the cap counts. `units` (default): the number of units carrying every keyword in `keywords` (one datasheet's identity, e.g. PATRIARCH, or EPIC HERO + YVRAINE). `alternatives`: each keyword is an alternative carried by a different datasheet, and the cap is the number of distinct alternatives present in the army (e.g. COMMANDER FARSIGHT / ETHEREAL with max 1: an army has Farsight or Ethereals, not both).

#### exempt\_faction\_keywords?

> `optional` **exempt\_faction\_keywords?**: [`KeywordList10`](../type-aliases/KeywordList10.md)

***

### army\_construction\_rules?

> `optional` **army\_construction\_rules?**: `object`[]

Defined in: [generated.ts:3216](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3216)

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

Defined in: [generated.ts:3231](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3231)

URL to the faction's logo/emblem image.
