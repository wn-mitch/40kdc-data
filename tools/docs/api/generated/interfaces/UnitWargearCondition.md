[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / UnitWargearCondition

# Interface: UnitWargearCondition

Defined in: [generated.ts:2127](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2127)

[composition] This unit has the wargear item `wargear` (a wargear record, not a weapon). With models, count bounds how many models in this unit carry the item (state carry) or lack it (state lack).

## Properties

### type

> **type**: `"unit-wargear"`

Defined in: [generated.ts:2128](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2128)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2129](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2129)

#### subject

> **subject**: [`UnitRef`](../type-aliases/UnitRef.md)

#### wargear

> **wargear**: `string`

#### models?

> `optional` **models?**: `object`

##### models.count

> **count**: [`CountBounds2`](CountBounds2.md)

##### models.state

> **state**: `"carry"` \| `"lack"`
