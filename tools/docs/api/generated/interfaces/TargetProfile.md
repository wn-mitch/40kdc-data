[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / TargetProfile

# Interface: TargetProfile

Defined in: [generated.ts:7377](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7377)

A named target archetype for damage comparison. References a real dataset unit (faction_id + unit_id) rather than copying its stat line, so the profile stays in sync with dataset updates. Stats, keywords, and defensive abilities are resolved from the referenced unit at use time.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "target-profile".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:7378](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7378)

***

### name

> **name**: `string`

Defined in: [generated.ts:7379](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7379)

***

### description?

> `optional` **description?**: `string`

Defined in: [generated.ts:7380](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7380)

***

### faction\_id

> **faction\_id**: `string`

Defined in: [generated.ts:7384](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7384)

Kebab-case identifier

***

### unit\_id

> **unit\_id**: `string`

Defined in: [generated.ts:7388](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7388)

Kebab-case identifier

***

### model\_count\_override?

> `optional` **model\_count\_override?**: `number` \| `null`

Defined in: [generated.ts:7392](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7392)

Optional non-default squad size for the comparison. When null/absent, the referenced unit's model_count.min is used.

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:7393](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7393)
