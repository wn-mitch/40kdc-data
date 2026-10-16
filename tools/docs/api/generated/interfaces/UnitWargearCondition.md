[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / UnitWargearCondition

# Interface: UnitWargearCondition

Defined in: [generated.ts:1731](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1731)

[composition] This unit has the wargear item `wargear` (a wargear record, not a weapon). With models, count bounds how many models in this unit carry the item (state carry) or lack it (state lack).

## Properties

### type

> **type**: `"unit-wargear"`

Defined in: [generated.ts:1732](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1732)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:1733](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1733)

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
