[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Faction

# Interface: Faction

Defined in: [generated.ts:1386](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1386)

A playable faction or sub-faction.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "faction".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:1387](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1387)

***

### external\_refs?

> `optional` **external\_refs?**: [`ExternalReferenceList`](../type-aliases/ExternalReferenceList.md)

Defined in: [generated.ts:1388](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1388)

***

### name

> **name**: `string`

Defined in: [generated.ts:1389](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1389)

***

### parent\_faction\_id?

> `optional` **parent\_faction\_id?**: `string` \| `null`

Defined in: [generated.ts:1390](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1390)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:1391](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1391)

***

### keywords?

> `optional` **keywords?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:1392](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1392)

***

### aliases?

> `optional` **aliases?**: `string`[]

Defined in: [generated.ts:1393](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1393)

***

### faction\_rule\_ids

> **faction\_rule\_ids**: \[`string`, `...string[]`\]

Defined in: [generated.ts:1399](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1399)

References to the faction-wide abilities in display order

#### Min Items

1

***

### army\_construction\_rules?

> `optional` **army\_construction\_rules?**: `object`[]

Defined in: [generated.ts:1403](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1403)

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

Defined in: [generated.ts:1418](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1418)

URL to the faction's logo/emblem image.
