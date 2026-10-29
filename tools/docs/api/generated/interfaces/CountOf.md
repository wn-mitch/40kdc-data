[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / CountOf

# Interface: CountOf

Defined in: [generated.ts:1184](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1184)

A number equal to how many of `count_of` there are (models in this unit with `keyword`, models equipped with `wargear`, the battle round number).

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "count-of".

## Properties

### count\_of

> **count\_of**: [`ScalingSource`](../type-aliases/ScalingSource.md)

Defined in: [generated.ts:1185](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1185)

***

### keyword?

> `optional` **keyword?**: `string`

Defined in: [generated.ts:1186](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1186)

***

### wargear?

> `optional` **wargear?**: `string`

Defined in: [generated.ts:1187](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1187)

***

### within?

> `optional` **within?**: [`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md) \| \{ `per_battle_round`: \[[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]; \}

Defined in: [generated.ts:1191](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1191)

Reach used by count sources that count models or units within a named range.

#### Union Members

[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md)

***

##### Type Literal

\{ `per_battle_round`: \[[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]; \}

##### per\_battle\_round

> **per\_battle\_round**: \[[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]

###### Min Items

1
