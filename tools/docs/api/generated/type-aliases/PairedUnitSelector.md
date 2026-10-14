[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / PairedUnitSelector

# Type Alias: PairedUnitSelector

> **PairedUnitSelector** = `object` & [`PairedUnitSelector1`](PairedUnitSelector1.md)

Defined in: [generated.ts:648](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L648)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "paired-unit-selector".

## Type Declaration

### owner

> **owner**: `"friendly"` \| `"enemy"`

### count?

> `optional` **count?**: `1`

### selection\_mode?

> `optional` **selection\_mode?**: `"any-number"`

### requires\_ability?

> `optional` **requires\_ability?**: `string`

### visible\_to?

> `optional` **visible\_to?**: [`SelectionReference`](../interfaces/SelectionReference.md)

### selection\_limit?

> `optional` **selection\_limit?**: `object`

#### selection\_limit.count

> **count**: `number`

#### selection\_limit.period

> **period**: `"turn"` \| `"phase"` \| `"battle-round"` \| `"battle"`

### bind\_as

> **bind\_as**: `string`
