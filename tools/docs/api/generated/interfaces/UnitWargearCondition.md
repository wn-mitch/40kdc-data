[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / UnitWargearCondition

# Interface: UnitWargearCondition

Defined in: [generated.ts:2031](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2031)

[composition] This unit has the wargear item `wargear` (a wargear record, not a weapon). With models, count bounds how many models in this unit carry the item (state carry) or lack it (state lack).

## Properties

### type

> **type**: `"unit-wargear"`

Defined in: [generated.ts:2032](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2032)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2033](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2033)

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
