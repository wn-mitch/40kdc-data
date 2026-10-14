[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / TargetProfile

# Interface: TargetProfile

Defined in: [generated.ts:3460](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3460)

A named target archetype for damage comparison. References a real dataset unit (faction_id + unit_id) rather than copying its stat line, so the profile stays in sync with dataset updates. Stats, keywords, and defensive abilities are resolved from the referenced unit at use time.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "target-profile".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:3461](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3461)

***

### name

> **name**: `string`

Defined in: [generated.ts:3462](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3462)

***

### description?

> `optional` **description?**: `string`

Defined in: [generated.ts:3463](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3463)

***

### faction\_id

> **faction\_id**: `string`

Defined in: [generated.ts:3467](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3467)

Kebab-case identifier

***

### unit\_id

> **unit\_id**: `string`

Defined in: [generated.ts:3471](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3471)

Kebab-case identifier

***

### model\_count\_override?

> `optional` **model\_count\_override?**: `number` \| `null`

Defined in: [generated.ts:3475](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3475)

Optional non-default squad size for the comparison. When null/absent, the referenced unit's model_count.min is used.

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:3476](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3476)
